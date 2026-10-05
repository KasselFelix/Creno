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

/** Suffixe sur l'état du remboursement, quand un paiement a été reçu pour une réservation close. */
function refundSuffix(booking: Pick<BookingDetail, 'paymentStatus'>): string {
  if (booking.paymentStatus === 'refunded') return ' · remboursée';
  if (booking.paymentStatus === 'succeeded') return ' · remboursement en cours';
  return '';
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
  booking: Pick<BookingDetail, 'status' | 'paymentStatus'>,
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
