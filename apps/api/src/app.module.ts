import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { CafesModule } from './cafes/cafes.module';
import { buildTypeOrmConfig } from './config/typeorm.config';
import { RedisModule } from './redis/redis.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(buildTypeOrmConfig()),
    RedisModule,
    AuthModule,
    CafesModule,
    ReservationsModule,
  ],
})
export class AppModule {}
