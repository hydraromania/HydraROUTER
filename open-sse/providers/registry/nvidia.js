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
  transport: {
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    validateUrl: "https://integrate.api.nvidia.com/v1/models",
  },
  models: [
    // ── Chat / LLM ──
    {
      id: "minimaxai/minimax-m2.7",
      name: "Minimax M2.7",
      defaults: { max_tokens: 16384, temperature: 1, top_p: 0.95, stream: true },
    },
    {
      id: "minimaxai/minimax-m3",
      name: "Minimax M3",
      defaults: { max_tokens: 16384, temperature: 1, top_p: 0.95, stream: true, chat_template_kwargs: { thinking_mode: "enabled" } },
    },
    {
      id: "google/diffusiongemma-26b-a4b-it",
      name: "DiffusionGemma 26B A4B IT",
      defaults: { max_tokens: 4096, temperature: 1, top_p: 0.95, stream: true, chat_template_kwargs: { enable_thinking: true } },
    },
    {
      id: "moonshotai/kimi-k2.6",
      name: "Kimi K2.6",
      defaults: { max_tokens: 16384, temperature: 1, top_p: 1, stream: true, chat_template_kwargs: { thinking: true } },
    },
    {
      id: "stepfun-ai/step-3.7-flash",
      name: "Step 3.7 Flash",
      defaults: { max_tokens: 16384, temperature: 1, top_p: 0.95, stream: true },
    },
    {
      id: "deepseek-ai/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      defaults: { max_tokens: 16384, temperature: 1, top_p: 0.95, stream: true, extra_body: { chat_template_kwargs: { thinking: true, reasoning_effort: "max" } } },
    },
    {
      id: "deepseek-ai/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      defaults: { max_tokens: 16384, temperature: 1, top_p: 0.95, stream: true, chat_template_kwargs: { thinking: true, reasoning_effort: "max" } },
    },
    {
      id: "mistralai/mistral-large-3-675b-instruct-2512",
      name: "Mistral Large 3 (675B)",
      defaults: { max_tokens: 7553, temperature: 0.15, top_p: 1, frequency_penalty: 0, presence_penalty: 0, stream: true },
    },
    { id: "z-ai/glm4.7", name: "GLM 4.7" },
    // ── Embedding ──
    { id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", kind: "embedding" },
    // ── STT ──
    { id: "nvidia/parakeet-ctc-1.1b-asr", name: "Parakeet CTC 1.1B", params: ["language"], kind: "stt" },
    // ── TTS ──
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
