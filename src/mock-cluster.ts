import express, { Request, Response } from "express";

type MockBehavior = {
  lagSlots: number;
  latencyMs: number;
  errorRate: number;
  writeFailureRate: number;
  enabled: boolean;
};

type MockProvider = {
  name: string;
  port: number;
  behavior: MockBehavior;
};

const providers: MockProvider[] = [
  {
    name: "alpha",
    port: 8891,
    behavior: {
      lagSlots: 0,
      latencyMs: 35,
      errorRate: 0,
      writeFailureRate: 0,
      enabled: true,
    },
  },
  {
    name: "beta",
    port: 8892,
    behavior: {
      lagSlots: 3,
      latencyMs: 20,
      errorRate: 0,
      writeFailureRate: 0,
      enabled: true,
    },
  },
  {
    name: "gamma",
    port: 8893,
    behavior: {
      lagSlots: 0,
      latencyMs: 120,
      errorRate: 0.15,
      writeFailureRate: 0.1,
      enabled: true,
    },
  },
];

let chainTip = 300_000_000;
const blockhashPrefix = "RouteXMockBlockhash";

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function randomSignature(seed: string): string {
  return `${seed}-${Math.random().toString(36).slice(2, 18)}`;
}

function buildResult(
  provider: MockProvider,
  method: string,
  id: string | number | null | undefined,
) {
  const slot = Math.max(0, chainTip - provider.behavior.lagSlots);

  switch (method) {
    case "getSlot":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: slot,
      };
    case "getBlockHeight":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: slot + 512,
      };
    case "getLatestBlockhash":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          context: {
            slot,
          },
          value: {
            blockhash: `${blockhashPrefix}-${provider.name}-${slot}`,
            lastValidBlockHeight: slot + 150,
          },
        },
      };
    case "getBalance":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          context: {
            slot,
          },
          value: 1_500_000_000,
        },
      };
    case "getAccountInfo":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          context: {
            slot,
          },
          value: {
            executable: false,
            lamports: 1_500_000_000,
            owner: "11111111111111111111111111111111",
            rentEpoch: 0,
            space: 0,
            data: ["", "base64"],
          },
        },
      };
    case "getProgramAccounts":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: [
          {
            pubkey: "Demo111111111111111111111111111111111111111",
            account: {
              executable: false,
              lamports: 1000,
              owner: "11111111111111111111111111111111",
              rentEpoch: 0,
              space: 0,
              data: ["", "base64"],
            },
          },
        ],
      };
    case "simulateTransaction":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          context: {
            slot,
          },
          value: {
            err: null,
            logs: [`simulated by ${provider.name}`],
          },
        },
      };
    case "sendTransaction":
    case "sendRawTransaction":
    case "sendVersionedTransaction":
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: randomSignature(`${provider.name}-${slot}`),
      };
    default:
      return jsonRpcError(id, -32601, `Mock provider does not implement ${method}`);
  }
}

async function handleRpcRequest(
  provider: MockProvider,
  requestBody: unknown,
): Promise<unknown> {
  await sleep(provider.behavior.latencyMs);

  if (!provider.behavior.enabled) {
    throw new Error(`${provider.name} is disabled`);
  }

  const processOne = (payload: Record<string, unknown>) => {
    const method = typeof payload.method === "string" ? payload.method : "";
    const id = payload.id as string | number | null | undefined;
    const failureRate =
      method.startsWith("send") || method === "simulateTransaction"
        ? provider.behavior.writeFailureRate
        : provider.behavior.errorRate;

    if (Math.random() < failureRate) {
      return jsonRpcError(id, -32005, `${provider.name} mock node is behind`);
    }

    return buildResult(provider, method, id);
  };

  if (Array.isArray(requestBody)) {
    return requestBody.map((entry) => processOne((entry ?? {}) as Record<string, unknown>));
  }

  return processOne((requestBody ?? {}) as Record<string, unknown>);
}

function startMockProvider(provider: MockProvider) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request: Request, response: Response) => {
    response.json({
      ok: true,
      provider: provider.name,
      port: provider.port,
      chainTip,
      currentSlot: Math.max(0, chainTip - provider.behavior.lagSlots),
      behavior: provider.behavior,
    });
  });

  app.get("/admin/state", (_request: Request, response: Response) => {
    response.json({
      provider: provider.name,
      port: provider.port,
      chainTip,
      currentSlot: Math.max(0, chainTip - provider.behavior.lagSlots),
      behavior: provider.behavior,
    });
  });

  app.post("/admin/behavior", (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Partial<MockBehavior>;

    if (typeof body.lagSlots === "number") {
      provider.behavior.lagSlots = Math.max(0, Math.floor(body.lagSlots));
    }

    if (typeof body.latencyMs === "number") {
      provider.behavior.latencyMs = Math.max(0, Math.floor(body.latencyMs));
    }

    if (typeof body.errorRate === "number") {
      provider.behavior.errorRate = Math.min(1, Math.max(0, body.errorRate));
    }

    if (typeof body.writeFailureRate === "number") {
      provider.behavior.writeFailureRate = Math.min(
        1,
        Math.max(0, body.writeFailureRate),
      );
    }

    if (typeof body.enabled === "boolean") {
      provider.behavior.enabled = body.enabled;
    }

    response.json({
      ok: true,
      provider: provider.name,
      behavior: provider.behavior,
    });
  });

  app.post("/", async (request: Request, response: Response) => {
    try {
      const payload = await handleRpcRequest(provider, request.body);
      response.json(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Mock provider failure";
      response.status(503).json(jsonRpcError(null, -32000, message));
    }
  });

  app.listen(provider.port, "127.0.0.1", () => {
    console.log(
      `Mock provider ${provider.name} listening on http://127.0.0.1:${provider.port}`,
    );
  });
}

for (const provider of providers) {
  startMockProvider(provider);
}

setInterval(() => {
  chainTip += 1;
}, 400);

console.log("RouteX mock cluster started");
