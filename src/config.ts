import { readFile } from "node:fs/promises";
import path from "node:path";
import { MonitorMode, ProviderConfig, RouteXConfig } from "./types.js";

function parseInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseMonitorMode(value: string | undefined): MonitorMode {
  if (!value || value.trim() === "") {
    return "rpc";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "rpc" || normalized === "yellowstone") {
    return normalized;
  }

  throw new Error(`Invalid ROUTEX_MONITOR_MODE: ${value}`);
}

function normalizeProviderConfig(input: unknown): ProviderConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Provider config must be an object");
  }

  const value = input as Record<string, unknown>;
  const {
    name,
    rpcUrl,
    cluster,
    yellowstoneUrl,
    token,
    writeEnabled,
    priorityBias,
    tags,
  } = value;

  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("Provider config is missing a valid name");
  }

  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error(`Provider ${name} is missing a valid rpcUrl`);
  }

  return {
    name: name.trim(),
    rpcUrl: rpcUrl.trim(),
    cluster:
      typeof cluster === "string" && cluster.trim() !== ""
        ? cluster
        : "mainnet-beta",
    yellowstoneUrl:
      typeof yellowstoneUrl === "string" && yellowstoneUrl.trim() !== ""
        ? yellowstoneUrl.trim()
        : undefined,
    token:
      typeof token === "string" && token.trim() !== ""
        ? token.trim()
        : undefined,
    writeEnabled: writeEnabled !== false,
    priorityBias:
      typeof priorityBias === "number" && Number.isFinite(priorityBias)
        ? priorityBias
        : 0,
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

async function loadProvidersFromFile(filePath: string): Promise<ProviderConfig[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Provider config file must contain an array");
  }

  return parsed.map(normalizeProviderConfig);
}

function loadProvidersFromEnv(raw: string): ProviderConfig[] {
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("ROUTEX_PROVIDERS_JSON must be a JSON array");
  }

  return parsed.map(normalizeProviderConfig);
}

export async function loadConfig(): Promise<RouteXConfig> {
  const host = process.env.ROUTEX_HOST?.trim() || "127.0.0.1";
  const port = parseInteger(process.env.ROUTEX_PORT, 8080, "ROUTEX_PORT");
  const monitorIntervalMs = parseInteger(
    process.env.ROUTEX_MONITOR_INTERVAL_MS,
    2_000,
    "ROUTEX_MONITOR_INTERVAL_MS",
  );
  const requestTimeoutMs = parseInteger(
    process.env.ROUTEX_REQUEST_TIMEOUT_MS,
    4_000,
    "ROUTEX_REQUEST_TIMEOUT_MS",
  );
  const maxSlotLagForWrites = parseInteger(
    process.env.ROUTEX_MAX_SLOT_LAG_FOR_WRITES,
    2,
    "ROUTEX_MAX_SLOT_LAG_FOR_WRITES",
  );
  const maxSlotLagForFreshReads = parseInteger(
    process.env.ROUTEX_MAX_SLOT_LAG_FOR_FRESH_READS,
    1,
    "ROUTEX_MAX_SLOT_LAG_FOR_FRESH_READS",
  );
  const staleAfterMs = parseInteger(
    process.env.ROUTEX_STALE_AFTER_MS,
    12_000,
    "ROUTEX_STALE_AFTER_MS",
  );
  const routeLogLimit = parseInteger(
    process.env.ROUTEX_ROUTE_LOG_LIMIT,
    150,
    "ROUTEX_ROUTE_LOG_LIMIT",
  );
  const eventLogLimit = parseInteger(
    process.env.ROUTEX_EVENT_LOG_LIMIT,
    200,
    "ROUTEX_EVENT_LOG_LIMIT",
  );
  const monitorMode = parseMonitorMode(process.env.ROUTEX_MONITOR_MODE);

  let providers: ProviderConfig[] = [];

  if (process.env.ROUTEX_PROVIDERS_JSON) {
    providers = loadProvidersFromEnv(process.env.ROUTEX_PROVIDERS_JSON);
  } else {
    const providerFile = process.env.ROUTEX_PROVIDERS_FILE
      ? path.resolve(process.cwd(), process.env.ROUTEX_PROVIDERS_FILE)
      : path.resolve(process.cwd(), "routex.providers.json");

    try {
      providers = await loadProvidersFromFile(providerFile);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;

      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {
    host,
    port,
    monitorIntervalMs,
    requestTimeoutMs,
    maxSlotLagForWrites,
    maxSlotLagForFreshReads,
    staleAfterMs,
    routeLogLimit,
    eventLogLimit,
    monitorMode,
    providers,
  };
}
