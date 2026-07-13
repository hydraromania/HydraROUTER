#!/usr/bin/env node
/**
 * PM2 entry — wraps Next.js standalone server with real-IP injection.
 *
 * The standalone build was freshly verified — .next/ subdir present.
 * This wrapper adds client-IP detection (same as custom-server.js).
 * NODE_PATH ensures modules resolve when standalone trace misses deps.
 */
const http = require("http");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname);

// Fallback module resolution: standalone prefers its own node_modules,
// but falls back to root's when standalone trace missed a file.
const nm = path.join(PROJECT_ROOT, "node_modules");
if (process.env.NODE_PATH) {
  const existing = process.env.NODE_PATH.split(path.delimiter);
  if (!existing.includes(nm)) process.env.NODE_PATH += path.delimiter + nm;
} else {
  process.env.NODE_PATH = nm;
}
delete require.cache; // force re-resolve with updated NODE_PATH
require("module").Module._initPaths();

// Real-IP injection (same as custom-server.js)
const origCreate = http.createServer.bind(http);
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket?.remoteAddress ?? "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopback = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopback && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    req.headers["x-9r-real-ip"] = ip;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  return origCreate(...rest, wrapped);
};

// Load standalone server (with retry if build is still in progress)
const standaloneDir = path.join(PROJECT_ROOT, ".next", "standalone");
const serverJs = path.join(standaloneDir, "server.js");
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

function loadServer(retriesLeft) {
  try {
    require(serverJs);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND" && retriesLeft > 0) {
      console.error(`[PM2] server.js not found — build in progress? Retrying in ${RETRY_DELAY_MS}ms (${retriesLeft} left)...`);
      return setTimeout(() => loadServer(retriesLeft - 1), RETRY_DELAY_MS);
    }
    console.error("[PM2] Failed to start server:", err);
    process.exit(1);
  }
}

loadServer(MAX_RETRIES);
