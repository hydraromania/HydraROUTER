"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

function formatNumber(num) {
  if (num == null || isNaN(num)) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
  return num.toLocaleString();
}

function formatCost(val) {
  const num = Number(val) || 0;
  return `$${num.toFixed(4)}`;
}

function formatMs(ms) {
  if (!ms || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Interactive Animated Counter
function AnimatedCounter({ value, formatter = formatNumber, prefix = "", suffix = "" }) {
  const [display, setDisplay] = useState(value);
  const prevVal = useRef(value);

  useEffect(() => {
    const start = prevVal.current;
    const end = typeof value === "number" ? value : Number(value) || 0;
    if (start === end) return;

    const startTime = performance.now();
    const duration = 600;

    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * ease;
      setDisplay(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        prevVal.current = end;
        setDisplay(end);
      }
    }
    requestAnimationFrame(step);
  }, [value]);

  return (
    <span>
      {prefix}
      {formatter(display)}
      {suffix}
    </span>
  );
}

// Particle stream canvas representing real incoming requests
function TrafficCanvas({ activeRequests = [], recentHistory = [] }) {
  const canvasRef = useRef(null);
  const particles = useRef([]);
  const animFrame = useRef(null);

  // Spawn particles when active/recent requests change
  useEffect(() => {
    const newItems = [...activeRequests, ...recentHistory.slice(0, 5)];
    if (!newItems.length) return;

    const colors = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];
    newItems.forEach((req, idx) => {
      if (Math.random() > 0.4) return;
      const color = colors[Math.abs((req.model || req.provider || "").split("").reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length];
      particles.current.push({
        x: 20 + Math.random() * 40,
        y: Math.random() * 200,
        targetY: 40 + (idx % 6) * 28,
        vx: 2 + Math.random() * 3,
        vy: (Math.random() - 0.5) * 1.5,
        size: 3 + Math.random() * 3,
        color,
        alpha: 1,
        life: 1,
        label: (req.model || req.provider || "req").slice(0, 14),
      });
    });

    if (particles.current.length > 50) {
      particles.current = particles.current.slice(-50);
    }
  }, [activeRequests, recentHistory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function render() {
      if (!canvas) return;
      const width = canvas.parentElement?.clientWidth || 600;
      const height = 240;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Draw subtle futuristic grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Hub nodes: Gateway (Left) -> Models (Right)
      const gwX = 50;
      const gwY = height / 2;

      // Gateway Pulsing node
      const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
      ctx.beginPath();
      ctx.arc(gwX, gwY, 14 + pulse * 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(99, 102, 241, 0.15)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(gwX, gwY, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#6366f1";
      ctx.shadowColor = "#6366f1";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#a5b4fc";
      ctx.font = "10px monospace";
      ctx.fillText("GATEWAY", gwX - 22, gwY + 22);

      // Target cluster nodes (Right)
      const targetX = width - 70;
      const targets = [
        { name: "CLAUDE", color: "#f97316", y: height * 0.25 },
        { name: "OPENAI", color: "#10b981", y: height * 0.5 },
        { name: "GEMINI", color: "#3b82f6", y: height * 0.75 },
      ];

      targets.forEach((t) => {
        ctx.beginPath();
        ctx.moveTo(gwX + 15, gwY);
        ctx.bezierCurveTo((gwX + targetX) / 2, gwY, (gwX + targetX) / 2, t.y, targetX - 15, t.y);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(targetX, t.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px monospace";
        ctx.fillText(t.name, targetX - 18, t.y + 16);
      });

      // Ambient background particles flow continuously
      if (Math.random() < 0.3) {
        particles.current.push({
          x: gwX,
          y: gwY,
          targetY: targets[Math.floor(Math.random() * targets.length)].y,
          vx: 2.5 + Math.random() * 2,
          vy: 0,
          size: 2.5,
          color: "#818cf8",
          alpha: 0.9,
          life: 1,
        });
      }

      // Update and draw live request packets
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        const progress = Math.min((p.x - gwX) / (targetX - gwX), 1);
        p.y = gwY + (p.targetY - gwY) * Math.sin((progress * Math.PI) / 2);
        p.alpha -= 0.008;

        if (p.x >= targetX || p.alpha <= 0) {
          particles.current.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        if (p.label && progress > 0.2 && progress < 0.8) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = "9px monospace";
          ctx.fillText(p.label, p.x + 6, p.y - 4);
        }
      }

      animFrame.current = requestAnimationFrame(render);
    }

    render();

    return () => {
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
    };
  }, []);

  return (
    <div className="relative w-full h-[240px] rounded-xl overflow-hidden bg-bg-card/50 border border-border/40 backdrop-blur-sm shadow-inner">
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="absolute top-3 left-4 flex items-center gap-2 pointer-events-none">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
        </span>
        <span className="text-xs font-mono font-medium text-text-muted uppercase tracking-wider">
          LIVE MESH TELEMETRY
        </span>
      </div>
    </div>
  );
}

export default function ConsoleLogAnimation() {
  const [period, setPeriod] = useState("today");
  const [stats, setStats] = useState(null);
  const [liveData, setLiveData] = useState({ active: [], history: [], stats: { activeCount: 0 } });
  const [connected, setConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Keep time ticking for active streams
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real aggregate stats
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/usage/stats?period=${period}`);
        if (res.ok && mounted) {
          const data = await res.json();
          setStats(data);
        }
      } catch (e) {
        console.error("Failed to fetch animated stats:", e);
      }
    };

    load();
    const interval = setInterval(load, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [period]);

  // Connect to SSE live request stream for real-time reactivity
  useEffect(() => {
    let es = null;
    const connect = () => {
      try {
        es = new EventSource("/api/usage/live");
        es.onopen = () => setConnected(true);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            setLiveData(data);
          } catch {
            // ignore heartbeat
          }
        };
        es.onerror = () => setConnected(false);
      } catch {
        setConnected(false);
      }
    };
    connect();

    return () => {
      if (es) es.close();
    };
  }, []);

  // Compute calculated metrics
  // API returns byProvider/byModel as objects ({ id: stats }), not arrays —
  // normalize both shapes so .map never crashes.
  const toProviderArray = (byProvider) => {
    if (Array.isArray(byProvider)) return byProvider;
    if (byProvider && typeof byProvider === "object") {
      return Object.entries(byProvider).map(([provider, v]) => ({ provider, ...(v || {}) }));
    }
    return [];
  };
  const toModelArray = (byModel) => {
    if (Array.isArray(byModel)) return byModel;
    if (byModel && typeof byModel === "object") {
      return Object.entries(byModel).map(([key, v]) => ({ key, ...(v || {}) }));
    }
    return [];
  };
  const toBucketArray = (v) => (Array.isArray(v) ? v : []);

  const totals = stats?.totals || {
    requests: stats?.totalRequests || 0,
    promptTokens: stats?.totalPromptTokens || 0,
    completionTokens: stats?.totalCompletionTokens || 0,
    totalTokens: (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0),
    cachedTokens: stats?.totalCachedTokens || 0,
    cost: stats?.totalCost || 0,
    avgDuration: stats?.avgDuration || 0,
  };

  const providers = useMemo(() => toProviderArray(stats?.byProvider), [stats]);
  const maxProviderReqs = useMemo(() => {
    return Math.max(...providers.map((p) => p.requests || 0), 1);
  }, [providers]);

  const models = useMemo(() => toModelArray(stats?.byModel), [stats]);
  const maxModelReqs = useMemo(() => {
    return Math.max(...models.map((m) => m.requests || 0), 1);
  }, [models]);

  const last10Minutes = useMemo(() => toBucketArray(stats?.last10Minutes), [stats]);
  const maxRpm = useMemo(() => {
    return Math.max(...last10Minutes.map((b) => b.requests || 0), 5);
  }, [last10Minutes]);

  const activeCount = liveData?.active?.length || 0;
  const successCount = liveData?.history?.filter((h) => h.status === "completed").length || 0;
  const errorCount = liveData?.history?.filter((h) => h.status === "error").length || 0;
  const totalTracked = (liveData?.history?.length || 0) + activeCount;
  const successRate = totalTracked > 0 ? ((successCount / Math.max(successCount + errorCount, 1)) * 100).toFixed(1) : "100.0";

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-text-main">
              Real-time Traffic & Telemetry
            </h2>
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              connected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
            }`}>
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-ping" : "bg-rose-400"}`} />
              {connected ? "LIVE STREAM ACTIVE" : "RECONNECTING"}
            </div>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Visual telemetry engine & reactive neural pipeline streaming actual platform activity.
          </p>
        </div>

        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1 bg-bg-card/70 p-1 rounded-xl border border-border/60">
          {["today", "24h", "7d", "30d", "all"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p
                  ? "bg-primary text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-main hover:bg-bg/40"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards Row with Animated Digits */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Total Requests */}
        <Card padding="md" className="relative overflow-hidden group hover:border-primary/50 transition-all">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Requests</span>
            <span className="material-symbols-outlined text-primary text-[20px]">swap_horiz</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-text-main font-mono">
            <AnimatedCounter value={totals.requests} />
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
            <span>Real traffic tracked</span>
          </div>
          <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-primary/10 rounded-full blur-xl pointer-events-none" />
        </Card>

        {/* Total Tokens */}
        <Card padding="md" className="relative overflow-hidden group hover:border-sky-500/50 transition-all">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Tokens Processed</span>
            <span className="material-symbols-outlined text-sky-400 text-[20px]">data_object</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-text-main font-mono">
            <AnimatedCounter value={totals.totalTokens} />
          </div>
          <div className="mt-2 text-[11px] text-text-muted font-mono flex items-center justify-between">
            <span>In: {formatNumber(totals.promptTokens)}</span>
            <span>Out: {formatNumber(totals.completionTokens)}</span>
          </div>
          <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-sky-500/10 rounded-full blur-xl pointer-events-none" />
        </Card>

        {/* In-Flight Active Requests */}
        <Card padding="md" className="relative overflow-hidden group hover:border-amber-500/50 transition-all">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Concurrency</span>
            <span className="material-symbols-outlined text-amber-400 text-[20px] animate-spin">sync</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-amber-400 font-mono flex items-center gap-2">
            <AnimatedCounter value={activeCount} />
            <span className="text-xs font-normal text-text-muted">streams</span>
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            {activeCount > 0 ? "Executing queries currently" : "Awaiting requests"}
          </div>
          <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
        </Card>

        {/* Latency / Avg Duration */}
        <Card padding="md" className="relative overflow-hidden group hover:border-violet-500/50 transition-all">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Latency</span>
            <span className="material-symbols-outlined text-violet-400 text-[20px]">timer</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-text-main font-mono">
            <AnimatedCounter value={totals.avgDuration || 0} formatter={formatMs} />
          </div>
          <div className="mt-2 text-[11px] text-emerald-400 font-medium">
            Success: {successRate}%
          </div>
          <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-violet-500/10 rounded-full blur-xl pointer-events-none" />
        </Card>

        {/* Estimated Cost */}
        <Card padding="md" className="relative overflow-hidden group hover:border-emerald-500/50 transition-all">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Est. Cost</span>
            <span className="material-symbols-outlined text-emerald-400 text-[20px]">payments</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-emerald-400 font-mono">
            <AnimatedCounter value={totals.cost || 0} formatter={formatCost} />
          </div>
          <div className="mt-2 text-[11px] text-text-muted font-mono">
            Cached: {formatNumber(totals.cachedTokens)} tok
          </div>
          <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
        </Card>
      </div>

      {/* Main Interactive Animated Traffic Canvas */}
      <Card padding="none" className="overflow-hidden border border-border/60 bg-bg-card/40">
        <TrafficCanvas activeRequests={liveData.active} recentHistory={liveData.history} />
      </Card>

      {/* Dynamic Activity Grid: 10-Min Pulse + Provider Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Real-time 10-Minute Volume Bars */}
        <Card padding="md" className="flex flex-col gap-4 border border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-main">Throughput Pulse (Last 10 Min)</h3>
              <p className="text-xs text-text-muted">Real requests breakdown bucketed minute-by-minute</p>
            </div>
            <span className="text-xs font-mono font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
              Peak: {maxRpm} req/m
            </span>
          </div>

          <div className="flex items-end justify-between gap-2 h-44 pt-6 px-2">
            {last10Minutes.length > 0 ? (
              last10Minutes.map((bucket, i) => {
                const heightPct = Math.max((bucket.requests / maxRpm) * 100, 6);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                    <div className="relative w-full flex items-end justify-center h-full">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full max-w-[28px] bg-gradient-to-t from-primary/80 to-sky-400 rounded-t-md transition-all duration-500 group-hover:from-primary group-hover:to-sky-300 relative"
                      >
                        {bucket.requests > 0 && (
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-bg-card border border-border text-[10px] font-mono px-1.5 py-0.5 rounded shadow whitespace-nowrap pointer-events-none z-10 text-text-main">
                            {bucket.requests} reqs
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-text-muted">{bucket.time}</span>
                  </div>
                );
              })
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-muted text-xs font-mono">
                Awaiting throughput telemetry...
              </div>
            )}
          </div>
        </Card>

        {/* Live Provider Breakdown with Animated Progress */}
        <Card padding="md" className="flex flex-col gap-4 border border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-main">Provider Routing Distribution</h3>
              <p className="text-xs text-text-muted">Traffic dispatched across upstream providers</p>
            </div>
            <span className="text-xs font-mono text-text-muted">{providers.length} connected</span>
          </div>

          <div className="flex flex-col gap-3 h-44 overflow-y-auto pr-1">
            {providers.length > 0 ? (
              providers.slice(0, 5).map((prov, i) => {
                const pct = Math.round((prov.requests / maxProviderReqs) * 100);
                return (
                  <div key={prov.provider || i} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-text-main uppercase tracking-wide">
                        {prov.provider || "Unknown"}
                      </span>
                      <div className="flex items-center gap-3 font-mono text-text-muted text-[11px]">
                        <span>{prov.requests.toLocaleString()} reqs</span>
                        <span className="text-emerald-400">{formatCost(prov.cost)}</span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-bg/80 rounded-full overflow-hidden p-0.5 border border-border/30">
                      <div
                        style={{ width: `${pct}%` }}
                        className="h-full bg-gradient-to-r from-primary to-indigo-400 rounded-full transition-all duration-700 ease-out shadow-sm"
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-xs font-mono">
                No provider routing recorded yet.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Recent Stream Activity Ledger */}
      <Card padding="md" className="border border-border/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-text-muted text-[18px]">terminal</span>
            <h3 className="text-sm font-semibold text-text-main">Active Streams & Live Request Flow</h3>
          </div>
          <span className="text-xs font-mono text-text-muted">
            {liveData.active.length} active • {liveData.history.length} recent
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-border/50 text-text-muted">
                <th className="pb-2 font-medium">STATUS</th>
                <th className="pb-2 font-medium">MODEL</th>
                <th className="pb-2 font-medium">PROVIDER</th>
                <th className="pb-2 font-medium">DURATION</th>
                <th className="pb-2 font-medium text-right">TOKENS (IN/OUT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {liveData.active.map((item) => (
                <tr key={item.id} className="bg-primary/5 text-text-main transition-colors">
                  <td className="py-2.5 flex items-center gap-2 text-primary font-bold">
                    <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                    STREAMING
                  </td>
                  <td className="py-2.5 font-medium">{item.model || "-"}</td>
                  <td className="py-2.5 text-text-muted">{item.provider || "-"}</td>
                  <td className="py-2.5 text-amber-400 font-semibold">{formatMs(currentTime ? currentTime - item.startTime : item.duration)}</td>
                  <td className="py-2.5 text-right text-text-muted">-</td>
                </tr>
              ))}
              {liveData.history.slice(0, 6).map((item) => (
                <tr key={item.id || item.startTime} className="hover:bg-bg/40 text-text-main transition-colors">
                  <td className="py-2 flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.status === "completed"
                          ? "bg-emerald-400"
                          : item.status === "error"
                          ? "bg-rose-400"
                          : "bg-amber-400"
                      }`}
                    />
                    <span className={item.status === "error" ? "text-rose-400" : "text-text-muted"}>
                      {item.status?.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 text-text-main">{item.model || "-"}</td>
                  <td className="py-2 text-text-muted">{item.provider || "-"}</td>
                  <td className="py-2 text-text-muted">{formatMs(item.duration)}</td>
                  <td className="py-2 text-right text-text-muted">
                    {item.tokens ? `${item.tokens.prompt || 0} / ${item.tokens.completion || 0}` : "-"}
                  </td>
                </tr>
              ))}
              {liveData.active.length === 0 && liveData.history.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-text-muted">
                    No active or historical requests recorded yet. Send queries to hydrarouter to view live telemetry.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
