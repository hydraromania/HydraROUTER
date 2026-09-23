import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";
import { getRateLimitsForProvider } from "@/lib/db/index.js";
import { rateLimitTracker } from "open-sse/services/rateLimitTracker.js";
import { getModelRateLimits, hasRateLimitConfig, getRpdResetTime, getConfiguredModelsForProvider, setModelLimitOverrides, DEFAULT_RESET_TZ } from "open-sse/config/modelRateLimits.js";
import { getBlockedModels, unblockModel } from "open-sse/services/combo.js";
import { getDisabledByProvider } from "@/lib/disabledModelsDb";

export const dynamic = "force-dynamic";

// Rehydrate runtime overrides from persisted settings
async function rehydrateOverrides() {
  const settings = await getSettings();
  const saved = settings.rateLimitOverrides || {};
  setModelLimitOverrides(saved);
  return saved;
}

// Registry-configured models + any model with live (unexpired) tracked usage.
// Without the DB union, traffic on models without explicit registry limits
// (e.g. gemini-2.5-flash / gemini-2.5-pro) is tracked but never shown, so the
// table looks stuck at 0 for every visible row.
async function getVisibleModelIds(providerId) {
  const configured = getConfiguredModelsForProvider(providerId);
  try {
    const rows = await getRateLimitsForProvider(providerId);
    const now = Date.now();
    const live = new Set();
    for (const row of rows || []) {
      if (!row?.modelId) continue;
      const hasLiveRpd = (row.rpdCount || 0) > 0 && (row.rpdResetAt || 0) > now;
      const hasLiveRpm = (row.rpmCount || 0) > 0 && (row.rpmResetAt || 0) > now;
      const hasLiveTpm = (row.tpmCount || 0) > 0 && (row.tpmResetAt || 0) > now;
      const coolingDown = (row.rateLimitedUntil || 0) > now;
      if (hasLiveRpd || hasLiveRpm || hasLiveTpm || coolingDown) live.add(row.modelId);
    }
    return [...new Set([...configured, ...live])];
  } catch {
    return configured;
  }
}

export async function GET(request) {
  try {
    const savedOverrides = await rehydrateOverrides();
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider");
    const modelId = searchParams.get("model");

    if (!providerId) {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }

    if (!hasRateLimitConfig(providerId)) {
      return NextResponse.json({ provider: providerId, hasConfig: false, rows: [], blockedModels: [] });
    }

    const connections = await getProviderConnections();
    const providerConnections = connections
      .filter((c) => c.provider === providerId)
      // Mask: never expose full API keys — connectionName is a display label only.
      .map((c) => ({ id: c.id, name: c.name || `cheie ${String(c.id).slice(0, 4)}••••`, isActive: c.isActive }));

    const modelIds = modelId ? [modelId] : await getVisibleModelIds(providerId);

    // Filter out disabled models
    const disabledModelIds = await getDisabledByProvider(providerId);
    const activeModelIds = modelIds.filter((m) => !disabledModelIds.includes(m));

    // One row per model x connection, tracker data merged in (0 usage when untouched)
    const rows = [];
    for (const mId of activeModelIds) {
      const trackerRows = await rateLimitTracker.getAllKeysUsage(mId, providerId);
      const byKey = new Map(trackerRows.map((r) => [r.keyId, r]));
      const limits = getModelRateLimits(providerId, mId);
      const nextRpdReset = getRpdResetTime(limits.rpdResetHour, limits.resetTz);
      const timeoutSec = limits.timeoutMs ? Math.round(limits.timeoutMs / 1000) : null;

      for (const conn of providerConnections) {
        const t = byKey.get(conn.id);
        rows.push({
          keyId: conn.id,
          connectionName: conn.name || conn.id,
          isActive: conn.isActive,
          modelId: mId,
          limits: {
            rpm: limits.rpm,
            tpm: limits.tpm,
            rpd: limits.rpd,
            timeoutSec,
            rpdResetHour: limits.rpdResetHour,
            resetTz: limits.resetTz || DEFAULT_RESET_TZ,
          },
          rpdResetHour: limits.rpdResetHour,
          resetTz: limits.resetTz || DEFAULT_RESET_TZ,
          nextRpdReset: nextRpdReset.toISOString(),
          rpm: t?.rpm ?? { used: 0, limit: limits.rpm, remaining: limits.rpm },
          tpm: t?.tpm ?? { used: 0, limit: limits.tpm, remaining: limits.tpm },
          rpd: t?.rpd ?? { used: 0, limit: limits.rpd, remaining: limits.rpd },
          rateLimitedUntil: t?.rateLimitedUntil || 0,
          manualBlockUntil: t?.manualBlockUntil || 0,
          count429: t?.count429 || 0,
          lastCheck: t?.updatedAt || null,
          discovery: t?.discovery || null,
        });
      }
    }

    // Blocked combo models for this provider (from 503/504 errors)
    const allBlocked = getBlockedModels();
    const prefix = `${providerId}/`;
    const blockedModels = allBlocked.filter((b) => b.model.startsWith(prefix) || b.model === providerId);

    // Provider-level defaults
    const providerOverride = savedOverrides[`${providerId}/*`] || {};
    const sampleLimits = modelIds[0] ? getModelRateLimits(providerId, modelIds[0]) : null;

    return NextResponse.json({
      provider: providerId,
      hasConfig: true,
      providerDefaults: {
        rpdResetHour: providerOverride.rpdResetHour ?? sampleLimits?.rpdResetHour ?? 0,
        resetTz: providerOverride.resetTz ?? sampleLimits?.resetTz ?? DEFAULT_RESET_TZ,
        timeoutSec: providerOverride.timeout ?? (sampleLimits?.timeoutMs ? Math.round(sampleLimits.timeoutMs / 1000) : null),
      },
      rows,
      blockedModels,
      overrides: savedOverrides,
    });
  } catch (error) {
    console.log("Error fetching rate limits:", error);
    return NextResponse.json({ error: "Failed to fetch rate limits" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, model, keyId, action, value, limits } = body;

    if (!provider || !action) {
      return NextResponse.json({ error: "Provider and action are required" }, { status: 400 });
    }

    // 1. Set model limits override (RPM, TPM, RPD, timeout, rpdResetHour, resetTz)
    if (action === "setLimits") {
      if (!model || !limits || typeof limits !== "object") {
        return NextResponse.json({ error: "Model and limits object are required" }, { status: 400 });
      }

      const settings = await getSettings();
      const currentOverrides = settings.rateLimitOverrides || {};
      const overrideKey = model === "*" ? `${provider}/*` : `${provider}/${model}`;

      const cleaned = {};
      if (limits.rpm !== undefined && limits.rpm !== null && limits.rpm !== "") cleaned.rpm = Number(limits.rpm);
      if (limits.tpm !== undefined && limits.tpm !== null && limits.tpm !== "") cleaned.tpm = Number(limits.tpm);
      if (limits.rpd !== undefined && limits.rpd !== null && limits.rpd !== "") cleaned.rpd = Number(limits.rpd);
      if (limits.timeout !== undefined && limits.timeout !== null && limits.timeout !== "") cleaned.timeout = Number(limits.timeout);
      if (limits.rpdResetHour !== undefined && limits.rpdResetHour !== null && limits.rpdResetHour !== "") cleaned.rpdResetHour = Number(limits.rpdResetHour);
      if (limits.resetTz) cleaned.resetTz = String(limits.resetTz);

      const updatedOverrides = { ...currentOverrides, [overrideKey]: cleaned };
      await updateSettings({ rateLimitOverrides: updatedOverrides });
      setModelLimitOverrides(updatedOverrides);

      return NextResponse.json({ success: true, overrides: updatedOverrides });
    }

    // 2. Set provider-level defaults (e.g. reset hour, timezone, default timeout)
    if (action === "setProviderDefaults") {
      const settings = await getSettings();
      const currentOverrides = settings.rateLimitOverrides || {};
      const overrideKey = `${provider}/*`;
      const existing = currentOverrides[overrideKey] || {};

      const updated = { ...existing };
      if (limits?.rpdResetHour !== undefined) updated.rpdResetHour = Number(limits.rpdResetHour);
      if (limits?.resetTz !== undefined) updated.resetTz = String(limits.resetTz);
      if (limits?.timeout !== undefined) updated.timeout = limits.timeout ? Number(limits.timeout) : undefined;

      const updatedOverrides = { ...currentOverrides, [overrideKey]: updated };
      await updateSettings({ rateLimitOverrides: updatedOverrides });
      setModelLimitOverrides(updatedOverrides);

      return NextResponse.json({ success: true, overrides: updatedOverrides });
    }

    // 3. Clear model limits override (reset to registry defaults)
    if (action === "clearLimits") {
      if (!model) return NextResponse.json({ error: "Model is required" }, { status: 400 });
      const settings = await getSettings();
      const currentOverrides = { ...(settings.rateLimitOverrides || {}) };
      delete currentOverrides[`${provider}/${model}`];
      await updateSettings({ rateLimitOverrides: currentOverrides });
      setModelLimitOverrides(currentOverrides);
      return NextResponse.json({ success: true });
    }

    // 4. Set counter value (RPM, TPM, or RPD)
    if (action === "setCounter" || action === "setRpd") {
      if (!keyId || !model) {
        return NextResponse.json({ error: "KeyId and model are required" }, { status: 400 });
      }
      const val = Number(value);
      if (!Number.isFinite(val) || val < 0) {
        return NextResponse.json({ error: "Value must be a number >= 0" }, { status: 400 });
      }

      const counter = body.counter || (action === "setRpd" ? "rpd" : "rpd");
      if (counter === "rpm") await rateLimitTracker.setRpmCount(keyId, model, provider, val);
      else if (counter === "tpm") await rateLimitTracker.setTpmCount(keyId, model, provider, val);
      else await rateLimitTracker.setRpdCount(keyId, model, provider, val);

      return NextResponse.json({ success: true });
    }

    // 5. Unblock 429 cooldown or manual block for a key & model
    if (action === "unblock429") {
      if (!keyId || !model) {
        return NextResponse.json({ error: "KeyId and model are required" }, { status: 400 });
      }
      await rateLimitTracker.clearCooldown(keyId, model, provider);
      return NextResponse.json({ success: true });
    }

    if (action === "unblockManual") {
      if (!keyId || !model) {
        return NextResponse.json({ error: "KeyId and model are required" }, { status: 400 });
      }
      await rateLimitTracker.clearManualBlock(keyId, model, provider);
      return NextResponse.json({ success: true });
    }

    // 6. Unblock combo-level blocked model (503/504 errors)
    if (action === "unblockCombo") {
      const fullModelStr = model.includes("/") ? model : `${provider}/${model}`;
      const success = unblockModel(fullModelStr);
      return NextResponse.json({ success, message: success ? "Model unblocked" : "Model was not blocked" });
    }

    // 6b. Block or Unblock all keys for a specific model (manual admin override)
    if (action === "blockAllModel" || action === "unblockAllModel") {
      if (!model) return NextResponse.json({ error: "Model is required" }, { status: 400 });

      const conns = await getProviderConnections();
      const providerConns = conns.filter(c => c.provider === provider);

      for (const conn of providerConns) {
        if (action === "blockAllModel") {
          // Block all connections for this provider so no requests route to this model
          await rateLimitTracker.recordManualBlock(conn.id, model, provider);
        } else {
          // Unblock clears every row (active or not) so no stale block survives.
          await rateLimitTracker.clearManualBlock(conn.id, model, provider);
          // Also clear any 429 cooldown so "unblock all" completely frees the model
          await rateLimitTracker.clearCooldown(conn.id, model, provider);
        }
      }
      return NextResponse.json({ success: true, count: providerConns.length });
    }

    // 7. Reset all counters for a key & model
    if (action === "reset") {
      if (!keyId || !model) {
        return NextResponse.json({ error: "KeyId and model are required" }, { status: 400 });
      }
      await rateLimitTracker.resetLimits(keyId, model, provider);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.log("Error updating rate limits:", error);
    return NextResponse.json({ error: "Failed to update rate limits" }, { status: 500 });
  }
}
