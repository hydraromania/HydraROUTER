"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

export default function ErrorAnalysisTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [appliedActions, setAppliedActions] = useState({});
  const [applyingId, setApplyingId] = useState(null);
  const [applyMsg, setApplyMsg] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/usage/error-analysis");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        const applied = {};
        for (const pat of json.patterns || []) {
          if (pat.applied) applied[pat.id] = true;
        }
        setAppliedActions(applied);
      }
    } catch (e) {
      console.error("Failed to load error analysis:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load on mount
    fetchData();
  }, []);

  const handleApply = async (pat) => {
    const patternId = pat.id;
    if (appliedActions[patternId] || applyingId) return;
    const fallbackByType = {
      rate_limit: "enable_pacing",
      model_gone: "replace_model",
      thinking_unsupported: "disable_thinking",
      tools_unsupported: "drop_tools",
      context_length_exceeded: "enable_rtk",
      bad_request: "inspect_request",
    };
    const action = pat.recommendation?.action || fallbackByType[pat.type];
    if (!action) return;
    setApplyingId(patternId);
    setApplyMsg("");
    try {
      const res = await fetch("/api/usage/error-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, provider: pat.provider, model: pat.model, patternId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Aplicarea a esuat");
      if (action !== "inspect_request") {
        setAppliedActions((prev) => ({ ...prev, [patternId]: true }));
      }
      setApplyMsg(json.message || "Recomandare aplicata.");
    } catch (e) {
      setApplyMsg(e.message || "Aplicarea a esuat.");
    } finally {
      setApplyingId(null);
    }
  };

  const summary = data?.summary || { totalErrors: 0, total400: 0, total429: 0, total410: 0, byProvider: {}, byModel: {} };
  const patterns = data?.patterns || [];

  return (
    <div className="space-y-4">
      {/* Top summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 border-border-subtle bg-surface">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Erori 400 (Bad Request)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-purple-400">
              {summary.total400 || 0}
            </span>
            <span className="text-xs text-text-muted">cereri invalide</span>
          </div>
        </Card>

        <Card className="p-3.5 border-border-subtle bg-surface">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Erori 429 (Rate Limit)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-error">
              {summary.total429}
            </span>
            <span className="text-xs text-text-muted">incidente detectate</span>
          </div>
        </Card>

        <Card className="p-3.5 border-border-subtle bg-surface">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Erori 410 (Model Gone)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-amber-500">
              {summary.total410}
            </span>
            <span className="text-xs text-text-muted">modele retrase</span>
          </div>
        </Card>

        <Card className="p-3.5 border-border-subtle bg-surface">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Total Erori Analizate
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-text-main">
              {summary.totalErrors}
            </span>
            <span className="text-xs text-text-muted">în istoric recent</span>
          </div>
        </Card>
      </div>

      {/* Patterns & Recommendations */}
      <Card className="border-border-subtle overflow-hidden">
        <div className="flex items-center justify-between p-3.5 border-b border-border bg-bg-subtle/50">
          <div>
            <h3 className="text-sm font-semibold text-text-main">
              Tipare de Eșec Repetitive & Recomandări Automate
            </h3>
            <p className="text-[11px] text-text-muted">
              Analiză automată a erorilor 400 (context limit, parametri, incompatibilități tools/thinking), limitelor 429 și modelelor retrase 410.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchData}
            disabled={loading}
            className="text-xs"
          >
            <span className={cn("material-symbols-outlined text-[14px]", loading && "animate-spin")}>
              refresh
            </span>
            Reîmprospătează
          </Button>
        </div>

        <div className="p-3.5 divide-y divide-border">
          {applyMsg && (
            <div className="pb-3 text-xs text-text-main bg-primary/10 border border-primary/20 rounded px-2.5 py-2">
              {applyMsg}
            </div>
          )}
          {patterns.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-xs">
              Nu au fost detectate tipare repetitive de eroare 400, 429 sau 410 în sesiunile recente.
            </div>
          ) : (
            patterns.map((pat) => (
              <div key={pat.id} className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                      pat.severity === "critical" && "bg-error/15 text-error border border-error/30",
                      pat.severity === "high" && "bg-amber-500/15 text-amber-500 border border-amber-500/30",
                      pat.severity === "medium" && "bg-primary/15 text-primary border border-primary/30"
                    )}>
                      {pat.severity}
                    </span>
                    <span className="font-semibold text-xs text-text-main">{pat.title}</span>
                    <span className="font-mono text-[10px] text-text-muted bg-bg-subtle px-1.5 py-0.2 rounded border border-border">
                      {pat.count} apariții
                    </span>
                  </div>

                  <p className="text-xs text-text-muted leading-relaxed">
                    {pat.description}
                  </p>

                  {pat.samples?.length > 0 && (
                    <div className="text-[11px] font-mono text-text-muted/80 bg-bg-subtle/80 p-2 rounded border border-border/60 break-all">
                      <span className="font-semibold text-text-muted">Exemplu upstream: </span>
                      {pat.samples[0]}
                    </div>
                  )}
                </div>

                <div className="sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApply(pat)}
                    disabled={appliedActions[pat.id] || applyingId === pat.id}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5",
                      appliedActions[pat.id]
                        ? "bg-success/15 text-success border border-success/30 cursor-default"
                        : "bg-primary text-white hover:bg-primary/90 shadow-sm"
                    )}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {appliedActions[pat.id] ? "check" : applyingId === pat.id ? "progress_activity" : "auto_fix_high"}
                    </span>
                    {appliedActions[pat.id] ? "Recomandare Aplicată" : applyingId === pat.id ? "Se aplică..." : pat.recommendation?.label || "Aplică Ajustarea"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
