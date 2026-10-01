import { z } from 'zod';

/** Plage maximale d'un appel à `GET /resources/:id/slots`. */
export const MAX_SLOTS_RANGE_DAYS = 31;
/** On ne propose pas de créneau au-delà de ce nombre de jours (jours calendaires de la ressource). */
export const BOOKING_HORIZON_DAYS = 90;
export const MAX_RULES = 28;

/** Heure locale `HH:mm`. `24:00` (fin de journée) n'est accepté que comme heure de fin. */
const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Heure au format HH:mm' });
const endTimeSchema = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, { error: 'Heure au format HH:mm' });

export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7), // ISO : 1 = lundi … 7 = dimanche
    startTime: startTimeSchema,
    endTime: endTimeSchema,
  })
  // Format HH:mm à largeur fixe : l'ordre des chaînes est l'ordre des heures.
  .refine((r) => r.startTime < r.endTime, {
    error: 'La fin doit être après le début',
    path: ['endTime'],
  });
export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;

export const replaceRulesSchema = z.object({
  rules: z
    .array(availabilityRuleSchema)
    .max(MAX_RULES, { error: `${MAX_RULES} plages maximum` })
    .superRefine((rules, ctx) => {
      // Deux plages du même jour qui se touchent (09:00-12:00, 12:00-14:00) sont permises.
      rules.forEach((rule, index) => {
        const overlaps = rules.some(
          (other, otherIndex) =>
            otherIndex < index &&
            other.weekday === rule.weekday &&
            other.startTime < rule.endTime &&
            rule.startTime < other.endTime,
        );
        if (overlaps) {
          ctx.addIssue({
            code: 'custom',
            message: 'Cette plage en chevauche une autre le même jour',
            path: [index, 'startTime'],
          });
        }
      });
    }),
});
export type ReplaceRulesInput = z.infer<typeof replaceRulesSchema>;

export const rulesResponseSchema = z.object({ rules: z.array(availabilityRuleSchema) });
export type RulesResponse = z.infer<typeof rulesResponseSchema>;

const isRealDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value.slice(0, 10));
};

/** Date locale de la ressource, `YYYY-MM-DD`. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Date au format AAAA-MM-JJ' })
  .refine(isRealDate, { error: 'Date invalide' });

/** Date et heure locales de la ressource, `YYYY-MM-DDTHH:mm` (format d'un `input datetime-local`). */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, { error: 'Date et heure requises' })
  .refine(isRealDate, { error: 'Date invalide' });

export const createExceptionSchema = z
  .object({
    startLocal: localDateTimeSchema,
    endLocal: localDateTimeSchema,
    reason: z.string().trim().max(200, { error: '200 caractères maximum' }).optional(),
  })
  .refine((v) => v.startLocal < v.endLocal, {
    error: 'La fin doit être après le début',
    path: ['endLocal'],
  });
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;

export const availabilityExceptionSchema = z.object({
  id: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  reason: z.string().nullable(),
});
export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;

export const exceptionListSchema = z.object({ items: z.array(availabilityExceptionSchema) });
export type ExceptionList = z.infer<typeof exceptionListSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

export const slotsQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((v) => v.from <= v.to, { error: '`from` doit précéder `to`', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / DAY_MS < MAX_SLOTS_RANGE_DAYS, {
    error: `${MAX_SLOTS_RANGE_DAYS} jours maximum`,
    path: ['to'],
  });
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const slotSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  /** `false` : le créneau existe mais une réservation active l'occupe. */
  available: z.boolean(),
});
export type Slot = z.infer<typeof slotSchema>;

export const slotsResponseSchema = z.object({
  resourceId: z.uuid(),
  timezone: z.string(),
  slotMinutes: z.number().int(),
  priceCents: z.number().int(),
  currency: z.string(),
  days: z.array(z.object({ date: localDateSchema, slots: z.array(slotSchema) })),
});
export type SlotsResponse = z.infer<typeof slotsResponseSchema>;
