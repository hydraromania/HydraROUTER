// Persisted 429-hit counter per key+model for the quota monitor.
// Real data only: incremented on every actual upstream 429 (recordRateLimitHit).
export default {
  version: 4,
  name: "quota-counters",
  up(db) {
    try {
      db.exec(`ALTER TABLE rateLimits ADD COLUMN count429 INTEGER DEFAULT 0`);
      console.log("[MIGRATION 004] Added count429 column to rateLimits table");
    } catch (e) {
      if (!e.message?.includes("duplicate column")) {
        console.warn("[MIGRATION 004] Could not add count429:", e.message);
      }
    }
  },
};
