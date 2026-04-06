import { createRequire } from "node:module";
import { callJsonRpc } from "./rpc.js";
import { ProviderStore } from "./store.js";
import {
  MonitorMode,
  MonitorSource,
  ProviderConfig,
  RouteXConfig,
} from "./types.js";

const require = createRequire(import.meta.url);

type MonitorHandle = {
  stop: () => void;
};

type YellowstoneStream = {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  write: (chunk: unknown, callback: (error?: Error | null) => void) => void;
  end?: () => void;
  destroy?: () => void;
};

type YellowstoneChannelOptions = {
  grpcHttp2KeepAliveInterval: number;
  grpcKeepAliveTimeout: number;
  grpcKeepAliveWhileIdle: boolean;
  grpcTcpKeepalive: number;
};

const DEFAULT_YELLOWSTONE_CHANNEL_OPTIONS: YellowstoneChannelOptions = {
  grpcHttp2KeepAliveInterval: 30_000,
  grpcKeepAliveTimeout: 10_000,
  grpcKeepAliveWhileIdle: true,
  grpcTcpKeepalive: 1,
};

function isNodeVersionCompatibleForYellowstone(): boolean {
  const [major, minor] = process.versions.node
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }

  // Yellow­stone gRPC works on modern LTS (>=18.18) and 20+. We relax the guard so demos
  // on Node 18 don't get forced to RPC-only mode.
  return major > 20 || (major === 20 && minor >= 0) || (major === 18 && minor >= 18) || major > 18;
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractYellowstoneSlot(update: unknown): number | null {
  if (!update || typeof update !== "object") {
    return null;
  }

  const value = update as Record<string, unknown>;

  return (
    parseNumberish((value.slot as Record<string, unknown> | undefined)?.slot) ??
    parseNumberish(value.slot) ??
    parseNumberish((value.blockMeta as Record<string, unknown> | undefined)?.slot) ??
    parseNumberish((value.block as Record<string, unknown> | undefined)?.slot)
  );
}

function normalizeYellowstoneEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();

  if (trimmed.includes("://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

async function probeProvider(
  provider: ProviderConfig,
  requestTimeoutMs: number,
): Promise<{ slot: number; latencyMs: number }> {
  const { response, durationMs } = await callJsonRpc(
    {
      name: provider.name,
      rpcUrl: provider.rpcUrl,
    },
    {
      jsonrpc: "2.0",
      id: `${provider.name}-probe`,
      method: "getSlot",
      params: [
        {
          commitment: "processed",
        },
      ],
    },
    requestTimeoutMs,
  );

  if (Array.isArray(response) || typeof response.result !== "number") {
    throw new Error(`Provider ${provider.name} returned an invalid slot result`);
  }

  return {
    slot: response.result,
    latencyMs: durationMs,
  };
}

function startRpcPollingMonitor(
  providerStore: ProviderStore,
  config: RouteXConfig,
  providers: ProviderConfig[],
): MonitorHandle {
  let stopped = false;
  let inFlight = false;

  const runCycle = async () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;

    try {
      await Promise.all(
        providers.map(async (provider) => {
          try {
            const result = await probeProvider(provider, config.requestTimeoutMs);
            providerStore.updateProbeSuccess(
              provider.name,
              result.slot,
              result.latencyMs,
              "rpc",
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown provider probe failure";
            const timeout = message.includes("aborted");
            providerStore.updateProbeFailure(provider.name, message, timeout, "rpc");
          }
        }),
      );

      const bestProvider = providerStore.getBestProvider({
        strategy: "read",
        maxSlotLag: null,
      });
      providerStore.markActiveProvider(bestProvider?.name ?? null);
    } finally {
      inFlight = false;
    }
  };

  void runCycle();
  const intervalId = setInterval(() => {
    void runCycle();
  }, config.monitorIntervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(intervalId);
    },
  };
}

function importYellowstoneModule(): {
  default: new (endpoint: string, xToken?: string, channelOptions?: Record<string, unknown>) => {
    connect: () => Promise<void>;
    subscribe: () => Promise<YellowstoneStream>;
  };
  CommitmentLevel: {
    PROCESSED: number;
  };
} {
  return require("@triton-one/yellowstone-grpc") as {
    default: new (endpoint: string, xToken?: string, channelOptions?: Record<string, unknown>) => {
      connect: () => Promise<void>;
      subscribe: () => Promise<YellowstoneStream>;
    };
    CommitmentLevel: {
      PROCESSED: number;
    };
  };
}

function startYellowstoneMonitor(
  providerStore: ProviderStore,
  config: RouteXConfig,
): MonitorHandle {
  let stopped = false;
  const cleanupFns: Array<() => void> = [];

  const eligibleProviders = config.providers.filter((provider) => provider.yellowstoneUrl);
  const fallbackProviders = config.providers.filter((provider) => !provider.yellowstoneUrl);

  if (eligibleProviders.length === 0) {
    providerStore.noteEvent(
      "warn",
      "yellowstone-unavailable",
      "No provider has a yellowstoneUrl configured, falling back to RPC polling",
      null,
    );
    providerStore.setActiveMonitorMode(
      "rpc",
      "RouteX fell back to RPC polling because no Yellowstone endpoints were configured",
    );
    return startRpcPollingMonitor(providerStore, config, config.providers);
  }

  if (!isNodeVersionCompatibleForYellowstone()) {
    providerStore.noteEvent(
      "warn",
      "yellowstone-runtime",
      `Node ${process.versions.node} does not satisfy the Yellowstone SDK runtime requirement, falling back to RPC polling`,
      null,
    );
    providerStore.setActiveMonitorMode(
      "rpc",
      "RouteX fell back to RPC polling because the local Node runtime is below 20.18",
    );
    return startRpcPollingMonitor(providerStore, config, config.providers);
  }

  providerStore.setActiveMonitorMode(
    "yellowstone",
    "RouteX is using Yellowstone slot streaming for freshness monitoring",
  );

  let rpcHybridHandle: MonitorHandle | null = null;

  providerStore.noteEvent(
    "info",
    "yellowstone-rpc-hybrid",
    fallbackProviders.length > 0
      ? "Yellowstone mode is active with RPC polling enabled for all providers and fallback-only coverage for providers without Yellowstone"
      : "Yellowstone mode is active with RPC polling enabled as a fallback and HTTP health verifier for all providers",
    null,
    {
      yellowstoneProviders: eligibleProviders.map((provider) => provider.name),
      rpcOnlyProviders: fallbackProviders.map((provider) => provider.name),
    },
  );
  rpcHybridHandle = startRpcPollingMonitor(providerStore, config, config.providers);

  const subscribeToProvider = async (
    provider: ProviderConfig,
    sdk: Awaited<ReturnType<typeof importYellowstoneModule>>,
  ) => {
    try {
      const Client = sdk.default;
      const client = new Client(
        normalizeYellowstoneEndpoint(provider.yellowstoneUrl ?? ""),
        provider.token,
        DEFAULT_YELLOWSTONE_CHANNEL_OPTIONS,
      );

      if (typeof client.connect === "function") {
        await client.connect();
      }

      const stream = await client.subscribe();
      let pingId = 1;
      let pingTimer: NodeJS.Timeout | null = null;

      const subscriptionRequest = {
        slots: {
          [provider.name]: {},
        },
        accounts: {},
        transactions: {},
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        accountsDataSlice: [],
        commitment: sdk.CommitmentLevel.PROCESSED,
      };

      await new Promise<void>((resolve, reject) => {
        stream.write(subscriptionRequest, (error) => {
          if (!error) {
            resolve();
            return;
          }

          reject(error);
        });
      });

      providerStore.noteEvent(
        "info",
        "yellowstone-subscribed",
        `Subscribed to Yellowstone slot updates for ${provider.name}`,
        provider.name,
      );

      stream.on("data", (update) => {
        const pingId = (update as { ping?: { id?: number } } | null)?.ping?.id;

        if (typeof pingId === "number") {
          stream.write(
            {
              ping: { id: pingId },
              accounts: {},
              slots: {},
              transactions: {},
              transactionsStatus: {},
              blocks: {},
              blocksMeta: {},
              entry: {},
              accountsDataSlice: [],
            },
            () => undefined,
          );
        }

        const slot = extractYellowstoneSlot(update);

        if (slot === null) {
          return;
        }

        providerStore.updateProbeSuccess(provider.name, slot, 1, "yellowstone");
        const bestProvider = providerStore.getBestProvider({
          strategy: "read",
          maxSlotLag: null,
        });
        providerStore.markActiveProvider(bestProvider?.name ?? null);
      });

      stream.on("error", (error) => {
        const message =
          error instanceof Error ? error.message : "Yellowstone stream error";
        providerStore.updateProbeFailure(provider.name, message, false, "yellowstone");
        providerStore.noteEvent(
          "error",
          "yellowstone-stream-error",
          `${provider.name} Yellowstone stream failed: ${message}`,
          provider.name,
        );

        if (!stopped) {
          setTimeout(() => {
            void subscribeToProvider(provider, sdk);
          }, config.monitorIntervalMs);
        }
      });

      stream.on("end", () => {
        providerStore.noteEvent(
          "warn",
          "yellowstone-stream-ended",
          `${provider.name} Yellowstone stream ended`,
          provider.name,
        );

        if (!stopped) {
          setTimeout(() => {
            void subscribeToProvider(provider, sdk);
          }, config.monitorIntervalMs);
        }
      });

      pingTimer = setInterval(() => {
        stream.write({ ping: { id: pingId } }, () => undefined);
        pingId += 1;
      }, 20_000);

      cleanupFns.push(() => {
        if (pingTimer) {
          clearInterval(pingTimer);
        }

        stream.end?.();
        stream.destroy?.();
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Yellowstone setup error";

      providerStore.noteEvent(
        "warn",
        "yellowstone-subscribe-failed",
        `${provider.name} could not start Yellowstone monitoring: ${message}`,
        provider.name,
      );
      providerStore.updateProbeFailure(provider.name, message, false, "yellowstone");

        if (!stopped) {
          setTimeout(() => {
            void subscribeToProvider(provider, sdk);
          }, config.monitorIntervalMs);
        }
    }
  };

  // Load SDK synchronously via require (CJS build); on failure fall back to RPC.
  try {
    const sdk = importYellowstoneModule();
    if (!stopped) {
      providerStore.setActiveMonitorMode(
        "yellowstone",
        "RouteX is using Yellowstone slot streaming for freshness monitoring",
      );

      for (const provider of eligibleProviders) {
        void subscribeToProvider(provider, sdk);
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to load Yellowstone SDK";
    providerStore.noteEvent(
      "warn",
      "yellowstone-import-failed",
      `${message}; falling back to RPC polling`,
      null,
    );
    providerStore.setActiveMonitorMode(
      "rpc",
      "RouteX fell back to RPC polling because Yellowstone import failed",
    );
    rpcHybridHandle = startRpcPollingMonitor(providerStore, config, config.providers);
  }

  return {
    stop: () => {
      stopped = true;
      for (const cleanup of cleanupFns) {
        cleanup();
      }
      rpcHybridHandle?.stop();
    },
  };
}

export function startMonitor(
  providerStore: ProviderStore,
  config: RouteXConfig,
): MonitorHandle {
  if (config.monitorMode === "yellowstone") {
    return startYellowstoneMonitor(providerStore, config);
  }

  providerStore.setActiveMonitorMode(
    "rpc",
    "RouteX is using RPC slot polling for provider monitoring",
  );
  return startRpcPollingMonitor(providerStore, config, config.providers);
}
