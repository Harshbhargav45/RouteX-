import express, { Request, Response } from "express";
import { loadConfig } from "./config.js";
import { renderDashboardHtml } from "./dashboard.js";
import { startMonitor } from "./monitor.js";
import {
  buildJsonRpcErrorResponse,
  callJsonRpc,
  describePayloadMethods,
  getPayloadStrategy,
  isRetryableBatchUpstreamError,
  isRetryableUpstreamError,
} from "./rpc.js";
import { ProviderStore } from "./store.js";
import {
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
  JsonRpcRequest,
  MethodStrategy,
} from "./types.js";

function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  if (!body || typeof body !== "object") {
    return false;
  }

  const value = body as Record<string, unknown>;
  return typeof value.method === "string";
}

function isJsonRpcBatchRequest(body: unknown): body is JsonRpcBatchRequest {
  return Array.isArray(body) && body.length > 0 && body.every(isJsonRpcRequest);
}

function buildRequestId(id: JsonRpcRequest["id"]): string {
  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }

  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeBatchErrors(response: JsonRpcBatchResponse): string | null {
  const messages = response
    .filter((entry) => entry.error?.message)
    .map((entry) => entry.error?.message ?? "");

  if (messages.length === 0) {
    return null;
  }

  return messages.join(" | ");
}

function getMaxSlotLagForStrategy(
  strategy: MethodStrategy,
  config: Awaited<ReturnType<typeof loadConfig>>,
): number | null {
  if (strategy === "write") {
    return config.maxSlotLagForWrites;
  }

  if (strategy === "fresh-read") {
    return config.maxSlotLagForFreshReads;
  }

  return null;
}

async function bootstrap() {
  const config = await loadConfig();
  const providerStore = new ProviderStore(config.providers, {
    staleAfterMs: config.staleAfterMs,
    eventLogLimit: config.eventLogLimit,
    routeLogLimit: config.routeLogLimit,
    configuredMonitorMode: config.monitorMode,
  });
  const monitor = startMonitor(providerStore, config);
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_request: Request, response: Response) => {
    response.type("html");
    return response.send(renderDashboardHtml());
  });

  app.get("/api/health", (_request: Request, response: Response) => {
    return response.json({
      ok: true,
      ...providerStore.getSnapshot(),
    });
  });

  app.get("/api/providers", (_request: Request, response: Response) => {
    return response.json(providerStore.listProviders());
  });

  app.get("/api/metrics", (_request: Request, response: Response) => {
    return response.json(providerStore.getMetrics());
  });

  app.get("/api/events", (_request: Request, response: Response) => {
    return response.json(providerStore.listEvents());
  });

  app.get("/api/routes", (_request: Request, response: Response) => {
    return response.json(providerStore.listRouteLog());
  });

  app.get("/api/history", (_request: Request, response: Response) => {
    return response.json(providerStore.getLagHistory());
  });

  app.get("/api/config", (_request: Request, response: Response) => {
    return response.json({
      host: config.host,
      port: config.port,
      monitorMode: config.monitorMode,
      providerCount: config.providers.length,
      providerNames: config.providers.map((provider) => provider.name),
      nodeVersion: process.versions.node,
    });
  });

  app.get("/health", (_request: Request, response: Response) => {
    return response.json({
      ok: true,
      ...providerStore.getSnapshot(),
    });
  });

  app.get("/providers", (_request: Request, response: Response) => {
    return response.json(providerStore.listProviders());
  });

  app.get("/metrics", (_request: Request, response: Response) => {
    return response.json(providerStore.getMetrics());
  });

  app.post("/rpc", async (request: Request, response: Response) => {
    const isSingle = isJsonRpcRequest(request.body);
    const isBatch = isJsonRpcBatchRequest(request.body);

    if (!isSingle && !isBatch) {
      return response
        .status(400)
        .json(buildJsonRpcErrorResponse(null, -32600, "Invalid JSON-RPC request"));
    }

    const payload = request.body as JsonRpcRequest | JsonRpcBatchRequest;
    const singlePayload = isSingle ? (payload as JsonRpcRequest) : null;
    const requestId = buildRequestId(singlePayload?.id ?? null);
    const strategy = getPayloadStrategy(payload);
    const methodLabel = describePayloadMethods(payload);
    const strictMaxSlotLag = getMaxSlotLagForStrategy(strategy, config);
    let candidates = providerStore.getOrderedCandidates({
      strategy,
      maxSlotLag: strictMaxSlotLag,
    });

    if (candidates.length === 0 && strictMaxSlotLag !== null) {
      providerStore.noteEvent(
        "warn",
        "policy-relaxed",
        `Relaxed ${strategy} freshness policy for ${methodLabel} because no provider met the strict lag threshold`,
        null,
        {
          requestId,
          strictMaxSlotLag,
        },
      );
      candidates = providerStore.getOrderedCandidates({
        strategy,
        maxSlotLag: null,
      });
    }

    if (candidates.length === 0) {
      providerStore.recordRoute({
        requestId,
        method: methodLabel,
        strategy,
        providerName: null,
        attemptedProviders: [],
        attempts: 0,
        status: "failed",
        durationMs: 0,
        errorMessage: "No healthy RouteX providers are available",
      });

      return response.status(503).json(
        buildJsonRpcErrorResponse(
          singlePayload?.id ?? null,
          -32001,
          "No healthy RouteX providers are available",
        ),
      );
    }

    const attemptedProviders: string[] = [];
    const startedAt = Date.now();
    let lastError: string | null = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      attemptedProviders.push(candidate.name);

      try {
        const { response: upstreamResponse, durationMs } = await callJsonRpc(
          candidate,
          payload,
          config.requestTimeoutMs,
        );

        if (
          ((Array.isArray(upstreamResponse) &&
            isRetryableBatchUpstreamError(upstreamResponse)) ||
            (!Array.isArray(upstreamResponse) &&
              upstreamResponse.error &&
              isRetryableUpstreamError(upstreamResponse))) &&
          index < candidates.length - 1
        ) {
          providerStore.recordRequestAttempt({
            providerName: candidate.name,
            durationMs,
            ok: false,
            timeout: false,
            errorMessage: Array.isArray(upstreamResponse)
              ? summarizeBatchErrors(upstreamResponse)
              : upstreamResponse.error?.message ?? null,
          });
          lastError = Array.isArray(upstreamResponse)
            ? summarizeBatchErrors(upstreamResponse)
            : upstreamResponse.error?.message ?? null;
          continue;
        }

        providerStore.recordRequestAttempt({
          providerName: candidate.name,
          durationMs,
          ok: Array.isArray(upstreamResponse)
            ? upstreamResponse.every((entry) => !entry.error)
            : !upstreamResponse.error,
          timeout: false,
          errorMessage: Array.isArray(upstreamResponse)
            ? summarizeBatchErrors(upstreamResponse)
            : upstreamResponse.error?.message ?? null,
        });
        providerStore.markActiveProvider(candidate.name);
        providerStore.recordRoute({
          requestId,
          method: methodLabel,
          strategy,
          providerName: candidate.name,
          attemptedProviders,
          attempts: index + 1,
          status: Array.isArray(upstreamResponse)
            ? upstreamResponse.some((entry) => entry.error)
              ? "failed"
              : "success"
            : upstreamResponse.error
              ? "failed"
              : "success",
          durationMs: Date.now() - startedAt,
          errorMessage: Array.isArray(upstreamResponse)
            ? summarizeBatchErrors(upstreamResponse)
            : upstreamResponse.error?.message ?? null,
        });

        response.setHeader("x-routex-provider", candidate.name);
        response.setHeader("x-routex-attempts", String(index + 1));
        response.setHeader("x-routex-strategy", strategy);
        return response.json(upstreamResponse);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown upstream error";
        const timeout = errorMessage.includes("aborted");

        providerStore.recordRequestAttempt({
          providerName: candidate.name,
          durationMs: config.requestTimeoutMs,
          ok: false,
          timeout,
          errorMessage,
        });

        lastError = errorMessage;
      }
    }

    providerStore.recordRoute({
      requestId,
      method: methodLabel,
      strategy,
      providerName: attemptedProviders[attemptedProviders.length - 1] ?? null,
      attemptedProviders,
      attempts: attemptedProviders.length,
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorMessage: lastError,
    });

    return response.status(502).json(
      buildJsonRpcErrorResponse(
        singlePayload?.id ?? null,
        -32002,
        "All RouteX providers failed",
        {
          lastError,
          attemptedProviders,
        },
      ),
    );
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`RouteX listening on http://${config.host}:${config.port}`);
    console.log(`Configured providers: ${config.providers.length}`);
    console.log(`Configured monitor mode: ${config.monitorMode}`);
  });

  const shutdown = () => {
    monitor.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("RouteX failed to start");
  console.error(error);
  process.exit(1);
});
