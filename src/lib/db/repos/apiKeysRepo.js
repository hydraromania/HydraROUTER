import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const VALID_OUTPUT_FORMATS = new Set(["auto", "openai", "claude"]);

function normalizeOutputFormat(value) {
  if (value === null || value === undefined || value === "") return "auto";
  const v = String(value).toLowerCase();
  return VALID_OUTPUT_FORMATS.has(v) ? v : "auto";
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    allowedModels: row.allowedModels ? parseJson(row.allowedModels, null) : null,
    outputFormat: normalizeOutputFormat(row.outputFormat),
    priority: row.priority !== undefined ? Number(row.priority) : 0,
    isDefault: row.isDefault === 1 || row.isDefault === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY priority ASC, createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, allowedModels = null, outputFormat = "auto") {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    allowedModels: Array.isArray(allowedModels) ? allowedModels : null,
    outputFormat: normalizeOutputFormat(outputFormat),
    priority: 0,
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedModels, outputFormat, priority, isDefault, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.allowedModels ? stringifyJson(apiKey.allowedModels) : null,
      apiKey.outputFormat,
      apiKey.priority,
      apiKey.isDefault ? 1 : 0,
      apiKey.createdAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToKey(row);
    const merged = { ...existing, ...data };
    if ("allowedModels" in data) {
      merged.allowedModels = Array.isArray(data.allowedModels) ? data.allowedModels : null;
    }
    if ("outputFormat" in data) {
      merged.outputFormat = normalizeOutputFormat(data.outputFormat);
    }
    
    // If setting this key as default, we need to clear isDefault on all other keys
    if (data.isDefault) {
      db.run(`UPDATE apiKeys SET isDefault = 0 WHERE id != ?`, [id]);
    }

    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, outputFormat = ?, priority = ?, isDefault = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        merged.allowedModels ? stringifyJson(merged.allowedModels) : null,
        normalizeOutputFormat(merged.outputFormat),
        merged.priority,
        merged.isDefault ? 1 : 0,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
