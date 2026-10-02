import { describe, expect, it } from 'vitest';
import {
  countActiveFilters,
  describeResults,
  formatDistance,
  parseSearchParams,
  searchHref,
  toApiParams,
  toSearchParams,
} from './params';

const parse = (query: string) => parseSearchParams(new URLSearchParams(query));

describe('parseSearchParams', () => {
  it('donne les valeurs par défaut sans paramètre', () => {
    expect(parse('')).toEqual({ radiusKm: 10 });
  });

  it('lit tous les filtres et arrondit la position à 3 décimales', () => {
    expect(
      parse('lat=45.764043&lng=4.835659&radiusKm=5&category=hairdresser&priceMax=3000&place=Lyon'),
    ).toEqual({
      center: { lat: 45.764, lng: 4.836 },
      place: 'Lyon',
      radiusKm: 5,
      category: 'hairdresser',
      priceMax: 3000,
    });
  });

  it('ignore les paramètres invalides au lieu de refuser toute la recherche', () => {
    expect(parse('lat=abc&lng=4.8&radiusKm=500&category=plumber&priceMax=-3')).toEqual({
      radiusKm: 10,
    });
    // Une seule coordonnée ne fait pas un centre ; le libellé seul est abandonné.
    expect(parse('lat=45.76&place=Lyon&category=room')).toEqual({ radiusKm: 10, category: 'room' });
  });

  it('borne le libellé du lieu', () => {
    expect(parse(`lat=1&lng=2&place=${'a'.repeat(300)}`).place).toHaveLength(100);
  });
});

describe('toSearchParams / toApiParams', () => {
  const filters = {
    center: { lat: 45.764, lng: 4.836 },
    place: 'Lyon',
    radiusKm: 5,
    category: 'hairdresser' as const,
    priceMax: 3000,
  };

  it('fait un aller-retour sans perte', () => {
    expect(parseSearchParams(toSearchParams(filters))).toEqual(filters);
    expect(parse(toSearchParams({ radiusKm: 10 }).toString())).toEqual({ radiusKm: 10 });
  });

  it('omet les valeurs par défaut dans l’URL de la page', () => {
    expect(searchHref({ radiusKm: 10 })).toBe('/search');
    expect(searchHref({ radiusKm: 10, center: { lat: 1, lng: 2 } })).toBe('/search?lat=1&lng=2');
  });

  it('n’envoie à l’API ni le libellé ni un rayon sans centre', () => {
    expect(toApiParams(filters).toString()).toBe(
      'lat=45.764&lng=4.836&radiusKm=5&category=hairdresser&priceMax=3000',
    );
    expect(toApiParams({ radiusKm: 25, category: 'room' }).toString()).toBe('category=room');
  });
});

describe('affichage', () => {
  it('formate les distances', () => {
    expect(formatDistance(73)).toBe('70 m');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(3240)).toBe('3,2 km');
    expect(formatDistance(24800)).toBe('25 km');
  });

  it('décrit le résultat', () => {
    expect(describeResults(0, { radiusKm: 10 })).toBe('Aucun prestataire');
    expect(describeResults(1, { radiusKm: 10 })).toBe('1 prestataire');
    expect(describeResults(12, { radiusKm: 5, center: { lat: 1, lng: 2 }, place: 'Lyon' })).toBe(
      '12 prestataires dans un rayon de 5 km autour de Lyon',
    );
    expect(describeResults(3, { radiusKm: 5, center: { lat: 1, lng: 2 } })).toBe(
      '3 prestataires dans un rayon de 5 km',
    );
  });

  it('compte les filtres actifs hors lieu', () => {
    expect(countActiveFilters({ radiusKm: 10 })).toBe(0);
    expect(countActiveFilters({ radiusKm: 25 })).toBe(0);
    expect(
      countActiveFilters({
        radiusKm: 25,
        center: { lat: 1, lng: 2 },
        category: 'room',
        priceMax: 0,
      }),
    ).toBe(3);
  });
});
