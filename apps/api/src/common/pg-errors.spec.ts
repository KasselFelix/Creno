import { describe, expect, it } from 'vitest';
import { mapPgError, pgConstraint } from './pg-errors.js';

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

  it('traduit une violation de CHECK (23514) en 400 VALIDATION_FAILED', () => {
    const error = mapPgError({ code: '23514' });
    expect(error?.code).toBe('VALIDATION_FAILED');
    expect(error?.statusCode).toBe(400);
  });

  it('lit le nom de la contrainte, même enveloppé par Drizzle', () => {
    const pgError = { code: '23505', constraint: 'providers_slug_unique' };
    expect(pgConstraint(pgError)).toBe('providers_slug_unique');
    expect(pgConstraint(new Error('query failed', { cause: pgError }))).toBe(
      'providers_slug_unique',
    );
    expect(pgConstraint(new Error('boom'))).toBeUndefined();
  });

  it('ignore les autres erreurs', () => {
    expect(mapPgError(new Error('boom'))).toBeUndefined();
    expect(mapPgError({ code: '42P01' })).toBeUndefined();
    expect(mapPgError({ code: '40P01' })).toBeUndefined();
  });
});
