"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, Badge } from "@/shared/components";

const MODEL_LABELS = {
  "gemini-3.8-flash": "3.8 Flash",
  "gemini-3.7-flash": "3.7 Flash",
  "gemini-3.6-flash": "3.6 Flash",
  "gemini-3.5-flash": "3.5 Flash",
  "gemini-3-flash": "3 Flash",
  "gemini-3-flash-preview": "3 Flash Preview",
  "gemini-3-pro-preview": "3 Pro Preview",
  "gemini-3.5-flash-lite": "3.5 Flash Lite",
  "gemini-3.1-flash-lite-preview": "3.1 Flash Lite",
  "gemini-2.5-flash-lite": "2.5 Flash Lite",
  "gemma-2-27b-it": "Gemma 2 27B",
  "gemma-2-9b-it": "Gemma 2 9B",
};

const COMMON_TIMEZONES = [
  "Europe/Bucharest",
  "Europe/Berlin",
  "Europe/London",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
];

function fmtLimit(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "∞";
  return String(n);
}

function fmtTokens(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "∞";
  return `${(n / 1000).toFixed(0)}k`;
}

function CooldownBadge({ rateLimitedUntil, manualBlockUntil, currentTime, onUnblock429, onUnblockManual }) {
  const isManual = manualBlockUntil && manualBlockUntil > currentTime;
  const is429 = rateLimitedUntil && rateLimitedUntil > currentTime;
  if (!isManual && !is429) return null;

  const targetTime = isManual ? manualBlockUntil : rateLimitedUntil;
  // ponytail: permanent = far-future manualBlockUntil. Upgrade path: blockReason column.
  const isPermanent = isManual && targetTime > currentTime + 365 * 24 * 3600 * 1000;
  const secs = Math.ceil((targetTime - currentTime) / 1000);
  const label = isPermanent
    ? "definitiv"
    : secs >= 3600
      ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
      : secs >= 60
        ? `${Math.floor(secs / 60)}m ${secs % 60}s`
        : `${secs}s`;

  const onUnblock = isManual ? onUnblockManual : onUnblock429;

  return (
    <div className="inline-flex items-center gap-1.5">
      <Badge variant={isManual ? "warning" : "error"} size="sm" dot>
        {isManual ? `Blocat manual · ${label}` : `429 · ${label}`}
      </Badge>
      {onUnblock && (
        <button
          type="button"
          onClick={onUnblock}
          className="text-[10px] font-medium text-primary hover:underline"
          title={isManual ? "Deblochează manual imediat" : "Deblochează pauza 429 imediat"}
        >
          Deblochează
        </button>
      )}
    </div>
  );
}

function getRowStatus(row, currentTime) {
  if (row.manualBlockUntil && row.manualBlockUntil > currentTime) {
    return "manual_blocked";
  }
  if (row.rateLimitedUntil && row.rateLimitedUntil > currentTime) {
    return "cooldown";
  }
  const rpdExhausted = Number.isFinite(row.limits.rpd) && row.rpd.used >= row.limits.rpd;
  const rpmExhausted = Number.isFinite(row.limits.rpm) && row.rpm.used >= row.limits.rpm;
  const tpmExhausted = Number.isFinite(row.limits.tpm) && row.tpm.used >= row.limits.tpm;

  if (rpdExhausted) return "rpd_exhausted";
  if (rpmExhausted || tpmExhausted) return "rate_exhausted";
  return "ok";
}

function fmtLastCheck(ts, currentTime) {
  if (!ts) return "—";
  const t = typeof ts === "string" ? Date.parse(ts) : Number(ts);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.floor((currentTime - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function StatusBadge({ row, currentTime }) {
  const status = getRowStatus(row, currentTime);
  if (status === "manual_blocked") {
    const permanent = row.manualBlockUntil > currentTime + 365 * 24 * 3600 * 1000;
    return <Badge variant="warning" size="sm" dot>{permanent ? "Blocat definitiv" : "Blocat manual"}</Badge>;
  }
  if (status === "cooldown") return <Badge variant="error" size="sm" dot>429 Cooldown</Badge>;
  if (status === "rpd_exhausted") return <Badge variant="error" size="sm" dot>RPD Epuizat</Badge>;
  if (status === "rate_exhausted") {
    const rpmExhausted = Number.isFinite(row.limits.rpm) && row.rpm.used >= row.limits.rpm;
    return <Badge variant="warning" size="sm" dot>{rpmExhausted ? "RPM / min" : "TPM / min"}</Badge>;
  }
  return <Badge variant="success" size="sm" dot>OK</Badge>;
}

function DiscoveredHint({ value }) {
  if (value === null || value === undefined) return null;
  return (
    <span className="font-mono text-[10px] text-text-muted" title="Limită reală descoperită pasiv dintr-un 429 Google (quotaValue). Null = încă necunoscută.">
      real: {value}
    </span>
  );
}

function MiniProgressBar({ used = 0, limit, colorClass = "bg-primary" }) {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  let barColor = colorClass;
  if (pct >= 100) barColor = "bg-red-500";
  else if (pct >= 80) barColor = "bg-amber-500";

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
      <div
        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function RateLimitsTable({ providerId, onUnlockConnectionLocks = null }) {
  const [rows, setRows] = useState([]);
  const [blockedModels, setBlockedModels] = useState([]);
  const [providerDefaults, setProviderDefaults] = useState(null);
  const [hasConfig, setHasConfig] = useState(true);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  // Filters & Search & View controls
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'ok' | 'issues' | 'blocked'
  const [selectedKey, setSelectedKey] = useState("all");
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [compactView, setCompactView] = useState(false);

  // Editing key counter: { keyId, modelId, counter: 'rpd'|'rpm'|'tpm' }
  const [editingCounter, setEditingCounter] = useState(null);
  const [counterValue, setCounterValue] = useState("");

  // Editing model limits: modelId
  const [editingModelLimits, setEditingModelLimits] = useState(null);
  const [limitsForm, setLimitsForm] = useState({ rpm: "", tpm: "", rpd: "", timeout: "" });

  // Editing provider defaults (reset hour / timezone)
  const [editingProviderDefaults, setEditingProviderDefaults] = useState(false);
  const [providerForm, setProviderForm] = useState({ rpdResetHour: 0, resetTz: "Europe/Bucharest", timeout: "" });

  const fetchRateLimits = useCallback(async () => {
    try {
      const res = await fetch(`/api/rate-limits?provider=${providerId}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
        setBlockedModels(data.blockedModels || []);
        setProviderDefaults(data.providerDefaults || null);
        setHasConfig(data.hasConfig !== false);
        if (data.providerDefaults) {
          setProviderForm({
            rpdResetHour: data.providerDefaults.rpdResetHour ?? 0,
            resetTz: data.providerDefaults.resetTz || "Europe/Bucharest",
            timeout: data.providerDefaults.timeoutSec != null ? String(data.providerDefaults.timeoutSec) : "",
          });
        }
      }
    } catch (error) {
      console.log("Error fetching rate limits:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    const clockTimer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (isMounted) await fetchRateLimits();
    };
    load();
    const t = setInterval(fetchRateLimits, 10000);
    return () => {
      isMounted = false;
      clearInterval(t);
    };
  }, [fetchRateLimits]);

  // Set counter value for a key
  const handleSaveCounter = async (row, counter, value) => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          model: row.modelId,
          keyId: row.keyId,
          action: "setCounter",
          counter,
          value,
        }),
      });
      if (res.ok) {
        setEditingCounter(null);
        fetchRateLimits();
      }
    } catch (error) {
      console.log("Error updating counter:", error);
    }
  };

  // Unblock 429 cooldown or manual block for a specific key
  const handleUnblockKey = async (row, actionType = "unblock429") => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          model: row.modelId,
          keyId: row.keyId,
          action: actionType,
        }),
      });
      if (res.ok) fetchRateLimits();
    } catch (error) {
      console.log("Error unblocking key:", error);
    }
  };

  // Reset all counters for a key
  const handleResetKey = async (row) => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          model: row.modelId,
          keyId: row.keyId,
          action: "reset",
        }),
      });
      if (res.ok) fetchRateLimits();
    } catch (error) {
      console.log("Error resetting key:", error);
    }
  };

  // Test a single model+key pair (ping that model pinned to that connection)
  const [testingKey, setTestingKey] = useState(null);

  const handleTestKey = async (row) => {
    const testKey = `${row.keyId}:${row.modelId}`;
    setTestingKey(testKey);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-connection-id": row.keyId,
        },
        body: JSON.stringify({ model: `${providerId}/${row.modelId}`, kind: "llm" }),
      });
      await res.json().catch(() => null);
      fetchRateLimits();
    } catch (error) {
      console.log("Error testing key:", error);
    } finally {
      setTestingKey(null);
    }
  };

  // Save model limits (RPM, TPM, RPD, timeout in seconds)
  const handleSaveModelLimits = async (modelId) => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          model: modelId,
          action: "setLimits",
          limits: {
            rpm: limitsForm.rpm !== "" ? Number(limitsForm.rpm) : undefined,
            tpm: limitsForm.tpm !== "" ? Number(limitsForm.tpm) * 1000 : undefined,
            rpd: limitsForm.rpd !== "" ? Number(limitsForm.rpd) : undefined,
            timeout: limitsForm.timeout !== "" ? Number(limitsForm.timeout) : undefined,
          },
        }),
      });
      if (res.ok) {
        setEditingModelLimits(null);
        fetchRateLimits();
      }
    } catch (error) {
      console.log("Error saving model limits:", error);
    }
  };

  // Reset model limits to registry defaults
  const handleClearModelLimits = async (modelId) => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          model: modelId,
          action: "clearLimits",
        }),
      });
      if (res.ok) {
        setEditingModelLimits(null);
        fetchRateLimits();
      }
    } catch (error) {
      console.log("Error clearing model limits:", error);
    }
  };

  // Save provider-level defaults (reset hour, tz, timeout)
  const handleSaveProviderDefaults = async () => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          action: "setProviderDefaults",
          limits: {
            rpdResetHour: Number(providerForm.rpdResetHour),
            resetTz: providerForm.resetTz,
            timeout: providerForm.timeout !== "" ? Number(providerForm.timeout) : undefined,
          },
        }),
      });
      if (res.ok) {
        setEditingProviderDefaults(false);
        fetchRateLimits();
      }
    } catch (error) {
      console.log("Error saving provider defaults:", error);
    }
  };

  // Unblock combo-level blocked model (from 503/504 errors)
  const handleUnblockComboModel = async (fullModelStr) => {
    try {
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          action: "unblockCombo",
          model: fullModelStr,
        }),
      });
      if (res.ok) fetchRateLimits();
    } catch (error) {
      console.log("Error unblocking combo model:", error);
    }
  };

  // Block / Unblock all keys for a specific model (429 cooldown override)
  const handleToggleBlockAllModel = async (modelId, block) => {
    try {
      const action = block ? "blockAllModel" : "unblockAllModel";
      const res = await fetch("/api/rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          action,
          model: modelId,
        }),
      });
      if (res.ok) fetchRateLimits();
    } catch (error) {
      console.log(`Error ${block ? "blocking" : "unblocking"} model ${modelId}:`, error);
    }
  };

  const toggleModelCollapse = (modelId) => {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const collapseAll = () => {
    setExpandedModels(new Set());
  };

  const expandAll = () => {
    const all = new Set(rows.map((r) => r.modelId));
    setExpandedModels(all);
  };

  // Export visible (filtered) rows as JSON — client-side, no backend needed.
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filteredRows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rate-limits-${providerId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Distinct connections for filter dropdown
  const uniqueConnections = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.keyId)) map.set(r.keyId, r.connectionName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return rows.filter((row) => {
      if (selectedKey !== "all" && row.keyId !== selectedKey) return false;

      const modelLabel = MODEL_LABELS[row.modelId] || row.modelId;
      if (q) {
        const matchesQuery =
          row.modelId.toLowerCase().includes(q) ||
          modelLabel.toLowerCase().includes(q) ||
          row.connectionName.toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }

      if (statusFilter === "all") return true;

      const status = getRowStatus(row, currentTime);
      if (statusFilter === "ok") return status === "ok";
      if (statusFilter === "issues") return status !== "ok";
      if (statusFilter === "blocked") return status === "cooldown" || status === "manual_blocked";
      return true;
    });
  }, [rows, searchQuery, selectedKey, statusFilter, currentTime]);

  // Group filtered rows by model
  const byModel = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      if (!map.has(row.modelId)) map.set(row.modelId, []);
      map.get(row.modelId).push(row);
    }
    return map;
  }, [filteredRows]);

  // Metrics summary
  const summary = useMemo(() => {
    let totalKeys = uniqueConnections.length;
    let totalModels = new Set(rows.map((r) => r.modelId)).size;
    let totalCooldowns = 0;
    let totalManualBlocks = 0;
    let totalRpdExhausted = 0;
    let totalRpmExhausted = 0;

    for (const r of rows) {
      if (r.manualBlockUntil && r.manualBlockUntil > currentTime) totalManualBlocks++;
      else if (r.rateLimitedUntil && r.rateLimitedUntil > currentTime) totalCooldowns++;
      else if (Number.isFinite(r.limits.rpd) && r.rpd.used >= r.limits.rpd) totalRpdExhausted++;
      else if (Number.isFinite(r.limits.rpm) && r.rpm.used >= r.limits.rpm) totalRpmExhausted++;
    }

    return {
      totalKeys,
      totalModels,
      totalCooldowns,
      totalManualBlocks,
      totalRpdExhausted,
      totalRpmExhausted,
      hasIssues: totalCooldowns > 0 || totalManualBlocks > 0 || totalRpdExhausted > 0 || totalRpmExhausted > 0 || blockedModels.length > 0,
    };
  }, [rows, uniqueConnections, blockedModels, currentTime]);

  if (!hasConfig && rows.length === 0 && blockedModels.length === 0) return null;

  const resetHourStr =
    providerDefaults?.rpdResetHour !== undefined
      ? `${String(providerDefaults.rpdResetHour).padStart(2, "0")}:00`
      : "10:00";
  const resetTzStr = providerDefaults?.resetTz || "Europe/Bucharest";

  return (
    <Card className="space-y-4">
      {/* 1. Header & Quick Controls */}
      <div className="flex flex-col gap-3 border-b border-border/40 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[20px]">speed</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold leading-none text-text-main">
                  Rate Limits & Blocaje Modele
                </h3>
                {summary.hasIssues && (
                  <Badge variant="warning" size="sm" dot>
                    Atenție
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                Monitorizare ferestre RPM/TPM (60s) și cote zilnice RPD per conexiune
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={editingProviderDefaults ? "primary" : "secondary"}
              icon="tune"
              onClick={() => setEditingProviderDefaults(!editingProviderDefaults)}
            >
              {editingProviderDefaults ? "Închide Config" : "Reset & Timezone"}
            </Button>
            <Button size="sm" variant="secondary" icon="refresh" onClick={fetchRateLimits} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              onClick={handleExportJson}
              disabled={rows.length === 0}
              title="Exportă rândurile vizibile (filtrate) ca JSON"
            >
              Export
            </Button>
          </div>
        </div>

        {/* Status bar pills / Summary counters */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-text-muted">
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              Reset RPD:{" "}
              <span className="font-mono font-semibold text-text-main">
                {resetHourStr} ({resetTzStr})
              </span>
            </span>

            {providerDefaults?.timeoutSec && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-text-muted">
                <span className="material-symbols-outlined text-[14px]">timer</span>
                Timeout: <span className="font-mono font-semibold text-text-main">{providerDefaults.timeoutSec}s</span>
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-text-muted">
              <span className="material-symbols-outlined text-[14px]">key</span>
              Conexiuni: <span className="font-mono font-semibold text-text-main">{summary.totalKeys}</span>
            </span>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            {summary.totalManualBlocks > 0 && (
              <Badge variant="warning" size="sm">
                {summary.totalManualBlocks} Blocat manual
              </Badge>
            )}
            {summary.totalCooldowns > 0 && (
              <Badge variant="error" size="sm">
                {summary.totalCooldowns} 429 activ
              </Badge>
            )}
            {summary.totalRpdExhausted > 0 && (
              <Badge variant="error" size="sm">
                {summary.totalRpdExhausted} RPD epuizat
              </Badge>
            )}
            {summary.totalRpmExhausted > 0 && (
              <Badge variant="warning" size="sm">
                {summary.totalRpmExhausted} RPM limit
              </Badge>
            )}
            {blockedModels.length > 0 && (
              <Badge variant="error" size="sm">
                {blockedModels.length} Combo blocat
              </Badge>
            )}
          </div>
        </div>

        {/* Provider defaults editing drawer / box */}
        {editingProviderDefaults && (
          <div className="mt-1 rounded-xl border border-primary/30 bg-primary/[0.03] p-3.5 text-xs animate-in fade-in duration-150">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="font-semibold text-text-main">
                Setări globale provider ({providerId})
              </span>
              <button
                type="button"
                onClick={() => setEditingProviderDefaults(false)}
                className="text-text-muted hover:text-text-main"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-medium text-text-muted">Ora reset zilnic RPD (0 - 23):</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={providerForm.rpdResetHour}
                  onChange={(e) => setProviderForm({ ...providerForm, rpdResetHour: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-text-muted">Fus orar (Timezone):</label>
                <select
                  value={providerForm.resetTz}
                  onChange={(e) => setProviderForm({ ...providerForm, resetTz: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-text-muted">Timeout implicit (secunde):</label>
                <input
                  type="number"
                  min={1}
                  placeholder="ex: 10"
                  value={providerForm.timeout}
                  onChange={(e) => setProviderForm({ ...providerForm, timeout: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditingProviderDefaults(false)}>
                Anulează
              </Button>
              <Button size="sm" onClick={handleSaveProviderDefaults}>
                Salvează setările
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Blocked Models Alert Bar (Compact Modern Banner) */}
      {blockedModels.length > 0 && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/[0.04] p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium text-red-600 dark:text-red-400">
              <span className="material-symbols-outlined text-[18px]">block</span>
              <span>Modele blocate automat în Combo (erori 503/504 repetate):</span>
            </div>
            <span className="text-[11px] text-text-muted">
              {blockedModels.length} model(e) temporar oprite
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {blockedModels.map((b) => {
              const remainingMin = Math.ceil(b.remainingMs / 60000);
              return (
                <div
                  key={b.model}
                  className="flex items-center justify-between gap-2 rounded-lg border border-red-500/20 bg-background/80 px-2.5 py-1.5 backdrop-blur-sm"
                >
                  <div className="min-w-0 flex-1 truncate font-mono">
                    <span className="font-semibold text-text-main">{b.model}</span>
                    <span className="ml-1 text-[10px] text-text-muted">
                      ({b.failureCount} err · {remainingMin}m)
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="lock_open"
                    onClick={() => handleUnblockComboModel(b.model)}
                    title="Deblochează modelul imediat"
                    className="h-7 px-2 text-xs"
                  >
                    Unblock
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Filter and Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2/60 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search box */}
          <div className="relative min-w-[200px] flex-1 sm:w-64 sm:flex-initial">
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">
              search
            </span>
            <input
              type="text"
              placeholder="Filtrează model sau cheie..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-background py-1.5 pl-8 pr-7 text-xs focus:border-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>

          {/* Status filter tabs */}
          <div className="inline-flex rounded-lg border border-border/60 bg-background/50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === "all" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text-main"
              }`}
            >
              Toate
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("issues")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === "issues" ? "bg-amber-500 text-white shadow-sm" : "text-text-muted hover:text-text-main"
              }`}
            >
              Probleme {summary.totalCooldowns + summary.totalRpdExhausted > 0 && `(${summary.totalCooldowns + summary.totalRpdExhausted})`}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("blocked")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === "blocked" ? "bg-red-500 text-white shadow-sm" : "text-text-muted hover:text-text-main"
              }`}
            >
              429 Cooldown
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("ok")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === "ok" ? "bg-green-600 text-white shadow-sm" : "text-text-muted hover:text-text-main"
              }`}
            >
              Doar OK
            </button>
          </div>

          {/* Key selector dropdown */}
          {uniqueConnections.length > 1 && (
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="rounded-lg border border-border/80 bg-background px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
            >
              <option value="all">Toate conexiunile ({uniqueConnections.length})</option>
              {uniqueConnections.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.id}</option>
              ))}
            </select>
          )}
        </div>

        {/* View Toggle & Collapse Actions */}
        <div className="flex items-center gap-1.5 text-xs">
          <Button
            size="sm"
            variant="ghost"
            icon={compactView ? "view_agenda" : "view_headline"}
            onClick={() => setCompactView(!compactView)}
            title={compactView ? "Comută la vizualizare detaliată" : "Comută la vizualizare compactă"}
          >
            {compactView ? "Detaliat" : "Compact"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="unfold_less"
            onClick={collapseAll}
            title="Restrânge toate modelele"
          >
            Restrânge
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="unfold_more"
            onClick={expandAll}
            title="Extinde toate modelele"
          >
            Extinde
          </Button>
        </div>
      </div>

      {/* 4. Model Cards & Per-Key Lists */}
      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-text-muted">
          Nicio cheie conectată sau niciun model configurat pentru acest provider.
        </div>
      ) : byModel.size === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-text-muted">
          <span className="material-symbols-outlined mb-1 text-[28px]">search_off</span>
          <span>Niciun model sau cheie nu corespunde filtrelor selectate.</span>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
              setSelectedKey("all");
            }}
          >
            Resetează filtrele
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {[...byModel.entries()].map(([modelId, modelRows]) => {
            const firstLimits = modelRows[0]?.limits || {};
            const isEditingThisModel = editingModelLimits === modelId;
            const modelLabel = MODEL_LABELS[modelId] || modelId;
            const isExpanded = expandedModels.has(modelId);

            const anyManualBlocked = modelRows.some((r) => r.manualBlockUntil && r.manualBlockUntil > currentTime);
            const allManualBlocked = modelRows.length > 0 && modelRows.every(
              (r) => r.manualBlockUntil && r.manualBlockUntil > currentTime
            );
            const any429Blocked = modelRows.some((r) => r.rateLimitedUntil && r.rateLimitedUntil > currentTime);
            const all429Blocked = modelRows.length > 0 && modelRows.every(
              (r) => r.rateLimitedUntil && r.rateLimitedUntil > currentTime
            );
            // Unblock All must appear as soon as ANY row is blocked — blockAllModel
            // only blocks active connections, so inactive rows break the old .every() check
            // and the button never showed.
            const allBlocked = modelRows.some(
              (r) => (r.manualBlockUntil && r.manualBlockUntil > currentTime) || (r.rateLimitedUntil && r.rateLimitedUntil > currentTime)
            );
            const anyRpdExhausted = modelRows.some((r) => Number.isFinite(r.limits.rpd) && r.rpd.used >= r.limits.rpd);

            return (
              <div
                key={modelId}
                className="overflow-hidden rounded-xl border border-border/70 bg-card transition-all"
              >
                {/* Header Bar for each Model */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-surface-2/40 px-3.5 py-2">
                  <div
                    className="flex flex-1 cursor-pointer select-none items-center gap-2 min-w-0"
                    onClick={() => toggleModelCollapse(modelId)}
                  >
                    <span className="material-symbols-outlined text-[18px] text-text-muted transition-transform duration-150">
                      {isExpanded ? "expand_more" : "chevron_right"}
                    </span>
                    <span className="font-mono text-xs font-bold text-text-main truncate">
                      {modelLabel}
                    </span>
                    {modelLabel !== modelId && (
                      <span className="hidden font-mono text-[10px] text-text-muted sm:inline truncate">
                        ({modelId})
                      </span>
                    )}

                    {/* Status indicator badge */}
                    {allManualBlocked ? (
                      <Badge variant="warning" size="sm" dot>Blocat manual</Badge>
                    ) : all429Blocked ? (
                      <Badge variant="error" size="sm" dot>Toate 429</Badge>
                    ) : anyManualBlocked ? (
                      <Badge variant="warning" size="sm" dot>Unele blocate manual</Badge>
                    ) : any429Blocked ? (
                      <Badge variant="warning" size="sm" dot>Unele 429</Badge>
                    ) : anyRpdExhausted ? (
                      <Badge variant="error" size="sm" dot>RPD Atins</Badge>
                    ) : (
                      <Badge variant="success" size="sm">OK</Badge>
                    )}

                    {/* Limits capsule */}
                    <span className="ml-1 hidden items-center gap-1 rounded-md bg-background px-2 py-0.5 font-mono text-[10px] text-text-muted md:inline-flex">
                      <span>RPM {fmtLimit(firstLimits.rpm)}</span>
                      <span>·</span>
                      <span>TPM {fmtTokens(firstLimits.tpm)}</span>
                      <span>·</span>
                      <span>RPD {fmtLimit(firstLimits.rpd)}</span>
                      {firstLimits.timeoutSec && (
                        <>
                          <span>·</span>
                          <span>{firstLimits.timeoutSec}s</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Actions for Model */}
                  <div className="flex items-center gap-1">
                    {allBlocked ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="lock_open"
                        onClick={() => handleToggleBlockAllModel(modelId, false)}
                        title="Deblochează toate conexiunile pentru acest model"
                        className="h-7 px-2 text-xs"
                      >
                        Unblock All
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="block"
                        onClick={() => handleToggleBlockAllModel(modelId, true)}
                        title="Blochează modelul pe toate conexiunile până la reset"
                        className="h-7 px-2 text-xs text-text-muted hover:text-red-500"
                      >
                        Block All
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant={isEditingThisModel ? "primary" : "ghost"}
                      icon="tune"
                      onClick={() => {
                        if (isEditingThisModel) {
                          setEditingModelLimits(null);
                        } else {
                          setEditingModelLimits(modelId);
                          setLimitsForm({
                            rpm: Number.isFinite(firstLimits.rpm) ? String(firstLimits.rpm) : "",
                            tpm: Number.isFinite(firstLimits.tpm) ? String(firstLimits.tpm / 1000) : "",
                            rpd: Number.isFinite(firstLimits.rpd) ? String(firstLimits.rpd) : "",
                            timeout: firstLimits.timeoutSec != null ? String(firstLimits.timeoutSec) : "",
                          });
                        }
                      }}
                      title="Setează limite și timeout pentru acest model"
                      className="h-7 px-2 text-xs"
                    >
                      {isEditingThisModel ? "Închide" : "Setează"}
                    </Button>
                  </div>
                </div>

                {/* Inline form for limits */}
                {isEditingThisModel && (
                  <div className="border-b border-border/60 bg-primary/[0.02] p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between font-medium text-text-main">
                      <span>Modifică limitele pentru <span className="font-mono text-primary">{modelId}</span></span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-text-muted">RPM (req/min):</label>
                        <input
                          type="number"
                          min={1}
                          placeholder="ex: 5"
                          value={limitsForm.rpm}
                          onChange={(e) => setLimitsForm({ ...limitsForm, rpm: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-text-muted">TPM (k tokens/min):</label>
                        <input
                          type="number"
                          min={1}
                          placeholder="ex: 250"
                          value={limitsForm.tpm}
                          onChange={(e) => setLimitsForm({ ...limitsForm, tpm: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-text-muted">RPD (req/zi):</label>
                        <input
                          type="number"
                          min={1}
                          placeholder="ex: 20"
                          value={limitsForm.rpd}
                          onChange={(e) => setLimitsForm({ ...limitsForm, rpd: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-text-muted">Timeout (secunde):</label>
                        <input
                          type="number"
                          min={1}
                          placeholder="ex: 10"
                          value={limitsForm.timeout}
                          onChange={(e) => setLimitsForm({ ...limitsForm, timeout: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => handleClearModelLimits(modelId)}>
                        Resetează la implicite
                      </Button>
                      <Button size="sm" onClick={() => handleSaveModelLimits(modelId)}>
                        Salvează
                      </Button>
                    </div>
                  </div>
                )}

                {/* Per-Key Table / List */}
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/40 text-[11px] font-semibold text-text-muted">
                          <th className="px-3.5 py-2">Conexiune / Cheie</th>
                          <th className="px-3 py-2">RPM (1m)</th>
                          <th className="px-3 py-2">TPM (1m)</th>
                          <th className="px-3 py-2">RPD (Zilnic)</th>
                          <th className="px-3 py-2" title="Număr real de erori 429 primite de la upstream pe această cheie+model">429</th>
                          <th className="px-3 py-2" title="Ultima actualizare a contoarelor (ultimul request / 429 / test)">Last Check</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Blocaj / Cooldown</th>
                          <th className="px-3.5 py-2 text-right">Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {modelRows.map((row) => {
                          const isEditingRPD =
                            editingCounter?.keyId === row.keyId &&
                            editingCounter?.modelId === modelId &&
                            editingCounter?.counter === "rpd";
                          const isEditingRPM =
                            editingCounter?.keyId === row.keyId &&
                            editingCounter?.modelId === modelId &&
                            editingCounter?.counter === "rpm";
                          const isEditingTPM =
                            editingCounter?.keyId === row.keyId &&
                            editingCounter?.modelId === modelId &&
                            editingCounter?.counter === "tpm";

                          return (
                            <tr
                              key={`${row.keyId}:${modelId}`}
                              className="hover:bg-surface-2/30 transition-colors"
                            >
                              {/* Connection Column */}
                              <td className="px-3.5 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`size-2 rounded-full ${
                                      row.isActive !== false ? "bg-green-500" : "bg-gray-400"
                                    }`}
                                    title={row.isActive !== false ? "Activă" : "Inactivă"}
                                  />
                                  <span className="font-medium text-text-main max-w-[170px] truncate" title={row.connectionName}>
                                    {row.connectionName}
                                  </span>
                                </div>
                              </td>

                              {/* RPM Column */}
                              <td className="px-3 py-2 font-mono">
                                {isEditingRPM ? (
                                  <input
                                    type="number"
                                    min={0}
                                    value={counterValue}
                                    autoFocus
                                    onChange={(e) => setCounterValue(e.target.value)}
                                    onBlur={() => {
                                      const val = parseInt(counterValue, 10);
                                      if (Number.isFinite(val)) handleSaveCounter(row, "rpm", val);
                                      setEditingCounter(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const val = parseInt(counterValue, 10);
                                        if (Number.isFinite(val)) handleSaveCounter(row, "rpm", val);
                                        setEditingCounter(null);
                                      }
                                      if (e.key === "Escape") setEditingCounter(null);
                                    }}
                                    className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs focus:border-primary focus:outline-none"
                                  />
                                ) : (
                                  <div className="flex flex-col gap-0.5">
                                    <span
                                      className="cursor-pointer hover:text-primary hover:underline"
                                      title="Click pentru a edita RPM"
                                      onClick={() => {
                                        setEditingCounter({ keyId: row.keyId, modelId, counter: "rpm" });
                                        setCounterValue(String(row.rpm.used));
                                      }}
                                    >
                                      {row.rpm.used} / {fmtLimit(row.limits.rpm)}
                                    </span>
                                    <DiscoveredHint value={row.discovery?.rpmLimit} />
                                    {!compactView && (
                                      <MiniProgressBar used={row.rpm.used} limit={row.limits.rpm} />
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* TPM Column */}
                              <td className="px-3 py-2 font-mono">
                                {isEditingTPM ? (
                                  <input
                                    type="number"
                                    min={0}
                                    value={counterValue}
                                    autoFocus
                                    onChange={(e) => setCounterValue(e.target.value)}
                                    onBlur={() => {
                                      const val = parseInt(counterValue, 10);
                                      if (Number.isFinite(val)) handleSaveCounter(row, "tpm", val);
                                      setEditingCounter(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const val = parseInt(counterValue, 10);
                                        if (Number.isFinite(val)) handleSaveCounter(row, "tpm", val);
                                        setEditingCounter(null);
                                      }
                                      if (e.key === "Escape") setEditingCounter(null);
                                    }}
                                    className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs focus:border-primary focus:outline-none"
                                  />
                                ) : (
                                  <div className="flex flex-col gap-0.5">
                                    <span
                                      className="cursor-pointer hover:text-primary hover:underline"
                                      title="Click pentru a edita TPM"
                                      onClick={() => {
                                        setEditingCounter({ keyId: row.keyId, modelId, counter: "tpm" });
                                        setCounterValue(String(row.tpm.used));
                                      }}
                                    >
                                      {fmtTokens(row.tpm.used)} / {fmtTokens(row.limits.tpm)}
                                    </span>
                                    <DiscoveredHint value={row.discovery?.tpmLimit} />
                                    {!compactView && (
                                      <MiniProgressBar used={row.tpm.used} limit={row.limits.tpm} />
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* RPD Column */}
                              <td className="px-3 py-2 font-mono">
                                {isEditingRPD ? (
                                  <input
                                    type="number"
                                    min={0}
                                    value={counterValue}
                                    autoFocus
                                    onChange={(e) => setCounterValue(e.target.value)}
                                    onBlur={() => {
                                      const val = parseInt(counterValue, 10);
                                      if (Number.isFinite(val)) handleSaveCounter(row, "rpd", val);
                                      setEditingCounter(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const val = parseInt(counterValue, 10);
                                        if (Number.isFinite(val)) handleSaveCounter(row, "rpd", val);
                                        setEditingCounter(null);
                                      }
                                      if (e.key === "Escape") setEditingCounter(null);
                                    }}
                                    className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs focus:border-primary focus:outline-none"
                                  />
                                ) : (
                                  <div className="flex flex-col gap-0.5">
                                    <span
                                      className="cursor-pointer hover:text-primary hover:underline"
                                      title="Click pentru a edita RPD"
                                      onClick={() => {
                                        setEditingCounter({ keyId: row.keyId, modelId, counter: "rpd" });
                                        setCounterValue(String(row.rpd.used));
                                      }}
                                    >
                                      {row.rpd.used} / {fmtLimit(row.limits.rpd)}
                                    </span>
                                    <DiscoveredHint value={row.discovery?.rpdLimit} />
                                    {!compactView && (
                                      <MiniProgressBar used={row.rpd.used} limit={row.limits.rpd} />
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* 429 Column (real upstream 429 hits) */}
                              <td className="px-3 py-2 font-mono" title="Erori 429 reale de la upstream">
                                {(row.count429 || 0) > 0 ? (
                                  <span className="text-red-500 font-semibold">{row.count429}</span>
                                ) : (
                                  <span className="text-text-muted">0</span>
                                )}
                              </td>

                              {/* Last Check Column */}
                              <td className="px-3 py-2 font-mono text-[11px] text-text-muted whitespace-nowrap" title={row.lastCheck || "Fără activitate înregistrată"}>
                                {fmtLastCheck(row.lastCheck, currentTime)}
                              </td>

                              {/* Status Column */}
                              <td className="px-3 py-2">
                                <StatusBadge row={row} currentTime={currentTime} />
                              </td>

                              {/* Blocaj / Cooldown Column — lacătul deblocării manuale trăiește aici, nu la listarea cheii */}
                              <td className="px-3 py-2">
                                <CooldownBadge
                                  rateLimitedUntil={row.rateLimitedUntil}
                                  manualBlockUntil={row.manualBlockUntil}
                                  currentTime={currentTime}
                                  onUnblock429={() => handleUnblockKey(row, "unblock429")}
                                  onUnblockManual={() => handleUnblockKey(row, "unblockManual")}
                                />
                                {row.manualBlockUntil && row.manualBlockUntil > currentTime && onUnlockConnectionLocks && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnblockKey(row, "unblockManual")}
                                    className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                                    title={`Deblochează blocajul manual pentru modelul ${row.modelId}`}
                                  >
                                    <span className="material-symbols-outlined text-[11px]">lock_open</span>
                                    Deblochează
                                  </button>
                                )}
                              </td>

                              {/* Actions Column */}
                              <td className="px-3.5 py-2 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleTestKey(row)}
                                    disabled={testingKey === `${row.keyId}:${row.modelId}`}
                                    className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-50"
                                    title={`Testează modelul ${row.modelId} cu cheia ${row.connectionName}`}
                                  >
                                    <span className="material-symbols-outlined text-[15px]">
                                      {testingKey === `${row.keyId}:${row.modelId}` ? "progress_activity" : "science"}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCounter({ keyId: row.keyId, modelId, counter: "rpd" });
                                      setCounterValue(String(row.rpd.used));
                                    }}
                                    className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-main"
                                    title="Modifică RPD folosit"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleResetKey(row)}
                                    className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-main"
                                    title="Resetează toate contoarele conexiunii pentru acest model"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
