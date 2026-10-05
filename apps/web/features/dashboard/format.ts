import type { ProviderBooking } from '@creno/shared';
import { dateTimeInZone, timeInZone, todayInZone } from '@/lib/format';

/** « mar. 20 oct. 2026, 10:00 – 11:00 », dans le fuseau de la ressource. */
export function slotLabel(booking: Pick<ProviderBooking, 'start' | 'end' | 'timezone'>): string {
  return `${dateTimeInZone(booking.start, booking.timezone)} – ${timeInZone(booking.end, booking.timezone)}`;
}

/** Date locale (`YYYY-MM-DD`) du début de la réservation, dans le fuseau de la ressource. */
export function localDateOfBooking(booking: Pick<ProviderBooking, 'start' | 'timezone'>): string {
  return todayInZone(booking.timezone, new Date(booking.start));
}

/** Nom du client, ou le statut d'un hold dont le client n'est pas encore connu. */
export function customerLabel(booking: Pick<ProviderBooking, 'customer'>): string {
  return booking.customer?.fullName ?? 'Paiement en cours';
}
