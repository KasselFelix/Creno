import { z } from 'zod';
import { localDateSchema } from './availability.js';

/** Lundi d'une semaine, `YYYY-MM-DD`. Interprété dans le fuseau de chaque ressource. */
export const weekStartSchema = localDateSchema.refine(
  (value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1,
  { error: 'La semaine commence un lundi' },
);

export const statsQuerySchema = z.object({ weekStart: weekStartSchema });
export type StatsQuery = z.infer<typeof statsQuerySchema>;

const occupancyFields = {
  /** Minutes d'ouverture de la semaine : horaires moins fermetures. */
  openMinutes: z.number().int(),
  /** Minutes réservées (réservations confirmées) à l'intérieur de l'ouverture. */
  bookedMinutes: z.number().int(),
  /** `bookedMinutes / openMinutes`, entre 0 et 1 ; `null` sans aucune minute d'ouverture. */
  occupancy: z.number().min(0).max(1).nullable(),
  /** Montant brut des réservations confirmées qui commencent dans la semaine. */
  revenueCents: z.number().int(),
  confirmedCount: z.number().int(),
};

export const resourceStatsSchema = z.object({
  resourceId: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  ...occupancyFields,
});
export type ResourceStats = z.infer<typeof resourceStatsSchema>;

export const providerStatsSchema = z.object({
  weekStart: localDateSchema,
  /** Toutes les ressources sont en euros (la devise n'est pas modifiable aujourd'hui). */
  currency: z.string(),
  resources: z.array(resourceStatsSchema),
  totals: z.object(occupancyFields),
});
export type ProviderStats = z.infer<typeof providerStatsSchema>;
