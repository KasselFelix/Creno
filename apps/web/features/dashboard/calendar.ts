import type { AvailabilityException, AvailabilityRule, ProviderBooking } from '@creno/shared';
import { addDays } from '@/lib/format';

/** Minutes depuis minuit d'une heure locale `HH:mm`. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Pas d'aimantation du calendrier, en minutes. Les créneaux partent du début de chaque horaire,
 * de `slotMinutes` en `slotMinutes` : avec des créneaux de 60 min et des horaires qui commencent à
 * 09:00 et à 13:30, un pas de 60 min (aligné sur minuit) rendrait 13:30 inatteignable. Le PGCD
 * tombe sur tous les débuts de créneau.
 */
export function snapMinutes(slotMinutes: number, rules: Pick<AvailabilityRule, 'startTime'>[]) {
  return rules.reduce((step, rule) => gcd(step, minutesOf(rule.startTime)), slotMinutes);
}

/** Heure du premier horaire de la semaine (`HH:mm:00`), pour faire défiler le calendrier jusque-là. */
export function earliestStart(rules: Pick<AvailabilityRule, 'startTime'>[]): string {
  const first = rules.map((rule) => rule.startTime).sort()[0] ?? '08:00';
  return `${first}:00`;
}

/** Horaires au format FullCalendar (dimanche = 0 chez FullCalendar, 7 en ISO). */
export function businessHoursOf(rules: AvailabilityRule[]) {
  return rules.map((rule) => ({
    daysOfWeek: [rule.weekday % 7],
    startTime: rule.startTime,
    endTime: rule.endTime,
  }));
}

/** Lundi (`YYYY-MM-DD`) de la semaine qui contient la date locale `date`. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/**
 * Heure murale `YYYY-MM-DDTHH:mm` d'une date FullCalendar. Avec un fuseau nommé, `startStr` porte
 * le décalage de ce fuseau (`2026-10-20T10:00:00+02:00`) : ses 16 premiers caractères sont
 * l'heure locale de la ressource, ce qu'attend la création d'une fermeture.
 */
export function wallTimeOf(isoWithOffset: string): string {
  return isoWithOffset.slice(0, 16);
}

/** Réservations confirmées dont le créneau chevauche `[start, end)`. */
export function overlappingBookings(
  bookings: Pick<ProviderBooking, 'start' | 'end' | 'status'>[],
  start: Date,
  end: Date,
): number {
  return bookings.filter(
    (booking) =>
      booking.status === 'confirmed' &&
      Date.parse(booking.start) < end.getTime() &&
      Date.parse(booking.end) > start.getTime(),
  ).length;
}

export type CalendarItem =
  | { type: 'booking'; booking: ProviderBooking }
  | { type: 'closure'; closure: AvailabilityException };

/** Événements FullCalendar : réservations (déplaçables si l'API le permet) et fermetures. */
export function calendarEvents(bookings: ProviderBooking[], closures: AvailabilityException[]) {
  return [
    ...closures.map((closure) => ({
      id: `closure:${closure.id}`,
      start: closure.start,
      end: closure.end,
      title: closure.reason ? `Fermé · ${closure.reason}` : 'Fermé',
      editable: false,
      color: 'var(--muted)',
      contrastColor: 'var(--muted-foreground)',
      extendedProps: { item: { type: 'closure', closure } satisfies CalendarItem },
    })),
    ...bookings.map((booking) => ({
      id: booking.id,
      start: booking.start,
      end: booking.end,
      // Un hold n'a pas encore de client connu : le statut tient lieu de titre.
      title: booking.customer?.fullName ?? 'Paiement en cours',
      startEditable: booking.reschedulable,
      durationEditable: false,
      ...(booking.status === 'pending'
        ? { color: 'var(--muted)', contrastColor: 'var(--muted-foreground)' }
        : {}),
      extendedProps: { item: { type: 'booking', booking } satisfies CalendarItem },
    })),
  ];
}
