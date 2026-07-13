#!/usr/bin/env node
// Copies the client static assets and the public folder into the Next.js
// standalone server output.
//
// `next build --webpack` with `output: "standalone"` does NOT copy these:
//   - .next/static   -> client JS/CSS chunks (the dashboard UI)
//   - public         -> static assets served at /
//
// Without this step the standalone server 404s on every client chunk and
// the app crashes with errors like:
//   "client reference manifest for route ... does not exist"
//   "Failed to load static file for page: /500 ... 500.html"
//
// Run automatically as the `postbuild` hook after `next build` (and
// `postbuild:bun` for the bun build). Safe to run in any environment:
// it is a no-op when `.next/standalone` is absent (e.g. a dev build).

import { existsSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // repo root
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.log(
    "[copy-standalone-assets] .next/standalone not found — skipping (dev / non-standalone build)."
  );
  process.exit(0);
}

const jobs = [
  {
    from: join(root, ".next", "static"),
    to: join(standalone, ".next", "static"),
    label: ".next/static",
  },
  {
    from: join(root, "public"),
    to: join(standalone, "public"),
    label: "public",
  },
];

for (const { from, to, label } of jobs) {
  if (!existsSync(from)) {
    console.log(
      `[copy-standalone-assets] source ${label} not found at ${from} — skipping.`
    );
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`[copy-standalone-assets] copied ${label} -> ${to}`);
}

console.log("[copy-standalone-assets] done.");
