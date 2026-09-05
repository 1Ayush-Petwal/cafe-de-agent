import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { CafesModule } from './cafes/cafes.module';
import { buildTypeOrmConfig } from './config/typeorm.config';
import { DecisionsModule } from './decisions/decisions.module';
import { GeoModule } from './geo/geo.module';
import { MandatesModule } from './mandates/mandates.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OwnerModule } from './owner/owner.module';
import { PartnerModule } from './partner/partner.module';
import { PaymentsModule } from './payments/payments.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RedisModule } from './redis/redis.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(buildTypeOrmConfig()),
    RedisModule,
    AuthModule,
    RateLimitModule,
    CafesModule,
    GeoModule,
    ReservationsModule,
    MandatesModule,
    DecisionsModule,
    NotificationsModule,
    OwnerModule,
    PartnerModule,
    PaymentsModule,
    AgentModule,
  ],
})
export class AppModule {}
