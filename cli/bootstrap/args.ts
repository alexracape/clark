import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { listProviderNames } from "../../core/llm/catalog.ts";
import { version } from "../../core/version.ts";

export interface CliArgs {
  provider?: string;
  model?: string;
  port: number;
  upgrade?: boolean;
}

export { version };

export async function parseCliArgs(argv = process.argv): Promise<CliArgs> {
  const providers = listProviderNames().join(", ");
  const parsed = await yargs(hideBin(argv))
    .version(version)
    .alias("v", "version")
    .option("provider", {
      type: "string",
      describe: `LLM provider (${providers})`,
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
    .option("upgrade", {
      type: "boolean",
      describe: "Upgrade Clark to the latest version",
    })
    .alias("upgrade", "update")
    .help()
    .parse();

  return {
    provider: parsed.provider,
    model: parsed.model,
    port: parsed.port,
    upgrade: parsed.upgrade,
  };
}
