import { Inject, Injectable, MessageEvent } from '@nestjs/common';
import Redis from 'ioredis';
import { Observable } from 'rxjs';
import { REDIS_CLIENT } from '../redis/redis.constants';

export type AvailabilityChangeType = 'held' | 'confirmed' | 'cancelled';

export interface AvailabilityChangedEvent {
  type: AvailabilityChangeType;
  cafeId: string;
  tableId: string;
  slotId: string;
}

/**
 * M4 (issue #7): the Redis pub/sub backplane that makes a booking-state
 * change committed on any API instance reach SSE clients connected to any
 * other instance — publish() and stream() never talk to each other
 * in-process, only through Redis, so this is the same mechanism whether
 * there's one API instance or ten.
 */
@Injectable()
export class AvailabilityEventsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private channel(cafeId: string): string {
    return `cafe:${cafeId}`;
  }

  async publish(event: AvailabilityChangedEvent): Promise<void> {
    await this.redis.publish(this.channel(event.cafeId), JSON.stringify(event));
  }

  /**
   * One dedicated subscriber connection per SSE client — ioredis puts a
   * connection in subscriber mode once it SUBSCRIBEs, so it can no longer
   * issue PUBLISH/other commands, hence `duplicate()` rather than reusing
   * the shared client. Cleaned up when the caller unsubscribes (the SSE
   * response closing, which Nest wires to Observable teardown).
   */
  stream(cafeId: string): Observable<MessageEvent> {
    const channel = this.channel(cafeId);
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
