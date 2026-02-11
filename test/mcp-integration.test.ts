/**
 * MCP integration tests.
 *
 * Spawns the standalone MCP server as a subprocess via StdioClientTransport,
 * connects with the MCP Client, and tests tools through the full protocol.
 * This validates the same path the MCP Inspector uses.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");
const SERVER_PATH = resolve(import.meta.dir, "../src/mcp/standalone.ts");

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "bun",
    args: [SERVER_PATH, TEST_VAULT],
    stderr: "pipe",
  });

  client = new Client(
    { name: "clark-test", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
});

afterAll(async () => {
  await transport.close();
});

describe("MCP Protocol — tools/list", () => {
  test("lists all 8 tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);

    expect(names).toContain("read_file");
    expect(names).toContain("search_notes");
    expect(names).toContain("list_files");
    expect(names).toContain("create_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("read_canvas");
    expect(names).toContain("export_pdf");
    expect(names).toContain("save_canvas");
    expect(result.tools).toHaveLength(8);
  });

  test("each tool has a description and valid inputSchema", async () => {
    const result = await client.listTools();

    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("tools have MCP annotations", async () => {
    const result = await client.listTools();

    const readFile = result.tools.find((t) => t.name === "read_file")!;
    expect(readFile.annotations?.readOnlyHint).toBe(true);
    expect(readFile.annotations?.openWorldHint).toBe(false);

    const editFile = result.tools.find((t) => t.name === "edit_file")!;
    expect(editFile.annotations?.readOnlyHint).toBe(false);
    expect(editFile.annotations?.destructiveHint).toBe(true);

    const saveCanvas = result.tools.find((t) => t.name === "save_canvas")!;
    expect(saveCanvas.annotations?.idempotentHint).toBe(true);
  });

  test("read_file tool has correct input schema", async () => {
    const result = await client.listTools();
    const readFile = result.tools.find((t) => t.name === "read_file")!;

    expect(readFile.inputSchema.properties).toHaveProperty("path");
    expect(readFile.inputSchema.required).toContain("path");
  });

  test("edit_file tool requires path, old_text, new_text", async () => {
    const result = await client.listTools();
    const editFile = result.tools.find((t) => t.name === "edit_file")!;

    expect(editFile.inputSchema.properties).toHaveProperty("path");
    expect(editFile.inputSchema.properties).toHaveProperty("old_text");
    expect(editFile.inputSchema.properties).toHaveProperty("new_text");
    expect(editFile.inputSchema.required).toContain("path");
    expect(editFile.inputSchema.required).toContain("old_text");
    expect(editFile.inputSchema.required).toContain("new_text");
  });
});

describe("MCP Protocol — tools/call", () => {
  test("read_file returns markdown with wikilink footer", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "Notes/RLHF.md" },
    });

    expect(result.isError).toBeFalsy();
    const textContent = result.content.find((c) => c.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    expect(textContent).toBeDefined();
    expect(textContent!.text).toContain("Reinforcement learning from human feedback");
    expect(textContent!.text).toContain("Linked files:");
    expect(textContent!.text).toContain("[[GRPO]]");
  });

  test("read_file returns image content for PNG files", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "Resources/Images/lecture_1_class_notes.png" },
    });

    expect(result.isError).toBeFalsy();
    const imageContent = result.content.find((c) => c.type === "image") as
      | { type: "image"; data: string; mimeType: string }
      | undefined;
    expect(imageContent).toBeDefined();
    expect(imageContent!.mimeType).toBe("image/png");
    expect(imageContent!.data.length).toBeGreaterThan(0);
  });

  test("read_file rejects path traversal", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "../../etc/passwd" },
    });

    expect(result.isError).toBe(true);
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.text).toContain("outside the vault");
  });

  test("search_notes finds matching content", async () => {
    const result = await client.callTool({
      name: "search_notes",
      arguments: { query: "reinforcement" },
    });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.text).toContain("RLHF.md");
  });

  test("search_notes returns no results gracefully", async () => {
    const result = await client.callTool({
      name: "search_notes",
      arguments: { query: "xyznonexistent999" },
    });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.text).toContain("No results found");
  });

  test("list_files lists vault contents", async () => {
    const result = await client.callTool({
      name: "list_files",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.text).toContain("RLHF.md");
    expect(textContent.text).toContain("lecture_1.pdf");
  });

  test("list_files filters by extension", async () => {
    const result = await client.callTool({
      name: "list_files",
      arguments: { extension: ".md" },
    });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.text).toContain(".md");
    expect(textContent.text).not.toContain(".pdf");
  });

  test("create_file and edit_file round-trip", async () => {
    const testPath = "Notes/_integration_test.md";
    const absolutePath = resolve(TEST_VAULT, testPath);

    try {
      // Create a file
      const createResult = await client.callTool({
        name: "create_file",
        arguments: { path: testPath, content: "# Integration Test\nOriginal content" },
      });
      expect(createResult.isError).toBeFalsy();

      // Read it back
      const readResult = await client.callTool({
        name: "read_file",
        arguments: { path: testPath },
      });
      expect(readResult.isError).toBeFalsy();
      const readText = (readResult.content[0] as { type: "text"; text: string }).text;
      expect(readText).toContain("Original content");

      // Edit it
      const editResult = await client.callTool({
        name: "edit_file",
        arguments: {
          path: testPath,
          old_text: "Original content",
          new_text: "Modified content",
        },
      });
      expect(editResult.isError).toBeFalsy();

      // Read again to verify
      const readAgain = await client.callTool({
        name: "read_file",
        arguments: { path: testPath },
      });
      const finalText = (readAgain.content[0] as { type: "text"; text: string }).text;
      expect(finalText).toContain("Modified content");
      expect(finalText).not.toContain("Original content");

      // Creating again should fail
      const dupResult = await client.callTool({
        name: "create_file",
        arguments: { path: testPath, content: "duplicate" },
      });
      expect(dupResult.isError).toBe(true);
    } finally {
      await rm(absolutePath, { force: true });
    }
  });

  test("save_canvas returns error without callback", async () => {
    const result = await client.callTool({
      name: "save_canvas",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });

  test("read_canvas returns error without iPad connection", async () => {
    const result = await client.callTool({
      name: "read_canvas",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.text).toContain("No canvas is open");
  });
});
