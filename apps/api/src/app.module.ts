import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { CafesModule } from './cafes/cafes.module';
import { buildTypeOrmConfig } from './config/typeorm.config';
import { NotificationsModule } from './notifications/notifications.module';
import { OwnerModule } from './owner/owner.module';
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
    ReservationsModule,
    NotificationsModule,
    OwnerModule,
    AgentModule,
  ],
})
export class AppModule {}
