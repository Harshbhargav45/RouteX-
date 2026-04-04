import {
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  MethodStrategy,
  ProviderState,
} from "./types.js";

const WRITE_METHODS = new Set([
  "sendTransaction",
  "sendRawTransaction",
  "sendVersionedTransaction",
]);

const FRESH_READ_METHODS = new Set([
  "getLatestBlockhash",
  "getSlot",
  "getBlockHeight",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getProgramAccounts",
  "simulateTransaction",
]);

export function getMethodStrategy(method: string): MethodStrategy {
  if (WRITE_METHODS.has(method)) {
    return "write";
  }

  if (FRESH_READ_METHODS.has(method)) {
    return "fresh-read";
  }

  return "read";
}

function strategyRank(strategy: MethodStrategy): number {
  switch (strategy) {
    case "write":
      return 3;
    case "fresh-read":
      return 2;
    default:
      return 1;
  }
}

export function getPayloadStrategy(
  payload: JsonRpcRequest | JsonRpcBatchRequest,
): MethodStrategy {
  if (!Array.isArray(payload)) {
    return getMethodStrategy(payload.method);
  }

  return payload.reduce<MethodStrategy>((selected, request) => {
    const next = getMethodStrategy(request.method);
    return strategyRank(next) > strategyRank(selected) ? next : selected;
  }, "read");
}

export function describePayloadMethods(
  payload: JsonRpcRequest | JsonRpcBatchRequest,
): string {
  if (!Array.isArray(payload)) {
    return payload.method;
  }

  const methods = payload.map((request) => request.method);
  return `batch(${payload.length}):${methods.join(",")}`;
}

export function buildJsonRpcErrorResponse(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      data,
    },
  };
}

export function isRetryableUpstreamError(response: JsonRpcResponse): boolean {
  if (!response.error) {
    return false;
  }

  const message = response.error.message.toLowerCase();
  const retryableMessage = [
    "node is behind",
    "blockhash not found",
    "slot was skipped",
    "timeout",
    "temporarily unavailable",
    "too busy",
    "stale",
    "behind",
  ].some((pattern) => message.includes(pattern));

  return retryableMessage || response.error.code === -32005;
}

export function isRetryableBatchUpstreamError(
  response: JsonRpcBatchResponse,
): boolean {
  return response.some((entry) => isRetryableUpstreamError(entry));
}

export async function callJsonRpc(
  provider: Pick<ProviderState, "rpcUrl" | "name">,
  request: JsonRpcRequest | JsonRpcBatchRequest,
  timeoutMs: number,
): Promise<{
  response: JsonRpcResponse | JsonRpcBatchResponse;
  durationMs: number;
}> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(provider.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        Array.isArray(request)
          ? request.map((entry) => ({
              jsonrpc: "2.0",
              id: entry.id ?? null,
              method: entry.method,
              params: entry.params ?? [],
            }))
          : {
              jsonrpc: "2.0",
              id: request.id ?? null,
              method: request.method,
              params: request.params ?? [],
            },
      ),
      signal: controller.signal,
    });

    const durationMs = Date.now() - startedAt;
    const payload = (await response.json()) as JsonRpcResponse | JsonRpcBatchResponse;

    if (!response.ok) {
      throw new Error(
        `Upstream ${provider.name} responded with HTTP ${response.status}`,
      );
    }

    return {
      response: payload,
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}
