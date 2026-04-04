# RouteX

RouteX is a freshness-aware Solana RPC router that monitors multiple RPC providers in real time and sends each request to the healthiest endpoint before stale reads or failed requests hit the app.

This repository now contains a fuller RouteX starter: a modular proxy server, provider health store, route/event logs, a built-in dashboard, method-aware routing, RPC polling, and optional Yellowstone monitoring with automatic fallback.

## Quick Start

```bash
npm install
cp routex.providers.example.json routex.providers.json
npm run dev
```

Then open:

```bash
http://127.0.0.1:8080/
```

Useful endpoints:

```bash
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/providers
curl http://127.0.0.1:8080/api/events
curl http://127.0.0.1:8080/api/routes
```

## Local Demo Mode

RouteX now includes a local mock cluster so you can validate routing and failover before wiring real Solana providers.

In terminal 1:

```bash
npm run demo:cluster
```

In terminal 2:

```bash
npm run demo:routex
```

In terminal 3:

```bash
npm run demo:benchmark
```

Optional chaos run:

```bash
ROUTEX_BENCH_CHAOS=1 npm run demo:benchmark
```

Demo files:

- `src/mock-cluster.ts` starts three local mock RPC providers on ports `8891`, `8892`, and `8893`
- `routex.providers.demo.json` points RouteX at those local providers
- `scripts/benchmark.ts` sends mixed read, fresh-read, write, and batch requests through RouteX

The mock providers also expose admin endpoints so you can change their behavior live:

```bash
curl -X POST http://127.0.0.1:8891/admin/behavior \
  -H "Content-Type: application/json" \
  -d '{"lagSlots":8,"errorRate":0.5,"writeFailureRate":0.7}'
```

To force Yellowstone mode:

```bash
export ROUTEX_MONITOR_MODE=yellowstone
npm run dev
```

Note: the installed Yellowstone SDK currently expects Node `>=20.18`. On older Node runtimes, RouteX will log the issue and fall back to RPC polling automatically.

## One-Line Pitch

RouteX uses Yellowstone slot telemetry to detect lagging Solana RPCs before they fail, then automatically routes traffic to the freshest provider.

## Problem

Most Solana apps pick a single RPC endpoint and hope it stays healthy. When that RPC degrades:

- requests can timeout
- reads can return stale state
- transactions can miss execution windows
- teams manually switch endpoints and redeploy

Traditional failover is reactive. It notices trouble after a request becomes slow or fails. RouteX is designed to be predictive by tracking chain freshness continuously.

## Solution

RouteX consumes Yellowstone gRPC slot streams from multiple providers, computes slot lag per provider, ranks endpoints by freshness and reliability, and forwards app requests to the best provider.

## Core Features

- Real-time slot lag monitoring across multiple RPC providers
- Freshness-aware routing instead of latency-only routing
- Automatic failover on timeout, error spikes, or lag jumps
- Drop-in JSON-RPC proxy for Solana apps
- Built-in dashboard for provider health, routing decisions, and events
- Method-aware routing for reads vs writes
- Batch JSON-RPC passthrough with strictest-method routing policy
- Recent route logs and provider incident history
- Optional Yellowstone mode with safe fallback to RPC polling

## How RouteX Works

1. Connect to Yellowstone gRPC streams from multiple providers.
2. Track the latest observed chain tip and each provider's slot.
3. Compute slot lag and a rolling health score for every provider.
4. Rank providers continuously.
5. Receive app JSON-RPC calls through a proxy endpoint.
6. Forward each request to the top-ranked provider.
7. Retry on the next provider if the active one degrades or fails.

## Architecture

There are three main layers:

### 1. Slot Lag Monitor

Consumes Yellowstone streams and calculates `chain_tip - provider_slot` every few hundred milliseconds.

### 2. Predictive Router

Uses slot lag, timeout rate, and recent errors to rank providers and keep an up-to-date routing table.

### 3. Failover Proxy

Accepts app RPC requests, forwards them to the best provider, and retries on backup providers when needed.

## Architecture Diagram

```text
                           +----------------------+
                           | Solana Validators    |
                           +----------+-----------+
                                      |
                         Yellowstone gRPC slot updates
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
         v                            v                            v
 +---------------+            +---------------+            +---------------+
 | Provider A    |            | Provider B    |            | Provider C    |
 | Yellowstone   |            | Yellowstone   |            | Yellowstone   |
 +-------+-------+            +-------+-------+            +-------+-------+
         \                            |                            /
          \                           |                           /
           \                          |                          /
            v                         v                         v
              +------------------------------------------------+
              |               Slot Lag Monitor                 |
              |      chain tip, provider slots, lag delta      |
              +------------------------+-----------------------+
                                       |
                                       v
              +------------------------------------------------+
              |               Predictive Router                |
              |  freshness score + health score + failover     |
              +------------------------+-----------------------+
                                       |
                                       v
              +------------------------------------------------+
              |                 RouteX Proxy                   |
              |     JSON-RPC in, best provider selected        |
              +------------------------+-----------------------+
                                       |
            +--------------------------+--------------------------+
            |                          |                          |
            v                          v                          v
     +-------------+            +-------------+            +-------------+
     | RPC A       |            | RPC B       |            | RPC C       |
     | HTTP RPC    |            | HTTP RPC    |            | HTTP RPC    |
     +-------------+            +-------------+            +-------------+
                                       |
                                       v
                           +----------------------+
                           | App / Bot / Wallet   |
                           +----------------------+
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Yellowstone client | `@triton-one/yellowstone-grpc` |
| Solana RPC | `@solana/web3.js` or `@solana/kit` |
| Proxy server | Fastify or Express |
| Metrics store | In-memory at MVP stage, Redis optional later |
| Dashboard | Next.js or React |
| Charts | Recharts or Chart.js |
| Packaging | Docker |
| Monitoring | Prometheus and Grafana optional |

## Suggested Project Structure

```text
routex/
├── apps/
│   ├── proxy/                 # JSON-RPC proxy service
│   ├── monitor/               # Yellowstone slot monitor
│   └── dashboard/             # Web UI
├── packages/
│   ├── router/                # Provider ranking and routing logic
│   ├── scorer/                # Slot lag scoring functions
│   ├── rpc-client/            # Provider request wrappers
│   ├── shared/                # Types, config, constants
│   └── logger/                # Logging helpers
├── configs/
│   └── providers.json         # RPC and Yellowstone endpoints
├── scripts/
│   └── benchmark.ts           # Compare routing strategies
├── docker/
│   └── Dockerfile
└── README.md
```

## MVP Scope

For a hackathon, build only these pieces:

- monitor slot lag from 2 to 3 providers
- compute provider freshness scores
- proxy `getLatestBlockhash`
- proxy `getAccountInfo`
- proxy `sendTransaction`
- fail over on timeout or large lag spikes
- show a small dashboard with current active provider

## Future Scope

- `minContextSlot` enforcement for freshness-safe reads
- method-aware routing policies
- provider history and incident playback
- benchmark suite against latency-only routing
- per-app API keys and dashboards
- transaction landing optimization

## Build Plan

### Phase 1: Bootstrap

- initialize TypeScript monorepo or keep a simple single app
- add provider config file
- add environment variable support
- create shared types for provider state, scores, and request metadata

### Phase 2: Yellowstone Monitor

- connect to Yellowstone gRPC for each provider
- subscribe to slot updates
- track highest observed chain tip
- compute lag per provider
- publish provider health snapshots in memory

### Phase 3: Router

- define provider score formula
- include slot lag, timeout count, and error rate
- rank providers every 200 to 500 ms
- expose current provider leaderboard

Example scoring idea:

```text
score = freshness_weight * slot_lag
      + timeout_weight * recent_timeouts
      + error_weight * recent_errors
      + latency_weight * avg_latency
```

Lower score is better.

### Phase 4: Proxy

- accept JSON-RPC POST requests
- choose the top-ranked provider
- forward the request
- capture latency and success or failure
- retry once on the next provider if needed

### Phase 5: Dashboard

- show provider list
- show slot lag per provider
- show current active route
- show failover events and request stats

### Phase 6: Benchmark and Demo

- simulate one lagging provider
- compare RouteX with a single fixed RPC
- measure stale reads, failures, and response time

## How To Build RouteX

### 1. Create the project

```bash
mkdir routex
cd routex
npm init -y
```

### 2. Install dependencies

```bash
npm install express @solana/web3.js @triton-one/yellowstone-grpc pino zod
npm install -D typescript tsx @types/node @types/express
```

If you use Fastify instead of Express:

```bash
npm install fastify
```

### 3. Add base scripts

Use this `package.json` shape:

```json
{
  "name": "routex",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:proxy": "tsx apps/proxy/src/index.ts",
    "dev:monitor": "tsx apps/monitor/src/index.ts",
    "dev:dashboard": "tsx apps/dashboard/src/index.ts",
    "build": "tsc -p tsconfig.json"
  }
}
```

### 4. Create provider config

```json
[
  {
    "name": "provider-a",
    "rpcUrl": "https://example-rpc-a.com",
    "yellowstoneUrl": "https://example-grpc-a.com:443",
    "token": "optional-auth-token"
  },
  {
    "name": "provider-b",
    "rpcUrl": "https://example-rpc-b.com",
    "yellowstoneUrl": "https://example-grpc-b.com:443",
    "token": "optional-auth-token"
  }
]
```

### 5. Implement core modules

- `monitor`: subscribe to Yellowstone slots and emit provider lag updates
- `router`: calculate scores and choose active provider
- `rpc-client`: forward JSON-RPC requests and collect request metrics
- `proxy`: expose a single app-facing endpoint

### 6. Start local services

```bash
npm run dev:monitor
npm run dev:proxy
```

### 7. Send requests through RouteX

```bash
curl -X POST http://localhost:8080/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getLatestBlockhash",
    "params": []
  }'
```

## Recommended API Shape

### App-facing proxy

- `POST /rpc`
- `GET /health`
- `GET /providers`
- `GET /metrics`

### Example `GET /providers` response

```json
[
  {
    "name": "provider-a",
    "slot": 302918441,
    "slotLag": 0,
    "errorRate": 0,
    "avgLatencyMs": 44,
    "score": 0.2,
    "active": true
  },
  {
    "name": "provider-b",
    "slot": 302918438,
    "slotLag": 3,
    "errorRate": 0.02,
    "avgLatencyMs": 38,
    "score": 3.5,
    "active": false
  }
]
```

## 48-Hour Hackathon Plan

### Day 1

- set up project structure
- wire 2 providers into Yellowstone
- compute slot lag
- expose provider rankings in memory

### Day 2

- add JSON-RPC proxy
- add failover logic
- support 3 core methods
- create a minimal dashboard

### Final Polish

- benchmark a lagging provider
- record demo video or live demo
- explain why freshness matters more than latency

## Why RouteX Can Stand Out

RouteX should not be pitched as a generic RPC balancer. It should be pitched as:

`A predictive freshness router for Solana built on Yellowstone telemetry.`

That is the differentiation.

## Demo Story

Show three providers:

- Provider A is healthy
- Provider B is lagging by several slots
- Provider C has higher latency but is current

Then:

- route reads to the freshest provider
- degrade the active provider live
- show RouteX switch automatically
- compare against a fixed RPC endpoint

## Submission Summary

**Name:** RouteX

**Category:** Solana infrastructure

**Short Description:** RouteX is a Yellowstone-powered Solana RPC router that predicts stale or degraded endpoints using live slot lag telemetry and automatically routes apps to the freshest provider.

## Notes

- The current codebase includes a working RouteX foundation and API surface.
- The present monitor uses RPC slot polling to stay runnable with minimal setup.
- Yellowstone gRPC integration is the next step for full predictive freshness routing.
