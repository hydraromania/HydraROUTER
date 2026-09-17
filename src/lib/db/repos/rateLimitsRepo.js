import { getAdapter } from "../driver.js";

export async function getRateLimit(keyId, modelId, providerId) {
  if (!keyId) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM rateLimits WHERE keyId = ? AND modelId = ? AND providerId = ?`,
    [keyId, modelId, providerId]
  );
  return row;
}

export async function getRateLimitByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM rateLimits WHERE keyId = ?`, [key]);
  return row;
}

export async function getAllRateLimits() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM rateLimits`);
}

export async function getRateLimitsForProvider(providerId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM rateLimits WHERE providerId = ?`, [providerId]);
}

export async function upsertRateLimit(data) {
  const { keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, manualBlockUntil } = data;
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, manualBlockUntil, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       rpdCount = excluded.rpdCount,
       rpdResetAt = excluded.rpdResetAt,
       rpmCount = excluded.rpmCount,
       rpmResetAt = excluded.rpmResetAt,
       tpmCount = excluded.tpmCount,
       tpmResetAt = excluded.tpmResetAt,
       rateLimitedUntil = excluded.rateLimitedUntil,
       manualBlockUntil = excluded.manualBlockUntil,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, rpdCount || 0, rpdResetAt, rpmCount || 0, rpmResetAt, tpmCount || 0, tpmResetAt, rateLimitedUntil || 0, manualBlockUntil || 0, now]
  );
}

export async function updateRpdCount(keyId, modelId, providerId, rpdCount, rpdResetAt) {
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, updatedAt)
     VALUES(?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       rpdCount = excluded.rpdCount,
       rpdResetAt = excluded.rpdResetAt,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, rpdCount, rpdResetAt, now]
  );
}

export async function updateRpmCount(keyId, modelId, providerId, rpmCount, rpmResetAt) {
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, updatedAt)
     VALUES(?, ?, ?, 0, 0, ?, ?, 0, 0, 0, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       rpmCount = excluded.rpmCount,
       rpmResetAt = excluded.rpmResetAt,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, rpmCount, rpmResetAt, now]
  );
}

export async function updateTpmCount(keyId, modelId, providerId, tpmCount, tpmResetAt) {
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, updatedAt)
     VALUES(?, ?, ?, 0, 0, 0, 0, ?, ?, 0, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       tpmCount = excluded.tpmCount,
       tpmResetAt = excluded.tpmResetAt,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, tpmCount, tpmResetAt, now]
  );
}

export async function updateRateLimitedUntil(keyId, modelId, providerId, rateLimitedUntil) {
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, manualBlockUntil, count429, updatedAt)
     VALUES(?, ?, ?, 0, 0, 0, 0, 0, 0, ?, 0, 0, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       rateLimitedUntil = excluded.rateLimitedUntil,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, rateLimitedUntil, now]
  );
}

// Real 429 counter: incremented on every actual upstream 429, never reset by windows.
export async function increment429Count(keyId, modelId, providerId) {
  if (!keyId) return 0;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, manualBlockUntil, count429, updatedAt)
     VALUES(?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 1, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       count429 = COALESCE(count429, 0) + 1,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, now]
  );
  const row = db.get(
    `SELECT count429 FROM rateLimits WHERE keyId = ? AND modelId = ? AND providerId = ?`,
    [keyId, modelId, providerId]
  );
  return row?.count429 || 0;
}

export async function updateManualBlockUntil(keyId, modelId, providerId, manualBlockUntil) {
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, manualBlockUntil, updatedAt)
     VALUES(?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)
     ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET
       manualBlockUntil = excluded.manualBlockUntil,
       updatedAt = excluded.updatedAt`,
    [keyId, modelId, providerId, manualBlockUntil, now]
  );
}

// Passive quota discovery: persists real violated limits learned from 429 bodies.
// Only overwrites the violated kind; other kinds stay as previously discovered (progressive).
// Returns the merged discovery row.
export async function recordQuotaDiscovery(keyId, modelId, providerId, discovery) {
  if (!keyId || !discovery) return null;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const cur = db.get(
    "SELECT discoveredRpd, discoveredRpm, discoveredTpm FROM rateLimits WHERE keyId = ? AND modelId = ? AND providerId = ?",
    [keyId, modelId, providerId]
  ) || {};
  const next = {
    discoveredRpd: discovery.kind === "rpd" && discovery.limit != null ? discovery.limit : (cur.discoveredRpd ?? null),
    discoveredRpm: discovery.kind === "rpm" && discovery.limit != null ? discovery.limit : (cur.discoveredRpm ?? null),
    discoveredTpm: discovery.kind === "tpm" && discovery.limit != null ? discovery.limit : (cur.discoveredTpm ?? null),
  };
  db.run(
    "INSERT INTO rateLimits(keyId, modelId, providerId, rpdCount, rpdResetAt, rpmCount, rpmResetAt, tpmCount, tpmResetAt, rateLimitedUntil, manualBlockUntil, count429, discoveredRpd, discoveredRpm, discoveredTpm, quotaProject, quotaMessage, quotaAt, lastRetryAfterSec, updatedAt) " +
    "VALUES(?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(keyId, modelId, providerId) DO UPDATE SET " +
    "discoveredRpd = COALESCE(excluded.discoveredRpd, discoveredRpd), " +
    "discoveredRpm = COALESCE(excluded.discoveredRpm, discoveredRpm), " +
    "discoveredTpm = COALESCE(excluded.discoveredTpm, discoveredTpm), " +
    "quotaProject = COALESCE(excluded.quotaProject, quotaProject), " +
    "quotaMessage = excluded.quotaMessage, quotaAt = excluded.quotaAt, " +
    "lastRetryAfterSec = excluded.lastRetryAfterSec, updatedAt = excluded.updatedAt",
    [keyId, modelId, providerId, next.discoveredRpd, next.discoveredRpm, next.discoveredTpm,
     discovery.project || null, (discovery.message || "").slice(0, 300), nowMs,
     discovery.retryAfterSec || 0, now]
  );
  return { ...next, quotaAt: nowMs, retryAfterSec: discovery.retryAfterSec || 0 };
}

export async function deleteRateLimit(keyId, modelId, providerId) {
  if (!keyId) return;
  const db = await getAdapter();
  db.run(`DELETE FROM rateLimits WHERE keyId = ? AND modelId = ? AND providerId = ?`, [keyId, modelId, providerId]);
}

export async function cleanupExpiredRateLimits(now = Date.now()) {
  const db = await getAdapter();
  db.run(`DELETE FROM rateLimits WHERE rpdResetAt < ? AND rpmResetAt < ? AND tpmResetAt < ? AND (rateLimitedUntil = 0 OR rateLimitedUntil < ?)`, [now, now, now, now]);
}