import { describe, expect, it } from 'vitest';
import {
  SEARCH_RADIUS_KM_DEFAULT,
  SEARCH_RESULTS_MAX,
  searchProvidersQuerySchema,
} from './search.js';

describe('searchProvidersQuerySchema', () => {
  it('pose les valeurs par défaut sans paramètre', () => {
    expect(searchProvidersQuerySchema.parse({})).toEqual({
      radiusKm: SEARCH_RADIUS_KM_DEFAULT,
      limit: SEARCH_RESULTS_MAX,
    });
  });

  it('convertit les valeurs de la query string et arrondit la position à 3 décimales', () => {
    const query = searchProvidersQuerySchema.parse({
      lat: '48.864412',
      lng: '2.369651',
      radiusKm: '5',
      category: 'hairdresser',
      priceMax: '3000',
      limit: '10',
    });
    expect(query).toEqual({
      lat: 48.864,
      lng: 2.37,
      radiusKm: 5,
      category: 'hairdresser',
      priceMax: 3000,
      limit: 10,
    });
  });

  it.each([
    ['lat sans lng', { lat: '48.86' }],
    ['lng sans lat', { lng: '2.37' }],
    ['latitude hors bornes', { lat: '91', lng: '2' }],
    ['longitude hors bornes', { lat: '48', lng: '181' }],
    ['latitude vide', { lat: '', lng: '2' }],
    ['latitude non numérique', { lat: 'abc', lng: '2' }],
    ['rayon nul', { radiusKm: '0' }],
    ['rayon trop grand', { radiusKm: '51' }],
    ['rayon décimal', { radiusKm: '2.5' }],
    ['catégorie inconnue', { category: 'plumber' }],
    ['prix négatif', { priceMax: '-1' }],
    ['limite nulle', { limit: '0' }],
    ['limite trop grande', { limit: '51' }],
  ])('refuse : %s', (_label, input) => {
    expect(searchProvidersQuerySchema.safeParse(input).success).toBe(false);
  });
});
