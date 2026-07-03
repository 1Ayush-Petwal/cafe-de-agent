import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { AgentEventsService } from './agent-events.service';
import { AgentService } from './agent.service';
import { AnswerWorkflowDto } from './dto/answer-workflow.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';

@Controller('agent/workflows')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly events: AgentEventsService,
    private readonly jwt: JwtService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWorkflowDto) {
    const workflow = await this.agent.create(user, dto.message);
    return { id: workflow.id, status: workflow.status };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agent.findOwned(user.sub, id);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const workflow = await this.agent.approve(user.sub, id);
    return { id: workflow.id, status: workflow.status };
  }

  @Post(':id/answer')
  @UseGuards(JwtAuthGuard)
  async answer(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: AnswerWorkflowDto) {
    const workflow = await this.agent.answer(user.sub, id, dto.answer);
    return { id: workflow.id, status: workflow.status };
  }

  /**
   * `EventSource` can't set an Authorization header, so this route takes the
   * token as a query param and verifies it itself (same self-decode idea as
   * RateLimitGuard) instead of running the header-only JwtAuthGuard.
   * Ownership is still enforced before the stream opens.
   */
  @Sse(':id/stream')
  async stream(@Param('id') id: string, @Query('token') token: string): Promise<Observable<MessageEvent>> {
    const payload = this.verify(token);
    await this.agent.findOwned(payload.sub, id);
    return this.events.stream(id);
  }

  private verify(token: string): JwtPayload {
    try {
      return this.jwt.verify<JwtPayload>(token ?? '');
    } catch {
      throw new UnauthorizedException('Invalid or missing token');
    }
  }
}
