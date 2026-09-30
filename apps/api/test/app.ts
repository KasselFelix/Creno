import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDb } from '@creno/db';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import type { AppConfig } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';
import { setupApp } from '../src/setup-app.js';

/** Démarre l'application complète sur la base de test (jamais de base mockée). */
export async function createTestApp(options: { databaseUrl?: string } = {}): Promise<INestApplication> {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) throw new Error('DATABASE_URL_TEST manquante (voir .env.example)');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testUrl;

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.databaseUrl) {
    builder.overrideProvider(DB).useValue(createDb(options.databaseUrl, { connectionTimeoutMillis: 500 }));
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}
