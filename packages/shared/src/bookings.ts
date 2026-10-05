import { z } from 'zod';
import { paymentStatusSchema } from './payments.js';
import { paginationSchema } from './users.js';

/** Durée du hold : un booking `pending` bloque le créneau le temps du paiement. */
export const HOLD_MINUTES = 15;
/** Nombre de holds actifs par utilisateur : sans paiement, c'est le frein au blocage d'un agenda. */
export const MAX_ACTIVE_HOLDS = 5;
/** Holds actifs d'un même utilisateur sur une même ressource. */
export const MAX_ACTIVE_HOLDS_PER_RESOURCE = 2;
/** Réservations gratuites à venir d'un même utilisateur : elles sont confirmées sans paiement. */
export const MAX_FREE_UPCOMING_BOOKINGS = 5;
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
  /** Date du dernier déplacement par le prestataire ; `null` si l'horaire n'a jamais changé. */
  rescheduledAt: z.iso.datetime({ offset: true }).nullable(),
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
  // `https` seulement : le navigateur est redirigé vers cette adresse.
  checkoutUrl: z.url({ protocol: /^https$/ }).nullable(),
  booking: bookingDetailSchema,
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

/**
 * Déplacements d'une même réservation par le prestataire. Chacun envoie un email au client : sans
 * plafond, des allers-retours épuiseraient son quota d'emails (et ses emails légitimes avec).
 */
export const MAX_RESCHEDULES_PER_BOOKING = 3;

/** Déplacement d'une réservation par le prestataire : nouveau début, même durée. */
export const rescheduleBookingSchema = z.object({
  /** Début d'un créneau proposé par la ressource (`GET /resources/:id/slots`). */
  start: z.iso.datetime({ offset: true }),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

/** Statuts visibles par le prestataire : un hold expiré (panier abandonné) n'est jamais listé. */
export const providerBookingStatuses = ['pending', 'confirmed', 'cancelled'] as const;
export const providerBookingStatusSchema = z.enum(providerBookingStatuses);

/**
 * Une réservation vue par le prestataire. Le client n'est connu qu'une fois la réservation
 * confirmée : un hold (`pending`) n'expose ni le nom ni l'email de quelqu'un qui n'a pas payé.
 */
export const providerBookingSchema = bookingSchema.extend({
  resourceName: z.string(),
  timezone: z.string(),
  customer: z.object({ fullName: z.string(), email: z.string() }).nullable(),
  paymentStatus: paymentStatusSchema.nullable(),
  rescheduledAt: z.iso.datetime({ offset: true }).nullable(),
  /** Dernier instant où le prestataire peut annuler ; `null` s'il ne le peut pas. */
  cancellableUntil: z.iso.datetime({ offset: true }).nullable(),
  /** Confirmée, pas commencée, de la durée actuelle des créneaux, et pas déjà déplacée 3 fois. */
  reschedulable: z.boolean(),
});
export type ProviderBooking = z.infer<typeof providerBookingSchema>;

export const PROVIDER_BOOKINGS_PAGE_SIZE_MAX = 50;
export const providerBookingsQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(PROVIDER_BOOKINGS_PAGE_SIZE_MAX).default(20),
  scope: z.enum(bookingScopes).default('upcoming'),
  status: providerBookingStatusSchema.optional(),
  resourceId: z.uuid().optional(),
});
export type ProviderBookingsQuery = z.infer<typeof providerBookingsQuerySchema>;

export const providerBookingListSchema = z.object({
  items: z.array(providerBookingSchema),
  total: z.number().int(),
});
export type ProviderBookingList = z.infer<typeof providerBookingListSchema>;

/** Plage maximale d'une requête du calendrier : une vue mois de 6 semaines. */
export const MAX_CALENDAR_RANGE_DAYS = 42;
const DAY_MS = 24 * 60 * 60 * 1000;

export const calendarQuerySchema = z
  .object({
    resourceId: z.uuid(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    error: '`from` doit précéder `to`',
    path: ['to'],
  })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= MAX_CALENDAR_RANGE_DAYS * DAY_MS, {
    error: `${MAX_CALENDAR_RANGE_DAYS} jours maximum`,
    path: ['to'],
  });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

/** Réservations confirmées et holds actifs qui chevauchent la plage demandée. */
export const calendarSchema = z.object({ items: z.array(providerBookingSchema) });
export type Calendar = z.infer<typeof calendarSchema>;
