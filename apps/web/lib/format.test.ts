import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDuration,
  formatLocalDate,
  formatPhone,
  formatPrice,
  timeInZone,
  todayInZone,
} from './format';

describe('format', () => {
  it('formate un prix en centimes', () => {
    expect(formatPrice(4500, 'EUR').replace(/\s/g, ' ')).toBe('45,00 €');
  });

  it('formate une durée', () => {
    expect([30, 60, 90, 125].map(formatDuration)).toEqual(['30 min', '1 h', '1 h 30', '2 h 05']);
  });

  it("affiche l'heure dans le fuseau de la ressource, pas celui du navigateur", () => {
    expect(timeInZone('2026-10-05T07:00:00.000Z', 'Europe/Paris')).toBe('09:00');
    expect(timeInZone('2026-10-05T07:00:00.000Z', 'America/New_York')).toBe('03:00');
  });

  it("« aujourd'hui » dépend du fuseau", () => {
    const now = new Date('2026-10-05T23:30:00Z');
    expect(todayInZone('Europe/Paris', now)).toBe('2026-10-06');
    expect(todayInZone('America/New_York', now)).toBe('2026-10-05');
  });

  it('décale une date locale, y compris en fin de mois', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('nomme le jour d’une date locale', () => {
    expect(formatLocalDate('2026-10-05', { weekday: 'long' })).toBe('lundi');
  });
});

describe('formatPhone', () => {
  it('groupe un numéro français par deux chiffres', () => {
    expect(formatPhone('+33639980001')).toBe('+33 6 39 98 00 01');
  });

  it('laisse les autres indicatifs tels quels', () => {
    expect(formatPhone('+447900000000')).toBe('+447900000000');
  });
});
