import {
  endTimeSchema,
  normalizeTimeRange,
  type Slot,
  startTimeSchema,
  type TimeRange,
} from '@creno/shared';
import { timeInZone } from '@/lib/format';

type RangeQuery = { timeFrom?: string | string[]; timeTo?: string | string[] };

/**
 * Plage horaire venue d'un résultat de recherche (`?timeFrom=HH:mm&timeTo=HH:mm`). Une borne invalide
 * est ignorée ; une plage vide, inversée ou absente donne `undefined` (la fiche s'affiche sans plage).
 */
export function parseSlotRange(query: RangeQuery): TimeRange | undefined {
  const timeFrom = startTimeSchema.safeParse(query.timeFrom);
  const timeTo = endTimeSchema.safeParse(query.timeTo);
  const range = normalizeTimeRange({
    timeFrom: timeFrom.success ? timeFrom.data : undefined,
    timeTo: timeTo.success ? timeTo.data : undefined,
  });
  return range && (range.timeFrom || range.timeTo) ? range : undefined;
}

/**
 * Créneaux dans la plage et les autres, chacun dans l'ordre. Comme le filtre de recherche : heure de
 * début dans le fuseau de la ressource, `timeTo` exclu.
 */
export function splitSlotsByRange(
  slots: Slot[],
  range: TimeRange,
  timeZone: string,
): { inRange: Slot[]; others: Slot[] } {
  const inRange: Slot[] = [];
  const others: Slot[] = [];
  for (const slot of slots) {
    const start = timeInZone(slot.start, timeZone);
    const inside =
      (range.timeFrom === undefined || start >= range.timeFrom) &&
      (range.timeTo === undefined || start < range.timeTo);
    (inside ? inRange : others).push(slot);
  }
  return { inRange, others };
}
