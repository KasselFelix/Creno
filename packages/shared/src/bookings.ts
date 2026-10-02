import { z } from 'zod';
import { paymentStatusSchema } from './payments.js';
import { paginationSchema } from './users.js';

/** Durée du hold : un booking `pending` bloque le créneau le temps du paiement. */
export const HOLD_MINUTES = 15;
/** Nombre de holds actifs par utilisateur : sans paiement, c'est le frein au blocage d'un agenda. */
export const MAX_ACTIVE_HOLDS = 5;
/** Holds actifs d'un même utilisateur sur une même ressource. */
export const MAX_ACTIVE_HOLDS_PER_RESOURCE = 2;
/**
 * Durée du hold une fois le paiement lancé. Stripe impose une session Checkout d'au moins 30 min :
 * le hold est prolongé une seule fois, et la session expire au même instant (1 min de marge).
 */
export const CHECKOUT_MINUTES = 31;
/** Un client annule une réservation confirmée, avec remboursement total, jusqu'à ce délai avant le début. */
export const FREE_CANCELLATION_HOURS = 24;

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

/** Une réservation avec ce qu'il faut pour l'afficher : jamais d'identifiant Stripe ni de client. */
export const bookingDetailSchema = bookingSchema.extend({
  resourceName: z.string(),
  providerName: z.string(),
  providerSlug: z.string(),
  /** Fuseau de la ressource : les dates s'affichent dans ce fuseau. */
  timezone: z.string(),
  /** `null` tant qu'aucun paiement n'a été reçu (hold, réservation gratuite). */
  paymentStatus: paymentStatusSchema.nullable(),
  refundedCents: z.number().int(),
  /** Vrai une fois le paiement lancé : le hold a été prolongé et une session Stripe existe. */
  checkoutStarted: z.boolean(),
  /** Dernier instant où l'appelant peut annuler ; `null` s'il ne peut plus (ou pas). */
  cancellableUntil: z.iso.datetime({ offset: true }).nullable(),
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

export const bookingScopes = ['upcoming', 'past'] as const;
export const bookingsQuerySchema = paginationSchema.extend({
  /** `upcoming` : créneaux non terminés, du plus proche au plus lointain ; `past` : l'inverse. */
  scope: z.enum(bookingScopes).default('upcoming'),
});
export type BookingsQuery = z.infer<typeof bookingsQuerySchema>;

export const bookingListSchema = z.object({
  items: z.array(bookingDetailSchema),
  total: z.number().int(),
});
export type BookingList = z.infer<typeof bookingListSchema>;

/** `checkoutUrl` est `null` pour une ressource gratuite : la réservation est alors déjà confirmée. */
export const checkoutResponseSchema = z.object({
  checkoutUrl: z.url().nullable(),
  booking: bookingDetailSchema,
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;
