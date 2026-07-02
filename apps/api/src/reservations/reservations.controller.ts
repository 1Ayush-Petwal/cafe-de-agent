import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { Reservation } from '../entities/reservation.entity';
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

  @Get('mine')
  findMine(@CurrentUser() user: JwtPayload): Promise<Reservation[]> {
    return this.reservations.findMine(user.sub);
  }

  @Delete(':id')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.reservations.cancel(user.sub, id);
  }
}
