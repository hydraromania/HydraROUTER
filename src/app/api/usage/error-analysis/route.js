import { NextResponse } from "next/server";
import { getLiveRequestsSnapshot } from "@/lib/liveRequestsTracker.js";
import { getRequestDetails } from "@/lib/db/repos/requestDetailsRepo.js";
import { diagnoseErrors } from "@/lib/errorAnalysis/diagnose.js";
import { buildFixPlan, FIX_ACTIONS } from "@/lib/errorAnalysis/applyFix.js";

/**
 * GET /api/usage/error-analysis
 * Aggregates error records from recent requestDetails and live tracker history,
 * diagnosing recurring 429 rate limit, 410 model gone, and incompatibility patterns.
 */
export async function GET() {
  try {
    const errorLogs = [];

    // 1. Gather from live tracker history
    const liveSnapshot = getLiveRequestsSnapshot();
    if (liveSnapshot && Array.isArray(liveSnapshot.history)) {
      for (const req of liveSnapshot.history) {
        if (req.status === "error" || (req.statusCode && req.statusCode >= 400)) {
          errorLogs.push({
            id: req.id,
            timestamp: req.timestamp,
            provider: req.provider,
            model: req.model,
            statusCode: req.statusCode,
            error: req.error || `HTTP ${req.statusCode}`,
          });
        }
      }
    }

    // 2. Gather recent error details from database
    try {
      const dbErrors = await getRequestDetails({
        status: "error",
        pageSize: 100,
      });
      if (dbErrors && Array.isArray(dbErrors.details)) {
        for (const req of dbErrors.details) {
          const status = req.response?.status || req.statusCode || 500;
          const errText = req.response?.data?.error?.message || req.response?.data?.error || req.error || `HTTP ${status}`;
          errorLogs.push({
            id: req.id,
            timestamp: req.timestamp,
            provider: req.provider,
            model: req.model,
            statusCode: status,
            error: errText,
          });
        }
      }
    } catch {
      // Non-blocking if requestDetails is empty or not enabled
    }

    const diagnosis = diagnoseErrors(errorLogs);

    // Mark patterns whose fix is already active so the UI persists "Aplicată" across refresh.
    try {
      const [{ getSettings }, { getDisabledModels }] = await Promise.all([
        import("@/lib/db/repos/settingsRepo.js"),
        import("@/lib/db/repos/disabledModelsRepo.js"),
      ]);
      const [{ PROVIDER_ID_TO_ALIAS }] = await Promise.all([
        import("open-sse/config/providerModels.js"),
      ]);
      const [settings, disabledMap] = await Promise.all([getSettings(), getDisabledModels()]);
      const disabledLists = Object.values(disabledMap || {});
      const isModelDisabled = (provider, model) => {
        if (!model || model === "unknown") return false;
        const alias = PROVIDER_ID_TO_ALIAS?.[provider] || provider;
        for (const key of new Set([provider, alias])) {
          if (Array.isArray(disabledMap?.[key]) && disabledMap[key].includes(model)) return true;
        }
        return disabledLists.some((ids) => Array.isArray(ids) && ids.includes(model));
      };
      const thinkingMode = (provider) => settings?.providerThinking?.[provider]?.mode;
      for (const pat of diagnosis.patterns || []) {
        const { type, provider, model } = pat;
        if (type === "rate_limit") pat.applied = !!(settings?.ratePacing?.[provider]?.enabled);
        else if (type === "model_gone") pat.applied = isModelDisabled(provider, model);
        else if (type === "thinking_unsupported") pat.applied = thinkingMode(provider) === "none" || thinkingMode(provider) === "off";
        else if (type === "tools_unsupported") pat.applied = !!settings?.toolStripProviders?.[provider];
        else if (type === "context_length_exceeded") pat.applied = settings?.rtkEnabled === true;
        else pat.applied = false;
      }
    } catch {
      // Non-blocking: applied flags stay false
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...diagnosis,
    });
  } catch (error) {
    console.error("[API ERROR] /api/usage/error-analysis failed:", error);
    return NextResponse.json({ error: "Failed to analyze error patterns" }, { status: 500 });
  }
}

/**
 * POST /api/usage/error-analysis
 * Body: { action, provider, model?, patternId? }
 * Applies the recommended fix for real: persists settings and/or disables the model.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, provider, model, patternId } = body || {};

    if (!action || !FIX_ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    if (!provider || typeof provider !== "string") {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }

    const { getSettings, updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const { resolveProviderAlias } = await import("open-sse/services/model.js");
    const { PROVIDER_ID_TO_ALIAS } = await import("open-sse/config/providerModels.js");
    const { getProviderAlias } = await import("@/shared/constants/providers.js");
    const { default: REGISTRY } = await import("open-sse/providers/registry/index.js");

    const providerId = resolveProviderAlias(provider) || provider;
    const thinkingOptions = REGISTRY.find((e) => e.id === providerId)?.thinkingConfig?.options || [];
    let storageAlias = PROVIDER_ID_TO_ALIAS?.[providerId] || providerId;
    try {
      const uiAlias = getProviderAlias(providerId);
      if (uiAlias && uiAlias !== providerId) storageAlias = uiAlias;
    } catch {
      // keep static alias
    }

    const settings = await getSettings();
    const plan = buildFixPlan({ action, provider: providerId, model, settings, providerAlias: storageAlias, thinkingOptions });
    if (!plan) {
      return NextResponse.json({ error: "Cannot build fix for this pattern" }, { status: 400 });
    }

    if (plan.settingsPatch) {
      await updateSettings(plan.settingsPatch);
    }
    if (plan.disable?.ids?.length) {
      const { disableModels } = await import("@/lib/db/repos/disabledModelsRepo.js");
      const keys = [...new Set([plan.disable.providerAlias, providerId, provider].filter(Boolean))];
      for (const key of keys) {
        await disableModels(key, plan.disable.ids);
      }
    }

    console.log(`[ErrorAnalysis] applied ${action} for ${providerId}/${model || "-"} (pattern ${patternId || "-"})`);
    return NextResponse.json({ success: true, message: plan.message, link: plan.link || null, patternId: patternId || null });
  } catch (error) {
    console.error("[API ERROR] /api/usage/error-analysis apply failed:", error);
    return NextResponse.json({ error: "Failed to apply fix" }, { status: 500 });
  }
}
