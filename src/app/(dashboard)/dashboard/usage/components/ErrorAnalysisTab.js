"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

export default function ErrorAnalysisTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
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
    fetchData();
  }, []);

  const generateClaudePrompt = useCallback((pat) => {
    const summary = data?.summary || {};
    return `Salut Claude! Sunt în dashboard-ul HydraRouter și am nevoie de ajutor pentru a rezolva o problemă recurentă detectată de sistemul de analiză.

DETALII PROBLEMĂ:
- Titlu: ${pat.title}
- Tip eroare: ${pat.type}
- Provider/Model: ${pat.provider || "N/A"} / ${pat.model || "Toate"}
- Severitate: ${pat.severity}
- Număr apariții: ${pat.count}

DESCRIERE:
${pat.description}

EȘANTION EROARE UPSTREAM:
${pat.samples?.[0] || "N/A"}

CONTEXT GLOBAL:
- Total erori în sesiune: ${summary.totalErrors}
- Erori 400 (Bad Request): ${summary.total400}
- Erori 429 (Rate Limit): ${summary.total429}
- Erori 410 (Model Gone): ${summary.total410}

RECOMANDARE SISTEM:
${pat.recommendation?.label || "Ajustare setări model sau provider"}

Cerință: Analizează detaliile de mai sus și oferă-mi o sugestie de configurare sau un fix în cod pentru a preveni aceste erori pe viitor. Dacă este o eroare de tip Thinking Level sau Context Limit, explică-mi cum să optimizez request-ul.`;
  }, [data]);

  const copyToClipboard = async (pat) => {
    const prompt = generateClaudePrompt(pat);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(pat.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

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
        <Card className="p-3.5 border-border-subtle bg-surface shadow-sm">
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

        <Card className="p-3.5 border-border-subtle bg-surface shadow-sm">
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

        <Card className="p-3.5 border-border-subtle bg-surface shadow-sm">
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

        <Card className="p-3.5 border-border-subtle bg-surface shadow-sm">
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

      {/* Main Analysis Section */}
      <Card className="border-border-subtle overflow-hidden">
        <div className="flex items-center justify-between p-3.5 border-b border-border bg-bg-subtle/50">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">psychology</span>
            <div>
              <h3 className="text-sm font-semibold text-text-main">
                AI Error Assistant (Prompt Generator)
              </h3>
              <p className="text-[11px] text-text-muted">
                Analiză asistată de AI pentru tiparele de eșec repetitive. Generați prompturi optimizate pentru Claude.
              </p>
            </div>
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
            Refresh Analysis
          </Button>
        </div>

        <div className="p-0 divide-y divide-border">
          {applyMsg && (
            <div className="m-3.5 text-xs text-text-main bg-primary/10 border border-primary/20 rounded px-2.5 py-2 flex items-center justify-between">
              <span>{applyMsg}</span>
              <button onClick={() => setApplyMsg("")} className="material-symbols-outlined text-[16px] hover:text-primary">close</button>
            </div>
          )}
          {patterns.length === 0 ? (
            <div className="py-12 text-center text-text-muted text-xs">
              <span className="material-symbols-outlined text-[48px] opacity-20 block mb-2">fact_check</span>
              Nu au fost detectate tipare repetitive de eroare în sesiunile recente.
            </div>
          ) : (
            patterns.map((pat) => (
              <div key={pat.id} className="p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                <div className="flex flex-col lg:flex-row gap-4">
                  {/* Left: Metadata & Description */}
                  <div className="flex-1 space-y-2.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        pat.severity === "critical" && "bg-error/15 text-error border border-error/30",
                        pat.severity === "high" && "bg-amber-500/15 text-amber-500 border border-amber-500/30",
                        pat.severity === "medium" && "bg-primary/15 text-primary border border-primary/30"
                      )}>
                        {pat.severity}
                      </span>
                      <span className="font-bold text-sm text-text-main">{pat.title}</span>
                      <span className="font-mono text-[10px] text-text-muted bg-bg-subtle px-1.5 py-0.2 rounded border border-border">
                        {pat.count} apariții
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase text-text-muted flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">analytics</span> Analiza Cauzei
                        </div>
                        <p className="text-xs text-text-muted leading-relaxed">
                          {pat.description}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase text-text-muted flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">tips_and_updates</span> Recomandare
                        </div>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium leading-relaxed">
                          {pat.recommendation?.label || "Ajustarea setărilor de rutare sau curățarea promptului de intrare."}
                        </p>
                      </div>
                    </div>

                    {pat.samples?.length > 0 && (
                      <div className="relative group/sample">
                        <div className="text-[10px] font-bold uppercase text-text-muted mb-1 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">code</span> Upstream Trace
                        </div>
                        <div className="text-[11px] font-mono text-text-muted/80 bg-black/10 dark:bg-black/40 p-2.5 rounded border border-border/60 break-all max-h-24 overflow-y-auto">
                          {pat.samples[0]}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0 justify-center min-w-[200px]">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(pat)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 border-2",
                        copiedId === pat.id
                          ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-500"
                          : "bg-surface border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
                      )}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {copiedId === pat.id ? "content_paste_check" : "content_copy"}
                      </span>
                      {copiedId === pat.id ? "Copiat în Clipboard!" : "Copiază Prompt pentru Claude"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApply(pat)}
                      disabled={appliedActions[pat.id] || applyingId === pat.id}
                      className={cn(
                        "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2",
                        appliedActions[pat.id]
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 cursor-default"
                          : "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20"
                      )}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {appliedActions[pat.id] ? "check" : applyingId === pat.id ? "progress_activity" : "magic_button"}
                      </span>
                      {appliedActions[pat.id] ? "Fix Aplicat" : applyingId === pat.id ? "Se aplică..." : "Aplică Fix Automat"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg flex gap-3">
        <span className="material-symbols-outlined text-amber-500">info</span>
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          <span className="font-bold">Notă:</span> Promptul generat conține detalii tehnice despre eroare, modelul afectat și contextul global. Folosiți-l în chat-ul cu Claude (Agent) pentru a primi asistență personalizată în refactorizarea aplicației sau ajustarea prompturilor.
        </p>
      </div>
    </div>
  );
}

