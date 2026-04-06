export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RouteX | PERFORMANCE_CHARTS</title>
    <style>
      :root {
        --bg: #0b1220;
        --panel: #111827;
        --text: #f5f7fb;
        --muted: #8a94ac;
        --green: #22d3a6;
        --pink: #f472b6;
        --blue: #38bdf8;
        --border: #1f2937;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: "Inter", sans-serif;
        height: 100vh;
        overflow: hidden;
        font-size: 14px;
      }

      body[data-health="warn"] { background: #0f1625; }
      body[data-health="bad"] { background: #140c12; }

      .shell {
        display: grid;
        grid-template-columns: 3fr 1.2fr;
        height: 100vh;
      }

      .main {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow-y: auto;
      }

      .hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .hero-title h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: 0.3px;
      }

      .hero-sub {
        color: var(--muted);
        font-size: 12px;
      }

      .hud-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
      }

      .hud-box {
        background: var(--panel);
        border: 1px solid var(--border);
        padding: 12px;
        border-radius: 10px;
      }

      .hud-label { font-size: 11px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px; }
      .hud-value { font-size: 22px; font-weight: 800; color: var(--text); }
      .hud-sub { font-size: 11px; color: var(--muted); margin-top: 3px; }

      .upper-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 14px;
      }

      .race-card { padding: 0; }

      .race-container {
        height: 320px;
        border-top: 1px solid var(--border);
        position: relative;
        overflow: hidden;
        border-radius: 0 0 10px 10px;
        background: #0d1424;
      }

      .track-lane {
        height: 70px;
        border-bottom: 1px solid var(--border);
        position: relative;
      }

      .lane-canvas {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
      }

      .runner {
        position: absolute;
        height: 38px;
        display: flex;
        align-items: center;
        gap: 10px;
        will-change: transform;
        z-index: 10;
      }

      .runner-rank {
        font-size: 14px;
        font-weight: 800;
        color: var(--blue);
        min-width: 28px;
        text-align: right;
      }

      .runner.active .runner-rank { color: var(--green); }

      .runner-sprite {
        width: 38px;
        height: 24px;
        background: var(--green);
        clip-path: polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%, 20% 50%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 900;
        color: #000;
        font-size: 12px;
      }

      .runner.active .runner-sprite {
        background: #fff;
        box-shadow: 0 0 12px var(--green);
      }

      .runner-info { display: flex; flex-direction: column; }
      .runner-name { font-size: 14px; font-weight: 800; }
      .runner-meta { font-size: 11px; color: var(--muted); }

      .sidebar {
        border-left: 1px solid var(--border);
        background: var(--panel);
        display: flex;
        flex-direction: column;
      }

      .log-section { flex: 1; overflow-y: auto; padding: 18px; }
      .log-title { font-size: 12px; font-weight: 800; color: var(--muted); margin-bottom: 12px; }
      .log-item { font-size: 13px; margin-bottom: 10px; font-weight: 600; padding: 8px; border-radius: 8px; background: #0f172a; border: 1px solid var(--border); }
      .log-time { color: var(--muted); font-size: 11px; font-family: monospace; }
      .log-val { color: var(--green); }

      .bottom-hud {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px;
        margin-top: 10px;
      }

      .card { background: var(--panel); border: 1px solid var(--border); padding: 14px; border-radius: 10px; }
      .card-tag { font-size: 11px; color: var(--muted); margin-bottom: 8px; font-weight: 800; letter-spacing: 0.3px; text-transform: uppercase; }

      .badge {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 800;
        background: #0f172a;
        border: 1px solid var(--border);
      }

      .failover-pill {
        margin-top: 2px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        background: #0f172a;
        color: var(--blue);
        font-size: 12px;
        font-weight: 800;
        border: 1px solid var(--border);
      }

      .legend-table { width: 100%; border-collapse: collapse; }
      .legend-table th, .legend-table td { padding: 8px 6px; text-align: left; font-size: 12px; }
      .legend-table th { color: var(--muted); font-weight: 700; border-bottom: 1px solid var(--border); }
      .legend-table tr td { border-bottom: 1px solid var(--border); }

      .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

      .traffic-chip {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        padding: 4px 8px;
        border-radius: 8px;
        background: #0f172a;
        color: var(--muted);
        font-size: 11px;
      }

      .spark {
        width: 36px;
        height: 6px;
        background: linear-gradient(90deg, var(--blue), var(--green));
        border-radius: 999px;
        display: inline-block;
      }

      .reason-line { margin-bottom: 4px; font-size: 12px; color: var(--text); }

    </style>
  </head>
  <body>
    <div class="shell">
      <div class="main">
        <div class="hero">
          <div>
            <h1 style="margin:0;">ROUTEX</h1>
            <div class="hero-sub">Adaptive RPC router · live health · race view</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div id="failover-pill"></div>
            <div class="badge" id="status-pill">Connecting…</div>
          </div>
        </div>

        <div class="hud-grid" id="metrics-root"></div>

        <div class="upper-grid">
          <div class="card">
            <div class="card-tag">Providers</div>
            <table class="legend-table" id="legend-list"></table>
          </div>
          <div class="card race-card">
            <div class="card-tag" style="padding:12px 14px 0 14px;">Race view</div>
            <div class="race-container" id="race-track"></div>
          </div>
        </div>

        <div class="bottom-hud">
          <div class="card">
             <div class="card-tag">Selection Rationale</div>
             <div id="reason-root" style="font-size:12px"></div>
          </div>
          <div class="card">
            <div class="card-tag">Manual Probe</div>
            <div style="display:flex; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
              <button id="probe-btn" style="background:var(--green); color:#000; border:none; padding:10px 12px; font-weight:800; cursor:pointer; border-radius:10px;">Probe latest blockhash</button>
              <button id="burst-btn" style="background:var(--blue); color:#000; border:none; padding:10px 12px; font-weight:800; cursor:pointer; border-radius:10px;">Send 5 mixed</button>
              <div id="probe-root" style="font-family:monospace; font-size:11px; color:var(--muted); flex:1; min-width:200px; max-height:80px; overflow:auto;">READY</div>
            </div>
          </div>
        </div>
      </div>

      <div class="sidebar">
        <div class="log-section">
          <div class="log-title">Network traffic</div>
          <div id="routes-root"></div>
        </div>
        <div class="log-section">
          <div class="log-title">System events</div>
          <div id="events-root"></div>
        </div>
      </div>
    </div>

    <script>
      const palette = ["#10e890", "#2eb8ff", "#ff2e88", "#ffc96a", "#9d82ff"];
      let providers = [];
      let totalDistances = {};
      let visualYs = {}; 
      let histories = {}; // Stores last N points
      let lastTime = performance.now();
      let routeCounts = {};

      function relativeTime(iso) {
        if (!iso) return "n/a";
        const ts = new Date(iso).getTime();
        if (Number.isNaN(ts)) return iso;
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return Math.round(diff) + "s ago";
        if (diff < 3600) return Math.round(diff/60) + "m ago";
        return Math.round(diff/3600) + "h ago";
      }

      function renderMetrics(h, m) {
        const entries = [
          ["Monitor mode", h.monitorMode || "rpc", "active"],
          ["Healthy nodes", \`\${h.healthyProviderCount}/\${h.providerCount}\`, "online providers"],
          ["Success rate", m.successRate === null ? "---" : \`\${m.successRate}%\`, "last 2 min"],
          ["Avg latency", \`\${m.averageDurationMs || 0} ms\`, "rolling"],
          ["Routes", valueOr(m.routeCount), "total handled"]
        ];
        document.getElementById("metrics-root").innerHTML = entries.map(([l, v, s]) => \`
          <div class="hud-box">
            <div class="hud-label">\${l}</div>
            <div class="hud-value">\${v}</div>
            <div class="hud-sub">\${s}</div>
          </div>
        \`).join("");
      }

      function renderLegend(pList, counts = {}) {
        const legend = document.getElementById("legend-list");
        if (!legend) return;
        legend.innerHTML = \`
          <thead>
            <tr><th></th><th>Name</th><th>Latency</th><th>Lag</th><th>Routes</th><th>Score</th></tr>
          </thead>
          <tbody>
            \${pList.map((p, i) => {
              const share = counts[p.name] || 0;
              return \`<tr>
                <td><span class="dot" style="background:\${palette[i % palette.length]}"></span></td>
                <td>\${p.name} \${p.active ? '<span style="color:var(--green);font-weight:700;">●</span>' : ''}</td>
                <td>\${p.avgLatencyMs || "--"} ms</td>
                <td>\${p.slotLag ?? "n/a"}</td>
                <td>\${share}</td>
                <td>\${valueOr(p.score)}</td>
              </tr>\`;
            }).join("")}
          </tbody>
        \`;
      }

      function updateRunners(pList, counts = {}) {
        providers = pList;
        routeCounts = counts;
        const track = document.getElementById("race-track");
        
        if (track.children.length !== providers.length) {
          track.innerHTML = providers.map((p, i) => \`
            <div class="track-lane">
              <canvas id="canvas-\${p.name.replace(/\\s+/g, '-')}" class="lane-canvas"></canvas>
              <div id="runner-\${p.name.replace(/\\s+/g, '-')}" class="runner">
                <div class="runner-rank" id="rank-\${p.name.replace(/\\s+/g, '-')}">#?</div>
                <div class="runner-sprite" style="background:\${palette[i % palette.length]}">\${p.name[0].toUpperCase()}</div>
                <div class="runner-info">
                  <div class="runner-name">\${p.name}</div>
                  <div class="runner-meta" id="meta-\${p.name.replace(/\\s+/g, '-')}">---</div>
                </div>
              </div>
            </div>
          \`).join("");
          
          providers.forEach(p => {
             const id = p.name.replace(/\\s+/g, '-');
             const canvas = document.getElementById(\`canvas-\${id}\`);
             canvas.width = canvas.clientWidth;
             canvas.height = canvas.clientHeight;

             if (totalDistances[p.name] === undefined) totalDistances[p.name] = 0;
             if (visualYs[p.name] === undefined) visualYs[p.name] = 50; 
             if (histories[p.name] === undefined) histories[p.name] = [];
          });
        }
      }

      function animate() {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        const trackWidth = document.getElementById("race-track").clientWidth;
        const ranked = [...providers].sort((a,b) => (totalDistances[b.name] || 0) - (totalDistances[a.name] || 0));
        const ranks = {};
        ranked.forEach((p, i) => ranks[p.name] = i + 1);

        providers.forEach((p, pIdx) => {
          const id = p.name.replace(/\\s+/g, '-');
          const el = document.getElementById(\`runner-\${id}\`);
          const canvas = document.getElementById(\`canvas-\${id}\`);
          if (!el || !canvas) return;

          const ctx = canvas.getContext("2d");
          const latency = p.avgLatencyMs || 500;
          const speedFactor = Math.max(0.4, (1000 - latency) / 250);
          
          // Speed based vertical: lower latency = higher (small top value in px)
          const targetY = Math.max(10, Math.min(80, (latency / 500) * 80)); 
          visualYs[p.name] += (targetY - visualYs[p.name]) * dt * 3; 

          totalDistances[p.name] += dt * 100 * speedFactor;
          const visualX = totalDistances[p.name] % trackWidth;
          
          // Update history
          histories[p.name].push({ x: visualX, y: visualYs[p.name] });
          if (histories[p.name].length > 120) histories[p.name].shift();

          // Reset history if we just wrapped around
          if (histories[p.name].length > 1 && visualX < histories[p.name][histories[p.name].length-2].x) {
             histories[p.name] = [{ x: visualX, y: visualYs[p.name] }];
          }

          // Draw Trail
          ctx.clearRect(0,0,canvas.width, canvas.height);
          ctx.beginPath();
          ctx.strokeStyle = palette[pIdx % palette.length];
          ctx.lineWidth = 2;
          ctx.shadowBlur = 10;
          ctx.shadowColor = palette[pIdx % palette.length];
          
          histories[p.name].forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y + 20);
            else ctx.lineTo(pt.x, pt.y + 20);
          });
          ctx.stroke();
          const last = histories[p.name][histories[p.name].length - 1];
          if (last) {
            ctx.beginPath();
            ctx.fillStyle = "#fff";
            ctx.arc(last.x, last.y + 20, 3, 0, Math.PI * 2);
            ctx.fill();
          }

          // Update Glider
          el.style.transform = \`translate(\${visualX}px, \${visualYs[p.name]}px)\`;
          el.className = \`runner \${p.active ? 'active' : ''}\`;
          
          const rankEl = document.getElementById(\`rank-\${id}\`);
          if (rankEl) rankEl.innerText = \`#\${ranks[p.name]}\`;

          const meta = document.getElementById(\`meta-\${id}\`);
          const share = routeCounts[p.name] || 0;
          meta.innerHTML = \`\${latency} ms · lag \${p.slotLag ?? "n/a"} · routes \${share}\`;
        });

        requestAnimationFrame(animate);
      }

      function renderFailover(h) {
        const root = document.getElementById("failover-pill");
        const ts = h.lastActiveSwitchAt;
        if (!ts) {
          root.innerHTML = '<span class="failover-pill" style="background:rgba(16,232,144,0.16);color:var(--green)">Stable: no switch yet</span>';
          return;
        }
        root.innerHTML = '<span class="failover-pill">Last switch ' + relativeTime(ts) + '</span>';
      }

      function renderReason(h, metrics) {
        const best = h.bestProvider;
        if (!best) return;
        const runnerUp = (h.providers || []).find((p) => p.name !== best.name) || null;
        const routeCounts = metrics.routeProviderCounts || {};
        const share = routeCounts[best.name] || 0;
        const lagDelta =
          runnerUp && runnerUp.slotLag !== null && best.slotLag !== null
            ? runnerUp.slotLag - best.slotLag
            : null;
        const scoreDelta =
          runnerUp && runnerUp.score !== null && best.score !== null
            ? runnerUp.score - best.score
            : null;
        const mix = metrics.methodCountByStrategy || {};
        const edge = runnerUp
          ? 'Next best delta: lag +' + (lagDelta ?? "n/a") + ', score +' + (scoreDelta ?? "n/a")
          : "No runner-up yet";
        document.getElementById("reason-root").innerHTML =
          '<div class="reason-line"><strong>Primary:</strong> ' + best.name + '</div>' +
          '<div class="reason-line">' + (best.avgLatencyMs ?? "--") + ' ms latency · slot lag ' + (best.slotLag ?? "n/a") + ' · score ' + valueOr(best.score) + '</div>' +
          '<div class="reason-line">Traffic share: ' + share + ' routes · ' + edge + '</div>' +
          '<div class="reason-line">Method mix: read ' + (mix.read ?? 0) + ' / fresh ' + (mix["fresh-read"] ?? 0) + ' / write ' + (mix.write ?? 0) + '</div>';
      }

      function renderRoutes(routes) {
        document.getElementById("routes-root").innerHTML = routes.slice(0, 10).map(r => \`
          <div class="log-item">
            <div class="log-time">[\${new Date(r.createdAt).toLocaleTimeString()}]</div>
            <div><strong>\${r.method}</strong> → <span class="log-val">\${r.providerName}</span></div>
          </div>
        \`).join("");
      }

      function renderEvents(events) {
        document.getElementById("events-root").innerHTML = events.slice(0, 10).map(e => \`
          <div class="log-item" style="color:\${e.level === 'error' ? 'var(--pink)' : 'var(--blue)'}">
            <div class="log-time">[\${new Date(e.createdAt).toLocaleTimeString()}]</div>
            <div>\${e.type}: \${e.message}</div>
          </div>
        \`).join("");
      }

      async function runProbe() {
        const btn = document.getElementById("probe-btn");
        btn.disabled = true;
        try {
          const started = performance.now();
          const res = await fetch("/rpc", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc:"2.0", id:1, method:"getLatestBlockhash"})});
          const body = await res.json();
          const duration = Math.round(performance.now() - started);
          const provider = res.headers.get("x-routex-provider") || "unknown";
          const hash = body?.result?.value?.blockhash || body?.result?.blockhash || "n/a";
          const shortHash = typeof hash === "string" ? hash.slice(0, 12) + "..." : "n/a";
          document.getElementById("probe-root").innerHTML = \`PROVIDER:\${provider} | \${duration}ms | HASH:\${shortHash}\`;
        } catch (e) { document.getElementById("probe-root").innerHTML = "Error: " + e; }
        btn.disabled = false;
      }

      async function runBurst() {
        const btn = document.getElementById("burst-btn");
        btn.disabled = true;
        document.getElementById("probe-root").innerHTML = "Sending burst...";
        const methods = ["getSlot", "getLatestBlockhash", "getBalance", "getAccountInfo", "getProgramAccounts"];
        for (const m of methods) {
          try {
            await fetch("/rpc", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc:"2.0", id:m, method:m, params:m==="getBalance"||m==="getAccountInfo" ? ["11111111111111111111111111111111"] : []})});
          } catch {}
        }
        document.getElementById("probe-root").innerHTML = "Burst sent (5 requests)";
        btn.disabled = false;
      }

      function valueOr(v, f = "0") { return v === null ? f : v; }

      async function refresh() {
        try {
          const [hR, mR, eR, rR] = await Promise.all([
            fetch("/api/health"),
            fetch("/api/metrics"),
            fetch("/api/events"),
            fetch("/api/routes")
          ]);
          const h = await hR.json(), m = await mR.json(), e = await eR.json(), r = await rR.json();
          document.body.dataset.health = h.healthyProviderCount === 0 ? "bad" : (h.healthyProviderCount < 2 ? "warn" : "ok");
          renderFailover(h);
          renderMetrics(h, m);
          updateRunners(h.providers || [], m.routeProviderCounts || {});
          renderLegend(h.providers || [], m.routeProviderCounts || {});
          renderReason(h, m);
          renderRoutes(r);
          renderEvents(e);
          const s = document.getElementById("status-pill");
          if (s) s.textContent = "Live at " + new Date().toLocaleTimeString();
        } catch (err) {
          const s = document.getElementById("status-pill");
          if (s) s.textContent = "API error";
          console.error("RouteX refresh failed", err);
        }
      }

      document.getElementById("probe-btn").onclick = runProbe;
      const burstBtn = document.getElementById("burst-btn");
      if (burstBtn) burstBtn.onclick = runBurst;
      refresh();
      setInterval(refresh, 2000);
      requestAnimationFrame(animate);
    </script>
  </body>
</html>`;
}
