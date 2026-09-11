"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";

function fmt(n) {
  return new Intl.NumberFormat().format(n || 0);
}

function fmtCost(n) {
  return `$${(n || 0).toFixed(4)}`;
}

function AnimatedCounter({ value, formatter = fmt, prefix = "", suffix = "" }) {
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

// Particle stream canvas for combos
function ComboAnimationCanvas({ combos = [] }) {
  const canvasRef = useRef(null);
  const particles = useRef([]);

  useEffect(() => {
    if (!combos.length) return;
    const colors = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];
    
    // Periodically spawn particles across combo nodes
    const interval = setInterval(() => {
      combos.forEach((combo, idx) => {
        if (Math.random() > 0.4) return;
        const color = colors[idx % colors.length];
        particles.current.push({
          x: 20 + Math.random() * 40,
          y: 20 + (idx % 6) * 35,
          targetX: 400 + Math.random() * 80,
          targetY: 20 + (idx % 6) * 35,
          vx: 3 + Math.random() * 2,
          size: 3 + Math.random() * 3,
          color,
          alpha: 1,
          label: combo.name.slice(0, 16),
        });
      });

      if (particles.current.length > 60) {
        particles.current = particles.current.slice(-60);
      }
    }, 400);

    return () => clearInterval(interval);
  }, [combos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    function render() {
      if (!canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        if (p.x >= p.targetX) {
          p.alpha -= 0.05;
        }

        if (p.alpha <= 0 || p.x > canvas.width) {
          particles.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        if (p.label) {
          ctx.font = "9px monospace";
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.fillText(p.label, p.x + 8, p.y + 3);
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={220}
      className="w-full h-[220px] rounded-lg bg-black/40 border border-white/10"
    />
  );
}

export default function ComboStatsTab() {
  const [combos, setCombos] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCombo, setSelectedCombo] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/combos").then(r => r.ok ? r.json() : null),
      fetch("/api/usage/stats?period=all").then(r => r.ok ? r.json() : null),
    ])
      .then(([combosData, statsData]) => {
        const list = combosData?.combos || [];
        setCombos(list);
        setStats(statsData);
        if (list.length > 0) setSelectedCombo(list[0].name);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Compute stats per combo
  const comboMetrics = useMemo(() => {
    if (!combos.length || !stats) return [];
    
    return combos.map(combo => {
      let requests = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let cost = 0;
      const modelBreakdown = {};

      const comboNameLower = (combo.name || "").toLowerCase().trim();
      const modelsList = combo.models || [];

      // Helper to clean model name from provider prefix or annotations like "openai/gpt-4o" or "gpt-4o (openai)"
      const cleanModelName = (str) => {
        if (!str) return "";
        let s = str.toLowerCase().trim();
        if (s.includes("/")) s = s.split("/").pop();
        if (s.includes("(")) s = s.split("(")[0].trim();
        if (s.includes("[")) s = s.split("[")[0].trim();
        return s;
      };

      const targetModelsClean = modelsList.map(cleanModelName).filter(Boolean);

      // 1. Check stats.byModel
      Object.entries(stats.byModel || {}).forEach(([key, stat]) => {
        const keyClean = cleanModelName(key);
        const rawModelClean = cleanModelName(stat.rawModel);

        const isDirectCombo = keyClean === comboNameLower || rawModelClean === comboNameLower;
        const matchingTargetModel = modelsList.find((m) => {
          const mClean = cleanModelName(m);
          return mClean === keyClean || mClean === rawModelClean || key.toLowerCase().includes(mClean);
        });

        if (isDirectCombo || matchingTargetModel) {
          const targetKey = matchingTargetModel || stat.rawModel || key;
          requests += stat.requests || 0;
          promptTokens += stat.promptTokens || 0;
          completionTokens += stat.completionTokens || 0;
          cost += stat.cost || 0;

          if (!modelBreakdown[targetKey]) {
            modelBreakdown[targetKey] = { requests: 0, tokens: 0, cost: 0 };
          }
          modelBreakdown[targetKey].requests += stat.requests || 0;
          modelBreakdown[targetKey].tokens += (stat.promptTokens || 0) + (stat.completionTokens || 0);
          modelBreakdown[targetKey].cost += stat.cost || 0;
        }
      });

      return {
        id: combo.id,
        name: combo.name,
        kind: combo.kind || "llm",
        models: combo.models || [],
        requests,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost,
        modelBreakdown,
      };
    });
  }, [combos, stats]);

  const activeComboData = useMemo(() => {
    return comboMetrics.find(c => c.name === selectedCombo) || comboMetrics[0];
  }, [comboMetrics, selectedCombo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted">
        <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Animated Banner */}
      <Card className="p-4 bg-gradient-to-r from-primary/10 via-purple-500/10 to-transparent border-primary/20">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px] animate-pulse">layers</span>
                Animated Combo Live Flow
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                Real-time visual routing traffic across fallback and round-robin combo pipelines
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success" size="sm" dot>Live Simulation</Badge>
              <Badge variant="primary" size="sm">{combos.length} Combos</Badge>
            </div>
          </div>

          <ComboAnimationCanvas combos={combos} />
        </div>
      </Card>

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md" className="flex items-center gap-4">
          <div className="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">hub</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold">
              <AnimatedCounter value={comboMetrics.reduce((sum, c) => sum + c.requests, 0)} />
            </span>
            <span className="text-xs text-text-muted">Total Combo Requests</span>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4">
          <div className="size-12 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">token</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold">
              <AnimatedCounter value={comboMetrics.reduce((sum, c) => sum + c.totalTokens, 0)} />
            </span>
            <span className="text-xs text-text-muted">Total Combo Tokens</span>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4">
          <div className="size-12 rounded-xl bg-warning/10 text-warning flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">payments</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold">
              <AnimatedCounter value={comboMetrics.reduce((sum, c) => sum + c.cost, 0)} formatter={fmtCost} />
            </span>
            <span className="text-xs text-text-muted">Total Est. Cost</span>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4">
          <div className="size-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">alt_route</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold">
              <AnimatedCounter value={combos.length} />
            </span>
            <span className="text-xs text-text-muted">Active Combos</span>
          </div>
        </Card>
      </div>

      {/* Per-Combo Detailed Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Combos list */}
        <Card className="p-4 flex flex-col gap-3">
          <h3 className="font-semibold text-sm">Select Combo</h3>
          <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[400px]">
            {comboMetrics.map((combo) => (
              <button
                key={combo.name}
                onClick={() => setSelectedCombo(combo.name)}
                className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                  selectedCombo === combo.name
                    ? "bg-primary/10 border-primary text-primary font-medium"
                    : "border-border hover:bg-bg-subtle text-text-main"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate">{combo.name}</div>
                  <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1">
                    <span>{combo.models.length} models</span>
                    {combo.kind && combo.kind !== "llm" && (
                      <span className="px-1 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-sans">
                        {combo.kind}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold">{fmt(combo.requests)} reqs</div>
                  <div className="text-[10px] text-text-muted">{fmtCost(combo.cost)}</div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Selected Combo Inspection */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {activeComboData ? (
            <Card className="p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <span className="font-mono">{activeComboData.name}</span>
                    <Badge variant="primary" size="sm">{activeComboData.kind}</Badge>
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Pipeline contains {activeComboData.models.length} model(s)
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-primary">
                    <AnimatedCounter value={activeComboData.requests} suffix=" reqs" />
                  </div>
                  <div className="text-xs text-text-muted">
                    <AnimatedCounter value={activeComboData.cost} formatter={fmtCost} />
                  </div>
                </div>
              </div>

              {/* Models inside combo */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-text-muted uppercase">Target Models Execution Pool</span>
                <div className="flex flex-col gap-2">
                  {activeComboData.models.map((modelId, idx) => {
                    const modelStat = activeComboData.modelBreakdown[modelId] || { requests: 0, tokens: 0, cost: 0 };
                    const reqPct = activeComboData.requests > 0 ? (modelStat.requests / activeComboData.requests) * 100 : 0;

                    return (
                      <div key={modelId} className="flex flex-col gap-1 p-2.5 rounded-lg border border-border bg-bg-subtle">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 font-mono">
                            <span className="size-4 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="truncate">{modelId}</span>
                          </div>
                          <div className="text-text-muted">
                            {fmt(modelStat.requests)} reqs ({reqPct.toFixed(0)}%)
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-1.5 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-500 rounded-full"
                            style={{ width: `${Math.max(reqPct, 4)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-text-muted">
              Select a combo from the list to inspect statistics.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}