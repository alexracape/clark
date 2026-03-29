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
  /** Opaque provider metadata (e.g., Google's thoughtSignature). Echoed on round-trip. */
  providerMetadata?: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolUseId: string;
  content: string | ImageContent[];
  isError?: boolean;
}

export interface ThinkingContent {
  type: "thinking";
  text: string;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

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

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
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
  /** Opaque provider metadata (e.g., Google's thoughtSignature). */
  providerMetadata?: Record<string, unknown>;
}

export interface ToolInputDelta {
  type: "tool_input_delta";
  id: string;
  input: string;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  text: string;
}

export interface StreamDone {
  type: "done";
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export type StreamChunk = TextDelta | ThinkingDelta | ToolUseDelta | ToolInputDelta | StreamDone;

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

const providers = new Map<string, (model?: string, options?: ProviderFactoryOptions) => LLMProvider>();

export interface ProviderFactoryOptions {
  apiKey?: string;
  cloudUrl?: string;
  maxTokens?: number;
  supportsVision?: boolean;
}

const providerOptions = new Map<string, ProviderFactoryOptions>();

export function registerProvider(name: string, factory: (model?: string, options?: ProviderFactoryOptions) => LLMProvider) {
  providers.set(name, factory);
}

export function setProviderOptions(name: string, options?: ProviderFactoryOptions) {
  if (!options) {
    providerOptions.delete(name);
    return;
  }
  providerOptions.set(name, options);
}

export function createProvider(name: string, model?: string): LLMProvider {
  const factory = providers.get(name);
  if (!factory) {
    const available = [...providers.keys()].join(", ");
    throw new Error(
      `Unknown LLM provider "${name}". Available: ${available}`,
    );
  }
  return factory(model, providerOptions.get(name));
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
