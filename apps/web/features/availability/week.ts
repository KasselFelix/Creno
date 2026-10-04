import { BOOKING_HORIZON_DAYS } from '@creno/shared';
import { addDays } from '@/lib/format';

export const WEEK = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jours calendaires de `from` à `to` (dates locales `YYYY-MM-DD`). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Premier jour de la semaine qui contient `date`. Les semaines de la fiche partent toujours
 * d'aujourd'hui (aujourd'hui, +7, +14…) ; `null` pour une date passée ou au-delà de l'horizon.
 */
export function weekStartFor(today: string, date: string): string | null {
  const days = daysBetween(today, date);
  if (days < 0 || days > BOOKING_HORIZON_DAYS) return null;
  return addDays(today, Math.floor(days / WEEK) * WEEK);
}
