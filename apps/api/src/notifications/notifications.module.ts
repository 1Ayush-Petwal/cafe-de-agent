import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Notification } from '../entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotifierService } from './notifier.service';
import { OutboxWorkerService } from './outbox-worker.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), AuthModule],
  controllers: [NotificationsController],
  providers: [NotifierService, OutboxWorkerService],
  exports: [NotifierService, OutboxWorkerService],
})
export class NotificationsModule {}
