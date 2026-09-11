import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  isModelAllowedForApiKey,
} from "../services/auth.js";
import { getSettings, getCombos } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { handleSearchCore } from "open-sse/handlers/search/index.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat, getComboModelsFromData } from "open-sse/services/combo.js";
import { saveRequestUsage, trackRequestStart, trackRequestEnd, trackRequestError } from "@/lib/usageDb.js";
import { checkAndRecordRateLimit, rateLimitTracker } from "open-sse/services/rateLimitTracker.js";

/**
 * Handle web search request for the SSE/Next.js server.
 * Provider IS the model (no model field). Mirrors handleEmbeddings auth + fallback flow.
 *
 * @param {Request} request
 */
export async function handleSearch(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("SEARCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  // Accept either `provider` or `model` (UI sends `model` since provider IS the model for webSearch)
  const providerInput = body.provider || body.model;
  const query = body.query;

  log.request("POST", `${url.pathname} | ${providerInput}`);

  // Log API key (masked)
  const apiKey = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!providerInput || typeof providerInput !== "string") {
    log.warn("SEARCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }

  if (apiKey) {
    const allowed = await isModelAllowedForApiKey(apiKey, providerInput);
    if (!allowed) {
      log.warn("AUTH", `API key does not have access to model '${providerInput}'`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `The model '${providerInput}' does not exist or you do not have access to it.`);
    }
  }

  if (!query || typeof query !== "string" || !query.trim()) {
    log.warn("SEARCH", "Missing query");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  }

  // Combo expansion: providerInput may be a combo name → run fallback/round-robin across providers
  const combos = await getCombos();
  const comboModels = getComboModelsFromData(providerInput, combos);
  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[providerInput]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("SEARCH", `Combo "${providerInput}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleProviderSearch(b, m, request, apiKey, settings),
      log,
      comboName: providerInput,
      comboStrategy,
      comboStickyLimit
    });
  }

  return handleSingleProviderSearch(body, providerInput, request, apiKey, settings);
}

async function handleSingleProviderSearch(body, providerInput, request, apiKey, settings) {
  const query = body.query;
  let parsedProvider = providerInput;
  let requestedModel = null;
  if (typeof providerInput === "string" && providerInput.includes("/")) {
    const slashIdx = providerInput.indexOf("/");
    parsedProvider = providerInput.slice(0, slashIdx);
    requestedModel = providerInput.slice(slashIdx + 1);
  }
  const providerId = resolveProviderId(parsedProvider);
  const resolvedProvider = AI_PROVIDERS[providerId];

  if (!resolvedProvider) {
    log.warn("SEARCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }

  const providerConfig = resolvedProvider.searchConfig;
  const supportsSearch = !!providerConfig || !!resolvedProvider.searchViaChat;

  if (!supportsSearch) {
    log.warn("SEARCH", "Provider does not support web search", { provider: providerId });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${providerId} does not support web search`);
  }

  if (providerInput !== providerId) {
    log.info("ROUTING", `${providerInput} → ${providerId}`);
  } else {
    log.info("ROUTING", `Provider: ${providerId}`);
  }

  // Sanitized body forwarded to core
  const coreBody = {
    query: query.trim(),
    provider: providerId,
    model: requestedModel || (body.model && !body.model.includes("/") ? body.model : null),
    max_results: body.max_results,
    search_type: body.search_type,
    country: body.country,
    language: body.language,
    time_range: body.time_range,
    offset: body.offset,
    domain_filter: body.domain_filter,
    content_options: body.content_options,
    provider_options: body.provider_options
  };

  // No-auth providers (e.g. searxng) bypass credential lookup
  if (resolvedProvider.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: null,
      log
    });
    if (result.success) return result.response;
    return result.response;
  }

  // Credential + fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  // Credential fallback: some search providers reuse the API key of a related
  // chat provider (e.g. ollama-search reuses the `ollama` chat key, zai-search
  // reuses the `glm` chat key). When the search provider has no own connection,
  // fall back to the linked provider's credentials.
  const fallbackProviderId = resolvedProvider.credentialFallback;

  // Lock scope for this handler. Without it markAccountUnavailable would write
  // an account-wide `__all` lock, which on the credentialFallback path takes
  // the shared chat key (e.g. glm) offline for chat as well. Must be passed to
  // getProviderCredentials too, so the lock is read back under the same key.
  // For chat-search the lock is per chain model (`websearch:gemini/<model>`) so
  // a spent model doesn't block the fallback models on the same account.
  const searchLockKeyFor = (chainModel) =>
    chainModel ? `websearch:${providerId}/${chainModel}` : `websearch:${providerId}`;

  // searchViaChat model chain: requested (or default) first, then registry
  // fallbackModels. A quota-exhausted model on one account tries the next model
  // on the next account — and when all accounts are spent on model N, the chain
  // moves to N+1 across all accounts again.
  const isChatSearch = !providerConfig && !!resolvedProvider.searchViaChat;
  const primaryModel = requestedModel || resolvedProvider.searchViaChat?.defaultModel || null;
  const modelChain = isChatSearch && primaryModel
    ? [primaryModel, ...((resolvedProvider.searchViaChat?.fallbackModels || []).filter((m) => m && m !== primaryModel))]
    : [null];
  // Connections already proven spent for the current chain model (per model pass)
  let spentForModel = new Set();
  let chainIdx = 0;

  while (true) {
    const chainModel = modelChain[chainIdx] ?? null;
    // Provider that actually owns the connection in use — differs from
    // providerId once we fall back, and error locks must be attributed to it.
    let credentialProviderId = providerId;
    const searchLockKey = searchLockKeyFor(chainModel);
    const excludeForLookup = new Set([...excludeConnectionIds, ...spentForModel]);
    let credentials = await getProviderCredentials(providerId, excludeForLookup, searchLockKey);

    // Fall back to the related chat provider's credentials when this search
    // provider has none of its own (one key, chat + search).
    if (!credentials && fallbackProviderId) {
      credentials = await getProviderCredentials(fallbackProviderId, excludeForLookup, searchLockKey);
      if (credentials) {
        credentialProviderId = fallbackProviderId;
        log.info("AUTH", `\x1b[32m${providerId} reusing ${fallbackProviderId} credentials\x1b[0m`);
      }
    }

    // All accounts spent for this chain model → advance to the next model, if any
    if ((!credentials || credentials.allRateLimited) && isChatSearch && chainModel && chainIdx < modelChain.length - 1) {
      log.warn("SEARCH", `[${providerId}/${chainModel}] all accounts exhausted, trying ${modelChain[chainIdx + 1]}`);
      chainIdx += 1;
      spentForModel = new Set();
      continue;
    }

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SEARCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${providerId}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0 && spentForModel.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("SEARCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);

    // RPD accounting per effective chat-search model (spent key → next account)
    let rpdModel = null;
    if (isChatSearch && chainModel) {
      rpdModel = chainModel;
      const rateLimitCheck = await checkAndRecordRateLimit(credentials.connectionId, `${providerId}/${chainModel}`, 0);
      if (!rateLimitCheck.allowed) {
        log.warn("RATE_LIMIT", `Key ${credentials.connectionName} rate limited for ${providerId}/${chainModel}: ${rateLimitCheck.message}`);
        spentForModel.add(credentials.connectionId);
        excludeConnectionIds.add(credentials.connectionId);
        lastError = rateLimitCheck.message;
        lastStatus = HTTP_STATUS.TOO_MANY_REQUESTS;
        continue;
      }
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || null;
    const isAutoProxy = credentials?.providerSpecificData?.proxyPoolAuto || false;
    const activeProxyUrl = credentials?.providerSpecificData?.vercelRelayUrl || (credentials?.providerSpecificData?.connectionProxyEnabled ? credentials?.providerSpecificData?.connectionProxyUrl : "");
    const proxyTracking = activeProxyUrl ? {
      url: activeProxyUrl,
      poolId,
      type: credentials?.providerSpecificData?.vercelRelayUrl ? "relay" : "proxy",
      isAuto: isAutoProxy,
    } : null;

    const liveReqId = trackRequestStart({
      model: rpdModel ? `${providerId}/${rpdModel}` : providerId,
      provider: providerId,
      type: "search",
      endpoint: "/v1/search",
      apiKey,
      connectionId: credentials.connectionId,
      accountName: credentials.connectionName,
      proxy: proxyTracking,
    });

    const chainBody = chainModel
      ? { ...coreBody, model: chainModel }
      : coreBody;

    const result = await handleSearchCore({
      body: chainBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials);
      }
    });

    if (result.success) {
      // RPD counts only successful responses, on the model actually billed
      // (chatSearch may have fallen back internally: result.usedModel wins)
      const successModel = result.usedModel || rpdModel;
      if (successModel) {
        await rateLimitTracker.recordSuccess(credentials.connectionId, successModel, providerId);
      }
      trackRequestEnd(liveReqId, { statusCode: 200, status: "completed" });
      saveRequestUsage({
        provider: providerId,
        model: successModel ? `${providerId}/${successModel}` : providerId,
        connectionId: credentials.connectionId,
        apiKey,
        endpoint: "/v1/search",
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        status: "success",
      }).catch(() => {});
      return result.response;
    }

    trackRequestError(liveReqId, { error: result.error, statusCode: result.status });

    // Upstream 429 on the billed model → local RPD/CD cooldown so the key is
    // skipped for this model without waiting for the next failure
    if (result.status === 429 && rpdModel) {
      await rateLimitTracker.recordRateLimitHit(credentials.connectionId, rpdModel, providerId);
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, credentialProviderId, searchLockKey);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      if (chainModel) spentForModel.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
