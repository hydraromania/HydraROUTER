"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

export default function ErrorAnalysisTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [appliedActions, setAppliedActions] = useState({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/usage/error-analysis");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to load error analysis:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApply = (patternId) => {
    setAppliedActions((prev) => ({ ...prev, [patternId]: true }));
  };

  const summary = data?.summary || { totalErrors: 0, total429: 0, total410: 0, byProvider: {}, byModel: {} };
  const patterns = data?.patterns || [];

  return (
    <div className="space-y-4">
      {/* Top summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              Analiză automată a incompatibilităților de unelte (tools), bugete de gândire (thinking) și epuizare de cotă.
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
          {patterns.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-xs">
              Nu au fost detectate tipare repetitive de eroare 429 sau 410 în sesiunile recente.
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
                    onClick={() => handleApply(pat.id)}
                    disabled={appliedActions[pat.id]}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5",
                      appliedActions[pat.id]
                        ? "bg-success/15 text-success border border-success/30 cursor-default"
                        : "bg-primary text-white hover:bg-primary/90 shadow-sm"
                    )}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {appliedActions[pat.id] ? "check" : "auto_fix_high"}
                    </span>
                    {appliedActions[pat.id] ? "Recomandare Aplicată" : pat.recommendation?.label || "Aplică Ajustarea"}
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
