// Add manualBlockUntil column to rateLimits table for manual admin blocks
export default {
  version: 3,
  name: "manual-block",
  up(db) {
    // Add manualBlockUntil column for manual admin blocks (separate from automatic 429 rateLimitedUntil)
    try {
      db.exec(`ALTER TABLE rateLimits ADD COLUMN manualBlockUntil INTEGER DEFAULT 0`);
      console.log("[MIGRATION 003] Added manualBlockUntil column to rateLimits table");
    } catch (e) {
      // Column might already exist, ignore
      if (!e.message?.includes("duplicate column")) {
        console.warn("[MIGRATION 003] Could not add manualBlockUntil:", e.message);
      }
    }
  },
};