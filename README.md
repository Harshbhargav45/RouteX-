# RouteX — Freshness-Aware Solana RPC Router

> **Route every JSON-RPC call to the fastest, freshest, healthiest Solana node — automatically.**

---

## The Problem

Solana apps depend on RPC providers (QuickNode, Helius, public endpoints, etc.) to read and write on-chain data. These providers are never equally healthy at the same time:

- **Slot lag** — one node may be 5–10 slots behind the chain tip, causing stale reads
- **Latency spikes** — a provider can become slow under load without going fully down
- **Silent failures** — timeouts and errors degrade UX without triggering obvious alerts
- **No smart failover** — most apps are hard-coded to one RPC; a config change or restart is required to switch

**RouteX solves this by acting as a local proxy** — your app talks to `localhost:8080`, and RouteX handles selecting the best upstream provider on every request, automatically.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Your Solana App                             │
│          (wallet adapter / SDK / custom client)                    │
└─────────────────────────┬──────────────────────────────────────────┘
                          │  JSON-RPC  (POST /rpc)
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         RouteX Proxy                                │
│                                                                     │
│  ┌──────────────┐   ┌───────────────────┐   ┌───────────────────┐  │
│  │ Slot Monitor │   │  Scoring Engine   │   │  Proxy Gateway    │  │
│  │              │   │                   │   │                   │  │
│  │ Yellowstone  │──▶│ slotLag × 12      │──▶│ Pick best ranked  │  │
│  │ gRPC stream  │   │ + latency penalty │   │ provider, retry   │  │
│  │  — or —      │   │ + error penalty   │   │ on failure        │  │
│  │ RPC polling  │   │ + priority bias   │   │                   │  │
│  └──────────────┘   └───────────────────┘   └─────────┬─────────┘  │
│                                                        │            │
└────────────────────────────────────────────────────────┼────────────┘
                                                         │
              ┌──────────────────────────────────────────┤
              │ Upstream RPC Providers                    │
              │                                           │
              │  ┌──────────┐  ┌────────┐  ┌──────────┐  │
              │  │ QuickNode│  │ Helius │  │ RPCFast  │  │
              │  └──────────┘  └────────┘  └──────────┘  │
              └───────────────────────────────────────────┘
```

---

## How It Works

### 1. Slot Monitor
Continuously tracks the current Solana slot for every configured provider:
- **Yellowstone mode** — subscribes to a gRPC slot stream (sub-millisecond freshness, push-based)
- **RPC polling mode** — calls `getSlot` on an interval (fallback, pull-based)
- Hybrid: providers with a `yellowstoneUrl` use gRPC; the rest use RPC polling

### 2. Scoring Engine
Every provider gets a score after each probe:
```
score = (slotLag × 12) + latencyPenalty + errorPenalty + timeoutPenalty + failurePenalty - priorityBias
```
Lower score = better candidate. A provider 2 slots behind carries a +24 penalty on top of latency.

### 3. Proxy Gateway
- Receives JSON-RPC requests at `POST /rpc`
- Classifies requests into `read`, `fresh-read`, or `write` strategies
- Selects the best provider meeting the strategy's slot-lag threshold
- Retries on failure with the next-best provider
- Sets `X-RouteX-Provider` response header so you can see who served the request

### 4. Live Dashboard
A real-time web dashboard at `http://localhost:8080` shows:
- Provider health, slot lag, latency, and score
- Active failover events and provider switches
- A "race view" visualizing relative provider speed
- Manual probe buttons to test live routing

---

## Use Cases

| Use Case | Why RouteX Helps |
|---|---|
| **DeFi trading bots** | Stale reads cause wrong pricing; RouteX ensures the freshest slot |
| **NFT minting** | Write transactions need a fully synced node; RouteX only routes writes to healthy providers |
| **Multi-datacenter redundancy** | Set up providers in different regions; RouteX picks the fastest one live |
| **Development & testing** | Run the built-in mock cluster locally with no external RPC dependencies |
| **Cost optimization** | Route high-frequency read traffic to a free/cheap endpoint, writes to a premium one via `priorityBias` |

---

## Quick Start

### 1. Install
```bash
git clone https://github.com/Harshbhargav45/RouteX-.git
cd RouteX-
npm install
```

### 2. Configure providers
```bash
cp routex.providers.example.json routex.providers.json
# Edit routex.providers.json with your RPC URLs and API keys
```

### 3. Run
```bash
npm start
# RouteX is now listening at http://127.0.0.1:8080
```

Point your Solana SDK at `http://127.0.0.1:8080/rpc` instead of a direct RPC URL.

### 4. Open the Dashboard
Visit [http://127.0.0.1:8080](http://127.0.0.1:8080)

---

## Demo Mode (No external RPC needed)

```bash
# Terminal 1 — start mock Solana cluster nodes
npm run demo:cluster

# Terminal 2 — start RouteX against the mock cluster
npm run demo:routex

# Terminal 3 (optional) — run a stress-test benchmark
npm run demo:benchmark
```

---

## Provider Config Reference

`routex.providers.json` is an array of provider objects:

```json
[
  {
    "name": "helius",
    "rpcUrl": "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY",
    "yellowstoneUrl": "YOUR_GRPC_HOST:443",
    "token": "YOUR_GRPC_TOKEN",
    "cluster": "mainnet-beta",
    "writeEnabled": true,
    "priorityBias": 2,
    "tags": ["fast", "helius"]
  }
]
```

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique identifier shown in the dashboard |
| `rpcUrl` | ✅ | Full HTTPS RPC endpoint URL |
| `yellowstoneUrl` | ❌ | gRPC host:port for Yellowstone slot streaming |
| `token` | ❌ | gRPC auth token (required if `yellowstoneUrl` is set) |
| `cluster` | ❌ | `mainnet-beta` (default) or `devnet` |
| `writeEnabled` | ❌ | Allow write transactions (default: `true`) |
| `priorityBias` | ❌ | Score bonus — higher = preferred when scores are close |
| `tags` | ❌ | Arbitrary labels, shown in dashboard |

> ⚠️ **`routex.providers.json` is gitignored.** Never commit it — it contains your API keys.
> Use `routex.providers.example.json` as the template.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ROUTEX_HOST` | `127.0.0.1` | Bind address |
| `ROUTEX_PORT` | `8080` | HTTP port |
| `ROUTEX_MONITOR_MODE` | `auto` | `rpc`, `yellowstone`, or `auto` |
| `ROUTEX_MONITOR_INTERVAL_MS` | `2000` | RPC polling interval |
| `ROUTEX_REQUEST_TIMEOUT_MS` | `4000` | Per-request timeout |
| `ROUTEX_MAX_SLOT_LAG_FOR_WRITES` | `2` | Max slot lag allowed for write routes |
| `ROUTEX_MAX_SLOT_LAG_FOR_FRESH_READS` | `1` | Max slot lag for `fresh-read` routes |
| `ROUTEX_STALE_AFTER_MS` | `12000` | Mark provider stale if no update for this long |
| `ROUTEX_PROVIDERS_JSON` | — | Inline JSON array of providers (alternative to file) |
| `ROUTEX_PROVIDERS_FILE` | `routex.providers.json` | Path to providers config file |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/rpc` | JSON-RPC proxy endpoint |
| `GET` | `/api/health` | Provider health snapshot |
| `GET` | `/api/metrics` | Routing metrics and stats |
| `GET` | `/api/events` | System event log |
| `GET` | `/api/routes` | Recent routing decisions |
| `GET` | `/` | Live dashboard |

---

## License

MIT
