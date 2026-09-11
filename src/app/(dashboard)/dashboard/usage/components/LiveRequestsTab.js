"use client";

import { useState, useEffect, useMemo } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Modal from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

function formatDuration(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTokens(tokens) {
  if (!tokens) return "-";
  const p = tokens.prompt || 0;
  const c = tokens.completion || 0;
  if (p === 0 && c === 0) return "-";
  return (
    <span>
      <span className="text-primary font-medium">{p.toLocaleString()}</span>
      <span className="text-text-muted mx-1">/</span>
      <span className="text-success font-medium">{c.toLocaleString()}</span>
    </span>
  );
}

export default function LiveRequestsTab() {
  const [snapshot, setSnapshot] = useState({
    active: [],
    history: [],
    stuckTimeoutMs: 600000,
    stats: { activeCount: 0, completedCount: 0, errorCount: 0, totalTracked: 0 },
  });
  const [connected, setConnected] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterProxy, setFilterProxy] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  // Slow/stuck badges scale with the backend stuck-sweep budget (default 10m)
  // instead of hardcoded seconds, so long legit streams (thinking models,
  // Gemini flash) are not mislabeled as blocked.
  const stuckBudgetMs = snapshot.stuckTimeoutMs && snapshot.stuckTimeoutMs > 0
    ? snapshot.stuckTimeoutMs
    : 600000;
  const slowAfterMs = Math.max(120000, Math.round(stuckBudgetMs * 0.4));
  const stuckAfterMs = Math.max(300000, Math.round(stuckBudgetMs * 0.8));
  const [proxyPools, setProxyPools] = useState([]);
  const [actionLoading, setActionLoading] = useState({});
  const [actionNotice, setActionNotice] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleAction = async (id, action) => {
    setActionLoading((prev) => ({ ...prev, [id]: action }));
    try {
      const res = await fetch("/api/usage/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionNotice({
          type: "success",
          message: action === "reroute"
            ? `Request rerutat — ${data.blockedModel || "modelul"} a fost blocat 10m pentru ca retry-ul clientului să meargă pe alt model.`
            : "Request anulat cu succes.",
        });
      } else {
        setActionNotice({ type: "error", message: data?.error || "Acțiunea a eșuat" });
      }
    } catch (e) {
      setActionNotice({ type: "error", message: e.message || "Eroare de rețea" });
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTimeout(() => setActionNotice(null), 6000);
    }
  };

  useEffect(() => {
    fetch("/api/proxy-pools?isActive=true")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.proxyPools) setProxyPools(data.proxyPools);
      })
      .catch(() => {});
  }, []);

  const proxyPoolMap = useMemo(() => {
    return new Map((proxyPools || []).map((p) => [p.id, p]));
  }, [proxyPools]);

  // Keep live duration ticking every 500ms
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Connect to SSE stream
  useEffect(() => {
    let es = null;
    const connect = () => {
      try {
        es = new EventSource("/api/usage/live");
        es.onopen = () => setConnected(true);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            setSnapshot(data);
          } catch {
            // ignore keepalive/parse errors
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

  const handleClear = async () => {
    try {
      await fetch("/api/usage/live", { method: "DELETE" });
    } catch (e) {
      console.error("Failed to clear live requests:", e);
    }
  };

  const allItems = useMemo(() => {
    return [...snapshot.active, ...snapshot.history];
  }, [snapshot.active, snapshot.history]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (filterType !== "all" && item.type !== filterType) return false;
      if (filterStatus !== "all") {
        if (filterStatus === "active" && item.status !== "in_progress") return false;
        if (filterStatus === "completed" && item.status !== "completed") return false;
        if (filterStatus === "error" && item.status !== "error") return false;
      }
      if (filterProxy !== "all") {
        if (filterProxy === "proxied" && !item.proxy?.url) return false;
        if (filterProxy === "direct" && item.proxy?.url) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesModel = item.model?.toLowerCase().includes(q);
        const matchesProvider = item.provider?.toLowerCase().includes(q);
        const matchesApiKey = item.apiKeyName?.toLowerCase().includes(q) || item.apiKey?.toLowerCase().includes(q);
        const matchesEndpoint = item.endpoint?.toLowerCase().includes(q);
        const matchesAccount = item.accountName?.toLowerCase().includes(q);
        const matchesProxy = item.proxy?.url?.toLowerCase().includes(q) || item.proxy?.poolId?.toLowerCase().includes(q);
        if (!matchesModel && !matchesProvider && !matchesApiKey && !matchesEndpoint && !matchesAccount && !matchesProxy) {
          return false;
        }
      }
      return true;
    });
  }, [allItems, filterType, filterStatus, filterProxy, searchQuery]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Top Header & Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="md" className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[24px]">sensors</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-text-main">{snapshot.stats.activeCount}</span>
              {snapshot.stats.activeCount > 0 && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                </span>
              )}
            </div>
            <span className="text-xs text-text-muted">Active In-Flight Requests</span>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success/10 text-success">
            <span className="material-symbols-outlined text-[24px]">check_circle</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-text-main">{snapshot.stats.completedCount}</span>
            <span className="text-xs text-text-muted">Completed (Recent)</span>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-error/10 text-error">
            <span className="material-symbols-outlined text-[24px]">error</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-text-main">{snapshot.stats.errorCount}</span>
            <span className="text-xs text-text-muted">Errors (Recent)</span>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-subtle text-text-muted">
            <span className="material-symbols-outlined text-[24px]">speed</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-text-main">{snapshot.stats.totalTracked}</span>
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                connected ? "bg-success/10 text-success" : "bg-error/10 text-error"
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-error")}></span>
                {connected ? "LIVE" : "DISCONNECTED"}
              </span>
            </div>
            <span className="text-xs text-text-muted">Total Streamed</span>
          </div>
        </Card>
      </div>

      {/* Control Bar: Filters & Search */}
      <Card padding="md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
                search
              </span>
              <input
                type="text"
                placeholder="Search model, API key, endpoint..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-lg border border-black/10 bg-surface pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
              />
            </div>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active (In Flight)</option>
              <option value="completed">Completed</option>
              <option value="error">Error</option>
            </select>

            <select
              value={filterProxy}
              onChange={(e) => setFilterProxy(e.target.value)}
              className="h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 cursor-pointer"
            >
              <option value="all">All Routing (Proxy/Direct)</option>
              <option value="proxied">Via Proxy / Relay</option>
              <option value="direct">Direct (No Proxy)</option>
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 cursor-pointer"
            >
              <option value="all">All Request Types</option>
              <option value="chat">Chat / LLM</option>
              <option value="embeddings">Embeddings</option>
              <option value="image">Image Gen</option>
              <option value="tts">TTS</option>
              <option value="stt">STT</option>
              <option value="search">Search</option>
              <option value="fetch">Web Fetch</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleClear}>
              <span className="material-symbols-outlined text-[16px] mr-1">delete_sweep</span>
              Clear History
            </Button>
          </div>
        </div>
      </Card>

      {actionNotice && (
        <div
          className={cn(
            "flex items-center justify-between rounded-xl px-4 py-2.5 text-xs font-medium border",
            actionNotice.type === "success"
              ? "bg-success/10 border-success/30 text-success"
              : "bg-error/10 border-error/30 text-error"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {actionNotice.type === "success" ? "check_circle" : "error"}
            </span>
            <span>{actionNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="hover:opacity-75 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Live Stream Table */}
      <Card className="overflow-hidden bg-black/5 dark:bg-black/20" padding="none">
        <div className="overflow-x-auto max-h-[700px] overflow-y-auto font-mono text-xs">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-text-muted">
              <span className="material-symbols-outlined text-[48px] opacity-30 mb-2">wifi_tethering</span>
              <p className="text-base font-semibold">No requests currently visible</p>
              <p className="text-xs">Incoming requests will stream here in real time with model, API key, and status.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-surface border-b border-border z-10 font-sans text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-2.5 py-2 border-r border-border w-24">Status</th>
                  <th className="px-2.5 py-2 border-r border-border w-16">Type</th>
                  <th className="px-2.5 py-2 border-r border-border max-w-[120px]">API Key</th>
                  <th className="px-2.5 py-2 border-r border-border min-w-[160px] max-w-[280px]">Model / Provider</th>
                  <th className="px-2.5 py-2 border-r border-border max-w-[100px]">Account</th>
                  <th className="px-2.5 py-2 border-r border-border max-w-[140px]">Proxy / Egress</th>
                  <th className="px-2.5 py-2 border-r border-border text-right w-24">Tokens</th>
                  <th className="px-2.5 py-2 border-r border-border text-right w-16">Duration</th>
                  <th className="px-2.5 py-2 border-r border-border min-w-[120px]">Details</th>
                  <th className="px-2.5 py-2 text-right w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredItems.map((item) => {
                  const isActive = item.status === "in_progress";
                  const isSuccess = item.status === "completed";
                  const isError = item.status === "error";
                  const duration = isActive ? currentTime - item.startTime : item.duration;
                  const isStuck = isActive && duration > slowAfterMs;
                  const isVeryStuck = isActive && duration > stuckAfterMs;
                  const currentAction = actionLoading[item.id];

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "hover:bg-primary/5 transition-colors font-mono text-[11px]",
                        isActive && !isStuck && "bg-primary/5 font-semibold",
                        isStuck && !isVeryStuck && "bg-amber-500/10 dark:bg-amber-500/15 font-semibold",
                        isVeryStuck && "bg-error/10 dark:bg-error/20 font-semibold"
                      )}
                    >
                      {/* Status Indicator */}
                      <td className="px-2.5 py-1.5 border-r border-border text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRequest(item);
                            setCopied(false);
                          }}
                          title="Vezi payload-ul și parametrii cererii (JSON)"
                          className="inline-flex items-center justify-center p-1 rounded hover:bg-bg-subtle transition-colors cursor-pointer"
                        >
                          {isActive && !isStuck && (
                            <span className="inline-flex items-center gap-1 text-primary font-bold animate-pulse text-[10px]">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping"></span>
                              ACTIVE
                            </span>
                          )}
                          {isActive && isStuck && (
                            <span className={cn(
                              "inline-flex items-center gap-1 font-bold animate-pulse text-[10px]",
                              isVeryStuck ? "text-error" : "text-amber-500"
                            )} title={`Request-ul rulează de ${formatDuration(duration)} fără să finalizeze`}>
                              <span className="material-symbols-outlined text-[13px]">warning</span>
                              {isVeryStuck ? "BLOCAT" : "LENT"}
                            </span>
                          )}
                          {isSuccess && (
                            <span className="inline-flex items-center gap-1 text-success font-medium text-[10px]">
                              <span className="material-symbols-outlined text-[13px]">check_circle</span>
                              {item.statusCode || 200}
                            </span>
                          )}
                          {isError && (
                            <span className="inline-flex items-center gap-1 text-error font-bold text-[10px]">
                              <span className="material-symbols-outlined text-[13px]">error</span>
                              {item.statusCode || "ERR"}
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Request Type */}
                      <td className="px-2.5 py-1.5 border-r border-border whitespace-nowrap">
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                          item.type === "chat" && "bg-blue-500/10 text-blue-500",
                          item.type === "embeddings" && "bg-purple-500/10 text-purple-500",
                          item.type === "image" && "bg-pink-500/10 text-pink-500",
                          item.type === "tts" && "bg-amber-500/10 text-amber-500",
                          item.type === "stt" && "bg-teal-500/10 text-teal-500",
                          item.type === "search" && "bg-indigo-500/10 text-indigo-500"
                        )}>
                          {item.type || "chat"}
                        </span>
                      </td>

                      {/* API Key (Cod API) */}
                      <td className="px-2.5 py-1.5 border-r border-border max-w-[120px]">
                        <div className="flex flex-col truncate">
                          <span className="font-semibold text-text-main font-sans text-[11px] truncate" title={item.apiKeyName || "Local"}>{item.apiKeyName || "Local"}</span>
                          {item.apiKey && (
                            <span className="text-[9px] text-text-muted font-mono truncate" title={item.apiKey}>{item.apiKey}</span>
                          )}
                        </div>
                      </td>

                      {/* Model & Provider */}
                      <td className="px-2.5 py-1.5 border-r border-border min-w-[160px] max-w-[280px]">
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-text-main break-words font-mono text-[11px]" title={item.model}>
                            {item.model}
                          </span>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {item.provider && (
                              <span className="shrink-0 rounded bg-bg-subtle px-1 py-0.2 text-[9px] uppercase font-bold text-text-muted border border-border">
                                {item.provider}
                              </span>
                            )}
                            {item.stream && (
                              <span className="shrink-0 text-[8px] text-primary border border-primary/30 rounded px-0.5" title="Streaming (SSE)">
                                stream
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Account */}
                      <td className="px-2.5 py-1.5 border-r border-border text-text-muted truncate max-w-[100px]" title={item.accountName}>
                        <span className="truncate block">{item.accountName || "-"}</span>
                      </td>

                      {/* Proxy / Egress */}
                      <td className="px-2.5 py-1.5 border-r border-border max-w-[140px]">
                        {item.proxy?.url ? (
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="material-symbols-outlined text-[12px] text-primary shrink-0">router</span>
                              <span className="text-[10px] font-semibold text-text-main truncate" title={proxyPoolMap.get(item.proxy.poolId)?.name || item.proxy.poolId || "Proxy"}>
                                {proxyPoolMap.get(item.proxy.poolId)?.name || (item.proxy.poolId ? `Pool: ${item.proxy.poolId.slice(0, 8)}` : (item.proxy.type === "relay" ? "Relay" : "Proxy"))}
                              </span>
                              {item.proxy.isAuto && (
                                <span className="shrink-0 rounded bg-primary/10 px-1 py-0.2 text-[8px] font-bold uppercase text-primary">
                                  Auto
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[9px] text-text-muted truncate" title={item.proxy.url}>
                              {item.proxy.url}
                            </span>
                          </div>
                        ) : (
                          <span className="text-text-muted/60 text-[10px] font-mono">Direct</span>
                        )}
                      </td>

                      {/* Tokens */}
                      <td className="px-2.5 py-1.5 border-r border-border text-right whitespace-nowrap text-[11px]">
                        {formatTokens(item.tokens)}
                      </td>

                      {/* Duration */}
                      <td className="px-2.5 py-1.5 border-r border-border text-right whitespace-nowrap">
                        <span className={cn(
                          "text-[10px]",
                          isActive ? "text-primary font-bold animate-pulse" : "text-text-muted"
                        )}>
                          {formatDuration(duration)}
                        </span>
                      </td>

                      {/* Error or Details Message */}
                      <td className="px-2.5 py-1.5 max-w-[180px] border-r border-border">
                        {isError ? (
                          <span className="text-error font-medium truncate block text-[10px]" title={item.error}>
                            {item.error}
                          </span>
                        ) : isActive ? (
                          <span className={cn("italic truncate block text-[10px]", isStuck ? "text-amber-500 font-medium" : "text-text-muted")}>
                            {isVeryStuck ? "Posibil blocat..." : isStuck ? "Răspuns întârziat..." : "Processing stream..."}
                          </span>
                        ) : (
                          <span className="text-success font-medium truncate block text-[10px]">Finished OK</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-2.5 py-1 text-right whitespace-nowrap">
                        {isActive ? (
                          <div className="inline-flex items-center gap-1 font-sans">
                            <button
                              type="button"
                              onClick={() => handleAction(item.id, "reroute")}
                              disabled={!!currentAction}
                              title="Oprește requestul curent și blochează temporar modelul (10m) astfel încât retry-ul clientului să fie trimis la un alt model din combo"
                              className={cn(
                                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer",
                                isStuck
                                  ? "bg-primary text-white hover:bg-primary/90 shadow-sm animate-pulse"
                                  : "bg-primary/10 text-primary hover:bg-primary/20"
                              )}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {currentAction === "reroute" ? "progress_activity" : "alt_route"}
                              </span>
                              {currentAction === "reroute" ? "Rerutez..." : "Rerutează"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAction(item.id, "cancel")}
                              disabled={!!currentAction}
                              title="Oprește forțat requestul blocat"
                              className="inline-flex items-center rounded border border-border px-1 py-0.5 text-[10px] text-text-muted hover:bg-error/10 hover:text-error hover:border-error/30 transition-colors cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[12px]">
                                {currentAction === "cancel" ? "progress_activity" : "close"}
                              </span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-text-muted/40 font-mono text-[10px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <div className="flex flex-col gap-1 text-[11px] text-text-muted italic">
        <div>Real-time connection stream via SSE. Active requests are updated dynamically as they are processed.</div>
        <div>
          <span className="font-semibold not-italic text-text-main">Butonul „Rerutează”:</span> blochează temporar modelul (10m) și forțează clientul să continue automat pe următorul model disponibil din combo sau alt provider.
        </div>
      </div>

      {/* Request Payload Modal */}
      <Modal
        isOpen={!!selectedRequest}
        onClose={() => {
          setSelectedRequest(null);
          setCopied(false);
        }}
        title={`Request Payload: ${selectedRequest?.model || ""}`}
        size="full"
      >
        <div className="space-y-3 font-sans text-xs">
          <div className="flex items-center justify-between gap-2 bg-bg-subtle p-2 rounded border border-border">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-text-main font-mono">{selectedRequest?.id}</span>
              {selectedRequest?.provider && (
                <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase font-bold text-text-muted border border-border">
                  {selectedRequest.provider}
                </span>
              )}
              {selectedRequest?.accountName && (
                <span className="text-[11px] text-text-muted">
                  ({selectedRequest.accountName})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                const text = selectedRequest?.payload
                  ? JSON.stringify(selectedRequest.payload, null, 2)
                  : "";
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white text-[11px] font-semibold hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied ? "check" : "content_copy"}
              </span>
              {copied ? "Copiat!" : "Copiază JSON"}
            </button>
          </div>

          <div className="relative">
            {selectedRequest?.payload ? (
              <pre className="max-h-[60vh] overflow-auto rounded bg-bg-subtle/80 p-3 font-mono text-[11px] text-text-main border border-border whitespace-pre-wrap break-all select-text">
                {JSON.stringify(selectedRequest.payload, null, 2)}
              </pre>
            ) : (
              <div className="p-8 text-center text-text-muted bg-bg-subtle rounded border border-border">
                Nu există payload disponibil pentru acest request (cerere internă sau tranzacție fără body stocat).
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
