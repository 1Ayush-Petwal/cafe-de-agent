import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildTypeOrmConfig } from '../config/typeorm.config';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * The separate worker process (issue #6, Roadmap M3): its own application
 * context, sharing the same TypeORM entity config as the API but with no
 * HTTP surface — it only drains the notification_jobs outbox.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), TypeOrmModule.forRoot(buildTypeOrmConfig()), NotificationsModule],
})
export class WorkerModule {}
