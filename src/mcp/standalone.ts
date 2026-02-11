/**
 * Standalone MCP server entry point.
 *
 * Starts the MCP server over stdio, exposing tools scoped to a vault directory.
 * Used by the MCP Inspector and integration tests.
 *
 * Usage:
 *   bun src/mcp/standalone.ts <vault-dir>
 */

import { startMCPServer } from "./server.ts";

const vaultDir = process.argv[2];

if (!vaultDir) {
  console.error("Usage: bun src/mcp/standalone.ts <vault-dir>");
  process.exit(1);
}

await startMCPServer({
  getBroker: () => null,
  vaultDir,
  getSaveCanvas: () => null,
  transport: "stdio",
});
