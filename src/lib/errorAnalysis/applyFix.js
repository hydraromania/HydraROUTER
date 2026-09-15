export const FIX_ACTIONS = [
  "enable_pacing",
  "replace_model",
  "disable_thinking",
  "drop_tools",
  "enable_rtk",
  "inspect_request",
];

export function buildFixPlan({ action, provider, model, settings = {}, providerAlias, thinkingOptions = [] }) {
  if (!FIX_ACTIONS.includes(action)) return null;
  if (!provider || typeof provider !== "string") return null;

  switch (action) {
    case "enable_pacing": {
      const ratePacing = {
        ...(settings.ratePacing || {}),
        [provider]: { enabled: true, minIntervalMs: 1000 },
      };
      const strategies = { ...(settings.providerStrategies || {}) };
      const current = { ...(strategies[provider] || {}) };
      if (!current.fallbackStrategy) current.fallbackStrategy = "round-robin";
      strategies[provider] = current;
      return {
        settingsPatch: { ratePacing, providerStrategies: strategies },
        message: `Rate-pacing 1 req/sec activat + rotatie conturi (round-robin) pe ${provider}.`,
      };
    }

    case "replace_model": {
      if (!model || model === "unknown") return null;
      return {
        settingsPatch: null,
        disable: { providerAlias: providerAlias || provider, ids: [model] },
        message: `Modelul ${model} a fost dezactivat si nu va mai fi oferit pe ${providerAlias || provider}.`,
      };
    }

    case "disable_thinking": {
      const mode = thinkingOptions.includes("off") ? "off" : "none";
      const providerThinking = {
        ...(settings.providerThinking || {}),
        [provider]: { mode },
      };
      return {
        settingsPatch: { providerThinking },
        message: `Thinking dezactivat (mode: ${mode}) pe ${provider}.`,
      };
    }

    case "drop_tools": {
      const toolStripProviders = {
        ...(settings.toolStripProviders || {}),
        [provider]: true,
      };
      return {
        settingsPatch: { toolStripProviders },
        message: `Uneltele (tools) vor fi eliminate din cererile catre ${provider}.`,
      };
    }

    case "enable_rtk":
      return {
        settingsPatch: { rtkEnabled: true },
        message: "RTK Token Saver activat global (compresie tool_result + trunchiere istoric).",
      };

    case "inspect_request":
      return {
        settingsPatch: null,
        message: "Verifica payload-ul in tab-ul Live / Console Log si normalizeaza parametrii (temperature, top_p, schema).",
        link: "/dashboard/usage?tab=live",
      };

    default:
      return null;
  }
}
