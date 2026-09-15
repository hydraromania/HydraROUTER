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
  authModes: ["apikey"],
  thinkingConfig: {
    options: ["auto", "none", "low", "medium", "high", "max"],
    defaultMode: "auto",
  },
  // RPD counters reset at 00:00 Europe for nvidia models
  rateLimits: { rpdResetHour: 0 },
  transport: {
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    validateUrl: "https://integrate.api.nvidia.com/v1/models",
  },
  models: [
    { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B", contextLength: 1048576 },
    { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super 120B", contextLength: 1048576 },
    { id: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "Nemotron 3.5 Lightning 30B", contextLength: 1048576 },
    { id: "deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", contextLength: 1048576 },
    { id: "moonshotai/kimi-k3", name: "Kimi K3", contextLength: 1048576 },
    { id: "poolside/laguna-xs-2.1", name: "Laguna XS 2.1", contextLength: 262144 },
    { id: "google/gemma-4-31b-it", name: "Gemma 4 31B IT", contextLength: 262144 },
    { id: "nvidia/nemotron-3-embed-1b", name: "Nemotron 3 Embed 1B", dimensions: 2048, kind: "embedding", contextLength: 32768 },
  ],
  serviceKinds: ["llm","embedding"],
  embeddingConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authType: "apikey", authHeader: "bearer" },
};
