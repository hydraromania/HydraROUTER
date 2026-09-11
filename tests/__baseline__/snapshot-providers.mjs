// Snapshot current PROVIDERS output to JSON (run on OLD code before refactor).
// Usage: node tests/__baseline__/snapshot-providers.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "providers-baseline.json");
// Scrub OAuth secrets so the baseline can be committed safely (GitHub push protection).
const scrubbed = JSON.parse(JSON.stringify(PROVIDERS, (k, v) =>
  (k === "clientSecret" || k === "clientId") ? "[REDACTED]" : v
));
writeFileSync(out, JSON.stringify(scrubbed, null, 2));
console.log(`Snapshot ${Object.keys(PROVIDERS).length} providers → ${out} (secrets scrubbed)`);
