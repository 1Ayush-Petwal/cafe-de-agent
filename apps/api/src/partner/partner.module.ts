import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CafesModule } from '../cafes/cafes.module';
import { Cafe } from '../entities/cafe.entity';
import { PartnerApiKey } from '../entities/partner-api-key.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { WebhookEndpoint } from '../entities/webhook-endpoint.entity';
import { ApiKeyGuard } from './api-key.guard';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';
import { WebhookDeliveryClient } from './webhook-delivery.client';
import { WebhookWorkerService } from './webhook-worker.service';

/**
 * Partner API v1 (issue #24, PRD area G): the partner-facing surface
 * (API-key-authenticated pull endpoints) and the webhook outbox consumer
 * that delivers to it, grouped the same way NotificationsModule groups the
 * customer-facing surface with its outbox consumer.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PartnerApiKey, WebhookEndpoint, Cafe, Slot, Reservation]), CafesModule],
  controllers: [PartnerController],
  providers: [ApiKeyGuard, PartnerService, WebhookDeliveryClient, WebhookWorkerService],
  exports: [WebhookDeliveryClient, WebhookWorkerService],
})
export class PartnerModule {}
