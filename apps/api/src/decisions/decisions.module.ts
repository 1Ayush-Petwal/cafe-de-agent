import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentDecision } from '../entities/agent-decision.entity';
import { Mandate } from '../entities/mandate.entity';
import { DecisionLogService } from './decision-log.service';
import { DecisionsController } from './decisions.controller';

/**
 * Standalone module (issue #6, PRD area C): both `MandatesModule` (proposals)
 * and `ReservationsModule` (authorize/confirm) need `DecisionLogService`, and
 * the trace endpoint needs mandate ownership — importing `MandatesModule`
 * here to reuse `MandatesService` would cycle back through this module, so
 * ownership is checked directly against the `Mandate` repository instead.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AgentDecision, Mandate])],
  controllers: [DecisionsController],
  providers: [DecisionLogService],
  exports: [DecisionLogService],
})
export class DecisionsModule {}
