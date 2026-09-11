"use client";

import { useState, useEffect } from "react";
import { Card, Button } from "@/shared/components";

function formatTimeRemaining(ms) {
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
}

export default function BlockedModelsTab() {
  const [blockedModels, setBlockedModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState(new Set());
  const [error, setError] = useState(null);

  const fetchBlockedModels = async () => {
    try {
      setError(null);
      const res = await fetch("/api/usage/blocked-models", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setBlockedModels(data.blockedModels || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnblock = async (model) => {
    if (unblocking.has(model)) return;
    const nextUnblocking = new Set(unblocking);
    nextUnblocking.add(model);
    setUnblocking(nextUnblocking);
    try {
      const res = await fetch("/api/usage/blocked-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unblock", model }),
      });
      if (res.ok) {
        fetchBlockedModels();
      } else {
        setError(`Failed to unblock ${model}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      const nextUnblocking2 = new Set(unblocking);
      nextUnblocking2.delete(model);
      setUnblocking(nextUnblocking2);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Clear all model blocks? This will unblock all models immediately.")) return;
    try {
      const res = await fetch("/api/usage/blocked-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearAll" }),
      });
      if (res.ok) {
        fetchBlockedModels();
      } else {
        setError("Failed to clear all blocks");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchBlockedModels();
    const interval = setInterval(fetchBlockedModels, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card className="p-6 text-center">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-surface-2 rounded w-1/4 mx-auto" />
          <div className="h-4 bg-surface-2 rounded w-1/2 mx-auto" />
          <div className="h-4 bg-surface-2 rounded w-1/3 mx-auto" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 text-center text-red-400">
        <p>Error: {error}</p>
        <Button onClick={fetchBlockedModels} className="mt-2">
          Retry
        </Button>
      </Card>
    );
  }

  if (blockedModels.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="text-4xl mb-3">✅</div>
        <h3 className="text-lg font-semibold text-text-main mb-1">No Blocked Models</h3>
        <p className="text-text-muted">All models are operating normally. Models are blocked after 3 consecutive timeouts/503/504 errors across different keys.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Blocked Models ({blockedModels.length})</h2>
        <Button variant="outline" icon="delete_sweep" onClick={handleClearAll} className="text-red-400 hover:bg-red-500/10">
          Clear All Blocks
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-text-muted">
                <th className="p-3 font-medium">Model</th>
                <th className="p-3 font-medium">Failures</th>
                <th className="p-3 font-medium">Blocked Until</th>
                <th className="p-3 font-medium">Time Remaining</th>
                <th className="p-3 font-medium">Last Error</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {blockedModels.map((item) => (
                <tr key={item.model} className="border-b border-border-subtle/50 hover:bg-surface-2/50">
                  <td className="p-3 font-mono text-text-main">{item.model}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-medium">
                      {item.failureCount} / 3
                    </span>
                  </td>
                  <td className="p-3 text-text-muted">{formatTimestamp(item.blockedUntil)}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs font-medium">
                      {formatTimeRemaining(item.remainingMs)}
                    </span>
                  </td>
                  <td className="p-3 text-text-muted">{formatTimestamp(item.lastErrorTime)}</td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      icon="unlock"
                      onClick={() => handleUnblock(item.model)}
                      disabled={unblocking.has(item.model)}
                      className="text-green-400 hover:bg-green-500/10"
                    >
                      {unblocking.has(item.model) ? "..." : "Unblock"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 bg-surface-2/50 border-border-subtle">
        <p className="text-sm text-text-muted">
          <strong>How it works:</strong> Models are automatically blocked for 24 hours after 3 consecutive timeouts/503/504 errors
          across different API keys. This prevents repeated failures from the same model. Use "Unblock" to manually
          restore a model immediately, or wait for the automatic expiry.
        </p>
      </Card>
    </div>
  );
}