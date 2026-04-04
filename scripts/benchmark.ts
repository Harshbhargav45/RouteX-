const targetUrl = process.env.ROUTEX_URL || "http://127.0.0.1:8080/rpc";
const requests = Number.parseInt(process.env.ROUTEX_BENCH_REQUESTS || "40", 10);
const chaos = process.env.ROUTEX_BENCH_CHAOS === "1";

type Outcome = {
  ok: boolean;
  provider: string;
  status: number;
  durationMs: number;
  strategy: string;
  body: unknown;
};

function randomMethod(index: number) {
  const methods = [
    "getSlot",
    "getLatestBlockhash",
    "getAccountInfo",
    "getBalance",
    "simulateTransaction",
    "sendTransaction",
  ];

  return methods[index % methods.length];
}

function buildPayload(index: number) {
  const method = randomMethod(index);

  if (index % 10 === 0) {
    return [
      {
        jsonrpc: "2.0",
        id: `${index}-a`,
        method: "getSlot",
        params: [],
      },
      {
        jsonrpc: "2.0",
        id: `${index}-b`,
        method: "getLatestBlockhash",
        params: [],
      },
    ];
  }

  return {
    jsonrpc: "2.0",
    id: index,
    method,
    params:
      method === "getAccountInfo" || method === "getBalance"
        ? ["Demo111111111111111111111111111111111111111"]
        : method.startsWith("send")
          ? ["deadbeef"]
          : [],
  };
}

async function maybeRunChaos(index: number) {
  if (!chaos || index !== Math.floor(requests / 2)) {
    return;
  }

  await fetch("http://127.0.0.1:8891/admin/behavior", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      lagSlots: 8,
      errorRate: 0.6,
      writeFailureRate: 0.7,
    }),
  });

  console.log("Applied chaos to mock provider alpha");
}

async function runOne(index: number): Promise<Outcome> {
  const payload = buildPayload(index);
  const startedAt = Date.now();
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const durationMs = Date.now() - startedAt;
  const body = await response.json();
  const provider = response.headers.get("x-routex-provider") || "none";
  const strategy = response.headers.get("x-routex-strategy") || "unknown";

  const ok = Array.isArray(body)
    ? body.every((entry) => !entry.error)
    : !body.error;

  return {
    ok,
    provider,
    status: response.status,
    durationMs,
    strategy,
    body,
  };
}

async function main() {
  const outcomes: Outcome[] = [];

  for (let index = 0; index < requests; index += 1) {
    await maybeRunChaos(index);
    outcomes.push(await runOne(index));
  }

  const providerCounts = new Map<string, number>();

  for (const outcome of outcomes) {
    providerCounts.set(
      outcome.provider,
      (providerCounts.get(outcome.provider) ?? 0) + 1,
    );
  }

  const successCount = outcomes.filter((outcome) => outcome.ok).length;
  const failureCount = outcomes.length - successCount;
  const avgLatencyMs = Math.round(
    outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0) /
      Math.max(1, outcomes.length),
  );

  console.log("RouteX benchmark summary");
  console.log(`target: ${targetUrl}`);
  console.log(`requests: ${outcomes.length}`);
  console.log(`successes: ${successCount}`);
  console.log(`failures: ${failureCount}`);
  console.log(`avg latency: ${avgLatencyMs}ms`);
  console.log("provider distribution:");

  for (const [provider, count] of [...providerCounts.entries()].sort()) {
    console.log(`  ${provider}: ${count}`);
  }

  const sampleFailure = outcomes.find((outcome) => !outcome.ok);

  if (sampleFailure) {
    console.log("sample failure:");
    console.log(JSON.stringify(sampleFailure.body, null, 2));
  }
}

main().catch((error) => {
  console.error("Benchmark failed");
  console.error(error);
  process.exit(1);
});
