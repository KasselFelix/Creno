import { describe, expect, it } from 'vitest';
import { healthResponseSchema, livenessResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepte la réponse terminus quand la base est joignable', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    });
    expect(parsed.info?.database?.status).toBe('up');
  });

  it('refuse un statut inconnu', () => {
    expect(healthResponseSchema.safeParse({ status: 'green' }).success).toBe(false);
  });
});

describe('livenessResponseSchema', () => {
  it('exige la release déployée', () => {
    expect(livenessResponseSchema.parse({ status: 'ok', release: 'abc123' }).release).toBe(
      'abc123',
    );
    expect(livenessResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
