import { z } from 'zod';
import { localDateSchema } from './availability.js';
import { providerCategorySchema } from './providers.js';
import { PRICE_CENTS_MAX } from './resources.js';

export const SEARCH_RADIUS_KM_MAX = 50;
export const SEARCH_RADIUS_KM_DEFAULT = 10;
/** Plafond de résultats : pas de pagination, l'écran invite à réduire le rayon ou à filtrer. */
export const SEARCH_RESULTS_MAX = 50;
export const SEARCH_RADIUS_OPTIONS_KM = [1, 2, 5, 10, 25, 50] as const;
/**
 * Fuseau de référence de la recherche : « aujourd'hui » et la plage de dates autorisée (jusqu'à
 * `BOOKING_HORIZON_DAYS` jours). Les créneaux, eux, sont calculés au fuseau de chaque ressource.
 */
export const SEARCH_TIMEZONE = 'Europe/Paris';
/** Avec une date, prestataires examinés (les plus proches d'abord) avant le filtre de disponibilité. */
export const SEARCH_DATE_CANDIDATES_MAX = 200;

/**
 * Arrondi à 3 décimales (≈ 100 m) : la position d'un visiteur est une donnée personnelle,
 * on ne transporte pas plus de précision que la recherche n'en a besoin.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Query string : les valeurs arrivent en texte. Une chaîne vide n'est pas un nombre
// (`Number('')` vaut 0, ce qui placerait la recherche dans le golfe de Guinée).
const queryNumber = z
  .union(
    [
      z.number(),
      z
        .string()
        .trim()
        .regex(/^-?\d+(\.\d+)?$/),
    ],
    { error: 'Nombre attendu' },
  )
  .transform(Number);

export const searchLatitudeSchema = queryNumber
  .pipe(z.number().min(-90, { error: 'Entre -90 et 90' }).max(90, { error: 'Entre -90 et 90' }))
  .transform(roundCoordinate);
export const searchLongitudeSchema = queryNumber
  .pipe(
    z.number().min(-180, { error: 'Entre -180 et 180' }).max(180, { error: 'Entre -180 et 180' }),
  )
  .transform(roundCoordinate);
export const searchRadiusKmSchema = queryNumber.pipe(
  z
    .number()
    .int({ error: 'Rayon en kilomètres entiers' })
    .min(1, { error: '1 km minimum' })
    .max(SEARCH_RADIUS_KM_MAX, { error: `${SEARCH_RADIUS_KM_MAX} km maximum` }),
);
export const searchPriceMaxSchema = queryNumber.pipe(
  z
    .number()
    .int({ error: 'Prix en centimes entiers' })
    .min(0, { error: 'Prix positif' })
    .max(PRICE_CENTS_MAX, { error: 'Prix trop élevé' }),
);

export const searchProvidersQuerySchema = z
  .object({
    lat: searchLatitudeSchema.optional(),
    lng: searchLongitudeSchema.optional(),
    /** Ignoré sans centre (`lat` + `lng`). */
    radiusKm: searchRadiusKmSchema.default(SEARCH_RADIUS_KM_DEFAULT),
    category: providerCategorySchema.optional(),
    /** Prix maximum en centimes : le prestataire a au moins une ressource active à ce prix ou moins. */
    priceMax: searchPriceMaxSchema.optional(),
    /** Jour où le prestataire doit avoir au moins un créneau libre (date locale `YYYY-MM-DD`). */
    date: localDateSchema.optional(),
    limit: queryNumber
      .pipe(z.number().int().min(1).max(SEARCH_RESULTS_MAX))
      .default(SEARCH_RESULTS_MAX),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    error: 'Latitude et longitude vont ensemble',
    path: ['lng'],
  });
/** Filtres après validation (nombres convertis, valeurs par défaut posées). */
export type SearchProvidersQuery = z.output<typeof searchProvidersQuerySchema>;

/** Un prestataire dans une liste de résultats : ni `userId`, ni `stripeAccountId`, ni description. */
export const searchProviderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  category: providerCategorySchema,
  address: z.string(),
  city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  /** Distance au centre de la recherche, arrondie au mètre ; `null` sans centre. */
  distanceMeters: z.number().int().nullable(),
  /** Prix le plus bas parmi les ressources actives. */
  minPriceCents: z.number().int(),
  currency: z.literal('EUR'),
  resourceCount: z.number().int(),
  /** Créneaux libres le jour demandé, sur les ressources éligibles (prix maximum compris) ; `null` sans date. */
  availableSlots: z.number().int().nullable(),
  /** Ressource éligible qui a un créneau libre ce jour-là, pour le lien vers la fiche ; `null` sans date. */
  availableResourceId: z.uuid().nullable(),
});
export type SearchProvider = z.infer<typeof searchProviderSchema>;

export const searchProvidersResponseSchema = z.object({
  items: z.array(searchProviderSchema),
  /** Nombre de résultats avant le plafond `limit`. */
  total: z.number().int(),
  /**
   * Avec une date, `true` quand plus de `SEARCH_DATE_CANDIDATES_MAX` prestataires correspondaient aux
   * autres filtres : seuls les plus proches ont été examinés et `total` n'est qu'un minimum.
   */
  totalIsCapped: z.boolean(),
});
export type SearchProvidersResponse = z.infer<typeof searchProvidersResponseSchema>;
