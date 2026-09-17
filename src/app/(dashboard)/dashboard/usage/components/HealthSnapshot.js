"use client";

import { useEffect, useState } from "react";

function fmtCountdown(ms) {
  if (ms <= 0) return "curând";
  const s = Math.floor(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// Polls /api/health/snapshot every 30s and renders compact health pills.
export default function HealthSnapshot() {
  const [snap, setSnap] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/health/snapshot", { cache: "no-store" });
        if (res.ok && alive) setSnap(await res.json());
      } catch {
        // fail-open: keep last snapshot
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const t = snap?.totals;
  const healthy = !t || (t.cooldowns === 0 && t.manualBlocks === 0 && t.comboBlocked === 0);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${
          healthy ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
        }`}
      >
        <span className={`size-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
        {healthy ? "All systems nominal" : "Issues detected"}
      </span>
      {t && (
        <>
          {t.cooldowns > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-red-500">
              <span className="material-symbols-outlined text-[14px]">pause_circle</span>
              {t.cooldowns} cooldown
            </span>
          )}
          {t.manualBlocks > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-500">
              <span className="material-symbols-outlined text-[14px]">lock</span>
              {t.manualBlocks} manual block
            </span>
          )}
          {t.comboBlocked > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-red-500">
              <span className="material-symbols-outlined text-[14px]">block</span>
              {t.comboBlocked} combo block
            </span>
          )}
          {snap.nextRpdReset && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-text-muted">
              <span className="material-symbols-outlined text-[14px]">update</span>
              RPD reset în {fmtCountdown(snap.nextRpdReset - Date.now())}
            </span>
          )}
        </>
      )}
    </div>
  );
}
