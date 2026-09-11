"use client";

import PropTypes from "prop-types";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  // Extract category counts if available
  const imageRequests = Object.values(stats?.byEndpoint || {}).filter(e => e.endpoint?.includes("/images") || e.rawModel?.toLowerCase().includes("image") || e.provider?.toLowerCase().includes("image")).reduce((sum, e) => sum + (e.requests || 0), 0);
  const searchRequests = Object.values(stats?.byEndpoint || {}).filter(e => e.endpoint?.includes("/search") || e.rawModel?.toLowerCase().includes("search") || e.provider?.toLowerCase().includes("search")).reduce((sum, e) => sum + (e.requests || 0), 0);
  const embeddingRequests = Object.values(stats?.byEndpoint || {}).filter(e => e.endpoint?.includes("/embeddings") || e.rawModel?.toLowerCase().includes("embed") || e.provider?.toLowerCase().includes("embed")).reduce((sum, e) => sum + (e.requests || 0), 0);

  const primaryCards = [
    {
      title: "Total Requests",
      value: fmt(stats?.totalRequests),
      icon: "swap_calls",
      accent: "from-blue-500/20 via-blue-500/5 to-transparent",
      border: "border-blue-500/30 hover:border-blue-500/60",
      iconBg: "bg-blue-500/15 text-blue-500 dark:text-blue-400 glow-blue",
      badge: "Traffic",
      badgeColor: "text-blue-600 bg-blue-500/10 dark:text-blue-300 border border-blue-500/20",
      subtext: "Total routed requests",
    },
    {
      title: "Input Tokens",
      value: fmt(stats?.totalPromptTokens),
      icon: "input",
      accent: "from-brand-500/20 via-brand-500/5 to-transparent",
      border: "border-brand-500/30 hover:border-brand-500/60",
      iconBg: "bg-brand-500/15 text-brand-500 dark:text-brand-400 glow-brand",
      badge: "Prompt",
      badgeColor: "text-brand-600 bg-brand-500/10 dark:text-brand-300 border border-brand-500/20",
      subtext: "Raw prompt intake",
    },
    {
      title: "Cached Tokens",
      value: fmt(stats?.totalCachedTokens),
      icon: "bolt",
      accent: "from-cyan-500/20 via-cyan-500/5 to-transparent",
      border: "border-cyan-500/30 hover:border-cyan-500/60",
      iconBg: "bg-cyan-500/15 text-cyan-500 dark:text-cyan-400 glow-cyan",
      badge: "Saved",
      badgeColor: "text-cyan-600 bg-cyan-500/10 dark:text-cyan-300 border border-cyan-500/20",
      subtext: "Prompt cache hits",
    },
    {
      title: "Output Tokens",
      value: fmt(stats?.totalCompletionTokens),
      icon: "output",
      accent: "from-emerald-500/20 via-emerald-500/5 to-transparent",
      border: "border-emerald-500/30 hover:border-emerald-500/60",
      iconBg: "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 glow-emerald",
      badge: "Generated",
      badgeColor: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-300 border border-emerald-500/20",
      subtext: "Model completions",
    },
    {
      title: "Est. Total Cost",
      value: `~${fmtCost(stats?.totalCost)}`,
      icon: "payments",
      accent: "from-amber-500/20 via-amber-500/5 to-transparent",
      border: "border-amber-500/30 hover:border-amber-500/60",
      iconBg: "bg-amber-500/15 text-amber-500 dark:text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.35)]",
      badge: "Estimate",
      badgeColor: "text-amber-600 bg-amber-500/10 dark:text-amber-300 border border-amber-500/20",
      subtext: "Approximate pricing tier",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Primary KPI Grid */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
        {primaryCards.map((card, idx) => (
          <div
            key={idx}
            className={`group relative overflow-hidden rounded-2xl glass-panel p-4.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl stat-tile-glow ${card.border}`}
          >
            {/* Ambient subtle gradient glow background */}
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent} opacity-70 transition-opacity duration-300 group-hover:opacity-100`} />

            <div className="relative z-10 flex flex-col justify-between h-full gap-3.5">
              <div className="flex items-center justify-between">
                <div className={`flex size-10 items-center justify-center rounded-xl shadow-inner ${card.iconBg}`}>
                  <span className="material-symbols-outlined text-[22px] transition-transform duration-300 group-hover:scale-110">
                    {card.icon}
                  </span>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${card.badgeColor}`}>
                  {card.badge}
                </span>
              </div>

              <div>
                <span className="block text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {card.title}
                </span>
                <div className="mt-1 truncate text-2xl lg:text-[26px] font-extrabold tracking-tight text-text-main">
                  {card.value}
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted/90 border-t border-border-subtle/70 pt-2.5">
                <span className="truncate">{card.subtext}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Multimodal & Specialized Subsystems */}
      {(imageRequests > 0 || searchRequests > 0 || embeddingRequests > 0 || stats?.totalRequests > 0) && (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div className="group relative overflow-hidden rounded-2xl border border-pink-500/20 bg-surface/80 p-3.5 backdrop-blur-md transition-all duration-300 hover:border-pink-500/40 hover:-translate-y-0.5 hover:shadow-md">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-pink-500/10 via-pink-500/5 to-transparent opacity-60 group-hover:opacity-100" />
            <div className="relative z-10 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-pink-500/15 text-pink-500 shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">palette</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Image Gen</span>
                  <span className="text-[10px] font-medium text-pink-500 bg-pink-500/10 px-1.5 py-0.5 rounded-full">Media</span>
                </div>
                <div className="mt-0.5 text-lg font-bold text-pink-600 dark:text-pink-400">
                  {fmt(imageRequests)} <span className="text-xs font-normal text-text-muted">reqs</span>
                </div>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-surface/80 p-3.5 backdrop-blur-md transition-all duration-300 hover:border-indigo-500/40 hover:-translate-y-0.5 hover:shadow-md">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-transparent opacity-60 group-hover:opacity-100" />
            <div className="relative z-10 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500 shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">travel_explore</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Web Search</span>
                  <span className="text-[10px] font-medium text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded-full">Live Net</span>
                </div>
                <div className="mt-0.5 text-lg font-bold text-indigo-600 dark:text-indigo-400">
                  {fmt(searchRequests)} <span className="text-xs font-normal text-text-muted">reqs</span>
                </div>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-purple-500/20 bg-surface/80 p-3.5 backdrop-blur-md transition-all duration-300 hover:border-purple-500/40 hover:-translate-y-0.5 hover:shadow-md">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent opacity-60 group-hover:opacity-100" />
            <div className="relative z-10 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/15 text-purple-500 shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">data_array</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Embeddings</span>
                  <span className="text-[10px] font-medium text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded-full">Vector</span>
                </div>
                <div className="mt-0.5 text-lg font-bold text-purple-600 dark:text-purple-400">
                  {fmt(embeddingRequests)} <span className="text-xs font-normal text-text-muted">reqs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
