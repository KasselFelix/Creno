import { subHours } from 'date-fns';
import { REMINDER_LEAD_HOURS } from '@creno/shared';

/**
 * Instant d'envoi du rappel d'un créneau, ou `null` s'il ne faut pas de rappel.
 *
 * Un créneau réservé moins de 24 h avant son début n'a pas de rappel : son instant serait déjà
 * passé, et le « rappel » partirait une minute après la confirmation (idée reprise d'Openings,
 * `reminder-timing.test.ts`). C'est une soustraction entre deux instants UTC : un changement
 * d'heure entre la réservation et le créneau ne déplace rien.
 */
export function reminderInstantFor(start: Date, now: Date): Date | null {
  const at = subHours(start, REMINDER_LEAD_HOURS);
  return at > now ? at : null;
}
