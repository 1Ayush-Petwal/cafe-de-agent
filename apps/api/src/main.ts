import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentWorkerService } from './agent/agent-worker.service';
import { AppModule } from './app.module';
import { OutboxWorkerService } from './notifications/outbox-worker.service';
import { WebhookWorkerService } from './partner/webhook-worker.service';

const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * Deploy shape: one process, one origin, one URL. The API answers under
 * `/api` (matching the dev proxy in apps/web/vite.config.ts) and everything
 * else falls through to the built SPA, so there is no CORS surface and no
 * second service to keep in sync.
 */
function serveWebApp(app: NestExpressApplication): void {
  const webDist = join(__dirname, '..', '..', 'web', 'dist');
  const indexHtml = join(webDist, 'index.html');
  if (!existsSync(indexHtml)) return; // API-only run (dev, tests): Vite serves the SPA.

  app.useStaticAssets(webDist);
  // React Router owns the client-side paths, several of which collide with API
  // routes (/cafes is both a page and a controller) — hence the `/api` prefix
  // above, and this fallback for deep links like /cafes/:id on a cold load.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexHtml);
  });
}

/**
 * The outbox/webhook/agent loops all claim rows with `SELECT ... FOR UPDATE
 * SKIP LOCKED`, so running them in the API process is safe at any instance
 * count — it just means N pollers instead of one. src/worker/main.ts remains
 * the split-out entrypoint for when the loops deserve their own machine
 * (docs/m7-scale-to-n-regions.md).
 */
function startWorkers(app: NestExpressApplication): void {
  const interval = (name: string) => Number(process.env[name]) || DEFAULT_POLL_INTERVAL_MS;
  app.get(OutboxWorkerService).start(interval('OUTBOX_POLL_INTERVAL_MS'));
  app.get(WebhookWorkerService).start(interval('WEBHOOK_POLL_INTERVAL_MS'));
  app.get(AgentWorkerService).start(interval('AGENT_POLL_INTERVAL_MS'));
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  serveWebApp(app);
  startWorkers(app);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap();
