import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { join } from "node:path";
import { listProviderNames } from "../llm/catalog.ts";

export interface CliArgs {
  provider?: string;
  model?: string;
  port: number;
  upgrade?: boolean;
}

// Read version — inlined at compile time via --define, with runtime fallback
declare const CLARK_VERSION: string | undefined;
export const version: string =
  typeof CLARK_VERSION !== "undefined"
    ? CLARK_VERSION
    : await Bun.file(join(import.meta.dir, "..", "..", "package.json"))
        .json()
        .then((p: { version?: string }) => p.version ?? "0.1.0")
        .catch(() => "0.1.0");

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
