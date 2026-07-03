import { Injectable } from '@nestjs/common';
import { ToolSpec } from './llm/agent-llm.types';

/**
 * Tools = authenticated calls to the app's own public API (Roadmap M5) — no
 * privileged backend access, so the agent can never do anything a human
 * couldn't do through the same endpoints. `execute()` always goes over real
 * HTTP with the requesting user's own bearer token, including in tests
 * (`setBaseUrl` points it at the test app's own ephemeral `listen(0)` port).
 */
@Injectable()
export class AgentToolsService {
  private baseUrl = process.env.AGENT_API_BASE_URL || `http://127.0.0.1:${process.env.PORT ?? 3000}`;

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  readonly specs: ToolSpec[] = [
    {
      name: 'search_cafes',
      description: 'List all cafés available to book, with their id, name, area, and description.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'check_availability',
      description: 'Get per-table slot availability for a café on a given date.',
      parameters: {
        type: 'object',
        properties: {
          cafeId: { type: 'string', description: 'The café id, from search_cafes.' },
          date: { type: 'string', description: 'ISO date, e.g. 2026-08-01.' },
        },
        required: ['cafeId', 'date'],
      },
    },
    {
      name: 'hold_table',
      description: 'Place a short-lived hold on a specific table and slot so nobody else can take it while confirming.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          slotId: { type: 'string' },
        },
        required: ['tableId', 'slotId'],
      },
    },
    {
      name: 'confirm_hold',
      description:
        'Confirm a held table into a real, paid reservation. This spends money — always requires the customer to approve first.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          slotId: { type: 'string' },
          holdId: { type: 'string' },
        },
        required: ['tableId', 'slotId', 'holdId'],
      },
    },
    {
      name: 'ask_user',
      description:
        "Ask the customer a clarifying question when their request is ambiguous (e.g. no date, party size, or area given). Only use this when you genuinely can't proceed without an answer.",
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
        },
        required: ['question'],
      },
    },
  ];

  /** Tool calls that spend money and must park in AWAITING_APPROVAL before executing. */
  readonly spendingTools = new Set(['confirm_hold']);

  /** Pure control-flow signal — never goes over HTTP; parks in AWAITING_INPUT until the customer answers. */
  readonly clarifyingTools = new Set(['ask_user']);

  async execute(
    name: string,
    args: Record<string, unknown>,
    token: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'search_cafes':
        return this.call('GET', '/cafes', token);
      case 'check_availability':
        return this.call('GET', `/cafes/${args.cafeId}/availability?date=${args.date}`, token);
      case 'hold_table':
        return this.call('POST', '/reservations/hold', token, { tableId: args.tableId, slotId: args.slotId });
      case 'confirm_hold':
        return this.call(
          'POST',
          '/reservations/confirm',
          token,
          { tableId: args.tableId, slotId: args.slotId, holdId: args.holdId },
          idempotencyKey,
        );
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async call(
    method: string,
    path: string,
    token: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (payload as { message?: string }).message ?? `Tool call failed with status ${res.status}`;
      throw new Error(message);
    }
    return payload as Record<string, unknown>;
  }
}
