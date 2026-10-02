import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { providers } from '@creno/db';
import { apiErrorSchema, connectOnboardingSchema, connectStatusSchema } from '@creno/shared';
import { PaymentsGatewayError } from '../src/payments/payments-gateway.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  fakePaymentsGateway,
  registerAs,
  resetDatabase,
  resetPaymentsGateway,
  WEB_ORIGIN,
} from './app.js';

describe('payments : compte Stripe Connect du prestataire', () => {
  let app: INestApplication;
  const gateway = fakePaymentsGateway();
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ payments: gateway, logs });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    resetPaymentsGateway(gateway);
    logs.length = 0;
  });
  afterAll(async () => {
    await app.close();
  });

  const accountOf = async (providerId: string) => {
    const [row] = await dbOf(app)
      .db.select({
        stripeAccountId: providers.stripeAccountId,
        chargesEnabled: providers.stripeChargesEnabled,
      })
      .from(providers)
      .where(eq(providers.id, providerId));
    return row!;
  };
  const newProvider = () => createProviderWithResource(app, {}, { payments: false });

  it('onboarding : crée le compte une seule fois et renvoie le lien Stripe', async () => {
    const { agent, provider } = await newProvider();
    const first = connectOnboardingSchema.parse(
      (await agent.post('/v1/payments/connect/onboarding').expect(200)).body,
    );
    const { stripeAccountId } = await accountOf(provider.id);
    expect(stripeAccountId).toMatch(/^acct_fake_/);
    expect(first.url).toBe(`https://connect.stripe.test/setup/${stripeAccountId}`);
    expect(gateway.createConnectAccount).toHaveBeenCalledWith({ providerId: provider.id });
    expect(gateway.createAccountLink).toHaveBeenCalledWith({
      accountId: stripeAccountId,
      refreshUrl: `${WEB_ORIGIN}/dashboard?stripe=refresh`,
      returnUrl: `${WEB_ORIGIN}/dashboard?stripe=return`,
    });

    // Second appel (formulaire abandonné puis repris) : même compte, nouveau lien.
    await agent.post('/v1/payments/connect/onboarding').expect(200);
    expect(gateway.createConnectAccount).toHaveBeenCalledTimes(1);
    expect((await accountOf(provider.id)).stripeAccountId).toBe(stripeAccountId);
    expect(logs.join('\n')).not.toContain(stripeAccountId);
  });

  it('statut : not_started → pending → active après relecture du compte chez Stripe', async () => {
    const { agent, provider } = await newProvider();
    const status = async () =>
      connectStatusSchema.parse((await agent.get('/v1/payments/connect/status').expect(200)).body);
    expect(await status()).toEqual({
      status: 'not_started',
      detailsSubmitted: false,
      feeBps: 1000,
    });

    // Sans compte, la relecture n'appelle pas Stripe.
    await agent.post('/v1/payments/connect/refresh').expect(200);
    expect(gateway.retrieveAccount).not.toHaveBeenCalled();

    await agent.post('/v1/payments/connect/onboarding').expect(200);
    expect((await status()).status).toBe('pending');

    gateway.retrieveAccount.mockResolvedValueOnce({
      chargesEnabled: false,
      detailsSubmitted: true,
    });
    const reviewing = connectStatusSchema.parse(
      (await agent.post('/v1/payments/connect/refresh').expect(200)).body,
    );
    expect(reviewing).toMatchObject({ status: 'pending', detailsSubmitted: true });

    const active = connectStatusSchema.parse(
      (await agent.post('/v1/payments/connect/refresh').expect(200)).body,
    );
    expect(active.status).toBe('active');
    expect((await accountOf(provider.id)).chargesEnabled).toBe(true);
    expect((await status()).status).toBe('active');
    // Aucune réponse ne porte l'identifiant du compte.
    expect(JSON.stringify(active)).not.toContain('acct_');
  });

  it('503 PAYMENT_PROVIDER_UNAVAILABLE si Stripe échoue, sans rattacher de compte', async () => {
    const { agent, provider } = await newProvider();
    gateway.createConnectAccount.mockRejectedValueOnce(new PaymentsGatewayError('rate_limited'));
    const res = await agent.post('/v1/payments/connect/onboarding').expect(503);
    expect(apiErrorSchema.parse(res.body).code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect((await accountOf(provider.id)).stripeAccountId).toBeNull();
  });

  it('403 pour un client, 409 PROVIDER_PROFILE_REQUIRED sans profil, 401 sans session', async () => {
    const customer = await registerAs(app, 'customer');
    const forbidden = [
      await customer.agent.post('/v1/payments/connect/onboarding').expect(403),
      await customer.agent.get('/v1/payments/connect/status').expect(403),
      await customer.agent.post('/v1/payments/connect/refresh').expect(403),
    ];
    for (const res of forbidden) expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN');
    const noProfile = await registerAs(app, 'provider');
    const res = await noProfile.agent.post('/v1/payments/connect/onboarding').expect(409);
    expect(apiErrorSchema.parse(res.body).code).toBe('PROVIDER_PROFILE_REQUIRED');
    await request(app.getHttpServer()).post('/v1/payments/connect/onboarding').expect(401);
    expect(gateway.createConnectAccount).not.toHaveBeenCalled();
  });
});
