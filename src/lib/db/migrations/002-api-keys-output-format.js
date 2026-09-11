// Adds per-key forced response format (auto/openai/claude) for apiKeys.
export default {
  version: 2,
  name: "api-keys-output-format",
  up(db) {
    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    if (!cols.includes("outputFormat")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN outputFormat TEXT`);
    }
  },
};
