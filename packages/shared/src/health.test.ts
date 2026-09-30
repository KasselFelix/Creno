import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

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
