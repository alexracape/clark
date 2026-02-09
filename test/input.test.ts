/**
 * Tests for input parsing, slash command detection, and command filtering.
 */

import { test, expect, describe } from "bun:test";
import { parseSlashCommand, COMMANDS } from "../src/tui/input.tsx";

describe("parseSlashCommand", () => {
  test("returns null for regular text", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
    expect(parseSlashCommand("no slash here")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("  spaces  ")).toBeNull();
  });

  test("parses command with no args", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
    expect(parseSlashCommand("/clear")).toEqual({ name: "clear", args: "" });
    expect(parseSlashCommand("/canvas")).toEqual({ name: "canvas", args: "" });
  });

  test("parses command with args", () => {
    expect(parseSlashCommand("/problem ./pset3.pdf")).toEqual({
      name: "problem",
      args: "./pset3.pdf",
    });
    expect(parseSlashCommand("/notes ~/Notes/CS229")).toEqual({
      name: "notes",
      args: "~/Notes/CS229",
    });
    expect(parseSlashCommand("/export /tmp/output.pdf")).toEqual({
      name: "export",
      args: "/tmp/output.pdf",
    });
  });

  test("handles leading whitespace", () => {
    expect(parseSlashCommand("  /help")).toEqual({ name: "help", args: "" });
    expect(parseSlashCommand("  /notes ~/path")).toEqual({ name: "notes", args: "~/path" });
  });

  test("handles multiple spaces between command and args", () => {
    expect(parseSlashCommand("/problem   ./file.pdf")).toEqual({
      name: "problem",
      args: "./file.pdf",
    });
  });

  test("handles args with spaces", () => {
    expect(parseSlashCommand("/problem ./my problem set.pdf")).toEqual({
      name: "problem",
      args: "./my problem set.pdf",
    });
  });
});

describe("COMMANDS", () => {
  test("all expected commands are defined", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names).toContain("help");
    expect(names).toContain("canvas");
    expect(names).toContain("export");
    expect(names).toContain("save");
    expect(names).toContain("notes");
    expect(names).toContain("model");
    expect(names).toContain("context");
    expect(names).toContain("compact");
    expect(names).toContain("clear");
  });

  test("all commands have descriptions", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  test("filtering commands by prefix", () => {
    // Simulates what the Input component does
    const filter = (partial: string) =>
      COMMANDS.filter((c) => c.name.startsWith(partial));

    expect(filter("")).toHaveLength(COMMANDS.length); // all commands
    expect(filter("s")).toHaveLength(1); // save
    expect(filter("sa")).toHaveLength(1); // save
    expect(filter("c")).toHaveLength(4); // canvas, context, compact, clear
    expect(filter("cl")).toHaveLength(1); // clear
    expect(filter("co")).toHaveLength(2); // context, compact
    expect(filter("xyz")).toHaveLength(0); // no match
    expect(filter("h")).toHaveLength(1); // help
    expect(filter("e")).toHaveLength(1); // export
    expect(filter("m")).toHaveLength(1); // model
    expect(filter("n")).toHaveLength(1); // notes
  });
});
