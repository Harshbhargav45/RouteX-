# RouteX — Freshness-Aware Solana RPC Router

> Route every JSON-RPC call to the fastest, freshest, healthiest Solana node — automatically.

---

## The Problem

Solana apps hard-code a single RPC endpoint. When that node lags behind the chain tip, you get stale reads, failed writes, and degraded UX — with no automatic recovery.

**RouteX acts as a local proxy.** Your app talks to `localhost:8080`; RouteX handles choosing the best upstream provider on every single request.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Your Solana App                    │
│         (wallet adapter / SDK / custom client)       │
└───────────────────────┬──────────────────────────────┘
                        │  JSON-RPC  (POST /rpc)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       RouteX Proxy                              │
│                                                                 │
│  ┌───────────────┐   ┌──────────────────┐   ┌───────────────┐  │
│  │  Slot Monitor │   │  Scoring Engine  │   │ Proxy Gateway │  │
│  │               │   │                  │   │               │  │
│  │  Yellowstone  │──▶│  slotLag × 12    │──▶│  Best ranked  │  │
│  │  gRPC stream  │   │  + latency       │   │  provider,    │  │
│  │   — or —      │   │  + error rate    │   │  auto-retry   │  │
│  │  RPC polling  │   │  + priority bias │   │  on failure   │  │
│  └───────────────┘   └──────────────────┘   └──────┬────────┘  │
└─────────────────────────────────────────────────────┼───────────┘
                                                      │
              ┌────────────────────────────────────────────────┤
              │              Upstream Providers                │
              │  ┌──────────────────────────┐  ┌───────────┐  │
              │  │  RPCFast  ★ Yellowstone  │  │ QuickNode │  │
              │  │  (gRPC slot streaming)   │  │ (RPC poll)│  │
              │  └──────────────────────────┘  └───────────┘  │
              │  ┌──────────┐  ┌───────────────────────────┐  │
              │  │  Helius  │  │  api.mainnet-beta.solana   │  │
              │  │ (RPC poll│  │        (baseline)          │  │
              │  └──────────┘  └───────────────────────────┘  │
              └────────────────────────────────────────────────┘
```

---

## How It Works

**1. Slot Monitor** — tracks the current Solana slot for every provider via Yellowstone gRPC (push, sub-ms) or RPC polling (pull, configurable interval). Hybrid mode is supported: gRPC-capable providers stream, the rest poll.

**2. Scoring Engine** — ranks providers after every update:
```
score = (slotLag × 12) + latencyPenalty + errorPenalty + failurePenalty − priorityBias
```
Lower score = better candidate. A node 2 slots behind carries a +24 penalty before latency is even factored in.

**3. Proxy Gateway** — classifies each request (`read` / `fresh-read` / `write`), picks the best provider meeting that strategy's slot-lag threshold, and retries on failure with the next-best provider.

**4. Live Dashboard** — real-time web UI at `http://localhost:8080` showing provider health, slot lag, scores, routing decisions, and a dynamic race visualization.

---

## Use Cases

| Use Case | How RouteX Helps |
|---|---|
| DeFi trading bots | Stale reads cause wrong pricing — RouteX routes to the freshest node via RPCFast Yellowstone gRPC |
| NFT minting | Writes need a fully synced node — stale providers are excluded automatically |
| Multi-provider redundancy | Transparent failover: RPCFast (primary) → QuickNode → Helius → public RPC |
| Yellowstone streaming | RPCFast's gRPC endpoint feeds sub-millisecond slot updates, eliminating polling lag |
| Local development | Built-in mock cluster — no external RPC keys needed |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Harshbhargav45/RouteX-.git
cd RouteX-
npm install

# 2. Configure providers (copy the example and fill in your RPC URLs)
cp routex.providers.example.json routex.providers.json

# 3. Start
npm start
# → http://127.0.0.1:8080
```

Point your Solana SDK at `http://127.0.0.1:8080/rpc` instead of a direct RPC URL.

### Try the built-in demo (no external RPC needed)

```bash
npm run demo:cluster   # Terminal 1: mock Solana nodes
npm run demo:routex    # Terminal 2: RouteX against the mock
npm run demo:benchmark # Terminal 3 (optional): stress test
```

---

## Provider Config

`routex.providers.json` — an array of provider objects:

```json
[
  {
    "name": "rpcfast",
    "rpcUrl": "https://solana-rpc.rpcfast.com?api_key=YOUR_RPCFAST_API_KEY",
    "yellowstoneUrl": "solana-yellowstone-grpc.rpcfast.com:443",
    "token": "YOUR_RPCFAST_GRPC_TOKEN",
    "cluster": "mainnet-beta",
    "writeEnabled": true,
    "priorityBias": 3,
    "tags": ["primary", "yellowstone-ready", "rpcfast"]
  },
  {
    "name": "quicknode",
    "rpcUrl": "https://YOUR_ENDPOINT.quiknode.pro/YOUR_KEY/",
    "cluster": "mainnet-beta",
    "writeEnabled": true,
    "priorityBias": 1,
    "tags": ["fallback", "quicknode"]
  },
  {
    "name": "solana-public",
    "rpcUrl": "https://api.mainnet-beta.solana.com",
    "cluster": "mainnet-beta",
    "writeEnabled": true,
    "priorityBias": 0,
    "tags": ["baseline", "public"]
  }
]
```

> **RPCFast** is the recommended primary provider — it exposes a [Yellowstone gRPC](https://solana-yellowstone-grpc.rpcfast.com) endpoint for real-time slot streaming, giving RouteX sub-millisecond freshness data instead of polling.

| Field | Description |
|---|---|
| `name` | Unique label shown in the dashboard |
| `rpcUrl` | HTTPS RPC endpoint |
| `yellowstoneUrl` | gRPC host:port for Yellowstone slot streaming (optional) |
| `token` | gRPC auth token (required if `yellowstoneUrl` is set) |
| `writeEnabled` | Allow write transactions through this provider (default: `true`) |
| `priorityBias` | Score bonus — higher value = preferred when scores are close |

---

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/rpc` | JSON-RPC proxy |
| `GET` | `/api/health` | Provider health snapshot |
| `GET` | `/api/metrics` | Routing metrics |
| `GET` | `/api/events` | System event log |
| `GET` | `/api/routes` | Recent routing decisions |
| `GET` | `/` | Live dashboard |

---

## License

MIT
