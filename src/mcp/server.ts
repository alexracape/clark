/**
 * MCP server implementation.
 *
 * Exposes tools to the LLM via the Model Context Protocol over stdio.
 * Receives references to the CanvasBroker and config at initialization.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createTools, type ToolsConfig, type ToolDefinition } from "./tools.ts";

export interface MCPServerOptions extends ToolsConfig {
  /** Run over stdio (default) or return the server instance for in-process use */
  transport?: "stdio" | "in-process";
}

/**
 * Create and configure the MCP server with all tools registered.
 */
export function createMCPServer(options: MCPServerOptions) {
  const server = new McpServer({
    name: "clark",
    version: "0.1.0",
  });

  const tools = createTools(options);

  // Register each tool with the MCP server
  for (const tool of tools) {
    registerTool(server, tool);
  }

  return server;
}

/**
 * Start the MCP server over stdio transport.
 */
export async function startMCPServer(options: MCPServerOptions) {
  const server = createMCPServer(options);

  if (options.transport !== "in-process") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  return server;
}

/**
 * Register a single tool definition with the MCP server.
 */
function registerTool(server: McpServer, tool: ToolDefinition) {
  // Build zod schema from the tool's input schema
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    let schema: z.ZodTypeAny;
    if (prop.enum) {
      schema = z.enum(prop.enum as [string, ...string[]]);
    } else if (prop.type === "number") {
      schema = z.number();
    } else {
      schema = z.string();
    }
    schema = schema.describe(prop.description);

    if (!tool.inputSchema.required?.includes(key)) {
      schema = schema.optional();
    }
    shape[key] = schema;
  }

  server.tool(tool.name, tool.description, shape, async (input) => {
    const result = await tool.handler(input as Record<string, unknown>);
    return {
      content: result.content,
      isError: result.isError,
    };
  });
}
