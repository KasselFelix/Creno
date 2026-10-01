import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { setupApp } from './setup-app.js';

// Hors Docker, charge le .env racine (les variables déjà définies gardent la priorité).
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get<AppConfig>(APP_CONFIG);
  setupApp(app, config);

  await app.listen(config.API_PORT, '0.0.0.0');
  logger.log({ event: 'app.started', port: config.API_PORT, env: config.NODE_ENV }, 'Bootstrap');
}

void bootstrap();
