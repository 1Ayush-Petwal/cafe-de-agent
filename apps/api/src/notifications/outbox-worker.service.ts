import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NotificationJobStatus } from '../entities/notification-job-status.enum';
import { NotificationJob } from '../entities/notification-job.entity';
import { Notification } from '../entities/notification.entity';
import { NotifierService } from './notifier.service';

export const OUTBOX_BATCH_SIZE = 10;
export const OUTBOX_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1000;

/**
 * The queue consumer (issue #6, Roadmap M3): `SELECT ... FOR UPDATE SKIP
 * LOCKED` claims a batch of due jobs so a second concurrent worker instance
 * skips rows already being worked rather than double-processing them. Each
 * job is attempted, then always resolved to done/retry-with-backoff/
 * dead-letter within the same transaction — a job is never left stuck in
 * limbo by an unhandled worker crash mid-loop (the whole batch just rolls
 * back and gets picked up again next tick).
 *
 * Delivery itself is idempotent (Notification.reservationId is unique via
 * `ON CONFLICT DO NOTHING`), so redelivering a job that already succeeded
 * — e.g. a crash between `deliver()` resolving and the job being marked
 * done — has no double effect on what the customer sees.
 *
 * Per the PRD's testing decision, the worker runs in-process during tests:
 * `processOnce()` is called directly rather than started on a timer, so
 * tests are deterministic instead of racing real poll intervals.
 */
@Injectable()
export class OutboxWorkerService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
  ) {}

  start(pollIntervalMs = 1000): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.processOnce().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('outbox worker tick failed', err);
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
        .createQueryBuilder(NotificationJob, 'job')
        .where('job.status = :status', { status: NotificationJobStatus.PENDING })
        .andWhere('job.availableAt <= now()')
        .orderBy('job.createdAt', 'ASC')
        .limit(OUTBOX_BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const job of jobs) {
        try {
          await this.notifier.deliver();
          await manager
            .createQueryBuilder()
            .insert()
            .into(Notification)
            .values({ userId: job.userId, reservationId: job.reservationId, message: job.message })
            .orIgnore()
            .execute();
          job.status = NotificationJobStatus.DONE;
          job.lastError = null;
        } catch (err) {
          job.attempts += 1;
          job.lastError = err instanceof Error ? err.message : String(err);
          job.status =
            job.attempts >= OUTBOX_MAX_ATTEMPTS ? NotificationJobStatus.DEAD_LETTER : NotificationJobStatus.PENDING;
          job.availableAt = new Date(Date.now() + BACKOFF_BASE_MS * job.attempts);
        }
        await manager.save(job);
      }

      return jobs.length;
    });
  }
}
