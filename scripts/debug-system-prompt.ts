import { scaffoldLibrary } from "../core/library.ts";
import { getWorkspaceDir } from "../core/workspace.ts";
import { loadEffectiveSystemPrompt } from "../cli/bootstrap/system-prompt.ts";
import { createTools } from "../core/mcp/index.ts";
import { toLLMTools } from "../core/engine.ts";

async function main(): Promise<void> {
  const withTools = process.argv.includes("--with-tools");
  const workspaceDir = getWorkspaceDir();

  // Match app bootstrap behavior before prompt assembly.
  await scaffoldLibrary(workspaceDir);

  const prompt = await loadEffectiveSystemPrompt(workspaceDir);
  process.stdout.write(`${prompt}\n`);

  if (!withTools) return;

  const tools = createTools({
    getBroker: () => null,
    getVaultDir: () => workspaceDir,
    getExportDir: () => workspaceDir,
    getSaveCanvas: () => null,
    getOCRProvider: () => null,
  });

  const llmTools = toLLMTools(tools);
  process.stdout.write("\n\n---\n## TOOL_DEFINITIONS\n");
  process.stdout.write(`${JSON.stringify(llmTools, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("Failed to load effective system prompt:");
  console.error(message);
  process.exit(1);
});
