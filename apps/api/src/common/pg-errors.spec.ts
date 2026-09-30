import { describe, expect, it } from 'vitest';
import { mapPgError } from './pg-errors.js';

describe('mapPgError', () => {
  it.each([
    ['23P01', 'SLOT_UNAVAILABLE'],
    ['23505', 'ALREADY_EXISTS'],
    ['23503', 'INVALID_REFERENCE'],
  ])('traduit %s en %s (409)', (code, expected) => {
    const error = mapPgError({ code });
    expect(error?.code).toBe(expected);
    expect(error?.statusCode).toBe(409);
  });

  it("lit le code dans la cause quand Drizzle enveloppe l'erreur pg", () => {
    expect(mapPgError(new Error('query failed', { cause: { code: '23P01' } }))?.code).toBe(
      'SLOT_UNAVAILABLE',
    );
  });

  it('ignore les autres erreurs', () => {
    expect(mapPgError(new Error('boom'))).toBeUndefined();
    expect(mapPgError({ code: '42P01' })).toBeUndefined();
    expect(mapPgError({ code: '40P01' })).toBeUndefined();
  });
});
