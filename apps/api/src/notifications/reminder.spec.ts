import { describe, expect, it } from 'vitest';
import { reminderInstantFor } from './reminder.js';

const NOW = new Date('2026-09-01T09:00:00Z');

describe('reminderInstantFor', () => {
  it('place le rappel 24 h avant le début du créneau', () => {
    const at = reminderInstantFor(new Date('2026-09-10T14:00:00Z'), NOW);
    expect(at?.toISOString()).toBe('2026-09-09T14:00:00.000Z');
  });

  it('ne donne pas de rappel pour un créneau réservé moins de 24 h avant', () => {
    expect(reminderInstantFor(new Date('2026-09-01T11:00:00Z'), NOW)).toBeNull();
  });

  it('à la limite exacte : pas de rappel (il partirait en même temps que la confirmation)', () => {
    expect(reminderInstantFor(new Date('2026-09-02T09:00:00Z'), NOW)).toBeNull();
    expect(reminderInstantFor(new Date('2026-09-02T09:01:00Z'), NOW)?.toISOString()).toBe(
      '2026-09-01T09:01:00.000Z',
    );
  });

  it('un changement d’heure entre-temps ne déplace pas le rappel', () => {
    // Europe/Paris passe à l'heure d'été le 29 mars 2026 : la veille compte 23 h en heure locale,
    // mais le rappel est un instant, exactement 24 h avant.
    const at = reminderInstantFor(
      new Date('2026-03-29T09:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(at?.toISOString()).toBe('2026-03-28T09:00:00.000Z');
  });
});
