import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { Notification } from '../entities/notification.entity';

/** The mock in-app channel the customer sees: what the worker has delivered so far. */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(@InjectRepository(Notification) private readonly notifications: Repository<Notification>) {}

  @Get('mine')
  findMine(@CurrentUser() user: JwtPayload): Promise<Notification[]> {
    return this.notifications.find({ where: { userId: user.sub }, order: { createdAt: 'DESC' } });
  }
}
