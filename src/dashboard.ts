export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RouteX Dashboard</title>
    <style>
      :root {
        --bg: #08111f;
        --panel: rgba(13, 27, 43, 0.84);
        --panel-border: rgba(109, 170, 255, 0.18);
        --text: #eff7ff;
        --muted: #8ba7c7;
        --green: #3ad29f;
        --yellow: #ffca68;
        --red: #ff6d7f;
        --blue: #5bb2ff;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(61, 124, 255, 0.26), transparent 30%),
          radial-gradient(circle at top right, rgba(58, 210, 159, 0.18), transparent 28%),
          linear-gradient(180deg, #040913, #091625 55%, #07111f);
        min-height: 100vh;
      }

      .shell {
        width: min(1200px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 20px;
        margin-bottom: 24px;
      }

      .hero h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 3.25rem);
        letter-spacing: -0.04em;
      }

      .hero p {
        margin: 10px 0 0;
        color: var(--muted);
        max-width: 720px;
        line-height: 1.6;
      }

      .pill {
        border: 1px solid var(--panel-border);
        background: rgba(255, 255, 255, 0.03);
        padding: 10px 14px;
        border-radius: 999px;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 16px;
      }

      .card {
        grid-column: span 12;
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 20px;
        padding: 18px;
        backdrop-filter: blur(18px);
        box-shadow: 0 16px 60px rgba(0, 0, 0, 0.25);
      }

      .metric-cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
      }

      .metric {
        background: rgba(255, 255, 255, 0.03);
        border-radius: 16px;
        padding: 16px;
      }

      .metric .label {
        color: var(--muted);
        font-size: 0.9rem;
      }

      .metric .value {
        margin-top: 8px;
        font-size: 1.9rem;
        font-weight: 700;
        letter-spacing: -0.04em;
      }

      .providers {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }

      .provider {
        background: rgba(255, 255, 255, 0.03);
        border-radius: 18px;
        padding: 16px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .provider.active {
        border-color: rgba(91, 178, 255, 0.45);
        box-shadow: inset 0 0 0 1px rgba(91, 178, 255, 0.2);
      }

      .provider h3 {
        margin: 0 0 8px;
        font-size: 1.05rem;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .status::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--yellow);
      }

      .status.healthy::before {
        background: var(--green);
      }

      .status.unhealthy::before {
        background: var(--red);
      }

      .provider dl {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 12px;
        margin: 14px 0 0;
      }

      .provider dt {
        color: var(--muted);
        font-size: 0.82rem;
      }

      .provider dd {
        margin: 4px 0 0;
        font-size: 1rem;
      }

      .logs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 420px;
        overflow: auto;
        padding-right: 6px;
      }

      .row {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.04);
      }

      .row .topline {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 6px;
      }

      .row .meta {
        color: var(--muted);
        font-size: 0.88rem;
      }

      .row strong {
        font-size: 0.95rem;
      }

      .warn {
        color: var(--yellow);
      }

      .error {
        color: var(--red);
      }

      .info {
        color: var(--blue);
      }

      .empty {
        color: var(--muted);
        padding: 8px 0;
      }

      a {
        color: var(--blue);
      }

      @media (max-width: 980px) {
        .metric-cards,
        .providers,
        .logs {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div>
          <h1>RouteX</h1>
          <p>Freshness-aware Solana RPC routing with health scoring, failover logs, and live provider visibility.</p>
        </div>
        <div class="pill" id="last-updated">Waiting for data...</div>
      </section>

      <section class="card">
        <div class="metric-cards" id="metrics"></div>
      </section>

      <section class="card">
        <div class="topline">
          <strong>Providers</strong>
          <span class="meta">Live ranking by freshness, reliability, and latency</span>
        </div>
        <div class="providers" id="providers"></div>
      </section>

      <section class="card">
        <div class="logs">
          <div>
            <div class="topline">
              <strong>Recent Route Decisions</strong>
              <span class="meta">Latest request outcomes</span>
            </div>
            <div class="list" id="routes"></div>
          </div>
          <div>
            <div class="topline">
              <strong>Event Timeline</strong>
              <span class="meta">Health, failover, and monitor events</span>
            </div>
            <div class="list" id="events"></div>
          </div>
        </div>
      </section>
    </div>

    <script>
      const formatValue = (value, suffix = "") => {
        if (value === null || value === undefined) return "n/a";
        return String(value) + suffix;
      };

      const timeAgo = (iso) => {
        if (!iso) return "never";
        const ms = Date.now() - new Date(iso).getTime();
        if (ms < 1000) return "just now";
        const secs = Math.floor(ms / 1000);
        if (secs < 60) return secs + "s ago";
        const mins = Math.floor(secs / 60);
        if (mins < 60) return mins + "m ago";
        const hours = Math.floor(mins / 60);
        return hours + "h ago";
      };

      const renderMetrics = (health, metrics) => {
        const items = [
          ["Monitor Mode", health.monitorMode || "rpc"],
          ["Chain Tip", formatValue(health.chainTip)],
          ["Healthy Providers", health.healthyProviderCount + " / " + health.providerCount],
          ["Requests Routed", metrics.routeCount || 0],
        ];

        document.getElementById("metrics").innerHTML = items.map(([label, value]) => \`
          <div class="metric">
            <div class="label">\${label}</div>
            <div class="value">\${value}</div>
          </div>
        \`).join("");
      };

      const renderProviders = (providers) => {
        const root = document.getElementById("providers");
        if (!providers.length) {
          root.innerHTML = '<div class="empty">No providers configured yet. Copy <code>routex.providers.example.json</code> to <code>routex.providers.json</code> and add your endpoints.</div>';
          return;
        }

        root.innerHTML = providers.map((provider) => \`
          <article class="provider \${provider.active ? "active" : ""}">
            <div class="topline">
              <h3>\${provider.name}</h3>
              <span class="status \${provider.healthy ? "healthy" : "unhealthy"}">\${provider.healthy ? "healthy" : "degraded"}</span>
            </div>
            <div class="meta">source: \${provider.monitorSource} | cluster: \${provider.cluster}</div>
            <dl>
              <div>
                <dt>Slot</dt>
                <dd>\${formatValue(provider.lastKnownSlot)}</dd>
              </div>
              <div>
                <dt>Lag</dt>
                <dd>\${formatValue(provider.slotLag)}</dd>
              </div>
              <div>
                <dt>Avg latency</dt>
                <dd>\${formatValue(provider.avgLatencyMs, " ms")}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>\${formatValue(provider.score)}</dd>
              </div>
              <div>
                <dt>Consecutive failures</dt>
                <dd>\${provider.consecutiveFailures}</dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>\${timeAgo(provider.lastUpdatedAt)}</dd>
              </div>
            </dl>
          </article>
        \`).join("");
      };

      const renderRoutes = (routes) => {
        const root = document.getElementById("routes");
        if (!routes.length) {
          root.innerHTML = '<div class="empty">No routed requests yet.</div>';
          return;
        }

        root.innerHTML = routes.map((entry) => \`
          <div class="row">
            <div class="topline">
              <strong>\${entry.method}</strong>
              <span class="meta">\${entry.status} in \${entry.durationMs}ms</span>
            </div>
            <div class="meta">
              strategy: \${entry.strategy} | provider: \${entry.providerName || "none"} | attempts: \${entry.attempts}
            </div>
            <div class="meta">
              path: \${entry.attemptedProviders.join(" -> ") || "none"}
            </div>
            \${entry.errorMessage ? \`<div class="meta error">\${entry.errorMessage}</div>\` : ""}
          </div>
        \`).join("");
      };

      const renderEvents = (events) => {
        const root = document.getElementById("events");
        if (!events.length) {
          root.innerHTML = '<div class="empty">No events recorded yet.</div>';
          return;
        }

        root.innerHTML = events.map((entry) => \`
          <div class="row">
            <div class="topline">
              <strong>\${entry.type}</strong>
              <span class="meta">\${timeAgo(entry.createdAt)}</span>
            </div>
            <div class="meta \${entry.level}">\${entry.message}</div>
            <div class="meta">\${entry.providerName ? "provider: " + entry.providerName : "system event"}</div>
          </div>
        \`).join("");
      };

      async function refresh() {
        const [healthRes, metricsRes, eventsRes, routesRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/metrics"),
          fetch("/api/events"),
          fetch("/api/routes")
        ]);

        const health = await healthRes.json();
        const metrics = await metricsRes.json();
        const events = await eventsRes.json();
        const routes = await routesRes.json();

        renderMetrics(health, metrics);
        renderProviders(health.providers || []);
        renderRoutes(routes);
        renderEvents(events);
        document.getElementById("last-updated").textContent = "Last refreshed " + new Date().toLocaleTimeString();
      }

      refresh().catch((error) => {
        document.getElementById("last-updated").textContent = "Dashboard load failed";
        console.error(error);
      });

      setInterval(() => {
        refresh().catch((error) => console.error(error));
      }, 1500);
    </script>
  </body>
</html>`;
}
