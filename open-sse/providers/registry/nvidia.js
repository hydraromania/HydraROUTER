export default {
  id: "nvidia",
  priority: 20,
  hasFree: true,
  alias: "nvidia",
  display: {
    name: "NVIDIA NIM",
    icon: "developer_board",
    color: "#76B900",
    textIcon: "NV",
    website: "https://developer.nvidia.com/nim",
    notice: {
      text: "Free access for NVIDIA Developer Program members (prototyping & testing).",
      apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey", "apikey+model"],
  // One API key unlocks every model on the same endpoint. When the requested
  // model is blocked/rate-limited, the router keeps trying the provider's other
  // LLM models on the same keys instead of burning every key on the blocked
  // model (each connection only carries a per-model lock).
  modelFallback: true,
  transport: {
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    validateUrl: "https://integrate.api.nvidia.com/v1/models",
  },
models: [
    { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "minimaxai/minimax-m3", name: "MiniMax M3" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "poolside/laguna-xs-2.1", name: "Poolside Laguna XS 2.1" },
    { id: "mistralai/mistral-large-3-675b-instruct-2512", name: "Mistral Large 3 675B Instruct 2512" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra" },
    { id: "google/gemma-4-31b-it", name: "Gemma 4 31B IT", thinking: true },
    { id: "stepfun-ai/step-3.7-flash", name: "Step 3.7 Flash", thinking: true },
    { id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", kind: "embedding" },
    { id: "nvidia/parakeet-ctc-1.1b-asr", name: "Parakeet CTC 1.1B", params: ["language"], kind: "stt" },
    { id: "fastpitch", name: "FastPitch", kind: "tts" },
    { id: "tacotron2", name: "Tacotron2", kind: "tts" },
  ],
  serviceKinds: ["llm","tts","embedding"],
  ttsConfig: {
    baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech",
    authType: "apikey",
    authHeader: "bearer",
    format: "nvidia-tts",
  },
  embeddingConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authType: "apikey", authHeader: "bearer" },
};
