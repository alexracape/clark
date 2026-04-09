/**
 * LLM module — re-exports provider interface and registers all built-in providers.
 *
 * Import this module to ensure all providers are registered.
 *
 * Cloud providers (Anthropic, OpenAI, Gemini) are routed through the
 * Clark Cloud proxy — see core/llm/cloud.ts. Only Ollama (local) has
 * a direct provider implementation.
 */

// Register providers (side-effect imports)
import "./cloud.ts";
import "./ollama.ts";
import "./mock.ts";

// Re-export public API
export { createProvider, registerProvider, listProviders } from "./provider.ts";
export type {
  LLMProvider,
  Message,
  MessageContent,
  Tool,
  StreamChunk,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolCall,
  StreamFinish,
  StopReason,
  Role,
} from "./provider.ts";
export { Conversation } from "./messages.ts";
