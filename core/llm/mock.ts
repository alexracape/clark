/**
 * Mock LLM provider for testing.
 *
 * Returns configurable canned responses and records all calls
 * for assertions. Supports simulating text responses, tool calls,
 * and multi-turn conversations.
 */

import {
  type LLMProvider,
  type Message,
  type Tool,
  type StreamChunk,
  registerProvider,
} from "./provider.ts";

/** A single canned response the mock will return */
export interface MockResponse {
  /** Text to stream back */
  text?: string;
  /** Tool calls to emit */
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /** Stop reason */
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
}

/** Record of a single chat() call for assertions */
export interface MockCall {
  messages: Message[];
  tools: Tool[];
  systemPrompt: string;
}

export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly supportsVision: boolean;

  /** Queue of responses to return. Shifts one per chat() call. */
  private responses: MockResponse[];
  /** All calls made to chat() */
  readonly calls: MockCall[] = [];

  constructor(responses: MockResponse[] = [], supportsVision = true) {
    this.responses = [...responses];
    this.supportsVision = supportsVision;
  }

  /** Add more responses to the queue */
  enqueue(...responses: MockResponse[]) {
    this.responses.push(...responses);
  }

  /** Get the last call made to chat() */
  get lastCall(): MockCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  async *chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    this.calls.push({ messages: [...messages], tools: [...tools], systemPrompt });

    const response = this.responses.shift();
    if (!response) {
      yield { type: "text_delta", text: "(no more mock responses)" };
      yield { type: "done", stopReason: "end_turn" };
      return;
    }

    // Stream text character by character (or in small chunks for realism)
    if (response.text) {
      // Simulate streaming with small chunks
      const chunkSize = 10;
      for (let i = 0; i < response.text.length; i += chunkSize) {
        yield { type: "text_delta", text: response.text.slice(i, i + chunkSize) };
      }
    }

    // Emit tool calls
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield { type: "tool_use_start", id: tc.id, name: tc.name };
        yield { type: "tool_input_delta", id: tc.id, input: JSON.stringify(tc.input) };
      }
    }

    const stopReason = response.stopReason
      ?? (response.toolCalls?.length ? "tool_use" : "end_turn");
    yield { type: "done", stopReason };
  }
}

// Register for use via createProvider("mock")
registerProvider("mock", () => new MockProvider());
