import { describe, expect, it } from 'vitest';
import type { SearchProvider } from '@creno/shared';
import {
  countActiveFilters,
  describeFreeSlots,
  describeResults,
  formatDistance,
  parseSearchParams,
  providerHref,
  searchHref,
  searchToday,
  timeRangeLabel,
  timeRangePhrase,
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

describe('parseSearchParams : date', () => {
  // Un dimanche ; l'horizon de réservation est à 90 jours (2027-01-02).
  const today = '2026-10-04';
  const parseOn = (query: string) => parseSearchParams(new URLSearchParams(query), today);

  it('lit une date d’aujourd’hui à l’horizon', () => {
    expect(parseOn('date=2026-10-04').date).toBe('2026-10-04');
    expect(parseOn('date=2026-10-10').date).toBe('2026-10-10');
    expect(parseOn('date=2027-01-02').date).toBe('2027-01-02');
  });

  it('ignore une date passée (lien ancien), trop lointaine ou mal formée', () => {
    expect(parseOn('date=2026-10-03&category=room')).toEqual({ radiusKm: 10, category: 'room' });
    expect(parseOn('date=2027-01-03').date).toBeUndefined();
    expect(parseOn('date=2026-02-30').date).toBeUndefined();
    expect(parseOn('date=samedi').date).toBeUndefined();
  });

  it('prend aujourd’hui à l’heure de Paris', () => {
    // 23:30 UTC le 3 octobre : il est déjà 01:30 le 4 à Paris.
    expect(searchToday(new Date('2026-10-03T23:30:00Z'))).toBe('2026-10-04');
  });

  it('écrit la date dans l’URL et pour l’API, et la relit', () => {
    const filters = { radiusKm: 10, date: '2026-10-10' };
    expect(searchHref(filters)).toBe('/search?date=2026-10-10');
    expect(toApiParams(filters).toString()).toBe('date=2026-10-10');
    expect(parseSearchParams(toSearchParams(filters), today)).toEqual(filters);
  });
});

describe('parseSearchParams : plage horaire', () => {
  const today = '2026-10-04';
  const parseOn = (query: string) => parseSearchParams(new URLSearchParams(query), today);

  it('lit la plage avec une date', () => {
    expect(parseOn('date=2026-10-10&timeFrom=12:00&timeTo=18:00')).toMatchObject({
      date: '2026-10-10',
      timeFrom: '12:00',
      timeTo: '18:00',
    });
    expect(parseOn('date=2026-10-10&timeFrom=18%3A30')).toMatchObject({ timeFrom: '18:30' });
  });

  it('ignore une plage sans date, inversée ou mal formée', () => {
    expect(parseOn('timeFrom=18:00')).toEqual({ radiusKm: 10 });
    // Date passée (lien ancien) : la plage part avec elle.
    expect(parseOn('date=2026-10-03&timeFrom=18:00')).toEqual({ radiusKm: 10 });
    expect(parseOn('date=2026-10-10&timeFrom=18:00&timeTo=12:00')).toEqual({
      radiusKm: 10,
      date: '2026-10-10',
    });
    expect(parseOn('date=2026-10-10&timeFrom=25:00').timeFrom).toBeUndefined();
    expect(parseOn('date=2026-10-10&timeTo=18h').timeTo).toBeUndefined();
  });

  it('retire les bornes neutres, pour une seule écriture par plage', () => {
    expect(parseOn('date=2026-10-10&timeFrom=18:00&timeTo=24:00')).toEqual({
      radiusKm: 10,
      date: '2026-10-10',
      timeFrom: '18:00',
    });
    expect(parseOn('date=2026-10-10&timeFrom=00:00&timeTo=24:00')).toEqual({
      radiusKm: 10,
      date: '2026-10-10',
    });
  });

  it('écrit la plage dans l’URL et pour l’API seulement avec une date, et la relit', () => {
    const filters = { radiusKm: 10, date: '2026-10-10', timeFrom: '12:00', timeTo: '18:00' };
    expect(toApiParams(filters).toString()).toBe('date=2026-10-10&timeFrom=12%3A00&timeTo=18%3A00');
    expect(parseSearchParams(toSearchParams(filters), today)).toEqual(filters);
    expect(toApiParams({ radiusKm: 10, timeFrom: '12:00' }).toString()).toBe('');
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

  it('décrit le résultat avec une date', () => {
    const saturday = { radiusKm: 10, date: '2026-10-10' };
    expect(describeResults(0, saturday)).toBe('Aucun prestataire disponible le samedi 10 octobre');
    expect(describeResults(1, saturday)).toBe('1 prestataire disponible le samedi 10 octobre');
    expect(describeResults(3, { ...saturday, center: { lat: 1, lng: 2 }, place: 'Lyon' })).toBe(
      '3 prestataires disponibles le samedi 10 octobre dans un rayon de 10 km autour de Lyon',
    );
    expect(describeResults(4, { ...saturday, timeFrom: '12:00', timeTo: '18:00' })).toBe(
      "4 prestataires disponibles le samedi 10 octobre l'après-midi",
    );
    // Seuls les 200 plus proches ont été examinés : le total n'est qu'un minimum.
    expect(describeResults(180, saturday, true)).toBe(
      'Au moins 180 prestataires disponibles le samedi 10 octobre',
    );
  });

  it('décrit les créneaux libres d’un résultat', () => {
    expect(describeFreeSlots(1, '2026-10-10')).toBe('1 créneau libre le samedi 10 octobre');
    expect(describeFreeSlots(3, '2026-10-10')).toBe('3 créneaux libres le samedi 10 octobre');
    expect(describeFreeSlots(2, '2026-10-10', { timeFrom: '12:00', timeTo: '18:00' })).toBe(
      "2 créneaux libres le samedi 10 octobre l'après-midi",
    );
    expect(describeFreeSlots(1, '2026-10-10', { timeFrom: '18:30' })).toBe(
      '1 créneau libre le samedi 10 octobre après 18 h 30',
    );
  });

  it('nomme les plages : périodes, puis bornes', () => {
    expect(timeRangeLabel({ timeTo: '12:00' })).toBe('Matin');
    expect(timeRangeLabel({ timeFrom: '12:00', timeTo: '18:00' })).toBe('Après-midi');
    expect(timeRangeLabel({ timeFrom: '18:00' })).toBe('Soir');
    expect(timeRangeLabel({ timeFrom: '18:30' })).toBe('Après 18 h 30');
    expect(timeRangeLabel({ timeTo: '10:00' })).toBe('Avant 10 h');
    expect(timeRangeLabel({ timeFrom: '09:00', timeTo: '16:00' })).toBe('Entre 9 h et 16 h');
    expect(timeRangeLabel({})).toBeUndefined();
    expect(timeRangePhrase({ timeTo: '12:00' })).toBe('le matin');
    expect(timeRangePhrase({ timeFrom: '18:00' })).toBe('le soir');
    expect(timeRangePhrase({ timeFrom: '14:00', timeTo: '16:00' })).toBe('entre 14 h et 16 h');
  });

  it('ouvre la fiche sur le jour et la ressource libre', () => {
    const provider = {
      slug: 'padel-merignac',
      availableResourceId: '0b6c1a52-4bd2-4f43-9a40-7d8d1a0b9c11',
    } as SearchProvider;
    expect(providerHref(provider, '2026-10-10')).toBe(
      '/providers/padel-merignac?date=2026-10-10&resource=0b6c1a52-4bd2-4f43-9a40-7d8d1a0b9c11',
    );
    expect(providerHref(provider, undefined)).toBe('/providers/padel-merignac');
    expect(providerHref({ ...provider, availableResourceId: null }, '2026-10-10')).toBe(
      '/providers/padel-merignac',
    );
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
    expect(countActiveFilters({ radiusKm: 10, date: '2026-10-10' })).toBe(1);
    // La plage compte une fois, même avec ses deux bornes.
    expect(
      countActiveFilters({ radiusKm: 10, date: '2026-10-10', timeFrom: '12:00', timeTo: '18:00' }),
    ).toBe(2);
  });
});
