import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AgentWorkflowStatus } from '../entities/agent-workflow-status.enum';
import { AgentWorkflow } from '../entities/agent-workflow.entity';
import { AgentEventsService } from './agent-events.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentLlmClient } from './llm/agent-llm.client';

export const AGENT_BATCH_SIZE = 5;
const MAX_STEPS_PER_TICK = 8;

const SYSTEM_INSTRUCTION = `You are a booking agent for a café table-reservation platform. You act on behalf of the
customer, using only the tools provided — you have no other way to affect the system.
Typical flow: search_cafes to find a café matching the request, check_availability for a date to find a free
table+slot, hold_table to hold it, then confirm_hold to pay and finalize. confirm_hold spends the customer's
money, so only call it once you've already held the specific table and slot they want.
Once the reservation is confirmed, reply with plain text (no further tool call) summarizing what was booked.`;

/**
 * The worker half of the durable agent workflow (issue #9, Roadmap M5):
 * `processOnce()` claims PENDING rows via `SELECT ... FOR UPDATE SKIP
 * LOCKED` (same shape as OutboxWorkerService, issue #6) and drives each to
 * its next pause point — AWAITING_APPROVAL, DONE, or FAILED. A crash
 * mid-loop rolls the whole transaction back, so the row is simply retried
 * from PENDING on the next tick; nothing is ever left half-applied.
 *
 * Per the PRD's testing decision, tests call `processOnce()` directly
 * rather than starting the timer, exactly like the outbox worker.
 */
@Injectable()
export class AgentWorkerService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly llm: AgentLlmClient,
    private readonly tools: AgentToolsService,
    private readonly events: AgentEventsService,
  ) {}

  start(pollIntervalMs = 1000): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.processOnce().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('agent worker tick failed', err);
      });
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async processOnce(): Promise<number> {
    const processedIds: string[] = [];
    const count = await this.dataSource.transaction(async (manager) => {
      const rows = await manager
        .createQueryBuilder(AgentWorkflow, 'w')
        .where('w.status = :status', { status: AgentWorkflowStatus.PENDING })
        .orderBy('w.createdAt', 'ASC')
        .limit(AGENT_BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const workflow of rows) {
        await this.runWorkflow(workflow);
        await manager.save(workflow);
        processedIds.push(workflow.id);
      }
      return rows.length;
    });

    // Published only after commit, so a subscriber that refetches on this
    // event always sees the persisted state, never a pending transaction.
    for (const id of processedIds) {
      await this.events.publish(id);
    }
    return count;
  }

  private async runWorkflow(workflow: AgentWorkflow): Promise<void> {
    const token = this.jwt.sign({ sub: workflow.userId, email: workflow.email, role: workflow.role });

    if (workflow.pendingAction) {
      const action = workflow.pendingAction;
      workflow.pendingAction = null;
      await this.runTool(workflow, action.name, action.args, token);
      if (workflow.status === AgentWorkflowStatus.FAILED) {
        return;
      }
    }

    for (let step = 0; step < MAX_STEPS_PER_TICK; step++) {
      let turn;
      try {
        turn = await this.llm.nextStep(SYSTEM_INSTRUCTION, workflow.history, this.tools.specs);
      } catch (err) {
        this.fail(workflow, err);
        return;
      }
      workflow.history = [...workflow.history, turn];

      if (!turn.functionCall) {
        workflow.status = AgentWorkflowStatus.DONE;
        return;
      }

      if (this.tools.spendingTools.has(turn.functionCall.name)) {
        workflow.pendingAction = { name: turn.functionCall.name, args: turn.functionCall.args };
        workflow.status = AgentWorkflowStatus.AWAITING_APPROVAL;
        return;
      }

      await this.runTool(workflow, turn.functionCall.name, turn.functionCall.args, token);
      if (workflow.status === AgentWorkflowStatus.FAILED) {
        return;
      }
    }

    this.fail(workflow, new Error('Agent exceeded its step budget for this request'));
  }

  private async runTool(
    workflow: AgentWorkflow,
    name: string,
    args: Record<string, unknown>,
    token: string,
  ): Promise<void> {
    try {
      const idempotencyKey = name === 'confirm_hold' ? `agent:${workflow.id}` : undefined;
      const result = await this.tools.execute(name, args, token, idempotencyKey);
      workflow.history = [...workflow.history, { role: 'user', functionResponse: { name, response: result } }];
      if (name === 'confirm_hold' && typeof result.id === 'string') {
        workflow.reservationId = result.id;
      }
    } catch (err) {
      this.fail(workflow, err);
    }
  }

  private fail(workflow: AgentWorkflow, err: unknown): void {
    workflow.status = AgentWorkflowStatus.FAILED;
    workflow.failureReason = err instanceof Error ? err.message : String(err);
  }
}
