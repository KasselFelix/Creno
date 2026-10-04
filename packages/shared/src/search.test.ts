import { describe, expect, it } from 'vitest';
import {
  SEARCH_RADIUS_KM_DEFAULT,
  SEARCH_RESULTS_MAX,
  searchProvidersQuerySchema,
  searchProvidersResponseSchema,
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
    ['date au format français', { date: '10/10/2026' }],
    ['date impossible', { date: '2026-02-31' }],
    ['date vide', { date: '' }],
  ])('refuse : %s', (_label, input) => {
    expect(searchProvidersQuerySchema.safeParse(input).success).toBe(false);
  });

  it('accepte une date de disponibilité', () => {
    expect(searchProvidersQuerySchema.parse({ date: '2026-10-10' })).toMatchObject({
      date: '2026-10-10',
    });
  });
});

describe('searchProvidersResponseSchema', () => {
  const provider = {
    id: '6f1c2b0e-8a4d-4c1e-9b7a-2d3e4f5a6b7c',
    name: 'Five Bordeaux Lac',
    slug: 'five-bordeaux-lac',
    category: 'sports_field',
    address: 'Rue du Lac',
    city: 'Bordeaux',
    latitude: 44.885,
    longitude: -0.563,
    distanceMeters: 1200,
    minPriceCents: 3000,
    currency: 'EUR',
    resourceCount: 2,
  };

  it('accepte un résultat sans date (créneaux non comptés) et un résultat avec date', () => {
    const withoutDate = { ...provider, availableSlots: null, availableResourceId: null };
    const withDate = {
      ...provider,
      availableSlots: 3,
      availableResourceId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    };
    expect(
      searchProvidersResponseSchema.safeParse({
        items: [withoutDate, withDate],
        total: 2,
        totalIsCapped: false,
      }).success,
    ).toBe(true);
  });

  it('exige totalIsCapped', () => {
    expect(searchProvidersResponseSchema.safeParse({ items: [], total: 0 }).success).toBe(false);
  });
});
