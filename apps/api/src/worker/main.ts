import { NestFactory } from '@nestjs/core';
import { OutboxWorkerService } from '../notifications/outbox-worker.service';
import { WorkerModule } from './worker.module';

const DEFAULT_POLL_INTERVAL_MS = 1000;

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const worker = app.get(OutboxWorkerService);
  const pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  worker.start(pollIntervalMs);
  // eslint-disable-next-line no-console
  console.log(`Notification worker started, polling every ${pollIntervalMs}ms`);
}

bootstrap();
