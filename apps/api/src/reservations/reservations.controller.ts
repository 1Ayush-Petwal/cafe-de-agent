import { Body, Controller, Delete, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { Reservation } from '../entities/reservation.entity';
import { Hold } from '../holds/holds.service';
import { ConfirmHoldDto } from './dto/confirm-hold.dto';
import { CreateHoldDto } from './dto/create-hold.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  book(@CurrentUser() user: JwtPayload, @Body() dto: CreateReservationDto): Promise<Reservation> {
    return this.reservations.book(user.sub, dto);
  }

  @Post('hold')
  hold(@CurrentUser() user: JwtPayload, @Body() dto: CreateHoldDto): Promise<Hold> {
    return this.reservations.hold(user.sub, dto);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmHoldDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<Reservation> {
    return this.reservations.confirmHold(user.sub, dto, idempotencyKey);
  }

  @Get('mine')
  findMine(@CurrentUser() user: JwtPayload): Promise<Reservation[]> {
    return this.reservations.findMine(user.sub);
  }

  @Delete(':id')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.reservations.cancel(user.sub, id);
  }
}
