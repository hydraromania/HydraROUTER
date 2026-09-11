"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import SegmentedControl from "@/shared/components/SegmentedControl";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const CHART_TYPES = [
  { value: "bar", label: "Stacked Bar" },
  { value: "line", label: "Trend Line" },
];

const METRICS = [
  { value: "requests", label: "Requests" },
  { value: "tokens", label: "Total Tokens" },
  { value: "cost", label: "Cost ($)" },
];

const COLOR_PALETTE = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#e11d48", // Rose
];

function fmt(n) {
  return new Intl.NumberFormat().format(n || 0);
}

function fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
}

function fmtCost(n) {
  return `$${(n || 0).toFixed(4)}`;
}

function fmtTime(iso) {
  if (!iso) return "Never used";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AnalyticsTab() {
  const [period, setPeriod] = useState("7d");
  const [provider, setProvider] = useState("all");
  const [model, setModel] = useState("all");
  const [connectionId, setConnectionId] = useState("all");
  const [chartType, setChartType] = useState("bar");
  const [metric, setMetric] = useState("requests");
  const [keyFilter, setKeyFilter] = useState("all"); // 'all', 'active', 'idle'
  const [searchKey, setSearchKey] = useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allProviders, setAllProviders] = useState([]);

  // Fetch registered providers list for filter
  useEffect(() => {
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.connections) {
          const provSet = new Set(d.connections.map((c) => c.provider));
          setAllProviders(Array.from(provSet));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          period,
          provider,
          model,
          connectionId,
        });
        const res = await fetch(`/api/usage/analytics?${params.toString()}`);
        if (res.ok && !ignore) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error("Failed to fetch analytics data:", e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchAnalytics();
    return () => {
      ignore = true;
    };
  }, [period, provider, model, connectionId]);

  // Extract top models for stacked dimensions
  const topModels = useMemo(() => {
    if (!data?.connections) return [];
    const modelTotals = {};
    for (const c of data.connections) {
      for (const [m, stat] of Object.entries(c.byModel || {})) {
        modelTotals[m] = (modelTotals[m] || 0) + (stat.requests || 0);
      }
    }
    return Object.entries(modelTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([m]) => m);
  }, [data]);

  // Transform timeline data with model breakdown
  const chartData = useMemo(() => {
    if (!data?.timeline) return [];
    return data.timeline.map((t) => {
      const entry = {
        label: t.label,
        dateKey: t.dateKey,
        requests: t.requests,
        tokens: t.totalTokens,
        cost: t.cost,
      };
      // Populate dimension breakdown
      for (const m of topModels) {
        entry[m] = t.byDimension?.[m] || 0;
      }
      return entry;
    });
  }, [data, topModels]);

  // Filter and search keys/connections
  const filteredConnections = useMemo(() => {
    if (!data?.connections) return [];
    return data.connections.filter((conn) => {
      if (keyFilter === "active" && conn.requests === 0) return false;
      if (keyFilter === "idle" && conn.requests > 0) return false;
      if (searchKey) {
        const query = searchKey.toLowerCase();
        const matchName = conn.name?.toLowerCase().includes(query);
        const matchEmail = conn.email?.toLowerCase().includes(query);
        const matchProv = conn.provider?.toLowerCase().includes(query);
        if (!matchName && !matchEmail && !matchProv) return false;
      }
      return true;
    });
  }, [data, keyFilter, searchKey]);

  return (
    <div className="flex flex-col gap-6">
      {/* Controls Bar: Filters & Period */}
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Provider selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase">Provider:</span>
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel("all");
                  setConnectionId("all");
                }}
                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Providers</option>
                {allProviders.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Model selector */}
            {data?.filters?.availableModels?.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-text-muted uppercase">Model:</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-main focus:outline-none focus:ring-1 focus:ring-primary max-w-[180px] truncate"
                >
                  <option value="all">All Models</option>
                  {data.filters.availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Metric selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase">Metric:</span>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Period selector */}
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        </div>
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="glass-panel p-3.5 rounded-2xl stat-tile-glow relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Total Requests</div>
          <div className="mt-1 text-2xl font-extrabold text-text-main">
            {loading ? "..." : fmt(data?.summary?.totalRequests)}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">In selected period</div>
        </div>

        <div className="glass-panel p-3.5 rounded-2xl stat-tile-glow relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Total Tokens</div>
          <div className="mt-1 text-2xl font-extrabold text-primary">
            {loading ? "..." : fmtTokens(data?.summary?.totalTokens)}
          </div>
          <div className="mt-1 text-[10px] text-text-muted truncate">
            {fmtTokens(data?.summary?.totalPromptTokens)} in / {fmtTokens(data?.summary?.totalCompletionTokens)} out
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-2xl stat-tile-glow relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Est. Cost</div>
          <div className="mt-1 text-2xl font-extrabold text-warning">
            {loading ? "..." : fmtCost(data?.summary?.totalCost)}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">Calculated usage</div>
        </div>

        <div className="glass-panel p-3.5 rounded-2xl stat-tile-glow relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Configured Keys</div>
          <div className="mt-1 text-2xl font-extrabold text-text-main">
            {loading ? "..." : data?.summary?.totalKeys || 0}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">Accounts / API keys</div>
        </div>

        <div className="glass-panel p-3.5 rounded-2xl stat-tile-glow relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Active Keys</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-500">
            {loading ? "..." : data?.summary?.activeKeys || 0}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">Active in period</div>
        </div>

        <div className="glass-panel p-3.5 rounded-2xl stat-tile-glow relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Idle Keys</div>
          <div className="mt-1 text-2xl font-extrabold text-cyan-500">
            {loading ? "..." : data?.summary?.idleKeys || 0}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">Available standby</div>
        </div>
      </div>

      {/* Main Timeline Chart */}
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h3 className="text-base font-semibold text-text-main">
              Daily & Hourly Distribution
            </h3>
            <p className="text-xs text-text-muted">
              {metric === "requests" ? "Request counts over time" : metric === "tokens" ? "Token volume over time" : "Cost accumulation over time"}
              {provider !== "all" ? ` for ${provider.toUpperCase()}` : ""}
            </p>
          </div>
          <SegmentedControl
            options={CHART_TYPES}
            value={chartType}
            onChange={setChartType}
            size="sm"
          />
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center text-text-muted text-sm">
            <span className="material-symbols-outlined text-2xl animate-spin mr-2">progress_activity</span>
            Loading analytics chart...
          </div>
        ) : !chartData.length || chartData.every((d) => d[metric] === 0) ? (
          <div className="h-64 flex flex-col items-center justify-center text-text-muted text-sm gap-1">
            <span className="material-symbols-outlined text-3xl opacity-40">bar_chart</span>
            <span>No activity recorded for this selection.</span>
          </div>
        ) : (
          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "bar" && metric === "requests" && topModels.length > 0 ? (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.6 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.6 }} tickLine={false} axisLine={false} tickFormatter={fmt} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                  {topModels.map((m, idx) => (
                    <Bar
                      key={m}
                      dataKey={m}
                      name={m}
                      stackId="a"
                      fill={COLOR_PALETTE[idx % COLOR_PALETTE.length]}
                      radius={idx === topModels.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              ) : chartType === "bar" ? (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.6 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.6 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={metric === "tokens" ? fmtTokens : metric === "cost" ? fmtCost : fmt}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(val) => [metric === "tokens" ? fmtTokens(val) : metric === "cost" ? fmtCost(val) : fmt(val), metric.toUpperCase()]}
                  />
                  <Bar dataKey={metric} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.6 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.6 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={metric === "tokens" ? fmtTokens : metric === "cost" ? fmtCost : fmt}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(val) => [metric === "tokens" ? fmtTokens(val) : metric === "cost" ? fmtCost(val) : fmt(val), metric.toUpperCase()]}
                  />
                  <Line type="monotone" dataKey={metric} stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Keys & Accounts Comparison Matrix */}
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-base font-semibold text-text-main">
              Key & Account Comparison Matrix
            </h3>
            <p className="text-xs text-text-muted">
              Compare requests, free/idle capacity, and model distribution across all keys
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter active vs free */}
            <div className="flex rounded-lg border border-border bg-bg-subtle p-0.5">
              <button
                onClick={() => setKeyFilter("all")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${keyFilter === "all" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text"}`}
              >
                All ({data?.connections?.length || 0})
              </button>
              <button
                onClick={() => setKeyFilter("active")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${keyFilter === "active" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text"}`}
              >
                Active ({data?.summary?.activeKeys || 0})
              </button>
              <button
                onClick={() => setKeyFilter("idle")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${keyFilter === "idle" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text"}`}
              >
                Free / Idle ({data?.summary?.idleKeys || 0})
              </button>
            </div>

            {/* Search filter */}
            <input
              type="text"
              placeholder="Search keys/accounts..."
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-primary w-40"
            />
          </div>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="py-2.5 px-3 font-semibold">Status / Priority</th>
                <th className="py-2.5 px-3 font-semibold">Account / Key Name</th>
                <th className="py-2.5 px-3 font-semibold">Provider</th>
                <th className="py-2.5 px-3 font-semibold text-right">Requests</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tokens</th>
                <th className="py-2.5 px-3 font-semibold">Model Breakdown</th>
                <th className="py-2.5 px-3 font-semibold text-right">Last Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-text-muted">
                    Loading key comparison data...
                  </td>
                </tr>
              ) : !filteredConnections.length ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-text-muted">
                    No keys found matching the current filter.
                  </td>
                </tr>
              ) : (
                filteredConnections.map((conn) => {
                  const totalConnRequests = conn.requests || 0;
                  const modelsUsed = Object.entries(conn.byModel || {}).sort((a, b) => b[1].requests - a[1].requests);

                  return (
                    <tr key={conn.connectionId} className="hover:bg-bg-subtle/50 transition-colors">
                      {/* Status / Priority */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {conn.isIdle ? (
                            <Badge variant="neutral" size="sm">
                              Free (0 req)
                            </Badge>
                          ) : (
                            <Badge variant="success" size="sm">
                              Active
                            </Badge>
                          )}
                          <span className="text-[10px] text-text-muted">#{conn.priority}</span>
                        </div>
                      </td>

                      {/* Name / Identifier */}
                      <td className="py-3 px-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-text-main truncate max-w-[200px]" title={conn.name}>
                            {conn.name}
                          </span>
                          {conn.email && conn.email !== conn.name && (
                            <span className="text-[11px] text-text-muted truncate max-w-[200px]" title={conn.email}>
                              {conn.email}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Provider */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <Badge variant="primary" size="sm">
                          {conn.providerDisplayName || conn.provider}
                        </Badge>
                      </td>

                      {/* Requests */}
                      <td className="py-3 px-3 text-right font-semibold text-text-main whitespace-nowrap">
                        {fmt(conn.requests)}
                      </td>

                      {/* Tokens */}
                      <td className="py-3 px-3 text-right text-text-muted whitespace-nowrap">
                        {fmtTokens(conn.totalTokens)}
                      </td>

                      {/* Model Breakdown Bar */}
                      <td className="py-3 px-3">
                        {totalConnRequests === 0 ? (
                          <span className="text-text-muted text-[11px] italic">No models used yet</span>
                        ) : (
                          <div className="flex flex-col gap-1 min-w-[200px]">
                            {/* Visual stacked bar */}
                            <div className="h-2 w-full flex rounded-full overflow-hidden bg-bg-subtle border border-border/40">
                              {modelsUsed.map(([modelName, stat], idx) => {
                                const pct = (stat.requests / totalConnRequests) * 100;
                                return (
                                  <div
                                    key={modelName}
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: COLOR_PALETTE[idx % COLOR_PALETTE.length],
                                    }}
                                    title={`${modelName}: ${stat.requests} req (${pct.toFixed(0)}%)`}
                                  />
                                );
                              })}
                            </div>
                            {/* Badges for top models */}
                            <div className="flex flex-wrap gap-1">
                              {modelsUsed.slice(0, 3).map(([modelName, stat], idx) => (
                                <span
                                  key={modelName}
                                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted"
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{ backgroundColor: COLOR_PALETTE[idx % COLOR_PALETTE.length] }}
                                  />
                                  <span className="truncate max-w-[90px]">{modelName}</span>
                                  <span className="font-semibold text-text-main">{stat.requests}</span>
                                </span>
                              ))}
                              {modelsUsed.length > 3 && (
                                <span className="text-[10px] text-text-muted self-center">
                                  +{modelsUsed.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Last Used */}
                      <td className="py-3 px-3 text-right text-text-muted whitespace-nowrap">
                        {fmtTime(conn.lastUsed)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
