"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

export default function UsageChart({ period = "7d" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

  // Calculate totals for quick header preview
  const totalInPeriod = data.reduce(
    (acc, d) => ({
      tokens: acc.tokens + (d.tokens || 0),
      cost: acc.cost + (d.cost || 0),
    }),
    { tokens: 0, cost: 0 }
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-2xl glass-panel p-5 shadow-sm">
      {/* Header with Title & Mode Switcher */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500 shadow-inner glow-brand">
            <span className="material-symbols-outlined text-[22px]">show_chart</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight text-text-main">Usage Trends & Telemetry</h3>
              <span className="rounded-full bg-brand-500/10 border border-brand-500/20 px-2.5 py-0.5 text-[10px] font-bold text-brand-500">
                {period.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Total period: <span className="font-semibold text-text-main">{viewMode === "tokens" ? fmtTokens(totalInPeriod.tokens) + " tokens" : fmtCost(totalInPeriod.cost)}</span>
            </p>
          </div>
        </div>

        {/* View Mode Toggle Pill */}
        <div className="flex items-center rounded-xl glass-pill p-1 self-start sm:self-auto shadow-inner">
          <button
            onClick={() => setViewMode("tokens")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === "tokens"
                ? "bg-brand-500 text-white shadow-sm glow-brand"
                : "text-text-muted hover:text-text-main hover:bg-surface-2/50"
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">generating_tokens</span>
            Tokens
          </button>
          <button
            onClick={() => setViewMode("cost")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === "cost"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-text-muted hover:text-text-main hover:bg-surface-2/50"
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">paid</span>
            Cost
          </button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-shimmer h-56 rounded-xl" />
      ) : !hasData ? (
        <div className="h-56 flex flex-col items-center justify-center gap-2 text-text-muted text-sm rounded-xl border border-dashed border-border/60 bg-bg-subtle/20">
          <span className="material-symbols-outlined text-[28px] opacity-40">query_stats</span>
          <span>No usage activity recorded for this period</span>
        </div>
      ) : (
        <div className="w-full pt-2">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#E56A4A" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#E56A4A" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.06} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)", strokeOpacity: 0.5 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
                width={56}
              />
              <Tooltip
                cursor={{ stroke: viewMode === "tokens" ? "#E56A4A" : "#f59e0b", strokeDasharray: "4 4", strokeOpacity: 0.5 }}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const val = payload[0].value;
                    return (
                      <div className="animate-pop-in relative rounded-xl border border-border bg-surface/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md">
                        <div className="text-[11px] font-semibold text-text-muted mb-1">{label}</div>
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: viewMode === "tokens" ? "#E56A4A" : "#f59e0b" }}
                          />
                          <span className="text-xs font-medium text-text-muted">
                            {viewMode === "tokens" ? "Tokens:" : "Est. Cost:"}
                          </span>
                          <span className="font-mono text-sm font-bold text-text-main">
                            {viewMode === "tokens" ? fmtTokens(val) : fmtCost(val)}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {viewMode === "tokens" ? (
                <Area
                  type="monotone"
                  dataKey="tokens"
                  stroke="#E56A4A"
                  strokeWidth={2.5}
                  fill="url(#gradTokens)"
                  dot={false}
                  activeDot={{ r: 5, stroke: "#E56A4A", strokeWidth: 2, fill: "var(--color-surface)" }}
                />
              ) : (
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  fill="url(#gradCost)"
                  dot={false}
                  activeDot={{ r: 5, stroke: "#f59e0b", strokeWidth: 2, fill: "var(--color-surface)" }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
