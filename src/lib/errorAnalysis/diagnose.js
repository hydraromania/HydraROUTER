/**
 * Error analysis and diagnostic engine for 429, 410, and recurring parameter/tool incompatibilities.
 */

export function diagnoseErrors(logs = []) {
  const summary = {
    totalErrors: 0,
    total429: 0,
    total410: 0,
    byProvider: {},
    byModel: {},
  };

  const patternMap = new Map();

  for (const item of logs) {
    if (!item) continue;
    summary.totalErrors++;

    const status = Number(item.statusCode) || 0;
    if (status === 429) summary.total429++;
    if (status === 410) summary.total410++;

    const provider = item.provider || "unknown";
    const model = item.model || "unknown";
    const errorStr = (typeof item.error === "string" ? item.error : (item.error?.message || JSON.stringify(item.error || ""))).toLowerCase();

    summary.byProvider[provider] = (summary.byProvider[provider] || 0) + 1;
    summary.byModel[model] = (summary.byModel[model] || 0) + 1;

    // Pattern A: 429 Rate Limiting
    if (status === 429 || errorStr.includes("rate limit") || errorStr.includes("resource_exhausted") || errorStr.includes("quota exceeded")) {
      const key = `rate_limit:${provider}:${model}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, {
          id: key,
          type: "rate_limit",
          severity: "high",
          provider,
          model,
          count: 0,
          title: `Limită de rată depășită (429 / Quota Exceeded) pe ${provider}`,
          description: `Cereri frecvente către ${model} (${provider}) primesc 429. Se recomandă activarea rate-pacing-ului, rotația conexiunilor sau fallback în combo.`,
          recommendation: {
            action: "enable_pacing",
            label: "Activează Rate-Pacing (1 req/sec) & Combo Fallback",
            provider,
            model,
          },
          samples: [],
        });
      }
      const entry = patternMap.get(key);
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(item.error || "429 Too Many Requests");
    }

    // Pattern B: 410 Model Gone / Retired
    if (status === 410 || errorStr.includes("shut down") || errorStr.includes("no longer available") || errorStr.includes("model retired") || errorStr.includes("deprecated")) {
      const key = `model_gone:${provider}:${model}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, {
          id: key,
          type: "model_gone",
          severity: "critical",
          provider,
          model,
          count: 0,
          title: `Model indisponibil / retras definitiv (410 Gone) pe ${provider}`,
          description: `Modelul ${model} nu mai este servit de API-ul ${provider}. Cererile vor eșua continuu dacă nu este înlocuit.`,
          recommendation: {
            action: "replace_model",
            label: `Dezactivează ${model} sau redirecționează către alias nou`,
            provider,
            model,
          },
          samples: [],
        });
      }
      const entry = patternMap.get(key);
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(item.error || "410 Model Gone");
    }

    // Pattern C: Thinking / Reasoning unsupported
    if (errorStr.includes("thinking") && (errorStr.includes("not supported") || errorStr.includes("unsupported") || errorStr.includes("budget"))) {
      const key = `thinking_unsupported:${provider}:${model}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, {
          id: key,
          type: "thinking_unsupported",
          severity: "medium",
          provider,
          model,
          count: 0,
          title: `Parametru de Thinking / Reasoning respins pe ${provider}`,
          description: `Upstream-ul respinge cererea deoarece modulul de gândire (thinking) nu este suportat pentru acest model/tier.`,
          recommendation: {
            action: "disable_thinking",
            label: "Dezactivează parametrul de thinking pentru acest provider",
            provider,
            model,
          },
          samples: [],
        });
      }
      const entry = patternMap.get(key);
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(item.error || "Thinking unsupported");
    }

    // Pattern D: Tools / Function calling unsupported
    if ((errorStr.includes("tool") || errorStr.includes("function call")) && (errorStr.includes("not supported") || errorStr.includes("unsupported") || errorStr.includes("free tier") || errorStr.includes("schema"))) {
      const key = `tools_unsupported:${provider}:${model}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, {
          id: key,
          type: "tools_unsupported",
          severity: "medium",
          provider,
          model,
          count: 0,
          title: `Unelte (Tools / Function Calling) incompatibile pe ${provider}`,
          description: `Tier-ul gratuit sau modelul respinge apelurile de tip tools. Se recomandă strip-tools sau rutarea la un model compatibil.`,
          recommendation: {
            action: "drop_tools",
            label: "Curăță uneltele din prompt (Drop Tools) pentru acest tier",
            provider,
            model,
          },
          samples: [],
        });
      }
      const entry = patternMap.get(key);
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(item.error || "Tools unsupported");
    }
  }

  const patterns = Array.from(patternMap.values()).sort((a, b) => b.count - a.count);

  return {
    summary,
    patterns,
  };
}
