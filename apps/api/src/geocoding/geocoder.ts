import type { GeocodingResult } from '@creno/shared';

/** Jeton d'injection du géocodeur : l'adapter réel est remplacé par un faux dans les tests. */
export const GEOCODER = Symbol('GEOCODER');

/** Service externe qui transforme un texte (« place bellecour lyon ») en lieux avec coordonnées. */
export interface Geocoder {
  search(query: string, limit: number): Promise<GeocodingResult[]>;
}

export type GeocoderFailure = 'timeout' | 'network' | 'invalid_response' | `http_${number}`;

/** Échec du géocodeur. `reason` est loggable : il ne contient jamais le texte recherché. */
export class GeocoderError extends Error {
  constructor(readonly reason: GeocoderFailure) {
    super(`Géocodeur indisponible (${reason})`);
    this.name = 'GeocoderError';
  }
}
