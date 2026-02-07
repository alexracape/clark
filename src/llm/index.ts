/**
 * LLM module — re-exports provider interface and registers all built-in providers.
 *
 * Import this module to ensure all providers are registered.
 */

// Register providers (side-effect imports)
import "./anthropic.ts";
import "./openai.ts";

// Re-export public API
export { createProvider, registerProvider, listProviders } from "./provider.ts";
export type {
  LLMProvider,
  Message,
  MessageContent,
  Tool,
  StreamChunk,
  TextDelta,
  ToolUseDelta,
  ToolInputDelta,
  StreamDone,
  Role,
} from "./provider.ts";
export { Conversation } from "./messages.ts";
