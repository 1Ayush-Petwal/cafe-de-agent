import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from '../agent/agent.module';
import { buildTypeOrmConfig } from '../config/typeorm.config';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisModule } from '../redis/redis.module';

/**
 * The separate worker process (issue #6, Roadmap M3; extended by issue #9):
 * its own application context, sharing the same TypeORM entity config as the
 * API but with no HTTP surface — it drains the notification_jobs outbox and
 * drives pending agent workflows. `RedisModule` is imported explicitly here
 * (rather than relying on its `@Global()` decorator) because that only
 * reaches modules within the *same* application context, and this is a
 * separate one from the API's.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(buildTypeOrmConfig()),
    RedisModule,
    NotificationsModule,
    AgentModule,
  ],
})
export class WorkerModule {}
