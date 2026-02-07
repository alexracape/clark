import { test, expect, describe } from "bun:test";
import { createTools } from "../src/mcp/tools.ts";
import { CanvasBroker } from "../src/canvas/server.ts";

describe("MCP Tools", () => {
  test("createTools returns all expected tools", () => {
    const broker = new CanvasBroker();
    const tools = createTools({ broker });

    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("search_notes");
    expect(names).toContain("list_files");
    expect(names).toContain("read_canvas");
    expect(names).toContain("export_pdf");
    expect(names).toContain("save_canvas");
  });

  test("search_notes returns error when no notes dir configured", async () => {
    const broker = new CanvasBroker();
    const tools = createTools({ broker });
    const searchTool = tools.find((t) => t.name === "search_notes")!;

    const result = await searchTool.handler({ query: "test" });
    expect(result.isError).toBe(true);
  });

  test("read_canvas returns error when no client connected", async () => {
    const broker = new CanvasBroker();
    const tools = createTools({ broker });
    const canvasTool = tools.find((t) => t.name === "read_canvas")!;

    const result = await canvasTool.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toHaveProperty("text");
  });
});
