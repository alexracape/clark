/**
 * Tests for input parsing, slash command detection, and command filtering.
 */

import { test, expect, describe } from "bun:test";
import { parseSlashCommand, COMMANDS, BUILTIN_COMMANDS, registerCommands } from "../src/tui/input.tsx";
import { CommandHistory } from "../src/tui/history.ts";

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

describe("registerCommands", () => {
  test("adds dynamic commands to COMMANDS", () => {
    const before = COMMANDS.length;
    registerCommands([
      { name: "class", description: "Track courses" },
      { name: "paper", description: "Academic papers" },
    ]);

    expect(COMMANDS.length).toBe(BUILTIN_COMMANDS.length + 2);
    expect(COMMANDS.map((c) => c.name)).toContain("class");
    expect(COMMANDS.map((c) => c.name)).toContain("paper");

    // Reset to avoid affecting other tests
    registerCommands([]);
    expect(COMMANDS.length).toBe(BUILTIN_COMMANDS.length);
  });

  test("does not modify BUILTIN_COMMANDS", () => {
    const originalLength = BUILTIN_COMMANDS.length;
    registerCommands([{ name: "test_skill", description: "Test" }]);

    expect(BUILTIN_COMMANDS.length).toBe(originalLength);
    expect(BUILTIN_COMMANDS.map((c) => c.name)).not.toContain("test_skill");

    // Reset
    registerCommands([]);
  });
});

describe("CommandHistory", () => {
  test("push and navigate up/down", () => {
    const h = new CommandHistory({ persist: false });
    h.push("first");
    h.push("second");
    h.push("third");

    expect(h.up("")).toBe("third");
    expect(h.up("")).toBe("second");
    expect(h.up("")).toBe("first");
    expect(h.up("")).toBeNull(); // at oldest

    expect(h.down()).toBe("second");
    expect(h.down()).toBe("third");
    expect(h.down()).toBe(""); // restores saved input
    expect(h.down()).toBeNull(); // already past newest
  });

  test("up saves and restores current input", () => {
    const h = new CommandHistory({ persist: false });
    h.push("old command");

    // User is typing "partial" then presses up
    expect(h.up("partial")).toBe("old command");
    // Down restores what they were typing
    expect(h.down()).toBe("partial");
  });

  test("skips consecutive duplicates", () => {
    const h = new CommandHistory({ persist: false });
    h.push("same");
    h.push("same");
    h.push("same");

    expect(h.getEntries()).toEqual(["same"]);
  });

  test("allows non-consecutive duplicates", () => {
    const h = new CommandHistory({ persist: false });
    h.push("a");
    h.push("b");
    h.push("a");

    expect(h.getEntries()).toEqual(["a", "b", "a"]);
  });

  test("ignores empty/whitespace entries", () => {
    const h = new CommandHistory({ persist: false });
    h.push("");
    h.push("   ");
    h.push("valid");

    expect(h.getEntries()).toEqual(["valid"]);
  });

  test("push resets navigation cursor", () => {
    const h = new CommandHistory({ persist: false });
    h.push("first");
    h.push("second");

    expect(h.up("")).toBe("second");
    expect(h.up("")).toBe("first");

    // New push resets cursor
    h.push("third");
    expect(h.up("")).toBe("third");
    expect(h.up("")).toBe("second");
  });
});
