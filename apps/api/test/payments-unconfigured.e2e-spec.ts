import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema, type Booking } from '@creno/shared';
import {
  createProviderWithResource,
  createTestApp,
  instantIn,
  registerAs,
  resetDatabase,
} from './app.js';

// Clone frais : pas de clé Stripe. L'API démarre, et tout ce qui a besoin de Stripe répond 503.
describe('payments sans clé Stripe', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('503 PAYMENT_PROVIDER_UNAVAILABLE au paiement et à l’onboarding, le hold reste possible', async () => {
    const provider = await createProviderWithResource(app);
    const { agent } = await registerAs(app, 'customer');
    const held = await agent
      .post('/v1/bookings')
      .send({ resourceId: provider.resource.id, start: instantIn(7, '10:00').toISOString() })
      .expect(201);

    const checkout = await agent
      .post(`/v1/bookings/${(held.body as Booking).id}/checkout`)
      .expect(503);
    expect(apiErrorSchema.parse(checkout.body).code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');

    const fresh = await createProviderWithResource(app, {}, { payments: false });
    const onboarding = await fresh.agent.post('/v1/payments/connect/onboarding').expect(503);
    expect(apiErrorSchema.parse(onboarding.body).code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
  });
});
