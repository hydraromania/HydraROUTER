// Passive Google quota discovery: real violated limits from 429 bodies (per key+model).
// Unknown stays NULL — never documented defaults.
export default {
  version: 5,
  name: "quota-discovery",
  up(db) {
    const cols = [
      "discoveredRpd INTEGER",
      "discoveredRpm INTEGER",
      "discoveredTpm INTEGER",
      "quotaProject TEXT",
      "quotaMessage TEXT",
      "quotaAt INTEGER DEFAULT 0",
      "lastRetryAfterSec INTEGER DEFAULT 0",
    ];
    for (const col of cols) {
      try {
        db.exec("ALTER TABLE rateLimits ADD COLUMN " + col);
      } catch (e) {
        if (!e.message || !e.message.includes("duplicate column")) {
          console.warn("[MIGRATION 005] Could not add " + col + ":", e.message);
        }
      }
    }
    console.log("[MIGRATION 005] Added quota discovery columns to rateLimits table");
  },
};
