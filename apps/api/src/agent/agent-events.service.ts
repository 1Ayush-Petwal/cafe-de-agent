import { Inject, Injectable, MessageEvent } from '@nestjs/common';
import Redis from 'ioredis';
import { Observable } from 'rxjs';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Per-workflow SSE channel (issue #9) — same Redis pub/sub backplane and
 * duplicate-subscriber-per-client shape as AvailabilityEventsService (M4,
 * issue #7), just keyed by workflow id instead of café id, since agent
 * progress belongs to the one requesting user rather than every viewer of
 * a café.
 */
@Injectable()
export class AgentEventsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private channel(workflowId: string): string {
    return `agent:${workflowId}`;
  }

  async publish(workflowId: string): Promise<void> {
    await this.redis.publish(this.channel(workflowId), JSON.stringify({ workflowId }));
  }

  stream(workflowId: string): Observable<MessageEvent> {
    const channel = this.channel(workflowId);
    return new Observable<MessageEvent>((subscriber) => {
      const sub = this.redis.duplicate();
      const onMessage = (ch: string, message: string) => {
        if (ch !== channel) return;
        subscriber.next({ data: message });
      };
      sub.on('message', onMessage);
      sub.subscribe(channel).catch((err) => subscriber.error(err));

      return () => {
        sub.off('message', onMessage);
        sub.quit().catch(() => undefined);
      };
    });
  }
}
