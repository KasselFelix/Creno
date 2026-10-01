import { z } from 'zod';
import type { GeocodingResult } from '@creno/shared';
import { type Geocoder, GeocoderError } from './geocoder.js';

const TIMEOUT_MS = 3000;

// Types de résultat de la Base Adresse Nationale → nos trois niveaux de précision.
const KINDS: Partial<Record<string, GeocodingResult['kind']>> = {
  housenumber: 'address',
  street: 'street',
  locality: 'street',
  municipality: 'city',
};

// GeoJSON : les coordonnées sont dans l'ordre [longitude, latitude].
const responseSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        label: z.string(),
        name: z.string(),
        type: z.string(),
        city: z.string().default(''),
        postcode: z.string().default(''),
      }),
    }),
  ),
});

/**
 * Géocodeur de l'État (Base Adresse Nationale, servie par la Géoplateforme de l'IGN) : sans clé,
 * licence ouverte, France uniquement. Voir docs/adr/0008-geocoding-provider.md.
 */
export class BanGeocoder implements Geocoder {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async search(query: string, limit: number): Promise<GeocodingResult[]> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/search`);
    url.search = new URLSearchParams({
      q: query,
      limit: String(limit),
      autocomplete: '1',
    }).toString();

    let res: Response;
    let body: unknown;
    try {
      // Pas de retry : c'est de l'autocomplétion, la frappe suivante relance la recherche.
      res = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Texte sans lettre ni chiffre (« ??? ») : le service répond 400, pour nous c'est « aucun lieu ».
      if (res.status === 400) return [];
      if (!res.ok) throw new GeocoderError(`http_${res.status}`);
      body = await res.json();
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') throw new GeocoderError('timeout');
      throw new GeocoderError(name === 'SyntaxError' ? 'invalid_response' : 'network');
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new GeocoderError('invalid_response');

    // Deux lieux au même libellé sont indiscernables pour le visiteur : on garde le premier (le mieux classé).
    const seen = new Set<string>();
    return parsed.data.features.flatMap(({ geometry, properties }) => {
      const kind = KINDS[properties.type];
      if (!kind || seen.has(properties.label)) return [];
      seen.add(properties.label);
      const [longitude, latitude] = geometry.coordinates;
      return [
        {
          label: properties.label,
          name: properties.name,
          city: properties.city,
          postcode: properties.postcode,
          latitude,
          longitude,
          kind,
        },
      ];
    });
  }
}
