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

type StreamProviderMetadata = Record<string, unknown>;

export type StopReason = "end_turn" | "tool_use" | "max_tokens";

export interface StreamStart {
  type: "start";
}

export interface StepStart {
  type: "start-step";
}

export interface TextStart {
  type: "text-start";
  id: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface TextDelta {
  type: "text-delta";
  id: string;
  text: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface TextEnd {
  type: "text-end";
  id: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface ReasoningStart {
  type: "reasoning-start";
  id: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface ReasoningDelta {
  type: "reasoning-delta";
  id: string;
  text: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface ReasoningEnd {
  type: "reasoning-end";
  id: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface ToolInputStart {
  type: "tool-input-start";
  id: string;
  toolName: string;
  /** Opaque provider metadata (e.g., Google's thoughtSignature). */
  providerMetadata?: StreamProviderMetadata;
}

export interface ToolInputDelta {
  type: "tool-input-delta";
  id: string;
  delta: string;
}

export interface ToolInputEnd {
  type: "tool-input-end";
  id: string;
  providerMetadata?: StreamProviderMetadata;
}

export interface ToolCall {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  providerMetadata?: StreamProviderMetadata;
}

export interface StepFinish {
  type: "finish-step";
  finishReason: StopReason;
  providerMetadata?: StreamProviderMetadata;
}

export interface StreamFinish {
  type: "finish";
  finishReason: StopReason;
}

export interface StreamAbort {
  type: "abort";
  reason?: string;
}

export type StreamChunk =
  | StreamStart
  | StepStart
  | TextStart
  | TextDelta
  | TextEnd
  | ReasoningStart
  | ReasoningDelta
  | ReasoningEnd
  | ToolInputStart
  | ToolInputDelta
  | ToolInputEnd
  | ToolCall
  | StepFinish
  | StreamFinish
  | StreamAbort;

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
