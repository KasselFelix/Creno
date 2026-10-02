import { describe, expect, it, vi } from 'vitest';
import { BanGeocoder } from './ban-geocoder.js';
import { GeocoderError } from './geocoder.js';

const feature = (
  properties: Record<string, unknown>,
  coordinates: number[] = [4.832, 45.7578],
) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function geocoderWith(fetchFn: typeof fetch) {
  return new BanGeocoder('https://geocodeur.test/geocodage/', fetchFn);
}

describe('BanGeocoder', () => {
  it('appelle le service et normalise les lieux (coordonnées GeoJSON = [longitude, latitude])', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        type: 'FeatureCollection',
        features: [
          feature(
            {
              label: '12 Rue Oberkampf 75011 Paris',
              name: '12 Rue Oberkampf',
              type: 'housenumber',
              city: 'Paris',
              postcode: '75011',
            },
            [2.36872, 48.863125],
          ),
          feature({
            label: 'Lyon',
            name: 'Lyon',
            type: 'municipality',
            city: 'Lyon',
            postcode: '69001',
          }),
          feature({ label: 'Lieu-dit sans ville', name: 'Lieu-dit', type: 'locality' }),
          feature({ label: 'Type inconnu', name: 'X', type: 'poi' }),
          // Doublon de libellé : ignoré.
          feature(
            { label: 'Lyon', name: 'Lyon', type: 'municipality', city: 'Lyon', postcode: '69002' },
            [4.83, 45.75],
          ),
        ],
      }),
    );

    const results = await geocoderWith(fetchFn).search('12 rue oberkampf', 5);

    expect(results).toEqual([
      {
        label: '12 Rue Oberkampf 75011 Paris',
        name: '12 Rue Oberkampf',
        city: 'Paris',
        postcode: '75011',
        latitude: 48.863125,
        longitude: 2.36872,
        kind: 'address',
      },
      expect.objectContaining({ label: 'Lyon', kind: 'city', latitude: 45.7578, longitude: 4.832 }),
      expect.objectContaining({
        label: 'Lieu-dit sans ville',
        kind: 'street',
        city: '',
        postcode: '',
      }),
    ]);
    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://geocodeur.test/geocodage/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '12 rue oberkampf',
      limit: '5',
      autocomplete: '1',
    });
  });

  it('renvoie une liste vide quand le service refuse le texte (400)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ detail: ['q invalide'] }, 400));
    await expect(geocoderWith(fetchFn).search('???', 5)).resolves.toEqual([]);
  });

  it.each([
    ['erreur 5xx', () => Promise.resolve(json({}, 502)), 'http_502'],
    ['limite de débit du service', () => Promise.resolve(json({}, 429)), 'http_429'],
    ['JSON inattendu', () => Promise.resolve(json({ results: [] })), 'invalid_response'],
    [
      'corps non JSON',
      () => Promise.resolve(new Response('<html>', { status: 200 })),
      'invalid_response',
    ],
    ['réseau coupé', () => Promise.reject(new TypeError('fetch failed')), 'network'],
    [
      'délai dépassé',
      () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
      'timeout',
    ],
  ])('lève GeocoderError : %s', async (_label, respond, reason) => {
    const error = await geocoderWith(vi.fn<typeof fetch>().mockImplementation(respond))
      .search('lyon', 5)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeocoderError);
    expect((error as GeocoderError).reason).toBe(reason);
  });

  it('passe un signal d’abandon à fetch (timeout)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ features: [] }));
    await geocoderWith(fetchFn).search('lyon', 5);
    expect(fetchFn.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
