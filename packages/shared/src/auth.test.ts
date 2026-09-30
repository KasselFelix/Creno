import { describe, expect, it } from 'vitest';
import { registerSchema, updateMeSchema } from './index.js';

const valid = {
  email: 'lea@example.com',
  password: 'un-mot-de-passe-long',
  fullName: 'Léa',
  role: 'customer',
};

describe('registerSchema', () => {
  it('accepte une inscription valide et nettoie les espaces', () => {
    expect(
      registerSchema.parse({ ...valid, email: '  lea@example.com ', fullName: ' Léa ' }),
    ).toMatchObject({
      email: 'lea@example.com',
      fullName: 'Léa',
    });
  });

  it.each([
    ['mot de passe trop court', { password: 'court' }],
    ['email invalide', { email: 'pas-un-email' }],
    ['rôle admin', { role: 'admin' }],
    ['nom vide', { fullName: '   ' }],
  ])('refuse : %s', (_label, patch) => {
    expect(registerSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('updateMeSchema', () => {
  it('accepte un téléphone E.164 ou null', () => {
    expect(updateMeSchema.safeParse({ phone: '+33612345678' }).success).toBe(true);
    expect(updateMeSchema.safeParse({ phone: null }).success).toBe(true);
  });

  it('refuse un téléphone national et un objet vide', () => {
    expect(updateMeSchema.safeParse({ phone: '0612345678' }).success).toBe(false);
    expect(updateMeSchema.safeParse({}).success).toBe(false);
  });
});
