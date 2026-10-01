import { z } from 'zod';

/** Durée du hold : un booking `pending` bloque le créneau le temps du paiement. */
export const HOLD_MINUTES = 15;
/** Nombre de holds actifs par utilisateur : sans paiement, c'est le frein au blocage d'un agenda. */
export const MAX_ACTIVE_HOLDS = 5;

export const bookingStatuses = ['pending', 'confirmed', 'cancelled', 'expired'] as const;
export const bookingStatusSchema = z.enum(bookingStatuses);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const createBookingSchema = z.object({
  resourceId: z.uuid(),
  /** Début du créneau, tel que renvoyé par `GET /resources/:id/slots`. */
  start: z.iso.datetime({ offset: true }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingSchema = z.object({
  id: z.uuid(),
  resourceId: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  status: bookingStatusSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  priceCents: z.number().int(),
  currency: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;
