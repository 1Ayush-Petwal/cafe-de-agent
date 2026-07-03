import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { LlmTurn, ToolSpec } from './agent-llm.types';

const MODEL = 'gemini-2.0-flash';

/**
 * A scripted turn can be a function of the conversation so far — needed
 * because a real tool-use loop feeds a prior tool's *result* into the next
 * call's arguments (e.g. `confirm_hold` needs the `holdId` that
 * `hold_table`'s response just produced), and that value doesn't exist until
 * the test runs. The script stays fully deterministic; it just isn't fully
 * static.
 */
export type ScriptedTurn = LlmTurn | ((history: LlmTurn[]) => LlmTurn);

/**
 * The thin client boundary the PRD calls for (M5): the whole agent loop only
 * ever talks to this one method. Real calls go to Gemini's function-calling
 * API; tests script a fixed sequence of turns via `script()`, which short-
 * circuits `nextStep()` before it ever reaches the network — "no real LLM
 * calls in tests" holds by construction, not by mocking a lower layer.
 */
@Injectable()
export class AgentLlmClient {
  private scripted: ScriptedTurn[] | null = null;
  private client: GoogleGenAI | null = null;

  /** Test-only: queue a fixed sequence of model turns, one per `nextStep()` call. */
  script(turns: ScriptedTurn[]): void {
    this.scripted = [...turns];
  }

  clearScript(): void {
    this.scripted = null;
  }

  async nextStep(systemInstruction: string, history: LlmTurn[], tools: ToolSpec[]): Promise<LlmTurn> {
    if (this.scripted) {
      const next = this.scripted.shift();
      if (!next) {
        throw new Error('AgentLlmClient script exhausted — the test scripted fewer turns than the loop needed');
      }
      return typeof next === 'function' ? next(history) : next;
    }
    return this.callGemini(systemInstruction, history, tools);
  }

  private async callGemini(systemInstruction: string, history: LlmTurn[], tools: ToolSpec[]): Promise<LlmTurn> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set — cannot call the agent without an LLM provider key');
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey });
    }

    const response = await this.client.models.generateContent({
      model: MODEL,
      contents: history.map(toContent),
      config: {
        systemInstruction,
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
      },
    });

    const call = response.functionCalls?.[0];
    if (call?.name) {
      return { role: 'model', functionCall: { name: call.name, args: call.args ?? {} } };
    }
    return { role: 'model', text: response.text ?? '' };
  }
}

function toContent(turn: LlmTurn) {
  if (turn.functionCall) {
    return { role: turn.role, parts: [{ functionCall: turn.functionCall }] };
  }
  if (turn.functionResponse) {
    return { role: turn.role, parts: [{ functionResponse: turn.functionResponse }] };
  }
  return { role: turn.role, parts: [{ text: turn.text ?? '' }] };
}
