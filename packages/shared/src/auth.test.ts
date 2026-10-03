import { describe, expect, it } from 'vitest';
import { completeRegistrationSchema, registerSchema, updateMeSchema } from './index.js';

const valid = {
  token: 'un-jeton',
  password: 'un-mot-de-passe-long',
  fullName: 'Léa',
  role: 'customer',
};

describe('registerSchema', () => {
  it('ne demande qu’une adresse, et nettoie les espaces', () => {
    expect(registerSchema.parse({ email: '  lea@example.com ' })).toEqual({
      email: 'lea@example.com',
    });
    expect(registerSchema.safeParse({ email: 'pas-un-email' }).success).toBe(false);
  });
});

describe('completeRegistrationSchema', () => {
  it('accepte un profil valide et nettoie les espaces', () => {
    expect(completeRegistrationSchema.parse({ ...valid, fullName: ' Léa ' })).toMatchObject({
      fullName: 'Léa',
    });
  });

  it.each([
    ['mot de passe trop court', { password: 'court' }],
    ['jeton absent', { token: '' }],
    ['rôle admin', { role: 'admin' }],
    ['nom vide', { fullName: '   ' }],
  ])('refuse : %s', (_label, patch) => {
    expect(completeRegistrationSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
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
