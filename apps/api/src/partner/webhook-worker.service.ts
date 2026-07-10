import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebhookEndpoint } from '../entities/webhook-endpoint.entity';
import { WebhookJobStatus } from '../entities/webhook-job-status.enum';
import { WebhookJob } from '../entities/webhook-job.entity';
import { WebhookDeliveryClient } from './webhook-delivery.client';

export const WEBHOOK_OUTBOX_BATCH_SIZE = 10;
export const WEBHOOK_OUTBOX_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1000;

/**
 * The Partner API's outbox consumer (issue #24, PRD area G) — the same
 * `SELECT ... FOR UPDATE SKIP LOCKED` claim-and-resolve loop
 * OutboxWorkerService (issue #6) uses for customer notifications, run here
 * as a second, independent consumer of the same outbox pattern rather than
 * a shared abstraction: the two queues have already diverged in shape
 * (structured payload vs a message string, per-reservation vs
 * per-(reservation, event) uniqueness) and are free to diverge further —
 * e.g. a different retry policy — without coupling the two.
 *
 * A job whose café has no registered webhook endpoint resolves DONE
 * immediately, without a delivery attempt — nothing failed, there's just
 * nowhere to send it yet. The Partner API's pull endpoints exist precisely
 * so a café that registers an endpoint later can reconcile past bookings
 * instead of relying on webhooks alone.
 */
@Injectable()
export class WebhookWorkerService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly delivery: WebhookDeliveryClient,
  ) {}

  start(pollIntervalMs = 1000): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.processOnce().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('webhook worker tick failed', err);
      });
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One tick: claim due jobs, attempt delivery, resolve every claimed job. Returns jobs processed. */
  async processOnce(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const jobs = await manager
        .createQueryBuilder(WebhookJob, 'job')
        .where('job.status = :status', { status: WebhookJobStatus.PENDING })
        .andWhere('job.availableAt <= now()')
        .orderBy('job.createdAt', 'ASC')
        .limit(WEBHOOK_OUTBOX_BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const job of jobs) {
        try {
          const endpoint = await manager.findOne(WebhookEndpoint, { where: { cafeId: job.cafeId } });
          if (endpoint) {
            await this.delivery.deliver(endpoint.url, job.payload);
          }
          job.status = WebhookJobStatus.DONE;
          job.lastError = endpoint ? null : 'No webhook endpoint registered for this café';
        } catch (err) {
          job.attempts += 1;
          job.lastError = err instanceof Error ? err.message : String(err);
          job.status =
            job.attempts >= WEBHOOK_OUTBOX_MAX_ATTEMPTS ? WebhookJobStatus.DEAD_LETTER : WebhookJobStatus.PENDING;
          job.availableAt = new Date(Date.now() + BACKOFF_BASE_MS * job.attempts);
        }
        await manager.save(job);
      }

      return jobs.length;
    });
  }
}
