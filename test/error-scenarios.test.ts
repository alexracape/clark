/**
 * Error scenario tests - network failures, config corruption, invalid inputs
 *
 * Tests that the application handles various failure modes gracefully
 * and provides actionable error messages to users.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { mkdtemp, rm, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createTools } from "../src/mcp/tools.ts";
import { CanvasBroker } from "../src/canvas/server.ts";
import { MockProvider } from "../src/llm/mock.ts";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");

describe("Config Error Scenarios", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "clark-config-test-"));
	});

	afterEach(async () => {
		if (tmpDir) {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	test("malformed config.json returns empty config", async () => {
		const configPath = join(tmpDir, ".clark", "config.json");
		await mkdir(join(tmpDir, ".clark"), { recursive: true });
		await writeFile(configPath, "{ invalid json");

		// Mock HOME to point to temp dir
		const originalHome = process.env.HOME;
		process.env.HOME = tmpDir;

		try {
			const config = await loadConfig();
			// Should return empty config instead of throwing
			expect(config).toBeDefined();
			expect(typeof config).toBe("object");
		} finally {
			process.env.HOME = originalHome;
		}
	});

	test("empty config.json returns empty config", async () => {
		const configPath = join(tmpDir, ".clark", "config.json");
		await mkdir(join(tmpDir, ".clark"), { recursive: true });
		await writeFile(configPath, "");

		const originalHome = process.env.HOME;
		process.env.HOME = tmpDir;

		try {
			const config = await loadConfig();
			expect(config).toBeDefined();
			expect(typeof config).toBe("object");
		} finally {
			process.env.HOME = originalHome;
		}
	});

	test("missing config directory returns empty config", async () => {
		// Don't create .clark directory
		const originalHome = process.env.HOME;
		process.env.HOME = tmpDir;

		try {
			const config = await loadConfig();
			expect(config).toBeDefined();
			expect(typeof config).toBe("object");
		} finally {
			process.env.HOME = originalHome;
		}
	});
});

describe("File System Error Scenarios", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "clark-fs-test-"));
	});

	afterEach(async () => {
		if (tmpDir) {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	test("read_file handles ENOENT gracefully", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const readFile = tools.find((t) => t.name === "read_file")!;
		const result = await readFile.handler({ path: "Notes/DoesNotExist.md" });

		expect(result.isError).toBe(true);
		expect(result.content[0]!.type).toBe("text");
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/not found|does not exist|enoent/i);
		}
	});

	test("create_file handles permission errors", async () => {
		// Create a read-only directory
		const readOnlyDir = join(tmpDir, "readonly");
		await mkdir(readOnlyDir);
		await chmod(readOnlyDir, 0o555); // Read + execute only

		const tools = createTools({
			getBroker: () => null,
			vaultDir: readOnlyDir,
			getSaveCanvas: () => null,
		});

		const createFile = tools.find((t) => t.name === "create_file")!;

		try {
			const result = await createFile.handler({
				path: "test.md",
				content: "test content",
			});

			expect(result.isError).toBe(true);
			if (result.content[0]!.type === "text") {
				expect(result.content[0]!.text.toLowerCase()).toMatch(/permission|eacces/i);
			}
		} finally {
			// Restore permissions for cleanup
			await chmod(readOnlyDir, 0o755);
		}
	});

	test("create_file rejects creating file that already exists", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const createFile = tools.find((t) => t.name === "create_file")!;
		const result = await createFile.handler({
			path: "Notes/RLHF.md", // Already exists
			content: "new content",
		});

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/already exists/i);
		}
	});

	test("edit_file handles nonexistent file", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const editFile = tools.find((t) => t.name === "edit_file")!;
		const result = await editFile.handler({
			path: "Notes/Nonexistent.md",
			oldText: "old",
			newText: "new",
		});

		expect(result.isError).toBe(true);
	});
});

describe("Path Traversal Security", () => {
	test("read_file rejects path traversal attempts", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const readFile = tools.find((t) => t.name === "read_file")!;
		const result = await readFile.handler({ path: "../../etc/passwd" });

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/outside|vault/i);
		}
	});

	test("create_file rejects path traversal", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const createFile = tools.find((t) => t.name === "create_file")!;
		const result = await createFile.handler({
			path: "../../../tmp/evil.md",
			content: "evil content",
		});

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/outside|vault/i);
		}
	});

	test("edit_file rejects absolute paths outside vault", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const editFile = tools.find((t) => t.name === "edit_file")!;
		const result = await editFile.handler({
			path: "/etc/passwd",
			oldText: "root",
			newText: "hacked",
		});

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/outside|vault/i);
		}
	});
});

describe("Canvas Connection Errors", () => {
	test("read_canvas fails when no broker available", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const readCanvas = tools.find((t) => t.name === "read_canvas")!;
		const result = await readCanvas.handler({});

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/no canvas|not open/i);
		}
	});

	test("read_canvas fails when broker not connected", async () => {
		const broker = new CanvasBroker(); // Created but not connected

		const tools = createTools({
			getBroker: () => broker,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const readCanvas = tools.find((t) => t.name === "read_canvas")!;
		const result = await readCanvas.handler({});

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			// Should fail with "no client connected" or similar
			expect(result.content[0]!.text.toLowerCase()).toMatch(/no (canvas|ipad|client)/i);
		}
	});

	test("export_pdf fails gracefully when no canvas", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const exportPdf = tools.find((t) => t.name === "export_pdf")!;
		const result = await exportPdf.handler({});

		expect(result.isError).toBe(true);
		if (result.content[0]!.type === "text") {
			expect(result.content[0]!.text.toLowerCase()).toMatch(/no canvas/i);
		}
	});
});

describe("LLM Provider Errors", () => {
	test("MockProvider handles empty response queue gracefully", async () => {
		const provider = new MockProvider([]);

		const chunks = [];
		for await (const chunk of provider.chat([], [], "system")) {
			chunks.push(chunk);
		}

		// Should return fallback response instead of crashing
		expect(chunks.length).toBeGreaterThan(0);
		const textChunks = chunks.filter((c) => c.type === "text_delta");
		expect(textChunks.length).toBeGreaterThan(0);
	});

	test("MockProvider can simulate errors", async () => {
		const provider = new MockProvider([]);

		// Override chat to throw an error
		const originalChat = provider.chat.bind(provider);
		provider.chat = async function* () {
			throw new Error("Network timeout");
		};

		try {
			const chunks = [];
			for await (const chunk of provider.chat([], [], "system")) {
				chunks.push(chunk);
			}
			expect(true).toBe(false); // Should not reach here
		} catch (err) {
			expect(err).toBeDefined();
			if (err instanceof Error) {
				expect(err.message).toContain("Network timeout");
			}
		}
	});
});

describe("Input Validation", () => {
	test("search_notes handles empty query", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const searchNotes = tools.find((t) => t.name === "search_notes")!;
		const result = await searchNotes.handler({ query: "" });

		// Empty query might return no results or an error
		// Either is acceptable as long as it doesn't crash
		expect(result).toBeDefined();
		expect(result.content).toBeDefined();
	});

	test("search_notes handles special regex characters", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const searchNotes = tools.find((t) => t.name === "search_notes")!;
		const result = await searchNotes.handler({ query: ".*[]()" });

		// Should handle regex special chars without crashing
		expect(result).toBeDefined();
		expect(result.content).toBeDefined();
	});

	test("list_files handles nonexistent directory", async () => {
		const tools = createTools({
			getBroker: () => null,
			vaultDir: TEST_VAULT,
			getSaveCanvas: () => null,
		});

		const listFiles = tools.find((t) => t.name === "list_files")!;
		const result = await listFiles.handler({ path: "NonexistentDir" });

		expect(result.isError).toBe(true);
	});

	test("create_file handles empty content", async () => {
		const tmpVault = await mkdtemp(join(tmpdir(), "clark-vault-"));

		try {
			const tools = createTools({
				getBroker: () => null,
				vaultDir: tmpVault,
				getSaveCanvas: () => null,
			});

			const createFile = tools.find((t) => t.name === "create_file")!;
			const result = await createFile.handler({
				path: "empty.md",
				content: "",
			});

			// Empty content should be allowed
			expect(result.isError).not.toBe(true);
		} finally {
			await rm(tmpVault, { recursive: true, force: true });
		}
	});
});

describe("Edge Cases", () => {
	test("read_file handles very large file gracefully", async () => {
		const tmpVault = await mkdtemp(join(tmpdir(), "clark-vault-"));

		try {
			// Create a large file (1MB of text)
			const largePath = join(tmpVault, "large.md");
			const largeContent = "a".repeat(1024 * 1024);
			await writeFile(largePath, largeContent);

			const tools = createTools({
				getBroker: () => null,
				vaultDir: tmpVault,
				getSaveCanvas: () => null,
			});

			const readFile = tools.find((t) => t.name === "read_file")!;
			const result = await readFile.handler({ path: "large.md" });

			// Should handle large files (may truncate, but shouldn't crash)
			expect(result).toBeDefined();
			expect(result.content).toBeDefined();
		} finally {
			await rm(tmpVault, { recursive: true, force: true });
		}
	});

	test("search_notes handles vault with many files", async () => {
		const tmpVault = await mkdtemp(join(tmpdir(), "clark-vault-"));

		try {
			// Create many files
			for (let i = 0; i < 100; i++) {
				await writeFile(join(tmpVault, `file${i}.md`), `Content ${i}`);
			}

			const tools = createTools({
				getBroker: () => null,
				vaultDir: tmpVault,
				getSaveCanvas: () => null,
			});

			const searchNotes = tools.find((t) => t.name === "search_notes")!;
			const result = await searchNotes.handler({ query: "Content" });

			// Should handle many results without crashing
			expect(result).toBeDefined();
			expect(result.content[0]!.type).toBe("text");
		} finally {
			await rm(tmpVault, { recursive: true, force: true });
		}
	});

	test("create_file handles filenames with special characters", async () => {
		const tmpVault = await mkdtemp(join(tmpdir(), "clark-vault-"));

		try {
			const tools = createTools({
				getBroker: () => null,
				vaultDir: tmpVault,
				getSaveCanvas: () => null,
			});

			const createFile = tools.find((t) => t.name === "create_file")!;

			// Test with spaces and special chars (but not path separators)
			const result = await createFile.handler({
				path: "file with spaces & chars.md",
				content: "test",
			});

			// Should handle special characters in filenames
			expect(result).toBeDefined();
		} finally {
			await rm(tmpVault, { recursive: true, force: true });
		}
	});
});
