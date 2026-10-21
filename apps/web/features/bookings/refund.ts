import {
  type BookingDetail,
  customerRefundSteps,
  type RefundAmountChangedDetails,
  refundCentsFor,
  refundPolicyText,
  refundStepAt,
} from '@creno/shared';
import { dayAtTimeInZone } from '@/lib/format';

/** Ce que rendrait une annulation maintenant : le montant envoyé à l'API pour qu'elle le vérifie. */
export type RefundQuote = RefundAmountChangedDetails;

type Slot = Pick<BookingDetail, 'start' | 'rescheduledAt' | 'timezone'>;

const formatIn = (timezone: string) => (date: Date) =>
  dayAtTimeInZone(date.toISOString(), timezone);

/** Réservation confirmée et payée : la seule dont l'annulation rembourse selon les paliers. */
const isPaidConfirmed = (booking: BookingDetail) =>
  booking.status === 'confirmed' && booking.paymentStatus !== null && booking.priceCents > 0;

/**
 * Paliers à venir d'un créneau payant, en une phrase (fiche avant de payer, page de confirmation) :
 * « Annulation gratuite jusqu'au …, remboursée à 50 % jusqu'au …, puis sans remboursement. »
 */
export function refundPolicyFor(slot: Slot, now = new Date()): string | null {
  return refundPolicyText(customerRefundSteps(slot), now, formatIn(slot.timezone));
}

/** Le palier en cours d'une réservation payée et son échéance (carte de « Mes réservations »). */
export function currentRefundText(booking: BookingDetail, now = new Date()): string | null {
  if (!isPaidConfirmed(booking)) return null;
  const step = refundStepAt(customerRefundSteps(booking), now);
  return step ? refundPolicyText([step], now, formatIn(booking.timezone)) : null;
}

/** Montant qu'une annulation rendrait à `now` ; `null` s'il n'y a rien à rembourser. */
export function refundQuote(booking: BookingDetail, now = new Date()): RefundQuote | null {
  if (!isPaidConfirmed(booking)) return null;
  const step = refundStepAt(customerRefundSteps(booking), now);
  if (!step) return null;
  return {
    refundDueCents: refundCentsFor(booking.priceCents, step.percent),
    percent: step.percent,
  };
}
