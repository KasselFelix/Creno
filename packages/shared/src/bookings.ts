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
/**
 * Remboursement d'une annulation par le client (ADR 0020) : intégral plus de 48 h avant le début,
 * à 50 % jusqu'à 24 h avant, puis aucun jusqu'au début.
 */
export const FULL_REFUND_HOURS = 48;
export const PARTIAL_REFUND_HOURS = 24;
export const PARTIAL_REFUND_PERCENT = 50;
/**
 * Réservation déplacée par le prestataire : le client garde au moins ce délai après le déplacement
 * pour annuler avec un remboursement intégral, sans dépasser le début (ADR 0015).
 */
export const RESCHEDULE_DECISION_HOURS = 24;

export type RefundPercent = 100 | typeof PARTIAL_REFUND_PERCENT | 0;

/** Un palier : à une annulation avant `until` (exclu), `percent` du montant payé est rendu. */
export interface RefundStep {
  percent: RefundPercent;
  until: Date;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Paliers de remboursement d'une réservation payée, du plus favorable au moins favorable ; le
 * dernier finit au début du créneau. Les instants sont comparés en UTC : 48 h sont 48 h réelles,
 * même à un changement d'heure.
 */
export function customerRefundSteps(booking: {
  start: Date | string;
  rescheduledAt: Date | string | null;
}): RefundStep[] {
  const start = new Date(booking.start).getTime();
  const usual = start - FULL_REFUND_HOURS * HOUR_MS;
  const decision =
    booking.rescheduledAt === null
      ? usual
      : new Date(booking.rescheduledAt).getTime() + RESCHEDULE_DECISION_HOURS * HOUR_MS;
  const fullUntil = Math.min(start, Math.max(usual, decision));
  const partialUntil = start - PARTIAL_REFUND_HOURS * HOUR_MS;

  const steps: RefundStep[] = [{ percent: 100, until: new Date(fullUntil) }];
  if (fullUntil < partialUntil) {
    steps.push({ percent: PARTIAL_REFUND_PERCENT, until: new Date(partialUntil) });
  }
  if (Math.max(fullUntil, partialUntil) < start) steps.push({ percent: 0, until: new Date(start) });
  return steps;
}

/** Palier en cours à `now` : le premier dont l'échéance n'est pas passée ; `null` une fois le créneau commencé. */
export function refundStepAt(steps: readonly RefundStep[], now: Date): RefundStep | null {
  return steps.find((step) => now < step.until) ?? null;
}

/** Montant rendu pour un palier, arrondi au centime inférieur. */
export function refundCentsFor(amountCents: number, percent: RefundPercent): number {
  return Math.floor((amountCents * percent) / 100);
}

/**
 * Les paliers encore à venir, en une phrase : « Annulation gratuite jusqu'au …, remboursée à 50 %
 * jusqu'au …, puis sans remboursement. » La même phrase sert à la fiche, à la page de paiement
 * et aux emails ; seul le format des dates change. `null` une fois le créneau commencé.
 */
export function refundPolicyText(
  steps: readonly RefundStep[],
  now: Date,
  formatDate: (date: Date) => string,
): string | null {
  const upcoming = steps.filter((step) => now < step.until);
  if (upcoming.length === 0) return null;
  const clauses = upcoming.map((step, index) => {
    if (step.percent === 0) {
      // Le palier à 0 % commence toujours moins de 24 h avant le début, même après un déplacement.
      return index === 0
        ? `Annulation sans remboursement (moins de ${PARTIAL_REFUND_HOURS} h avant le début)`
        : 'puis sans remboursement';
    }
    const refund = step.percent === 100 ? 'gratuite' : `remboursée à ${step.percent} %`;
    return `${index === 0 ? 'Annulation ' : ''}${refund} jusqu'au ${formatDate(step.until)}`;
  });
  return `${clauses.join(', ')}.`;
}

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
  /**
   * Montant dû au client par l'annulation (ou l'expiration) d'une réservation payée ; `null` sans
   * paiement. Le remboursement est en cours tant que `refundedCents` est inférieur.
   */
  refundDueCents: z.number().int().nullable(),
  /** Vrai une fois le paiement lancé : le hold a été prolongé et une session Stripe existe. */
  checkoutStarted: z.boolean(),
  /**
   * Dernier instant où l'appelant peut annuler ; `null` s'il ne peut plus (ou pas). Pour une
   * réservation confirmée, c'est son début : le montant rendu dépend des paliers (ADR 0020).
   */
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
 * Annulation. Le client renvoie le montant qu'on lui a annoncé : s'il ne correspond plus au palier
 * en cours, l'API refuse (409 `REFUND_AMOUNT_CHANGED`) au lieu de rendre un autre montant. Ce champ
 * ne sert qu'à cette comparaison, jamais de montant. Le corps peut être absent (prestataire).
 */
export const cancelBookingSchema = z
  .object({ expectedRefundCents: z.number().int().min(0).optional() })
  .default({});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

/** `details` d'une erreur `REFUND_AMOUNT_CHANGED` : le montant du palier en cours. */
export const refundAmountChangedDetailsSchema = z.object({
  refundDueCents: z.number().int().min(0),
  percent: z.union([z.literal(100), z.literal(PARTIAL_REFUND_PERCENT), z.literal(0)]),
});
export type RefundAmountChangedDetails = z.infer<typeof refundAmountChangedDetailsSchema>;

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
  refundedCents: z.number().int(),
  /** Montant dû au client par l'annulation ; `null` sans paiement (voir `bookingDetailSchema`). */
  refundDueCents: z.number().int().nullable(),
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
