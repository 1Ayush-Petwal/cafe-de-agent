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
  // The `/api` suffix mirrors main.ts setGlobalPrefix - the tool paths below
  // are public API routes, so they only resolve behind the prefix. Tests
  // override this via setBaseUrl with an app that has no prefix set.
  private baseUrl =
    process.env.AGENT_API_BASE_URL || `http://127.0.0.1:${process.env.PORT ?? 3000}/api`;

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
        'Confirm a held table into a real, paid reservation. This spends money. With no mandate attached to this ' +
        'conversation it always requires the customer to approve first. With a mandate attached, it completes ' +
        'immediately if within bounds, or comes back as a DENY result carrying the reason and remaining headroom ' +
        'if not — explain that to the customer instead of retrying blindly.',
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
      name: 'propose_alternatives',
      description:
        'When the requested table/slot is unavailable, or check_availability shows a cold slot inside the ' +
        "customer's window, get up to two alternative table+slot options for a café on a date. Each one is " +
        'already discounted if cold, and — when this conversation has a mandate attached — already screened so ' +
        "the mandate wouldn't refuse it.",
      parameters: {
        type: 'object',
        properties: {
          cafeId: { type: 'string', description: 'The café id, from search_cafes.' },
          date: { type: 'string', description: 'ISO date, e.g. 2026-08-01.' },
          excludeSlotId: { type: 'string', description: 'The slot the customer actually asked for, if any.' },
        },
        required: ['cafeId', 'date'],
      },
    },
    {
      name: 'get_mandate_status',
      description:
        "Read this conversation's own mandate: remaining budget, remaining bookings and expiry. Only useful when " +
        'a mandate is attached — call it before proposing a booking, since checking is cheaper than being refused.',
      parameters: { type: 'object', properties: {} },
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
    mandateId?: string,
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'search_cafes':
        return this.call('GET', '/cafes', token);
      case 'check_availability':
        return this.call('GET', `/cafes/${args.cafeId}/availability?date=${args.date}`, token);
      case 'propose_alternatives':
        return this.proposeAlternatives(args, token, mandateId);
      case 'hold_table':
        return this.call('POST', '/reservations/hold', token, { tableId: args.tableId, slotId: args.slotId });
      case 'confirm_hold':
        return this.confirmHold(args, token, idempotencyKey, mandateId);
      case 'get_mandate_status':
        if (!mandateId) {
          return { error: 'No mandate is attached to this conversation.' };
        }
        return this.call('GET', `/mandates/${mandateId}`, token);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Issue #10 (PRD area F): threads the conversation's own mandate through
   * as a query param so the alternatives endpoint can screen every
   * candidate through `previewMandate` before it ever reaches the model —
   * an alternative the mandate would refuse should never be proposed in the
   * first place, not proposed and then denied.
   */
  private async proposeAlternatives(
    args: Record<string, unknown>,
    token: string,
    mandateId?: string,
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ date: String(args.date) });
    if (args.excludeSlotId) {
      params.set('excludeSlotId', String(args.excludeSlotId));
    }
    if (mandateId) {
      params.set('mandateId', mandateId);
    }
    return this.call('GET', `/cafes/${args.cafeId}/alternatives?${params.toString()}`, token);
  }

  /**
   * Issue #7 (PRD area D): with a mandate attached, the atomic gate inside
   * `/reservations/confirm` is the sole arbiter — this just threads the
   * mandate through and, on a DENY, enriches it with the mandate's current
   * headroom so the model can explain *and* reason about what would fit,
   * rather than retrying blindly.
   */
  private async confirmHold(
    args: Record<string, unknown>,
    token: string,
    idempotencyKey?: string,
    mandateId?: string,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { tableId: args.tableId, slotId: args.slotId, holdId: args.holdId };
    if (mandateId) {
      body.mandateId = mandateId;
    }
    const result = await this.call('POST', '/reservations/confirm', token, body, idempotencyKey);
    if (mandateId && result.verdict === 'DENY') {
      const status = await this.call('GET', `/mandates/${mandateId}`, token);
      return { ...result, remainingMinor: status.remainingMinor, remainingBookings: status.remainingBookings };
    }
    return result;
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
      // A mandate DENY is a structured outcome, not a tool failure (issue
      // #7, PRD area D) — it's returned to the model as a functionResponse,
      // never thrown, so the agent can explain it and adapt instead of the
      // whole workflow failing.
      if ((payload as { verdict?: string }).verdict === 'DENY') {
        return payload as Record<string, unknown>;
      }
      const message = (payload as { message?: string }).message ?? `Tool call failed with status ${res.status}`;
      throw new Error(message);
    }
    return payload as Record<string, unknown>;
  }
}
