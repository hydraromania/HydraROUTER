import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getApiKeyByKey } from "@/lib/localDb";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

function extractGeminiApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) return googleApiKey;
  try {
    const url = new URL(request.url);
    return url.searchParams.get("key");
  } catch {
    return null;
  }
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    let allowedSet = null;
    const apiKey = extractGeminiApiKey(request);
    if (apiKey) {
      const keyRecord = await getApiKeyByKey(apiKey);
      if (keyRecord && Array.isArray(keyRecord.allowedModels) && keyRecord.allowedModels.length > 0) {
        allowedSet = new Set(keyRecord.allowedModels);
      }
    }

    const models = [];
    const seen = new Set();

    function addModel({ name, displayName, description, methods = ["generateContent"], fullModelId = null }) {
      if (seen.has(name)) return;
      if (allowedSet) {
        const checkId = fullModelId || name.replace(/^models\//, "");
        if (!allowedSet.has(checkId)) return;
      }
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          fullModelId: `${provider}/${model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
            fullModelId: model.id,
          });
        }
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}

