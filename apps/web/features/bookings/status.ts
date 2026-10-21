import type { BookingDetail } from '@creno/shared';

export type BookingTone = 'success' | 'waiting' | 'closed';

export interface BookingStatusView {
  label: string;
  tone: BookingTone;
}

/** Le client peut encore payer ou annuler son hold (l'API ne donne une échéance que s'il court). */
export function isPayable(booking: BookingDetail): boolean {
  return booking.status === 'pending' && booking.cancellableUntil !== null;
}

/** Ce qu'il faut pour dire où en est le remboursement d'une réservation close (ADR 0020). */
type RefundFields = Pick<BookingDetail, 'priceCents' | 'refundDueCents' | 'refundedCents'>;

/**
 * Suffixe sur le remboursement d'une réservation close qui avait été payée : le montant dû est
 * fixé à l'annulation, le montant remboursé arrive avec le webhook Stripe.
 */
function refundSuffix(booking: RefundFields): string {
  const due = booking.refundDueCents;
  if (due === null) return '';
  if (due === 0) return ' · non remboursée';
  if (booking.refundedCents < due) return ' · remboursement en cours';
  if (due >= booking.priceCents) return ' · remboursée';
  return ` · remboursée à ${Math.round((100 * due) / booking.priceCents)} %`;
}

/** Libellé affiché pour une réservation : statut de la réservation et, s'il y a lieu, du remboursement. */
export function bookingStatusView(booking: BookingDetail): BookingStatusView {
  switch (booking.status) {
    case 'confirmed':
      return { label: 'Confirmée', tone: 'success' };
    case 'pending':
      return isPayable(booking)
        ? { label: 'En attente de paiement', tone: 'waiting' }
        : { label: 'Délai de paiement dépassé', tone: 'closed' };
    case 'cancelled':
      return { label: `Annulée${refundSuffix(booking)}`, tone: 'closed' };
    case 'expired':
      return { label: `Expirée${refundSuffix(booking)}`, tone: 'closed' };
  }
}

/**
 * Libellé d'une réservation vue par le prestataire. Un hold y est un paiement en cours : le
 * prestataire ne voit jamais les holds expirés (l'API ne les liste pas).
 */
export function providerBookingStatusView(
  booking: Pick<BookingDetail, 'status'> & RefundFields,
): BookingStatusView {
  switch (booking.status) {
    case 'confirmed':
      return { label: 'Confirmée', tone: 'success' };
    case 'pending':
      return { label: 'Paiement en cours', tone: 'waiting' };
    case 'cancelled':
      return { label: `Annulée${refundSuffix(booking)}`, tone: 'closed' };
    case 'expired':
      return { label: 'Expirée', tone: 'closed' };
  }
}
