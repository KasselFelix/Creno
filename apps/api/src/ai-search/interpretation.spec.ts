import { describe, expect, it } from 'vitest';
import {
  costUsdMicros,
  eurosToCents,
  hasKnownPrice,
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

  it('renvoie null pour un modèle sans tarif ou des tokens inconnus', () => {
    expect(hasKnownPrice('mistral-large-2411')).toBe(false);
    expect(costUsdMicros('mistral-large-2411', { inputTokens: 500, outputTokens: 80 })).toBeNull();
    expect(costUsdMicros('mistral-small-2603', { inputTokens: null, outputTokens: 80 })).toBeNull();
  });
});
