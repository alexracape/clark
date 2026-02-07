/**
 * LLM Provider abstraction layer.
 *
 * All providers must support streaming responses and tool use.
 * Vision capability is optional — providers without it skip canvas tools.
 */

// --- Message types ---

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  /** Base64-encoded image data */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolUseId: string;
  content: string | ImageContent[];
  isError?: boolean;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent;

export interface Message {
  role: Role;
  content: MessageContent[];
}

// --- Tool definitions ---

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  required?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

// --- Streaming ---

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface ToolUseDelta {
  type: "tool_use_start";
  id: string;
  name: string;
}

export interface ToolInputDelta {
  type: "tool_input_delta";
  id: string;
  input: string;
}

export interface StreamDone {
  type: "done";
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export type StreamChunk = TextDelta | ToolUseDelta | ToolInputDelta | StreamDone;

// --- Provider interface ---

export interface LLMProvider {
  readonly name: string;
  readonly supportsVision: boolean;

  chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk>;
}

// --- Provider registry ---

const providers = new Map<string, () => LLMProvider>();

export function registerProvider(name: string, factory: () => LLMProvider) {
  providers.set(name, factory);
}

export function createProvider(name: string): LLMProvider {
  const factory = providers.get(name);
  if (!factory) {
    const available = [...providers.keys()].join(", ");
    throw new Error(
      `Unknown LLM provider "${name}". Available: ${available}`,
    );
  }
  return factory();
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
