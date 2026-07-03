import { NestFactory } from '@nestjs/core';
import { AgentWorkerService } from '../agent/agent-worker.service';
import { OutboxWorkerService } from '../notifications/outbox-worker.service';
import { WorkerModule } from './worker.module';

const DEFAULT_POLL_INTERVAL_MS = 1000;

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);

  const notificationWorker = app.get(OutboxWorkerService);
  const outboxPollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  notificationWorker.start(outboxPollIntervalMs);
  // eslint-disable-next-line no-console
  console.log(`Notification worker started, polling every ${outboxPollIntervalMs}ms`);

  const agentWorker = app.get(AgentWorkerService);
  const agentPollIntervalMs = Number(process.env.AGENT_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  agentWorker.start(agentPollIntervalMs);
  // eslint-disable-next-line no-console
  console.log(`Agent worker started, polling every ${agentPollIntervalMs}ms`);
}

bootstrap();
