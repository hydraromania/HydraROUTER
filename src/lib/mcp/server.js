// MCP Server for 9router - exposes the gateway as MCP tools
// Tools: providers, combos, quota, usage, settings, routing, logs, etc.

import { z } from "zod";
import { getProviderConnections, addProviderConnection, updateProviderConnection, deleteProviderConnection, testProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { getCombos, addCombo as addComboDb, updateCombo as updateComboDb, deleteCombo as deleteComboDb } from "@/lib/db/repos/combosRepo.js";
import { getSettings, patchSetting } from "@/lib/localDb.js";
import { getUsageHistory, getUsageStats } from "@/lib/usageDb.js";
import { getRequestDetails } from "@/lib/db/repos/requestDetailsRepo.js";
import { REGISTRY } from "open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { getModelInfo } from "@/sse/services/model.js";

// Tool schemas
const ToolSchemas = {
  // Provider tools
  list_providers: z.object({}).describe("List all configured provider connections"),
  add_provider: z.object({
    provider: z.string().describe("Provider ID (e.g., 'openai', 'anthropic', 'kiro', 'glm')"),
    name: z.string().optional().describe("Custom name for this connection"),
    authMode: z.enum(["apikey", "oauth", "apikey+model"]).describe("Authentication mode"),
    apiKey: z.string().optional().describe("API key (for apikey mode)"),
    oauthToken: z.string().optional().describe("OAuth token (for oauth mode)"),
    extra: z.record(z.string()).optional().describe("Extra provider-specific fields"),
  }).describe("Add a new provider connection"),
  update_provider: z.object({
    id: z.string().describe("Connection ID"),
    name: z.string().optional(),
    apiKey: z.string().optional(),
    oauthToken: z.string().optional(),
    extra: z.record(z.string()).optional(),
    enabled: z.boolean().optional(),
  }).describe("Update a provider connection"),
  delete_provider: z.object({
    id: z.string().describe("Connection ID"),
  }).describe("Delete a provider connection"),
  test_provider: z.object({
    id: z.string().describe("Connection ID"),
  }).describe("Test a provider connection (health check)"),
  get_provider_models: z.object({
    provider: z.string().describe("Provider ID or alias"),
  }).describe("Get available models for a provider"),

  // Combo tools
  list_combos: z.object({}).describe("List all model combos"),
  add_combo: z.object({
    name: z.string().describe("Combo name"),
    models: z.array(z.string()).describe("Array of model IDs in fallback order"),
    strategy: z.enum(["priority", "round-robin", "fusion"]).default("priority").describe("Routing strategy"),
    fusionTuning: z.object({}).optional().describe("Fusion strategy tuning parameters"),
  }).describe("Create a new model combo"),
  update_combo: z.object({
    id: z.string().describe("Combo ID"),
    name: z.string().optional(),
    models: z.array(z.string()).optional(),
    strategy: z.enum(["priority", "round-robin", "fusion"]).optional(),
    fusionTuning: z.object({}).optional(),
  }).describe("Update a combo"),
  delete_combo: z.object({
    id: z.string().describe("Combo ID"),
  }).describe("Delete a combo"),

  // Quota & Usage tools
  get_quota: z.object({
    provider: z.string().optional().describe("Filter by provider"),
  }).describe("Get current quota status for all/all providers"),
  get_usage_history: z.object({
    days: z.number().default(30).describe("Number of days of history"),
    provider: z.string().optional(),
    model: z.string().optional(),
  }).describe("Get usage history"),
  get_usage_stats: z.object({
    days: z.number().default(7).describe("Number of days for stats"),
    groupBy: z.enum(["day", "provider", "model", "apiKey"]).default("day"),
  }).describe("Get aggregated usage statistics"),

  // Settings tools
  get_settings: z.object({}).describe("Get all gateway settings"),
  update_setting: z.object({
    key: z.string().describe("Setting key"),
    value: z.any().describe("Setting value"),
  }).describe("Update a single setting"),
  update_settings: z.object({
    settings: z.record(z.any()).describe("Multiple settings to update"),
  }).describe("Update multiple settings at once"),

  // Routing tools
  get_routing_info: z.object({}).describe("Get current routing configuration and active combos"),
  test_routing: z.object({
    model: z.string().describe("Model to test (e.g., 'auto', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet')"),
    message: z.string().optional().describe("Test message"),
  }).describe("Test routing for a specific model"),

  // Logs tools
  get_logs: z.object({
    limit: z.number().default(100).describe("Number of log entries"),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    provider: z.string().optional(),
  }).describe("Get recent request logs"),

  // System tools
  get_system_status: z.object({}).describe("Get system health, version, and uptime"),
  restart_gateway: z.object({}).describe("Restart the gateway (if running in managed mode)"),
};

// Tool implementations
async function listProviders() {
  const connections = await getProviderConnections();
  const registryMap = new Map(REGISTRY.map(r => [r.id, r]));
  return connections.map(c => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    providerName: registryMap.get(c.provider)?.name || c.provider,
    authMode: c.authMode,
    enabled: c.enabled !== false,
    testStatus: c.testStatus,
    lastError: c.lastError,
    lastTestedAt: c.lastTestedAt,
    quota: c.quota,
    quotaUsed: c.quotaUsed,
    quotaResetAt: c.quotaResetAt,
    modelLock: Object.keys(c).filter(k => k.startsWith("modelLock_")).reduce((acc, k) => {
      if (c[k]) acc[k] = c[k];
      return acc;
    }, {}),
  }));
}

async function addProvider(args) {
  const { provider, name, authMode, apiKey, oauthToken, extra } = args;
  const connection = await addProviderConnection({
    provider,
    name: name || provider,
    authMode,
    apiKey,
    oauthToken,
    extra: extra || {},
    enabled: true,
    testStatus: "untested",
    createdAt: new Date().toISOString(),
  });
  return { success: true, connection };
}

async function updateProvider(args) {
  const { id, ...updates } = args;
  await updateProviderConnection(id, { ...updates, updatedAt: new Date().toISOString() });
  return { success: true };
}

async function deleteProvider(args) {
  await deleteProviderConnection(args.id);
  return { success: true };
}

async function testProvider(args) {
  const result = await testProviderConnection(args.id);
  return result;
}

async function getProviderModels(args) {
  const { provider } = args;
  const registryEntry = REGISTRY.find(r => r.id === provider || r.alias === provider);
  if (!registryEntry) throw new Error(`Provider not found: ${provider}`);
  const models = PROVIDER_MODELS[registryEntry.alias || registryEntry.id] || [];
  return models.map(m => ({
    id: typeof m === "string" ? m : m.id,
    name: typeof m === "string" ? m : m.name,
    kind: typeof m === "object" ? m.kind : undefined,
  }));
}

async function listCombos() {
  return await getCombos();
}

async function addCombo(args) {
  const { name, models, strategy, fusionTuning } = args;
  const combo = await addComboDb({
    name,
    models,
    strategy: strategy || "priority",
    fusionTuning: fusionTuning || {},
    createdAt: new Date().toISOString(),
  });
  return { success: true, combo };
}

async function updateCombo(args) {
  const { id, ...updates } = args;
  await updateComboDb(id, { ...updates, updatedAt: new Date().toISOString() });
  return { success: true };
}

async function deleteCombo(args) {
  await deleteComboDb(args.id);
  return { success: true };
}

async function getQuota(args) {
  const connections = await getProviderConnections();
  let filtered = connections;
  if (args.provider) {
    filtered = filtered.filter(c => c.provider === args.provider);
  }
  return filtered.map(c => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    testStatus: c.testStatus,
    quota: c.quota,
    quotaUsed: c.quotaUsed,
    quotaResetAt: c.quotaResetAt,
    lastError: c.lastError,
    modelLocks: Object.keys(c).filter(k => k.startsWith("modelLock_") && c[k]).reduce((acc, k) => {
      acc[k] = c[k];
      return acc;
    }, {}),
  }));
}

async function getUsageHistoryTool(args) {
  const { days, provider, model } = args;
  return await getUsageHistory(days, provider, model);
}

async function getUsageStatsTool(args) {
  const { days, groupBy } = args;
  return await getUsageStats(days, groupBy);
}

async function getSettingsTool() {
  return await getSettings();
}

async function updateSetting(args) {
  await patchSetting(args.key, args.value);
  return { success: true };
}

async function updateSettings(args) {
  for (const [key, value] of Object.entries(args.settings)) {
    await patchSetting(key, value);
  }
  return { success: true };
}

async function getRoutingInfo() {
  const settings = await getSettings();
  const combos = await getCombos();
  const connections = await getProviderConnections();
  return {
    defaultModel: settings.defaultModel,
    combos: combos.map(c => ({
      id: c.id,
      name: c.name,
      models: c.models,
      strategy: c.strategy,
    })),
    providerCount: connections.filter(c => c.enabled !== false).length,
    autoComboEnabled: settings.autoComboEnabled,
  };
}

async function testRouting(args) {
  // Use the internal routing logic to test
  const { handleChatRequest } = await import("@/sse/handlers/chat.js");
  const modelInfo = getModelInfo(args.model);
  const mockRequest = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      messages: [{ role: "user", content: args.message || "Hello, this is a routing test." }],
      max_tokens: 10,
    }),
  });
  try {
    const response = await handleChatRequest(mockRequest, modelInfo, null);
    const text = await response.text();
    return { success: true, response: text.slice(0, 500) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getLogs(args) {
  const { limit, level, provider } = args;
  const result = await getRequestDetails({
    provider,
    status: level,
    pageSize: limit,
  });
  return result.details;
}

async function getSystemStatus() {
  const settings = await getSettings();
  const connections = await getProviderConnections();
  const combos = await getCombos();
  return {
    version: process.env.npm_package_version || "unknown",
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
    providerCount: connections.length,
    activeProviders: connections.filter(c => c.enabled !== false && c.testStatus === "active").length,
    comboCount: combos.length,
    defaultModel: settings.defaultModel,
    rtkEnabled: settings.rtkEnabled,
    headroomEnabled: settings.headroomEnabled,
    cavemanEnabled: settings.cavemanEnabled,
    ponytailEnabled: settings.ponytailEnabled,
  };
}

async function restartGateway() {
  // This would trigger a graceful restart if running under a process manager
  // For now, just return info
  return {
    success: true,
    message: "Restart requested. If running under PM2/Docker, the process manager will handle it.",
  };
}

// Tool executor map
const ToolExecutors = {
  list_providers: listProviders,
  add_provider: addProvider,
  update_provider: updateProvider,
  delete_provider: deleteProvider,
  test_provider: testProvider,
  get_provider_models: getProviderModels,
  list_combos: listCombos,
  add_combo: addCombo,
  update_combo: updateCombo,
  delete_combo: deleteCombo,
  get_quota: getQuota,
  get_usage_history: getUsageHistoryTool,
  get_usage_stats: getUsageStatsTool,
  get_settings: getSettingsTool,
  update_setting: updateSetting,
  update_settings: updateSettings,
  get_routing_info: getRoutingInfo,
  test_routing: testRouting,
  get_logs: getLogs,
  get_system_status: getSystemStatus,
  restart_gateway: restartGateway,
};

// MCP Protocol handlers
export class McpServer {
  constructor() {
    this.tools = Object.entries(ToolSchemas).map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: this.zodToJsonSchema(schema),
    }));
  }

  zodToJsonSchema(zodSchema) {
    // Simplified zod to JSON Schema conversion
    // For production, use zod-to-json-schema package
    const shape = zodSchema.shape || {};
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(shape)) {
      if (value._def?.typeName === "ZodOptional") {
        properties[key] = this.zodTypeToSchema(value._def.innerType);
      } else if (value._def?.typeName === "ZodDefault") {
        properties[key] = this.zodTypeToSchema(value._def.innerType);
      } else {
        properties[key] = this.zodTypeToSchema(value);
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: true,
    };
  }

  zodTypeToSchema(zodType) {
    const def = zodType._def;
    if (!def) return { type: "string" };
    switch (def.typeName) {
      case "ZodString":
        return { type: "string", description: def.description };
      case "ZodNumber":
        return { type: "number", description: def.description };
      case "ZodBoolean":
        return { type: "boolean", description: def.description };
      case "ZodArray":
        return { type: "array", items: this.zodTypeToSchema(def.type), description: def.description };
      case "ZodObject":
        return this.zodToJsonSchema(zodType);
      case "ZodEnum":
        return { type: "string", enum: def.values, description: def.description };
      case "ZodOptional":
        return this.zodTypeToSchema(def.innerType);
      case "ZodDefault":
        return this.zodTypeToSchema(def.innerType);
      default:
        return { type: "string", description: def.description };
    }
  }

  async handleInitialize(request) {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: "9router",
        version: process.env.npm_package_version || "1.0.0",
      },
    };
  }

  async handleToolsList() {
    return { tools: this.tools };
  }

  async handleToolsCall(request) {
    const { name, arguments: args } = request.params;
    const executor = ToolExecutors[name];
    if (!executor) {
      throw new Error(`Unknown tool: ${name}`);
    }
    try {
      const result = await executor(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }

  async handleRequest(request) {
    const { method, params, id } = request;
    try {
      let result;
      switch (method) {
        case "initialize":
          result = await this.handleInitialize(request);
          break;
        case "tools/list":
          result = await this.handleToolsList();
          break;
        case "tools/call":
          result = await this.handleToolsCall(request);
          break;
        case "resources/list":
          result = { resources: [] };
          break;
        case "prompts/list":
          result = { prompts: [] };
          break;
        default:
          throw new Error(`Method not found: ${method}`);
      }
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return { jsonrpc: "2.0", id, error: { code: -32603, message: e.message } };
    }
  }
}

// Singleton instance
let mcpServerInstance = null;
export function getMcpServer() {
  if (!mcpServerInstance) {
    mcpServerInstance = new McpServer();
  }
  return mcpServerInstance;
}

// Stdio transport handler (for `9router --mcp`)
export async function runStdioServer() {
  const server = getMcpServer();
  const encoder = new TextEncoder();
  let buffer = "";

  process.stdin.on("data", async (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const request = JSON.parse(line);
        const response = await server.handleRequest(request);
        process.stdout.write(encoder.encode(JSON.stringify(response) + "\n"));
      } catch (e) {
        console.error("[MCP] Parse error:", e.message);
      }
    }
  });

  console.error("[MCP] 9router MCP server started on stdio");
}