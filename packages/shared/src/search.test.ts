import { describe, expect, it } from 'vitest';
import {
  isSearchDateInRange,
  normalizeTimeRange,
  SEARCH_RADIUS_KM_DEFAULT,
  SEARCH_RESULTS_MAX,
  searchDateRange,
  searchProvidersQuerySchema,
  searchProvidersResponseSchema,
  TIME_OF_DAY_RANGES,
  timeOfDayOf,
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
    ['heure de début hors bornes', { timeFrom: '25:00' }],
    ['heure de début à 24:00', { timeFrom: '24:00' }],
    ['heure sans minutes', { timeFrom: '18' }],
    ['heure de fin hors bornes', { timeTo: '24:30' }],
    ['plage inversée', { timeFrom: '18:00', timeTo: '12:00' }],
    ['plage vide', { timeFrom: '12:00', timeTo: '12:00' }],
    ['avant minuit', { timeTo: '00:00' }],
  ])('refuse : %s', (_label, input) => {
    expect(searchProvidersQuerySchema.safeParse(input).success).toBe(false);
  });

  it('accepte une date de disponibilité', () => {
    expect(searchProvidersQuerySchema.parse({ date: '2026-10-10' })).toMatchObject({
      date: '2026-10-10',
    });
  });

  it('accepte une plage horaire, fin de journée comprise', () => {
    expect(
      searchProvidersQuerySchema.parse({ date: '2026-10-10', timeFrom: '12:00', timeTo: '18:00' }),
    ).toMatchObject({ timeFrom: '12:00', timeTo: '18:00' });
    expect(searchProvidersQuerySchema.parse({ timeFrom: '00:00', timeTo: '24:00' })).toMatchObject({
      timeFrom: '00:00',
      timeTo: '24:00',
    });
  });
});

describe('normalizeTimeRange', () => {
  it.each([
    [
      'plage complète',
      { timeFrom: '12:00', timeTo: '18:00' },
      { timeFrom: '12:00', timeTo: '18:00' },
    ],
    ['début de journée retiré', { timeFrom: '00:00', timeTo: '10:00' }, { timeTo: '10:00' }],
    ['fin de journée retirée', { timeFrom: '18:00', timeTo: '24:00' }, { timeFrom: '18:00' }],
    ['journée entière', { timeFrom: '00:00', timeTo: '24:00' }, {}],
    ['aucune borne', {}, {}],
  ])('%s', (_label, range, expected) => {
    expect(normalizeTimeRange(range)).toEqual(expected);
  });

  it('renvoie null pour une plage vide ou inversée', () => {
    expect(normalizeTimeRange({ timeFrom: '18:00', timeTo: '12:00' })).toBeNull();
    expect(normalizeTimeRange({ timeFrom: '12:00', timeTo: '12:00' })).toBeNull();
    // Aucun créneau ne commence avant minuit.
    expect(normalizeTimeRange({ timeTo: '00:00' })).toBeNull();
  });
});

describe('timeOfDayOf', () => {
  it('reconnaît les trois périodes et rien d’autre', () => {
    expect(timeOfDayOf(TIME_OF_DAY_RANGES.morning)).toBe('morning');
    expect(timeOfDayOf({ timeFrom: '12:00', timeTo: '18:00' })).toBe('afternoon');
    expect(timeOfDayOf({ timeFrom: '18:00' })).toBe('evening');
    expect(timeOfDayOf({ timeFrom: '18:30' })).toBeUndefined();
    expect(timeOfDayOf({ timeFrom: '12:00' })).toBeUndefined();
    expect(timeOfDayOf({})).toBeUndefined();
  });
});

describe('isSearchDateInRange', () => {
  it("accepte d'aujourd'hui à 90 jours, bornes comprises, en franchissant mois et années", () => {
    expect(searchDateRange('2026-12-15')).toEqual({ min: '2026-12-15', max: '2027-03-15' });
    expect(isSearchDateInRange('2026-12-15', '2026-12-15')).toBe(true);
    expect(isSearchDateInRange('2027-03-15', '2026-12-15')).toBe(true);
  });

  it('refuse hier et le 91e jour', () => {
    expect(isSearchDateInRange('2026-12-14', '2026-12-15')).toBe(false);
    expect(isSearchDateInRange('2027-03-16', '2026-12-15')).toBe(false);
  });

  it("ne dépend pas d'un changement d'heure (fin mars)", () => {
    expect(searchDateRange('2027-01-01').max).toBe('2027-04-01');
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
