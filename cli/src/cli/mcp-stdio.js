// Standalone MCP stdio server entry point for CLI
// Can be required from cli/ without @/ aliases

const path = require("path");
const fs = require("fs");

// Add root src to module resolution
const rootSrc = path.join(__dirname, "..", "..", "src");
if (!require.main.paths.includes(rootSrc)) {
  require.main.paths.unshift(rootSrc);
}

// Import the main MCP server
const { runStdioServer } = require(path.join(rootSrc, "lib", "mcp", "server.js"));

runStdioServer().catch((err) => {
  console.error("[MCP] Fatal error:", err.message);
  process.exit(1);
});