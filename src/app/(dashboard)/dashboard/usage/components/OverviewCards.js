"use client";

import PropTypes from "prop-types";
import useCountUp from "./useCountUp";

const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function StatCard({ label, display, accentClass, dotClass, gradientClass, footer }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border-subtle bg-surface/80 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-brand-500/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-text-muted">{label}</span>
        <span className={`flex size-2 rounded-full ${dotClass} group-hover:shadow-[0_0_8px_currentColor] transition-all`} />
      </div>
      <div className={`mt-2 truncate text-2xl font-black tracking-tight ${accentClass}`}>
        {display}
      </div>
      {footer || <div className={`mt-1 h-0.5 w-full rounded-full ${gradientClass}`} />}
    </div>
  );
}
StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  display: PropTypes.string.isRequired,
  accentClass: PropTypes.string,
  dotClass: PropTypes.string,
  gradientClass: PropTypes.string,
  footer: PropTypes.node,
};

export default function OverviewCards({ stats }) {
  const requests = useCountUp(stats.totalRequests);
  const inputTokens = useCountUp(stats.totalPromptTokens);
  const cachedTokens = useCountUp(stats.totalCachedTokens);
  const outputTokens = useCountUp(stats.totalCompletionTokens);
  const cost = useCountUp(stats.totalCost);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <StatCard
        label="Total Requests"
        display={fmt(requests)}
        accentClass="text-text-main"
        dotClass="bg-indigo-500/40 group-hover:bg-indigo-500"
        gradientClass="from-indigo-500/20 via-indigo-500/40 to-transparent bg-gradient-to-r"
      />
      <StatCard
        label="Input Tokens"
        display={fmt(inputTokens)}
        accentClass="text-brand-500"
        dotClass="bg-brand-500/40 group-hover:bg-brand-500"
        gradientClass="from-brand-500/20 via-brand-500/40 to-transparent bg-gradient-to-r"
      />
      <StatCard
        label="Cached Tokens"
        display={fmt(cachedTokens)}
        accentClass="text-sky-500"
        dotClass="bg-sky-500/40 group-hover:bg-sky-500"
        gradientClass="from-sky-500/20 via-sky-500/40 to-transparent bg-gradient-to-r"
      />
      <StatCard
        label="Output Tokens"
        display={fmt(outputTokens)}
        accentClass="text-emerald-500"
        dotClass="bg-emerald-500/40 group-hover:bg-emerald-500"
        gradientClass="from-emerald-500/20 via-emerald-500/40 to-transparent bg-gradient-to-r"
      />
      <StatCard
        label="Est. Cost"
        display={`~${fmtCost(cost)}`}
        accentClass="text-amber-500"
        dotClass="bg-amber-500/40 group-hover:bg-amber-500"
        footer={<div className="mt-1 text-[10px] text-text-muted">Estimated, not actual billing</div>}
      />
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
