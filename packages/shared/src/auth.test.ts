import { describe, expect, it } from 'vitest';
import {
  completeRegistrationSchema,
  phoneSchema,
  registerSchema,
  updateMeSchema,
  verifyPhoneSchema,
} from './index.js';

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
  it('accepte un nom', () => {
    expect(updateMeSchema.safeParse({ fullName: 'Léa Petit' }).success).toBe(true);
  });

  it('refuse un téléphone (il passe par la vérification) et un objet vide', () => {
    expect(updateMeSchema.safeParse({ phone: '+33612345678' }).success).toBe(false);
    expect(updateMeSchema.safeParse({ phone: null }).success).toBe(false);
    expect(updateMeSchema.safeParse({}).success).toBe(false);
  });
});

describe('verifyPhoneSchema', () => {
  it('accepte 6 chiffres, espaces autour retirés', () => {
    expect(verifyPhoneSchema.parse({ code: ' 012345 ' })).toEqual({ code: '012345' });
  });

  it.each(['12345', '1234567', '12a456', '١٢٣٤٥٦'])('refuse %s', (code) => {
    expect(verifyPhoneSchema.safeParse({ code }).success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('accepte un numéro E.164', () => {
    expect(phoneSchema.parse(' +33612345678 ')).toBe('+33612345678');
    expect(phoneSchema.safeParse('+447900000000').success).toBe(true);
  });

  it.each(['0612345678', '+330612345678', '+3361234567', '+3361234567890'])(
    'refuse %s',
    (phone) => {
      expect(phoneSchema.safeParse(phone).success).toBe(false);
    },
  );
});
