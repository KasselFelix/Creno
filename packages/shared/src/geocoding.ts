import { z } from 'zod';

export const GEOCODING_QUERY_MIN = 3;
export const GEOCODING_QUERY_MAX = 200;
export const GEOCODING_RESULTS_MAX = 5;

export const geocodingQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(GEOCODING_QUERY_MIN, { error: `${GEOCODING_QUERY_MIN} caractères minimum` })
    .max(GEOCODING_QUERY_MAX, { error: `${GEOCODING_QUERY_MAX} caractères maximum` }),
});
export type GeocodingQuery = z.infer<typeof geocodingQuerySchema>;

export const geocodingKinds = ['address', 'street', 'city'] as const;

/** Une suggestion de lieu, indépendante du géocodeur utilisé. */
export const geocodingResultSchema = z.object({
  /** Libellé complet, ex. « 12 Rue Oberkampf 75011 Paris ». */
  label: z.string(),
  /** Adresse sans code postal ni ville, ex. « 12 Rue Oberkampf » (le nom de la ville pour une ville). */
  name: z.string(),
  city: z.string(),
  postcode: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  kind: z.enum(geocodingKinds),
});
export type GeocodingResult = z.infer<typeof geocodingResultSchema>;

export const geocodingResponseSchema = z.object({ items: z.array(geocodingResultSchema) });
export type GeocodingResponse = z.infer<typeof geocodingResponseSchema>;
