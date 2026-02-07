/**
 * MCP module — re-exports server and tool types.
 */

export { createMCPServer, startMCPServer } from "./server.ts";
export type { MCPServerOptions } from "./server.ts";
export { createTools } from "./tools.ts";
export type { ToolDefinition, ToolResult, ToolsConfig } from "./tools.ts";
export { extractPDFText, getPDFInfo } from "./pdf.ts";
