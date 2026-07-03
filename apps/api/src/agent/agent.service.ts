import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../auth/jwt.strategy';
import { AgentWorkflowStatus } from '../entities/agent-workflow-status.enum';
import { AgentWorkflow } from '../entities/agent-workflow.entity';

@Injectable()
export class AgentService {
  constructor(@InjectRepository(AgentWorkflow) private readonly workflows: Repository<AgentWorkflow>) {}

  /**
   * Returns immediately with a PENDING row — the loop itself runs on the
   * worker's next poll, never inside this HTTP request (issue #9, Roadmap
   * M5).
   */
  create(user: JwtPayload, message: string): Promise<AgentWorkflow> {
    return this.workflows.save(
      this.workflows.create({
        userId: user.sub,
        email: user.email,
        role: user.role,
        request: message,
        history: [{ role: 'user', text: message }],
      }),
    );
  }

  async findOwned(userId: string, id: string): Promise<AgentWorkflow> {
    const workflow = await this.workflows.findOne({ where: { id } });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    if (workflow.userId !== userId) {
      throw new ForbiddenException('You can only view your own agent workflows');
    }
    return workflow;
  }

  /** Flips AWAITING_APPROVAL back to PENDING — the worker's next poll resumes and executes the parked spend step. */
  async approve(userId: string, id: string): Promise<AgentWorkflow> {
    const workflow = await this.findOwned(userId, id);
    if (workflow.status !== AgentWorkflowStatus.AWAITING_APPROVAL) {
      throw new ConflictException('This workflow is not awaiting approval');
    }
    workflow.status = AgentWorkflowStatus.PENDING;
    return this.workflows.save(workflow);
  }

  /**
   * Resolves an AWAITING_INPUT pause (issue #10): unlike approval, there's no
   * real API tool call to execute — `ask_user` is a pure control-flow signal,
   * so the customer's answer is appended straight to the conversation as the
   * tool's functionResponse and the workflow goes back to PENDING for the
   * worker's next poll to keep reasoning with it.
   */
  async answer(userId: string, id: string, text: string): Promise<AgentWorkflow> {
    const workflow = await this.findOwned(userId, id);
    if (workflow.status !== AgentWorkflowStatus.AWAITING_INPUT) {
      throw new ConflictException('This workflow is not awaiting an answer');
    }
    const toolName = workflow.pendingAction?.name ?? 'ask_user';
    workflow.history = [
      ...workflow.history,
      { role: 'user', functionResponse: { name: toolName, response: { answer: text } } },
    ];
    workflow.pendingAction = null;
    workflow.status = AgentWorkflowStatus.PENDING;
    return this.workflows.save(workflow);
  }
}
