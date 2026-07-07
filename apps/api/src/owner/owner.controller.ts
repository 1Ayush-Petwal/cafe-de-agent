import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { UserRole } from '../entities/user-role.enum';
import { AvailabilityQueryDto } from '../cafes/dto/availability-query.dto';
import { CreateCafeDto } from './dto/create-cafe.dto';
import { CreateTableDto } from './dto/create-table.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import { UpdateCafeDto } from './dto/update-cafe.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { OwnerService } from './owner.service';

@Controller('owner')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Post('cafes')
  createCafe(@CurrentUser() user: JwtPayload, @Body() dto: CreateCafeDto): Promise<Cafe> {
    return this.owner.createCafe(user.sub, dto);
  }

  @Get('cafes')
  listMyCafes(@CurrentUser() user: JwtPayload): Promise<Cafe[]> {
    return this.owner.listMyCafes(user.sub);
  }

  @Patch('cafes/:cafeId')
  updateCafe(
    @CurrentUser() user: JwtPayload,
    @Param('cafeId') cafeId: string,
    @Body() dto: UpdateCafeDto,
  ): Promise<Cafe> {
    return this.owner.updateCafe(user.sub, cafeId, dto);
  }

  @Post('cafes/:cafeId/tables')
  createTable(
    @CurrentUser() user: JwtPayload,
    @Param('cafeId') cafeId: string,
    @Body() dto: CreateTableDto,
  ): Promise<CafeTable> {
    return this.owner.createTable(user.sub, cafeId, dto);
  }

  @Get('cafes/:cafeId/tables')
  listTables(@CurrentUser() user: JwtPayload, @Param('cafeId') cafeId: string): Promise<CafeTable[]> {
    return this.owner.listTables(user.sub, cafeId);
  }

  @Patch('cafes/:cafeId/tables/:tableId')
  updateTable(
    @CurrentUser() user: JwtPayload,
    @Param('cafeId') cafeId: string,
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableDto,
  ): Promise<CafeTable> {
    return this.owner.updateTable(user.sub, cafeId, tableId, dto);
  }

  @Post('cafes/:cafeId/slots/generate')
  generateSlots(
    @CurrentUser() user: JwtPayload,
    @Param('cafeId') cafeId: string,
    @Body() dto: GenerateSlotsDto,
  ): Promise<Slot[]> {
    return this.owner.generateSlots(user.sub, cafeId, dto);
  }

  @Get('cafes/:cafeId/bookings')
  bookingsForDay(
    @CurrentUser() user: JwtPayload,
    @Param('cafeId') cafeId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<Reservation[]> {
    return this.owner.bookingsForDay(user.sub, cafeId, query.date);
  }
}
