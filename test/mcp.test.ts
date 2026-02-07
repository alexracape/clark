import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { createTools, type ToolDefinition } from "../src/mcp/tools.ts";
import { CanvasBroker } from "../src/canvas/server.ts";
import {
  extractWikilinks,
  buildFileIndex,
  resolveWikilink,
  buildLinkFooter,
  resolveVaultPath,
  isWithinVault,
  isImageFile,
  isPDFFile,
} from "../src/mcp/vault.ts";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");

// --- Vault utility tests ---

describe("Vault Utilities", () => {
  describe("extractWikilinks", () => {
    test("extracts regular wikilinks", () => {
      const links = extractWikilinks("See [[Reinforcement Learning]] for details");
      expect(links).toHaveLength(1);
      expect(links[0]!.name).toBe("Reinforcement Learning");
      expect(links[0]!.isEmbed).toBe(false);
    });

    test("extracts embed wikilinks", () => {
      const links = extractWikilinks("![[lecture_1.pdf]]");
      expect(links).toHaveLength(1);
      expect(links[0]!.name).toBe("lecture_1.pdf");
      expect(links[0]!.isEmbed).toBe(true);
    });

    test("extracts multiple links", () => {
      const content = "Uses [[Reinforcement Learning]] with [[PPO]], [[DPO]], and [[GRPO]]";
      const links = extractWikilinks(content);
      expect(links).toHaveLength(4);
      expect(links.map((l) => l.name)).toEqual([
        "Reinforcement Learning",
        "PPO",
        "DPO",
        "GRPO",
      ]);
    });

    test("deduplicates repeated links", () => {
      const content = "See [[RL]] and also [[RL]] again";
      const links = extractWikilinks(content);
      expect(links).toHaveLength(1);
    });

    test("returns empty array for no links", () => {
      const links = extractWikilinks("No links here");
      expect(links).toHaveLength(0);
    });
  });

  describe("buildFileIndex", () => {
    test("indexes files by name with and without extension", async () => {
      const index = await buildFileIndex(TEST_VAULT);
      // Should find by name without extension
      expect(index.has("reinforcement learning")).toBe(true);
      // Should find by name with extension
      expect(index.has("reinforcement learning.md")).toBe(true);
      expect(index.has("lecture_1.pdf")).toBe(true);
    });
  });

  describe("resolveWikilink", () => {
    test("resolves markdown file by name", async () => {
      const result = await resolveWikilink("Reinforcement Learning", TEST_VAULT);
      expect(result).toContain("Reinforcement Learning.md");
    });

    test("resolves PDF by filename", async () => {
      const result = await resolveWikilink("lecture_1.pdf", TEST_VAULT);
      expect(result).toContain("lecture_1.pdf");
    });

    test("resolves image by filename", async () => {
      const result = await resolveWikilink("lecture_1_class_notes.png", TEST_VAULT);
      expect(result).toContain("lecture_1_class_notes.png");
    });

    test("returns null for nonexistent file", async () => {
      const result = await resolveWikilink("nonexistent", TEST_VAULT);
      expect(result).toBeNull();
    });
  });

  describe("buildLinkFooter", () => {
    test("builds footer with resolved links", async () => {
      const links = extractWikilinks("[[Reinforcement Learning]] and ![[lecture_1.pdf]]");
      const footer = await buildLinkFooter(links, TEST_VAULT);
      expect(footer).toContain("Linked files:");
      expect(footer).toContain("[link] [[Reinforcement Learning]]");
      expect(footer).toContain("[embed] [[lecture_1.pdf]]");
    });

    test("marks unresolved links", async () => {
      const links = extractWikilinks("[[nonexistent]]");
      const footer = await buildLinkFooter(links, TEST_VAULT);
      expect(footer).toContain("(not found)");
    });

    test("returns empty string for no links", async () => {
      const footer = await buildLinkFooter([], TEST_VAULT);
      expect(footer).toBe("");
    });
  });

  describe("path validation", () => {
    test("isWithinVault accepts paths inside vault", () => {
      expect(isWithinVault(join(TEST_VAULT, "Notes/RLHF.md"), TEST_VAULT)).toBe(true);
    });

    test("isWithinVault rejects paths outside vault", () => {
      expect(isWithinVault("/etc/passwd", TEST_VAULT)).toBe(false);
    });

    test("isWithinVault rejects path traversal", () => {
      expect(isWithinVault(join(TEST_VAULT, "../../../etc/passwd"), TEST_VAULT)).toBe(false);
    });

    test("resolveVaultPath resolves relative paths", () => {
      const result = resolveVaultPath("Notes/RLHF.md", TEST_VAULT);
      expect(result).toBe(resolve(TEST_VAULT, "Notes/RLHF.md"));
    });

    test("resolveVaultPath rejects escaping paths", () => {
      const result = resolveVaultPath("../../etc/passwd", TEST_VAULT);
      expect(result).toBeNull();
    });
  });

  describe("file type detection", () => {
    test("detects image files", () => {
      expect(isImageFile("photo.png")).toBe(true);
      expect(isImageFile("photo.jpg")).toBe(true);
      expect(isImageFile("photo.jpeg")).toBe(true);
      expect(isImageFile("icon.svg")).toBe(true);
      expect(isImageFile("notes.md")).toBe(false);
    });

    test("detects PDF files", () => {
      expect(isPDFFile("doc.pdf")).toBe(true);
      expect(isPDFFile("doc.PDF")).toBe(true);
      expect(isPDFFile("doc.md")).toBe(false);
    });
  });
});

// --- MCP Tool tests ---

describe("MCP Tools", () => {
  let tools: ToolDefinition[];
  let broker: CanvasBroker;

  beforeEach(() => {
    broker = new CanvasBroker();
    tools = createTools({ broker, vaultDir: TEST_VAULT });
  });

  function findTool(name: string): ToolDefinition {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }

  test("createTools returns all expected tools", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("search_notes");
    expect(names).toContain("list_files");
    expect(names).toContain("create_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("read_canvas");
    expect(names).toContain("export_pdf");
    expect(names).toContain("save_canvas");
    expect(names).toHaveLength(8);
  });

  describe("read_file", () => {
    test("reads markdown file with wikilink footer", async () => {
      const tool = findTool("read_file");
      const result = await tool.handler({ path: "Notes/RLHF.md" });
      expect(result.isError).toBeUndefined();

      const text = result.content[0] as { type: "text"; text: string };
      expect(text.text).toContain("Reinforcement learning from human feedback");
      expect(text.text).toContain("Linked files:");
      expect(text.text).toContain("[[Reinforcement Learning]]");
      expect(text.text).toContain("[[GRPO]]");
    });

    test("reads markdown without links (no footer)", async () => {
      const tool = findTool("read_file");
      const result = await tool.handler({ path: "Notes/GRPO.md" });
      const text = result.content[0] as { type: "text"; text: string };
      expect(text.text).toContain("Group relative policy optimization");
      expect(text.text).not.toContain("Linked files:");
    });

    test("reads image file as base64", async () => {
      const tool = findTool("read_file");
      const result = await tool.handler({ path: "Resources/Images/lecture_1_class_notes.png" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.type).toBe("image");

      const img = result.content[0] as { type: "image"; data: string; mimeType: string };
      expect(img.mimeType).toBe("image/png");
      expect(img.data.length).toBeGreaterThan(0);
    });

    test("rejects path traversal", async () => {
      const tool = findTool("read_file");
      const result = await tool.handler({ path: "../../etc/passwd" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toContain("outside the vault");
    });

    test("returns error for nonexistent file", async () => {
      const tool = findTool("read_file");
      const result = await tool.handler({ path: "nonexistent.md" });
      expect(result.isError).toBe(true);
    });
  });

  describe("search_notes", () => {
    test("finds matching notes by keyword", async () => {
      const tool = findTool("search_notes");
      const result = await tool.handler({ query: "reinforcement" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("RLHF.md");
    });

    test("returns no results for unmatched query", async () => {
      const tool = findTool("search_notes");
      const result = await tool.handler({ query: "xyznonexistent123" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("No results found");
    });

    test("search is case-insensitive", async () => {
      const tool = findTool("search_notes");
      const result = await tool.handler({ query: "REINFORCEMENT" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("RLHF.md");
    });
  });

  describe("list_files", () => {
    test("lists all files in vault root", async () => {
      const tool = findTool("list_files");
      const result = await tool.handler({});
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("RLHF.md");
      expect(text).toContain("lecture_1.pdf");
    });

    test("lists files in subdirectory", async () => {
      const tool = findTool("list_files");
      const result = await tool.handler({ path: "Notes" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("RLHF.md");
      expect(text).not.toContain("lecture_1.pdf");
    });

    test("filters by extension", async () => {
      const tool = findTool("list_files");
      const result = await tool.handler({ extension: ".md" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain(".md");
      expect(text).not.toContain(".pdf");
      expect(text).not.toContain(".png");
    });

    test("rejects path traversal", async () => {
      const tool = findTool("list_files");
      const result = await tool.handler({ path: "../../" });
      expect(result.isError).toBe(true);
    });
  });

  describe("create_file", () => {
    const tempFile = "Notes/_test_created.md";
    const tempAbsolute = resolve(TEST_VAULT, tempFile);

    afterEach(async () => {
      try {
        await rm(tempAbsolute, { force: true });
      } catch {}
    });

    test("creates a new file", async () => {
      const tool = findTool("create_file");
      const result = await tool.handler({ path: tempFile, content: "# Test\nHello world" });
      expect(result.isError).toBeUndefined();

      const written = await Bun.file(tempAbsolute).text();
      expect(written).toBe("# Test\nHello world");
    });

    test("fails if file already exists", async () => {
      const tool = findTool("create_file");
      // Create it first
      await Bun.write(tempAbsolute, "existing");

      const result = await tool.handler({ path: tempFile, content: "new content" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toContain("already exists");

      // Original content unchanged
      const content = await Bun.file(tempAbsolute).text();
      expect(content).toBe("existing");
    });

    test("creates parent directories", async () => {
      const deepPath = "Notes/_test_subdir/_test_deep.md";
      const deepAbsolute = resolve(TEST_VAULT, deepPath);

      const tool = findTool("create_file");
      const result = await tool.handler({ path: deepPath, content: "deep file" });
      expect(result.isError).toBeUndefined();

      const written = await Bun.file(deepAbsolute).text();
      expect(written).toBe("deep file");

      // Cleanup
      await rm(resolve(TEST_VAULT, "Notes/_test_subdir"), { recursive: true, force: true });
    });

    test("rejects path traversal", async () => {
      const tool = findTool("create_file");
      const result = await tool.handler({ path: "../../evil.md", content: "hack" });
      expect(result.isError).toBe(true);
    });
  });

  describe("edit_file", () => {
    const tempFile = "Notes/_test_edit.md";
    const tempAbsolute = resolve(TEST_VAULT, tempFile);

    beforeEach(async () => {
      await Bun.write(tempAbsolute, "Hello world\nLine two\nLine three");
    });

    afterEach(async () => {
      try {
        await rm(tempAbsolute, { force: true });
      } catch {}
    });

    test("replaces text in file", async () => {
      const tool = findTool("edit_file");
      const result = await tool.handler({
        path: tempFile,
        old_text: "Line two",
        new_text: "Updated line",
      });
      expect(result.isError).toBeUndefined();

      const content = await Bun.file(tempAbsolute).text();
      expect(content).toBe("Hello world\nUpdated line\nLine three");
    });

    test("fails when old_text not found", async () => {
      const tool = findTool("edit_file");
      const result = await tool.handler({
        path: tempFile,
        old_text: "nonexistent text",
        new_text: "replacement",
      });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toContain("not found");
    });

    test("rejects path traversal", async () => {
      const tool = findTool("edit_file");
      const result = await tool.handler({
        path: "../../evil.md",
        old_text: "a",
        new_text: "b",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("read_canvas", () => {
    test("returns error when no client connected", async () => {
      const tool = findTool("read_canvas");
      const result = await tool.handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("text");
    });
  });

  describe("save_canvas", () => {
    test("returns error when no saveCanvas callback", async () => {
      const tool = findTool("save_canvas");
      const result = await tool.handler({});
      expect(result.isError).toBe(true);
    });

    test("calls saveCanvas callback when provided", async () => {
      let called = false;
      const toolsWithSave = createTools({
        broker,
        vaultDir: TEST_VAULT,
        saveCanvas: async () => { called = true; },
      });
      const tool = toolsWithSave.find((t) => t.name === "save_canvas")!;
      const result = await tool.handler({});
      expect(result.isError).toBeUndefined();
      expect(called).toBe(true);
    });
  });
});
