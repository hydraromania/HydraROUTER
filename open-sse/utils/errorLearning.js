import { GEMINI_ROLE, ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../translator/schema/index.js";

const ERROR_LEARNING_KEY = "error_learning";

const KNOWN_ERROR_PATTERNS = [
  {
    name: "gemini_trailing_model_turn",
    match: (message) => /requests? ending with a model turn are not supported/i.test(message),
    providers: ["gemini", "gemini-cli", "antigravity", "vertex", "vertex-partner"],
    autoCorrect: "removeTrailingModelTurn",
  },
  {
    name: "gemini_empty_content",
    match: (message) => /content must not be empty|empty (content|parts)/i.test(message),
    providers: ["gemini", "gemini-cli", "antigravity", "vertex", "vertex-partner"],
    autoCorrect: "removeEmptyContents",
  },
  {
    name: "gemini_invalid_function_name",
    match: (message) => /function name|function_call.*name.*invalid/i.test(message),
    providers: ["gemini", "gemini-cli", "antigravity", "vertex", "vertex-partner"],
    autoCorrect: "sanitizeFunctionNames",
  },
  {
    name: "claude_tool_use_without_result",
    match: (message) => /tool_use.*without.*tool_result|tool_result.*missing|expected tool_result/i.test(message),
    providers: ["anthropic", "claude"],
    autoCorrect: "removeOrphanToolUse",
  },
  {
    name: "openai_max_tokens",
    match: (message) => /max_tokens.*exceed|max_output_tokens|context length.*exceed|too many tokens|must be `>= \d+`/i.test(message),
    providers: ["openai", "azure", "openai-compatible", "nvidia", "opencode", "opencode-go"],
    autoCorrect: "reduceMaxTokens",
  },
  {
    name: "nvidia_invalid_model",
    match: (message) => /model.*not (found|available|supported)|invalid model|unknown model/i.test(message),
    providers: ["nvidia"],
    autoCorrect: "stripModelSuffix",
  },
  {
    name: "nvidia_context_overflow",
    match: (message) => /context.*length|maximum context|token limit|input too long/i.test(message),
    providers: ["nvidia"],
    autoCorrect: "reduceMaxTokens",
  },
  {
    name: "nvidia_tool_calls_malformed",
    match: (message) => /tool_calls.*invalid|malformed.*tool|tool.*format/i.test(message),
    providers: ["nvidia"],
    autoCorrect: "sanitizeToolCalls",
  },
  {
    name: "nvidia_invalid_role",
    match: (message) => /invalid role|role.*not allowed|unsupported.*role/i.test(message),
    providers: ["nvidia"],
    autoCorrect: "normalizeRoles",
  },
  {
    name: "openai_assistant_content_required",
    match: (message) => /messages with role 'assistant' must contain.*content|assistant.*content.*required/i.test(message),
    providers: ["openai", "azure", "openai-compatible", "nvidia"],
    autoCorrect: "addAssistantContent",
  },
  {
    name: "openai_empty_assistant_message",
    match: (message) => /empty assistant|assistant message.*empty|content.*empty.*assistant/i.test(message),
    providers: ["openai", "azure", "openai-compatible", "nvidia"],
    autoCorrect: "removeEmptyAssistant",
  },
];

let learnedCache = new Map();
let persistenceEnabled = false;
let persistencePath = null;

function loadFromDisk() {
  if (!persistenceEnabled || !persistencePath) return;
  try {
    const fs = require("fs");
    if (fs.existsSync(persistencePath)) {
      const data = JSON.parse(fs.readFileSync(persistencePath, "utf8"));
      learnedCache = new Map(Object.entries(data));
    }
  } catch {
    // Ignore load errors
  }
}

function saveToDisk() {
  if (!persistenceEnabled || !persistencePath) return;
  try {
    const fs = require("fs");
    const dir = require("path").dirname(persistencePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(persistencePath, JSON.stringify(Object.fromEntries(learnedCache), null, 2));
  } catch {
    // Ignore save errors
  }
}

export function initErrorLearning({ enabled = true, path = null } = {}) {
  persistenceEnabled = enabled;
  persistencePath = path;
  if (enabled && path) loadFromDisk();
}

function getCacheKey(provider, model) {
  return `${provider}:${model}`;
}

function getLearnedPatterns(provider, model) {
  const key = getCacheKey(provider, model);
  return learnedCache.get(key) || [];
}

function addLearnedPattern(provider, model, patternName, autoCorrectFn) {
  const key = getCacheKey(provider, model);
  const patterns = learnedCache.get(key) || [];
  if (!patterns.includes(patternName)) {
    patterns.push(patternName);
    learnedCache.set(key, patterns);
    saveToDisk();
  }
}

function removeTrailingModelTurn(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };

  if (format === "gemini" || format === "gemini-cli" || format === "antigravity") {
    const contents = correctedBody.contents || correctedBody.request?.contents;
    if (Array.isArray(contents) && contents.length > 0) {
      const lastIdx = contents.length - 1;
      if (contents[lastIdx]?.role === GEMINI_ROLE.MODEL) {
        contents.splice(lastIdx, 1);
        return { body: correctedBody, corrected: true };
      }
    }
  } else if (format === "claude") {
    const messages = correctedBody.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const lastIdx = messages.length - 1;
      if (messages[lastIdx]?.role === ROLE.ASSISTANT) {
        messages.splice(lastIdx, 1);
        return { body: correctedBody, corrected: true };
      }
    }
  } else {
    const messages = correctedBody.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const lastIdx = messages.length - 1;
      if (messages[lastIdx]?.role === ROLE.ASSISTANT) {
        messages.splice(lastIdx, 1);
        return { body: correctedBody, corrected: true };
      }
    }
  }

  return { body: correctedBody, corrected: false };
}

function removeEmptyContents(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  let corrected = false;

  if (format === "gemini" || format === "gemini-cli" || format === "antigravity") {
    const contents = correctedBody.contents || correctedBody.request?.contents;
    if (Array.isArray(contents)) {
      const filtered = contents.filter(c => c.parts?.length > 0);
      if (filtered.length !== contents.length) {
        if (correctedBody.contents) correctedBody.contents = filtered;
        else if (correctedBody.request?.contents) correctedBody.request.contents = filtered;
        corrected = true;
      }
    }
  } else {
    const messages = correctedBody.messages;
    if (Array.isArray(messages)) {
      const filtered = messages.filter(m => {
        if (typeof m.content === "string") return m.content.trim().length > 0;
        if (Array.isArray(m.content)) return m.content.some(c => c.text?.trim().length > 0);
        return true;
      });
      if (filtered.length !== messages.length) {
        correctedBody.messages = filtered;
        corrected = true;
      }
    }
  }

  return { body: correctedBody, corrected };
}

function sanitizeFunctionNames(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  let corrected = false;

  function sanitize(name) {
    if (!name) return "_unknown";
    let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
    if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
    return s.substring(0, 64);
  }

  if (format === "gemini" || format === "gemini-cli" || format === "antigravity") {
    const tools = correctedBody.tools || correctedBody.request?.tools;
    if (Array.isArray(tools)) {
      for (const group of tools) {
        if (group.functionDeclarations) {
          for (const fn of group.functionDeclarations) {
            const sanitized = sanitize(fn.name);
            if (sanitized !== fn.name) {
              fn.name = sanitized;
              corrected = true;
            }
          }
        }
      }
    }
    const contents = correctedBody.contents || correctedBody.request?.contents;
    if (Array.isArray(contents)) {
      for (const c of contents) {
        if (c.parts) {
          for (const part of c.parts) {
            if (part.functionCall?.name) {
              const sanitized = sanitize(part.functionCall.name);
              if (sanitized !== part.functionCall.name) {
                part.functionCall.name = sanitized;
                corrected = true;
              }
            }
            if (part.functionResponse?.name) {
              const sanitized = sanitize(part.functionResponse.name);
              if (sanitized !== part.functionResponse.name) {
                part.functionResponse.name = sanitized;
                corrected = true;
              }
            }
          }
        }
      }
    }
  }

  return { body: correctedBody, corrected };
}

function removeOrphanToolUse(body, format) {
  if (!body || format !== "claude") return { body, corrected: false };

  const correctedBody = { ...body };
  const messages = correctedBody.messages;
  if (!Array.isArray(messages)) return { body: correctedBody, corrected: false };

  const toolUseIds = new Set();
  const toolResultIds = new Set();

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.TOOL_USE && block.id) {
          toolUseIds.add(block.id);
        }
        if (block.type === CLAUDE_BLOCK.TOOL_RESULT && block.tool_use_id) {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  const orphanIds = [...toolUseIds].filter(id => !toolResultIds.has(id));
  if (orphanIds.length === 0) return { body: correctedBody, corrected: false };

  let corrected = false;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const filtered = msg.content.filter(block => {
        if (block.type === CLAUDE_BLOCK.TOOL_USE && orphanIds.includes(block.id)) {
          corrected = true;
          return false;
        }
        return true;
      });
      if (filtered.length !== msg.content.length) {
        msg.content = filtered;
      }
    }
  }

  return { body: correctedBody, corrected };
}

function reduceMaxTokens(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  let corrected = false;

  const minCapMatch = (val) => typeof val === "number" && val < 16;

  if (correctedBody.max_tokens !== undefined) {
    if (correctedBody.max_tokens < 16) {
      correctedBody.max_tokens = 16;
      corrected = true;
    } else if (correctedBody.max_tokens > 1000) {
      correctedBody.max_tokens = Math.floor(correctedBody.max_tokens * 0.7);
      corrected = true;
    }
  }

  if (correctedBody.max_output_tokens !== undefined) {
    if (correctedBody.max_output_tokens < 16) {
      correctedBody.max_output_tokens = 16;
      corrected = true;
    } else if (correctedBody.max_output_tokens > 1000) {
      correctedBody.max_output_tokens = Math.floor(correctedBody.max_output_tokens * 0.7);
      corrected = true;
    }
  }

  if (correctedBody.max_completion_tokens !== undefined) {
    if (correctedBody.max_completion_tokens < 16) {
      correctedBody.max_completion_tokens = 16;
      corrected = true;
    } else if (correctedBody.max_completion_tokens > 1000) {
      correctedBody.max_completion_tokens = Math.floor(correctedBody.max_completion_tokens * 0.7);
      corrected = true;
    }
  }

  if (correctedBody.generationConfig?.maxOutputTokens !== undefined) {
    if (correctedBody.generationConfig.maxOutputTokens < 16) {
      correctedBody.generationConfig.maxOutputTokens = 16;
      corrected = true;
    } else if (correctedBody.generationConfig.maxOutputTokens > 1000) {
      correctedBody.generationConfig.maxOutputTokens = Math.floor(correctedBody.generationConfig.maxOutputTokens * 0.7);
      corrected = true;
    }
  }

  if (correctedBody.request?.generationConfig?.maxOutputTokens !== undefined) {
    if (correctedBody.request.generationConfig.maxOutputTokens < 16) {
      correctedBody.request.generationConfig.maxOutputTokens = 16;
      corrected = true;
    } else if (correctedBody.request.generationConfig.maxOutputTokens > 1000) {
      correctedBody.request.generationConfig.maxOutputTokens = Math.floor(correctedBody.request.generationConfig.maxOutputTokens * 0.7);
      corrected = true;
    }
  }

  return { body: correctedBody, corrected };
}

function stripModelSuffix(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  let corrected = false;

  if (correctedBody.model && typeof correctedBody.model === "string") {
    const original = correctedBody.model;
    correctedBody.model = original.replace(/(?::|-)(thinking|reasoning|instruct|chat|base)$/i, "");
    if (correctedBody.model !== original) corrected = true;
  }

  return { body: correctedBody, corrected };
}

function sanitizeToolCalls(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  let corrected = false;
  const messages = correctedBody.messages;

  if (!Array.isArray(messages)) return { body: correctedBody, corrected: false };

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.tool_calls)) {
      const validToolCalls = msg.tool_calls.filter(tc => {
        if (!tc || tc.type !== OPENAI_BLOCK.FUNCTION) return false;
        if (!tc.function || typeof tc.function.name !== "string") return false;
        if (tc.function.arguments == null) return false;
        if (typeof tc.function.arguments !== "string") {
          try {
            tc.function.arguments = JSON.stringify(tc.function.arguments);
            return true;
          } catch {
            return false;
          }
        }
        return true;
      });
      if (validToolCalls.length !== msg.tool_calls.length) {
        msg.tool_calls = validToolCalls;
        corrected = true;
      }
    }
  }

  return { body: correctedBody, corrected };
}

function normalizeRoles(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  const messages = correctedBody.messages;
  let corrected = false;

  if (!Array.isArray(messages)) return { body: correctedBody, corrected: false };

  const roleMap = {
    "system": ROLE.SYSTEM,
    "user": ROLE.USER,
    "assistant": ROLE.ASSISTANT,
    "tool": ROLE.TOOL,
    "function": ROLE.TOOL,
    "developer": ROLE.SYSTEM,
  };

  for (const msg of messages) {
    if (msg.role && roleMap[msg.role.toLowerCase()]) {
      const normalized = roleMap[msg.role.toLowerCase()];
      if (msg.role !== normalized) {
        msg.role = normalized;
        corrected = true;
      }
    }
  }

  return { body: correctedBody, corrected };
}

function addAssistantContent(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  const messages = correctedBody.messages;
  let corrected = false;

  if (!Array.isArray(messages)) return { body: correctedBody, corrected: false };

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && (msg.content == null || msg.content === "")) {
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      if (!hasToolCalls) {
        msg.content = " ";
        corrected = true;
      }
    }
  }

  return { body: correctedBody, corrected };
}

function removeEmptyAssistant(body, format) {
  if (!body) return { body, corrected: false };

  const correctedBody = { ...body };
  const messages = correctedBody.messages;
  let corrected = false;

  if (!Array.isArray(messages)) return { body: correctedBody, corrected: false };

  const filtered = messages.filter(m => {
    if (m.role === ROLE.ASSISTANT) {
      const hasContent = m.content != null && m.content !== "";
      const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      if (!hasContent && !hasToolCalls) {
        corrected = true;
        return false;
      }
    }
    return true;
  });

  if (corrected) {
    correctedBody.messages = filtered;
  }

  return { body: correctedBody, corrected };
}

const AUTO_CORRECTORS = {
  removeTrailingModelTurn,
  removeEmptyContents,
  sanitizeFunctionNames,
  removeOrphanToolUse,
  reduceMaxTokens,
  stripModelSuffix,
  sanitizeToolCalls,
  normalizeRoles,
  addAssistantContent,
  removeEmptyAssistant,
};

export function detectAndLearnError(provider, model, errorMessage, targetFormat) {
  for (const pattern of KNOWN_ERROR_PATTERNS) {
    if (pattern.match(errorMessage) && pattern.providers.includes(provider)) {
      addLearnedPattern(provider, model, pattern.name, pattern.autoCorrect);
      return { pattern: pattern.name, autoCorrect: pattern.autoCorrect };
    }
  }
  return null;
}

export function tryAutoCorrect(body, targetFormat, autoCorrectFnName) {
  const fn = AUTO_CORRECTORS[autoCorrectFnName];
  if (!fn) return { body, corrected: false };
  return fn(body, targetFormat);
}

export function getLearnedErrorPatterns(provider, model) {
  return getLearnedPatterns(provider, model);
}

export function clearLearnedPatterns(provider, model) {
  const key = getCacheKey(provider, model);
  learnedCache.delete(key);
  saveToDisk();
}

export function getAllLearnedPatterns() {
  return Object.fromEntries(learnedCache);
}