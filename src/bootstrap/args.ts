import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliArgs {
  provider?: string;
  model?: string;
  port: number;
}

export async function parseCliArgs(argv = process.argv): Promise<CliArgs> {
  const parsed = await yargs(hideBin(argv))
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
