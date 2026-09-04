import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { CreateMandateDto } from './dto/create-mandate.dto';
import { MandatesService, MandateView } from './mandates.service';

@Controller('mandates')
@UseGuards(JwtAuthGuard)
export class MandatesController {
  constructor(private readonly mandates: MandatesService) {}

  @Post()
  grant(@CurrentUser() user: JwtPayload, @Body() dto: CreateMandateDto): Promise<MandateView> {
    return this.mandates.grant(user.sub, dto);
  }

  @Get(':id')
  getStatus(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<MandateView> {
    return this.mandates.getStatus(user.sub, id);
  }

  @Post(':id/revoke')
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<MandateView> {
    return this.mandates.revoke(user.sub, id);
  }
}
