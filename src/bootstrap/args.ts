import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { join } from "node:path";

export interface CliArgs {
  provider?: string;
  model?: string;
  port: number;
}

// Read version from package.json (navigate to project root from src/bootstrap/)
const packageJsonPath = join(import.meta.dir, "..", "..", "package.json");
const packageJson = await Bun.file(packageJsonPath).json();
const version = packageJson.version || "0.1.0";

export async function parseCliArgs(argv = process.argv): Promise<CliArgs> {
  const parsed = await yargs(hideBin(argv))
    .version(version)
    .alias("v", "version")
    .option("provider", {
      type: "string",
      describe: "LLM provider (anthropic, openai, gemini, or ollama)",
    })
    .option("model", {
      type: "string",
      describe: "Specific model ID",
    })
    .option("port", {
      type: "number",
      default: 3000,
      describe: "Port for tldraw canvas server",
    })
    .help()
    .parse();

  return {
    provider: parsed.provider,
    model: parsed.model,
    port: parsed.port,
  };
}
