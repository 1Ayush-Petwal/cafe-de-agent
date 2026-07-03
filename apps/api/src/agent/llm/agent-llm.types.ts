/**
 * One turn of the agent's conversation, shaped like Gemini's `Content` so the
 * real client (agent-llm.client.ts) can pass it straight through — but kept
 * as our own plain type so the fake test client never needs the Gemini SDK.
 */
export interface LlmTurn {
  role: 'user' | 'model';
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

/** A tool the LLM may call, described as a JSON-schema parameter shape. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
