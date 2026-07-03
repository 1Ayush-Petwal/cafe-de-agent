import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AgentWorkflow } from '../entities/agent-workflow.entity';
import { AgentController } from './agent.controller';
import { AgentEventsService } from './agent-events.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentWorkerService } from './agent-worker.service';
import { AgentService } from './agent.service';
import { AgentLlmClient } from './llm/agent-llm.client';

@Module({
  imports: [TypeOrmModule.forFeature([AgentWorkflow]), AuthModule],
  controllers: [AgentController],
  providers: [AgentService, AgentEventsService, AgentToolsService, AgentLlmClient, AgentWorkerService],
  exports: [AgentService, AgentEventsService, AgentToolsService, AgentLlmClient, AgentWorkerService],
})
export class AgentModule {}
