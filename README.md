# RouteX: Freshness-aware Solana RPC Router

RouteX is a modular proxy server that monitors multiple Solana RPC providers in real-time and routes each request to the healthiest and freshest node.

## 🚀 MVP Features
- **Predictive Freshness**: Tracks slot lag using Yellowstone gRPC slot streaming or RPC polling.
- **Failover Proxy**: Automatically routes traffic away from lagging or degraded providers.
- **Local Demo Mode**: Includes a built-in mock cluster and benchmark tools for local testing.
- **Health Dashboard**: A built-in web dashboard for monitoring provider status and routing decisions.

## 🛠️ Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the demo environment:
   ```bash
   # Terminal 1: Start mock cluster nodes
   npm run demo:cluster
   ```
   ```bash
   # Terminal 2: Start RouteX proxy
   npm run demo:routex
   ```
   ```bash
   # Terminal 3 (Optional): Run stress-test benchmark
   npm run demo:benchmark
   ```
3. Open the Dashboard: [http://127.0.0.1:8080/](http://127.0.0.1:8080/)

## 🏗️ Architecture
- **Slot Monitor**: Subscribes to Yellowstone or polls RPC for slot height.
- **Scoring Engine**: Ranks providers based on slot lag, latency, and error rate.
- **Proxy Gateway**: Forwards JSON-RPC calls to the best-ranked provider.
