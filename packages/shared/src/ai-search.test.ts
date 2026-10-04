import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AI_QUERY_MAX,
  aiSearchExtractionSchema,
  interpretRequestSchema,
  interpretResponseSchema,
} from './ai-search.js';

const EMPTY_EXTRACTION = {
  category: null,
  place: null,
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: null,
  date: null,
  ignored: [],
};

describe('interpretRequestSchema', () => {
  it('retire les espaces autour de la phrase', () => {
    expect(interpretRequestSchema.parse({ query: '  coiffeur à Lyon  ' })).toEqual({
      query: 'coiffeur à Lyon',
    });
  });

  it('accepte 3 et 200 caractères', () => {
    expect(interpretRequestSchema.safeParse({ query: 'spa' }).success).toBe(true);
    expect(interpretRequestSchema.safeParse({ query: 'a'.repeat(AI_QUERY_MAX) }).success).toBe(
      true,
    );
  });

  it.each([
    ['2 caractères', 'ab'],
    ['2 lettres entourées d’espaces', '   ab   '],
    ['201 caractères', 'a'.repeat(AI_QUERY_MAX + 1)],
  ])('refuse : %s', (_label, query) => {
    expect(interpretRequestSchema.safeParse({ query }).success).toBe(false);
  });
});

describe('aiSearchExtractionSchema', () => {
  it('accepte une sortie complète, prix décimal compris', () => {
    const output = {
      category: 'sports_field',
      place: 'Bordeaux',
      nearMe: false,
      radiusKm: 5,
      priceMaxEuros: 29.9,
      date: '2026-10-10',
      ignored: ['après 18 h'],
    };
    expect(aiSearchExtractionSchema.parse(output)).toEqual(output);
  });

  it('accepte une sortie sans aucun filtre', () => {
    expect(aiSearchExtractionSchema.safeParse(EMPTY_EXTRACTION).success).toBe(true);
  });

  it("ne rejette jamais une sortie pour la longueur de `ignored` (l'API la tronque)", () => {
    const ignored = Array.from({ length: 8 }, () => 'x'.repeat(80));
    expect(aiSearchExtractionSchema.safeParse({ ...EMPTY_EXTRACTION, ignored }).success).toBe(true);
  });

  it.each([
    ['catégorie « Autre » (jamais déduite)', { category: 'other' }],
    ['catégorie inconnue', { category: 'spa' }],
    ['lieu vide', { place: '   ' }],
    ['lieu trop long', { place: 'a'.repeat(101) }],
    ['rayon nul', { radiusKm: 0 }],
    ['rayon trop grand', { radiusKm: 51 }],
    ['rayon décimal', { radiusKm: 2.5 }],
    ['prix négatif', { priceMaxEuros: -1 }],
    ['prix trop élevé', { priceMaxEuros: 10_001 }],
    ['date au format français', { date: '10/10/2026' }],
    ['date impossible', { date: '2026-02-31' }],
    ['nearMe absent', { nearMe: undefined }],
  ])('refuse : %s', (_label, change) => {
    expect(aiSearchExtractionSchema.safeParse({ ...EMPTY_EXTRACTION, ...change }).success).toBe(
      false,
    );
  });

  it('se convertit en JSON Schema strict pour le modèle : tous les champs requis, aucun en plus', () => {
    const schema = z.toJSONSchema(aiSearchExtractionSchema);
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['category', 'place', 'nearMe', 'radiusKm', 'priceMaxEuros', 'date', 'ignored'],
    });
  });
});

describe('interpretResponseSchema', () => {
  it('accepte une interprétation avec lieu, filtres et notices', () => {
    const response = {
      source: 'ai',
      filters: {
        category: 'hairdresser',
        place: { label: 'Lyon', lat: 45.758, lng: 4.835 },
        radiusKm: 5,
        priceMax: 3000,
        date: '2026-10-10',
      },
      notices: [{ type: 'ignored_terms', terms: ['après 18 h'] }],
    };
    expect(interpretResponseSchema.parse(response)).toEqual(response);
  });

  it('accepte « près de moi » sans lieu, et les notices de lieu et de date', () => {
    const response = {
      source: 'keywords',
      filters: { nearMe: true },
      notices: [
        { type: 'place_not_found', place: 'Bordo' },
        { type: 'date_out_of_range', date: '2026-01-01' },
      ],
    };
    expect(interpretResponseSchema.safeParse(response).success).toBe(true);
  });

  it.each([
    ['rayon hors des options de la recherche', { filters: { radiusKm: 7 } }],
    ['catégorie « Autre »', { filters: { category: 'other' } }],
    ['prix décimal (centimes attendus)', { filters: { priceMax: 29.9 } }],
    ['nearMe à false (absent quand il ne sert pas)', { filters: { nearMe: false } }],
    ['notice inconnue', { notices: [{ type: 'assistant_unavailable' }] }],
    ['notice de termes ignorés sans terme', { notices: [{ type: 'ignored_terms', terms: [] }] }],
    ['source inconnue', { source: 'cache' }],
  ])('refuse : %s', (_label, change) => {
    const response = { source: 'ai', filters: {}, notices: [], ...change };
    expect(interpretResponseSchema.safeParse(response).success).toBe(false);
  });
});
