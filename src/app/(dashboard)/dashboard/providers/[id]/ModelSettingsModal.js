"use client";
/* eslint-disable react-hooks/set-state-in-effect -- sync form when modal opens */

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Toggle, CapacityBadges } from "@/shared/components";
import { CAPACITY_META } from "@/shared/constants/models";

function fmtTokens(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 ? 1 : 0)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 ? 0 : 0)}k`;
  return `${v}`;
}

export default function ModelSettingsModal({ isOpen, onClose, modelId, fullModel, caps, thinkingLevels, isCustom, onSave }) {
  const [ctx, setCtx] = useState("");
  const [maxOut, setMaxOut] = useState("");
  const [localCaps, setLocalCaps] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCtx(caps?.contextWindow ? String(caps.contextWindow) : "");
      setMaxOut(caps?.maxOutput ? String(caps.maxOutput) : "");
      const init = {};
      for (const k of Object.keys(CAPACITY_META)) init[k] = !!caps?.[k];
      setLocalCaps(init);
    }
  }, [isOpen, caps]);

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      const merged = { ...localCaps };
      const cw = parseInt(ctx, 10);
      const mo = parseInt(maxOut, 10);
      if (Number.isFinite(cw) && cw > 0) merged.contextWindow = cw;
      if (Number.isFinite(mo) && mo > 0) merged.maxOutput = mo;
      await onSave(merged);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modelId || "Model settings"}>
      <div className="flex flex-col gap-4">
        {fullModel && (
          <code className="truncate rounded bg-sidebar px-2 py-1 font-mono text-xs text-text-muted">{fullModel}</code>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Context</p>
            <p className="text-lg font-semibold">{fmtTokens(caps?.contextWindow)}</p>
            <p className="text-[11px] text-text-muted">{caps?.contextWindow ? `${Number(caps.contextWindow).toLocaleString()} tokens` : "unknown"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Max output</p>
            <p className="text-lg font-semibold">{fmtTokens(caps?.maxOutput)}</p>
            <p className="text-[11px] text-text-muted">{caps?.maxOutput ? `${Number(caps.maxOutput).toLocaleString()} tokens` : "unknown"}</p>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium mb-1.5">Thinking</p>
          {thinkingLevels?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {thinkingLevels.map((l) => (
                <span key={l} className="rounded bg-sidebar px-2 py-0.5 font-mono text-xs text-text-muted">{l}</span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">{caps?.reasoning ? "Reasoning supported (no level list for this model)" : "No thinking / reasoning for this model"}</p>
          )}
        </div>
        <div>
          <p className="text-sm font-medium mb-1.5">Capabilities</p>
          {isCustom ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Context window</label>
                  <input type="number" min="0" value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder="e.g. 200000" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Max output</label>
                  <input type="number" min="0" value={maxOut} onChange={(e) => setMaxOut(e.target.value)} placeholder="e.g. 64000" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {Object.entries(CAPACITY_META).map(([key, meta]) => (
                  <Toggle key={key} checked={!!localCaps[key]} onChange={(v) => setLocalCaps((p) => ({ ...p, [key]: v }))} label={meta.label} description={meta.desc} size="sm" />
                ))}
              </div>
            </div>
          ) : (
            <CapacityBadges caps={caps} size={16} />
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Close</Button>
          {isCustom && onSave && (
            <Button onClick={handleSave} fullWidth size="sm" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

ModelSettingsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  modelId: PropTypes.string,
  fullModel: PropTypes.string,
  caps: PropTypes.object,
  thinkingLevels: PropTypes.arrayOf(PropTypes.string),
  isCustom: PropTypes.bool,
  onSave: PropTypes.func,
};
