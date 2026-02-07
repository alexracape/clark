/**
 * MCP module — re-exports server, tool, and vault types.
 */

export { createMCPServer, startMCPServer } from "./server.ts";
export type { MCPServerOptions } from "./server.ts";
export { createTools } from "./tools.ts";
export type { ToolAnnotations, ToolDefinition, ToolResult, ToolsConfig } from "./tools.ts";
export { extractPDFText, getPDFInfo } from "./pdf.ts";
export {
  extractWikilinks,
  buildFileIndex,
  resolveWikilink,
  buildLinkFooter,
  resolveVaultPath,
  isWithinVault,
  isImageFile,
  isPDFFile,
  imageMimeType,
} from "./vault.ts";
export type { WikiLink } from "./vault.ts";
