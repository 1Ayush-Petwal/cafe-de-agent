import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

@Module({
  imports: [AuthModule],
  providers: [RateLimitService, { provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
