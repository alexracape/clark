import { loadClarkContext } from "../library.ts";

export async function loadEffectiveSystemPrompt(workspaceDir: string): Promise<string> {
  const systemPromptPath = new URL("../prompts/system.md", import.meta.url).pathname;
  const systemPrompt = await Bun.file(systemPromptPath).text();
  const clarkContext = await loadClarkContext(workspaceDir);

  if (!clarkContext) {
    return systemPrompt;
  }

  return `${systemPrompt}\n\n---\n## CLARK.md\n${clarkContext}`;
}
