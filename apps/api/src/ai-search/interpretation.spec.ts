import { describe, expect, it } from 'vitest';
import {
  costUsdMicros,
  dayForTimeRange,
  eurosToCents,
  hasKnownPrice,
  resolveTimeRange,
  snapRadiusKm,
  truncateIgnored,
} from './interpretation.js';

describe('snapRadiusKm', () => {
  it.each([
    [1, 1],
    [3, 2],
    [4, 5],
    [7, 5],
    [8, 10],
    [17, 10],
    [18, 25],
    [37, 25],
    [38, 50],
    [50, 50],
  ])('%i km → %i km', (km, expected) => {
    expect(snapRadiusKm(km)).toBe(expected);
  });
});

describe('eurosToCents', () => {
  it('arrondit au centime et plafonne', () => {
    expect(eurosToCents(29.9)).toBe(2990);
    expect(eurosToCents(45.5)).toBe(4550);
    expect(eurosToCents(0.1 + 0.2)).toBe(30);
    expect(eurosToCents(10_000)).toBe(1_000_000);
  });
});

describe('truncateIgnored', () => {
  it('garde 5 morceaux de 60 caractères au plus, sans morceau vide', () => {
    const terms = ['  après 18 h ', '', 'x'.repeat(80), 'a', 'b', 'c', 'd'];
    expect(truncateIgnored(terms)).toEqual(['après 18 h', 'x'.repeat(60), 'a', 'b', 'c']);
  });
});

describe('costUsdMicros', () => {
  it('calcule le coût au tarif payant de Mistral Small 4 : 500 + 80 tokens → 123 µ$', () => {
    expect(costUsdMicros('mistral-small-2603', { inputTokens: 500, outputTokens: 80 })).toBe(123);
  });

  it('calcule le coût de Ministral 3 8B : 666 + 76 tokens → 111 µ$', () => {
    expect(hasKnownPrice('ministral-8b-2512')).toBe(true);
    expect(costUsdMicros('ministral-8b-2512', { inputTokens: 666, outputTokens: 76 })).toBe(111);
  });

  it('renvoie null pour un modèle sans tarif ou des tokens inconnus', () => {
    expect(hasKnownPrice('mistral-large-2411')).toBe(false);
    expect(costUsdMicros('mistral-large-2411', { inputTokens: 500, outputTokens: 80 })).toBeNull();
    expect(costUsdMicros('mistral-small-2603', { inputTokens: null, outputTokens: 80 })).toBeNull();
  });
});

describe('resolveTimeRange', () => {
  const time = (
    timeOfDay: 'morning' | 'afternoon' | 'evening' | null,
    startAfter: string | null = null,
    startBefore: string | null = null,
  ) => ({ timeOfDay, startAfter, startBefore });

  it.each([
    ['rien de cité', time(null), {}],
    ['matin', time('morning'), { timeTo: '12:00' }],
    ['après-midi', time('afternoon'), { timeFrom: '12:00', timeTo: '18:00' }],
    ['soir', time('evening'), { timeFrom: '18:00' }],
    ['après 18 h', time(null, '18:00'), { timeFrom: '18:00' }],
    ['avant 10 h', time(null, null, '10:00'), { timeTo: '10:00' }],
    ['entre 14 h et 16 h', time(null, '14:00', '16:00'), { timeFrom: '14:00', timeTo: '16:00' }],
    ["l'après-midi après 15 h", time('afternoon', '15:00'), { timeFrom: '15:00', timeTo: '18:00' }],
    ['le soir avant 20 h', time('evening', null, '20:00'), { timeFrom: '18:00', timeTo: '20:00' }],
    [
      'le matin après 14 h : les heures citées l’emportent',
      time('morning', '14:00'),
      { timeFrom: '14:00' },
    ],
    ['heures inversées : ignorées', time(null, '18:00', '12:00'), {}],
    ['heures égales : ignorées', time(null, '12:00', '12:00'), {}],
    ['heures inversées, période gardée', time('evening', '20:00', '19:00'), { timeFrom: '18:00' }],
    [
      'le soir jusqu’à minuit : bornes neutres retirées',
      time('evening', null, '24:00'),
      { timeFrom: '18:00' },
    ],
    ['dès minuit', time(null, '00:00'), {}],
  ])('%s', (_label, extraction, expected) => {
    expect(resolveTimeRange(extraction)).toEqual(expected);
  });
});

describe('dayForTimeRange (aucun jour cité)', () => {
  // Vendredi 16 octobre 2026.
  const TODAY = '2026-10-16';

  it("aujourd'hui tant que la plage n'est pas finie", () => {
    expect(dayForTimeRange({ timeFrom: '18:00' }, TODAY, '23:30')).toBe(TODAY);
    expect(dayForTimeRange({ timeTo: '10:00' }, TODAY, '09:30')).toBe(TODAY);
    expect(dayForTimeRange({ timeFrom: '12:00', timeTo: '18:00' }, TODAY, '17:59')).toBe(TODAY);
  });

  it('demain quand la plage est finie', () => {
    expect(dayForTimeRange({ timeTo: '12:00' }, TODAY, '15:00')).toBe('2026-10-17');
    expect(dayForTimeRange({ timeFrom: '12:00', timeTo: '18:00' }, TODAY, '18:00')).toBe(
      '2026-10-17',
    );
    // Fin de mois.
    expect(dayForTimeRange({ timeTo: '12:00' }, '2026-10-31', '15:00')).toBe('2026-11-01');
  });
});
