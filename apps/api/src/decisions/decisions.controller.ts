import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { AgentDecision } from '../entities/agent-decision.entity';
import { DecisionLogService } from './decision-log.service';
import { DecisionsQueryDto } from './dto/decisions-query.dto';

/** Issue #6 (PRD area C): the audit-trail read endpoint — a mandate's ordered decision trace. */
@Controller('agent/decisions')
@UseGuards(JwtAuthGuard)
export class DecisionsController {
  constructor(private readonly decisions: DecisionLogService) {}

  @Get()
  trace(@CurrentUser() user: JwtPayload, @Query() query: DecisionsQueryDto): Promise<AgentDecision[]> {
    return this.decisions.findTrace(user.sub, query.mandateId);
  }
}
