import { describe, expect, it } from 'vitest';
import { weekStartFor } from './week';

describe('weekStartFor', () => {
  const today = '2026-10-04';

  it('aligne la semaine sur aujourd’hui', () => {
    expect(weekStartFor(today, today)).toBe(today);
    expect(weekStartFor(today, '2026-10-10')).toBe(today);
    expect(weekStartFor(today, '2026-10-11')).toBe('2026-10-11');
    // Changement de mois et d'heure : des jours calendaires, pas des tranches de 24 h.
    expect(weekStartFor(today, '2026-10-26')).toBe('2026-10-25');
  });

  it('va jusqu’à l’horizon de réservation, pas au-delà', () => {
    expect(weekStartFor(today, '2027-01-02')).toBe('2026-12-27');
    expect(weekStartFor(today, '2027-01-03')).toBeNull();
    expect(weekStartFor(today, '2026-10-03')).toBeNull();
  });
});
