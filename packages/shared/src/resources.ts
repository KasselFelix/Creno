import { z } from 'zod';

export const SLOT_MINUTES_MIN = 5;
export const SLOT_MINUTES_MAX = 1440;
export const PRICE_CENTS_MAX = 10_000_000;
/** Stripe refuse un paiement par carte de moins de 0,50 € : un prix est gratuit (0) ou d'au moins 50 centimes. */
export const MIN_PAID_PRICE_CENTS = 50;
export const MAX_RESOURCES_PER_PROVIDER = 50;

/** Vrai pour un fuseau IANA connu du moteur JavaScript (ex. `Europe/Paris`), ou `UTC`. */
export function isValidTimeZone(value: string): boolean {
  // Intl accepte aussi des abréviations (`EST`) et des décalages (`+01:00`) : on exige `Région/Ville`.
  if (value !== 'UTC' && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimeZone, { error: 'Fuseau horaire inconnu' });

export const createResourceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Nom requis' })
    .max(100, { error: '100 caractères maximum' }),
  description: z.string().trim().max(2000, { error: '2000 caractères maximum' }),
  timezone: timezoneSchema,
  slotMinutes: z
    .number({ error: 'Durée requise' })
    .int({ error: 'Nombre entier de minutes' })
    .min(SLOT_MINUTES_MIN, { error: `${SLOT_MINUTES_MIN} minutes minimum` })
    .max(SLOT_MINUTES_MAX, { error: `${SLOT_MINUTES_MAX} minutes maximum` }),
  priceCents: z
    .number({ error: 'Prix requis' })
    .int({ error: 'Prix en centimes entiers' })
    .min(0, { error: 'Prix positif ou nul' })
    .max(PRICE_CENTS_MAX, { error: 'Prix trop élevé' })
    .refine((cents) => cents === 0 || cents >= MIN_PAID_PRICE_CENTS, {
      error: 'Gratuit, ou 0,50 € au minimum',
    }),
});
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = createResourceSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucune modification' });
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const resourceSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  name: z.string(),
  description: z.string(),
  timezone: z.string(),
  slotMinutes: z.number().int(),
  priceCents: z.number().int(),
  currency: z.string(),
  isActive: z.boolean(),
});
export type Resource = z.infer<typeof resourceSchema>;

export const resourceListSchema = z.object({ items: z.array(resourceSchema) });
export type ResourceList = z.infer<typeof resourceListSchema>;
