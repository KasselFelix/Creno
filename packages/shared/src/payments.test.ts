import { describe, expect, it } from 'vitest';
import { bookingsQuerySchema, createResourceSchema, platformFeeCents } from './index.js';

describe('platformFeeCents', () => {
  it('calcule la commission en centimes entiers, arrondie au plus proche', () => {
    expect(platformFeeCents(4500, 1000)).toBe(450);
    expect(platformFeeCents(2599, 1000)).toBe(260);
    expect(platformFeeCents(4500, 0)).toBe(0);
    expect(platformFeeCents(55, 1250)).toBe(7);
  });
});

describe('prix payable par carte', () => {
  const base = {
    name: 'Studio',
    description: '',
    timezone: 'Europe/Paris',
    slotMinutes: 60,
  };

  it.each([
    [0, true],
    [1, false],
    [49, false],
    [50, true],
  ])('prix de %i centimes → accepté : %s', (priceCents, accepted) => {
    expect(createResourceSchema.safeParse({ ...base, priceCents }).success).toBe(accepted);
  });
});

describe('bookingsQuerySchema', () => {
  it('liste les réservations à venir par défaut', () => {
    expect(bookingsQuerySchema.parse({})).toEqual({ scope: 'upcoming', page: 1, pageSize: 20 });
    expect(bookingsQuerySchema.safeParse({ scope: 'tout' }).success).toBe(false);
  });
});
