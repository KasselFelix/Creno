import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { hash } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import request from 'supertest';
import { vi } from 'vitest';
import { createDb, type DbHandle, providers, users } from '@creno/db';
import type { Provider, PublicUser, Resource, UserRole } from '@creno/shared';
import { AppModule } from '../src/app.module.js';
import { addLocalDays, localDateOf, wallTimeToInstant } from '../src/availability/slots.engine.js';
import { LOG_STREAM } from '../src/common/logger.js';
import { GEOCODER, type Geocoder } from '../src/geocoding/geocoder.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import type { AppConfig } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';
import { PAYMENTS_GATEWAY, type PaymentsGateway } from '../src/payments/payments-gateway.js';
import { setupApp } from '../src/setup-app.js';

export const TEST_PASSWORD = 'un-mot-de-passe-de-test';
export const WEB_ORIGIN = 'http://localhost:3000';
/** Secret de webhook de test, tiré au hasard à chaque exécution : aucun secret en dur dans le dépôt. */
export const TEST_WEBHOOK_SECRET = ['whsec', randomBytes(24).toString('hex')].join('_');

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
  /** Limite des lectures publiques par minute (très haute par défaut). */
  publicRateLimit?: number;
  /** Capture les logs JSON de l'application. */
  logs?: string[];
  /** Remplace le géocodeur (service externe) : les tests n'appellent jamais le vrai. */
  geocoder?: Geocoder;
  /** Remplace Stripe. Sans cette option, la passerelle est « non configurée » (503), jamais le vrai Stripe. */
  payments?: PaymentsGateway;
}

/** Démarre l'application complète sur la base de test (jamais de base mockée). */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    WEB_ORIGIN,
    JWT_ACCESS_SECRET: 'secret-de-test-secret-de-test-secret-de-test',
    AUTH_RATE_LIMIT_PER_MINUTE: String(options.authRateLimit ?? 1000),
    PUBLIC_RATE_LIMIT_PER_MINUTE: String(options.publicRateLimit ?? 100_000),
    BOOKING_RATE_LIMIT_PER_MINUTE: '100000',
    LOG_LEVEL: 'info',
    // Vide = absente : même si le .env local contient une vraie clé de test, les tests ne l'utilisent pas.
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: '',
    STRIPE_PLATFORM_FEE_BPS: '1000',
  });

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.databaseUrl) {
    builder
      .overrideProvider(DB)
      .useValue(createDb(options.databaseUrl, { connectionTimeoutMillis: 500 }));
  }
  if (options.geocoder) builder.overrideProvider(GEOCODER).useValue(options.geocoder);
  if (options.payments) builder.overrideProvider(PAYMENTS_GATEWAY).useValue(options.payments);
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

  // `rawBody` comme dans main.ts : la signature du webhook Stripe porte sur le corps brut.
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
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
    sql`TRUNCATE sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
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

let accounts = 0;

/** Active les paiements d'un prestataire, comme après l'onboarding Stripe. Renvoie son compte de test. */
export async function enablePayments(app: INestApplication, providerId: string): Promise<string> {
  accounts += 1;
  const accountId = `acct_test_${Date.now()}_${accounts}`;
  await dbOf(app)
    .db.update(providers)
    .set({ stripeAccountId: accountId, stripeChargesEnabled: true, stripeDetailsSubmitted: true })
    .where(eq(providers.id, providerId));
  return accountId;
}

/**
 * Inscrit un prestataire, crée son profil et une ressource ouverte tous les jours de 09:00 à 12:00.
 * Ses paiements sont actifs, sauf `payments: false`.
 */
export async function createProviderWithResource(
  app: INestApplication,
  resource: Partial<typeof RESOURCE_INPUT> = {},
  { payments = true }: { payments?: boolean } = {},
): Promise<{
  agent: Agent;
  user: PublicUser;
  provider: Provider;
  resource: Resource;
  stripeAccountId: string | null;
}> {
  const { agent, user } = await registerAs(app, 'provider');
  const provider = await agent.post('/v1/providers').send(PROVIDER_INPUT).expect(201);
  const stripeAccountId = payments
    ? await enablePayments(app, (provider.body as Provider).id)
    : null;
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
    stripeAccountId,
  };
}

/** Faux Stripe : chaque méthode est un mock qui réussit par défaut. */
export function fakePaymentsGateway() {
  let created = 0;
  return {
    createConnectAccount: vi.fn<PaymentsGateway['createConnectAccount']>(async () => {
      created += 1;
      return { accountId: `acct_fake_${Date.now()}_${created}` };
    }),
    createAccountLink: vi.fn<PaymentsGateway['createAccountLink']>(async ({ accountId }) => ({
      url: `https://connect.stripe.test/setup/${accountId}`,
    })),
    retrieveAccount: vi.fn<PaymentsGateway['retrieveAccount']>(async () => ({
      chargesEnabled: true,
      detailsSubmitted: true,
    })),
    createCheckoutSession: vi.fn<PaymentsGateway['createCheckoutSession']>(
      async ({ bookingId }) => ({
        sessionId: sessionIdOf(bookingId),
        url: `https://checkout.stripe.test/pay/${bookingId}`,
      }),
    ),
    retrieveCheckoutSession: vi.fn<PaymentsGateway['retrieveCheckoutSession']>(
      async (sessionId) => ({
        sessionId,
        url: `https://checkout.stripe.test/pay/${sessionId.replace('cs_test_', '')}`,
      }),
    ),
    expireCheckoutSession: vi.fn<PaymentsGateway['expireCheckoutSession']>(async () => {}),
    refund: vi.fn<PaymentsGateway['refund']>(async () => {}),
  } satisfies PaymentsGateway;
}

/** Remet un faux Stripe dans son état initial (appels oubliés, réponses par défaut rétablies). */
export function resetPaymentsGateway(gateway: ReturnType<typeof fakePaymentsGateway>): void {
  const fresh = fakePaymentsGateway();
  for (const name of Object.keys(fresh) as (keyof typeof fresh)[]) {
    gateway[name].mockReset();
    gateway[name].mockImplementation(fresh[name].getMockImplementation() as never);
  }
}

export const sessionIdOf = (bookingId: string) => `cs_test_${bookingId}`;

let events = 0;

/**
 * Envoie un événement au webhook, signé comme le fait Stripe (HMAC du corps brut avec le secret).
 * `secret` et `id` se remplacent pour tester une mauvaise signature ou un événement rejoué.
 */
export function postStripeEvent(
  app: INestApplication,
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; secret?: string; account?: string } = {},
) {
  events += 1;
  const payload = JSON.stringify({
    id: options.id ?? `evt_test_${Date.now()}_${events}`,
    object: 'event',
    // Renseigné par Stripe sur les événements d'un compte connecté.
    ...(options.account ? { account: options.account } : {}),
    type,
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? TEST_WEBHOOK_SECRET,
  });
  return request(app.getHttpServer())
    .post('/v1/payments/webhook')
    .set('content-type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);
}

/** Objet `checkout.session` tel que Stripe l'envoie pour un paiement réussi de la réservation. */
export function paidSession(
  booking: { id: string; priceCents: number },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: sessionIdOf(booking.id),
    object: 'checkout.session',
    client_reference_id: booking.id,
    payment_status: 'paid',
    amount_total: booking.priceCents,
    currency: 'eur',
    payment_intent: `pi_test_${booking.id}`,
    metadata: { bookingId: booking.id, feeCents: String(Math.round(booking.priceCents / 10)) },
    ...overrides,
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
