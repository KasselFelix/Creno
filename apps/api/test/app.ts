import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createDb, type DbHandle, users } from '@creno/db';
import type { Provider, PublicUser, Resource, UserRole } from '@creno/shared';
import { AppModule } from '../src/app.module.js';
import { addLocalDays, localDateOf, wallTimeToInstant } from '../src/availability/slots.engine.js';
import { LOG_STREAM } from '../src/common/logger.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import type { AppConfig } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';
import { setupApp } from '../src/setup-app.js';

export const TEST_PASSWORD = 'un-mot-de-passe-de-test';
export const WEB_ORIGIN = 'http://localhost:3000';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquante (voir .env.example)');
  return url;
}

export interface TestAppOptions {
  /** Remplace la base (ex. base injoignable). */
  databaseUrl?: string;
  /** Limite de requêtes d'auth par minute (très haute par défaut pour ne pas gêner les autres tests). */
  authRateLimit?: number;
  /** Capture les logs JSON de l'application. */
  logs?: string[];
}

/** Démarre l'application complète sur la base de test (jamais de base mockée). */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    WEB_ORIGIN,
    JWT_ACCESS_SECRET: 'secret-de-test-secret-de-test-secret-de-test',
    AUTH_RATE_LIMIT_PER_MINUTE: String(options.authRateLimit ?? 1000),
    LOG_LEVEL: 'info',
  });

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.databaseUrl) {
    builder
      .overrideProvider(DB)
      .useValue(createDb(options.databaseUrl, { connectionTimeoutMillis: 500 }));
  }
  if (options.logs) {
    const logs = options.logs;
    builder.overrideProvider(LOG_STREAM).useValue(
      new Writable({
        write(chunk: Buffer, _enc, done) {
          logs.push(...chunk.toString().split('\n').filter(Boolean));
          done();
        },
      }),
    );
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  // Comme main.ts : les `Logger` Nest des services écrivent dans pino (capturé ici).
  if (options.logs) app.useLogger(app.get(Logger));
  setupApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}

export function dbOf(app: INestApplication): DbHandle {
  return app.get<DbHandle>(DB);
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  await dbOf(app).db.execute(
    sql`TRUNCATE sessions, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@test.dev`;
}

/** Inscrit un utilisateur via l'API et renvoie un agent Supertest qui garde ses cookies. */
export async function registerAs(
  app: INestApplication,
  role: 'customer' | 'provider' = 'customer',
): Promise<{ agent: ReturnType<typeof request.agent>; user: PublicUser }> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/v1/auth/register')
    .send({ email: uniqueEmail(role), password: TEST_PASSWORD, fullName: `Test ${role}`, role })
    .expect(201);
  return { agent, user: (res.body as { user: PublicUser }).user };
}

/** Crée un admin directement en base (le rôle admin n'est jamais ouvert à l'inscription) et le connecte. */
export async function loginAsAdmin(
  app: INestApplication,
): Promise<{ agent: ReturnType<typeof request.agent>; user: PublicUser }> {
  const email = uniqueEmail('admin');
  await dbOf(app)
    .db.insert(users)
    .values({
      email,
      fullName: 'Admin',
      role: 'admin' satisfies UserRole,
      passwordHash: await hash(TEST_PASSWORD),
    });
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return { agent, user: (res.body as { user: PublicUser }).user };
}

/** Valeur d'un cookie dans les en-têtes Set-Cookie d'une réponse. */
export function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0] || undefined;
}

export function setCookieLine(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

type Agent = ReturnType<typeof request.agent>;

export const PROVIDER_INPUT = {
  name: 'Studio Lumière',
  category: 'photographer',
  description: 'Studio photo',
  address: '12 rue Oberkampf',
  city: 'Paris',
  latitude: 48.8644,
  longitude: 2.3696,
};

export const RESOURCE_INPUT = {
  name: 'Studio A',
  description: '',
  timezone: 'Europe/Paris',
  slotMinutes: 60,
  priceCents: 4500,
};

/** Inscrit un prestataire, crée son profil et une ressource ouverte tous les jours de 09:00 à 12:00. */
export async function createProviderWithResource(
  app: INestApplication,
  resource: Partial<typeof RESOURCE_INPUT> = {},
): Promise<{ agent: Agent; user: PublicUser; provider: Provider; resource: Resource }> {
  const { agent, user } = await registerAs(app, 'provider');
  const provider = await agent.post('/v1/providers').send(PROVIDER_INPUT).expect(201);
  const created = await agent
    .post('/v1/resources')
    .send({ ...RESOURCE_INPUT, ...resource })
    .expect(201);
  const resourceId = (created.body as Resource).id;
  await agent
    .put(`/v1/resources/${resourceId}/availability-rules`)
    .send({ rules: everyDay('09:00', '12:00') })
    .expect(200);
  return {
    agent,
    user,
    provider: provider.body as Provider,
    resource: created.body as Resource,
  };
}

export function everyDay(startTime: string, endTime: string) {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime, endTime }));
}

/** Date locale de la ressource dans `days` jours : toujours dans le futur, jamais au-delà de l'horizon. */
export function localDateIn(days: number, timezone = RESOURCE_INPUT.timezone): string {
  return addLocalDays(localDateOf(new Date(), timezone), days);
}

/** Instant d'une heure locale de la ressource dans `days` jours. */
export function instantIn(days: number, time: string, timezone = RESOURCE_INPUT.timezone): Date {
  return wallTimeToInstant(localDateIn(days, timezone), time, timezone);
}
