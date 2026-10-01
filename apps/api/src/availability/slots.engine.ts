import { TZDate } from '@date-fns/tz';
import { addMinutes, areIntervalsOverlapping, format } from 'date-fns';

/**
 * Moteur de calcul des créneaux. Fonctions pures : ni base de données ni horloge (`now` est un
 * paramètre), pour que les changements d'heure se testent sans rien d'autre (ADR 0006).
 * Idées reprises d'Openings (`src/lib/scheduling/availability.ts`) et de slotline (`src/availability.ts`).
 */

/** Plage horaire hebdomadaire en heure locale. `weekday` ISO (1 = lundi), heures `HH:mm`. */
export interface WallRule {
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Intervalle d'instants `[start, end)`. */
export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotsInput {
  /** Fuseau IANA de la ressource. */
  timezone: string;
  slotMinutes: number;
  rules: WallRule[];
  /** Fermetures : un créneau qui en chevauche une n'est pas proposé. */
  closures: Interval[];
  /** Réservations actives : un créneau qui en chevauche une est proposé avec `available: false`. */
  busy: Interval[];
  /** Premier et dernier jour, en dates locales de la ressource (`YYYY-MM-DD`), inclus. */
  from: string;
  to: string;
  now: Date;
  horizonDays: number;
}

export interface ComputedSlot extends Interval {
  available: boolean;
}

export interface DaySlots {
  date: string;
  slots: ComputedSlot[];
}

/** Décale une date locale `YYYY-MM-DD` de `days` jours calendaires. */
export function addLocalDays(date: string, days: number): string {
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'une date locale. */
function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

/** Date locale (`YYYY-MM-DD`) d'un instant, vue depuis le fuseau. */
export function localDateOf(instant: Date, timezone: string): string {
  return format(new TZDate(instant, timezone), 'yyyy-MM-dd');
}

/**
 * Instant correspondant à une heure murale dans le fuseau. `24:00` est le début du lendemain.
 * Heure inexistante (passage à l'heure d'été) : décalée vers l'avant. Heure répétée (passage à
 * l'heure d'hiver) : première occurrence. Les deux cas sont épinglés par les tests.
 */
export function wallTimeToInstant(date: string, time: string, timezone: string): Date {
  if (time === '24:00') return wallTimeToInstant(addLocalDays(date, 1), '00:00', timezone);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return new Date(new TZDate(year, month - 1, day, hours, minutes, timezone).getTime());
}

const overlapsAny = (slot: Interval, intervals: Interval[]) =>
  intervals.some((interval) => areIntervalsOverlapping(slot, interval));

/**
 * Créneaux de chaque jour local de `from` à `to`.
 *
 * Pour chaque jour : les plages du jour de la semaine sont converties en instants, puis découpées
 * en avançant de `slotMinutes` minutes RÉELLES depuis l'ouverture. Un jour de 23 h a donc moins de
 * créneaux, un jour de 25 h en a plus, et aucun créneau ne tombe sur une heure qui n'existe pas.
 */
export function computeSlots(input: SlotsInput): DaySlots[] {
  const { timezone, slotMinutes, rules, closures, busy, now, horizonDays } = input;
  // Horizon en jours calendaires locaux : fin du jour « aujourd'hui + horizonDays ».
  const horizon = wallTimeToInstant(
    addLocalDays(localDateOf(now, timezone), horizonDays + 1),
    '00:00',
    timezone,
  );

  const days: DaySlots[] = [];
  for (let date = input.from; date <= input.to; date = addLocalDays(date, 1)) {
    const weekday = isoWeekday(date);
    const slots: ComputedSlot[] = [];
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      const windowEnd = wallTimeToInstant(date, rule.endTime, timezone);
      let start = wallTimeToInstant(date, rule.startTime, timezone);
      for (;;) {
        const end = addMinutes(start, slotMinutes);
        if (end > windowEnd) break;
        const slot = { start, end };
        if (start > now && start < horizon && !overlapsAny(slot, closures)) {
          slots.push({ ...slot, available: !overlapsAny(slot, busy) });
        }
        start = end;
      }
    }
    slots.sort((a, b) => a.start.getTime() - b.start.getTime());
    days.push({ date, slots });
  }
  return days;
}

/**
 * Vrai si `start` est le début d'un créneau de la grille (horaires, fermetures, passé, horizon),
 * sans regarder les réservations : c'est la contrainte de la base qui dit si le créneau est pris.
 */
export function isOfferedSlot(input: Omit<SlotsInput, 'from' | 'to'>, start: Date): boolean {
  const date = localDateOf(start, input.timezone);
  return computeSlots({ ...input, from: date, to: date, busy: [] }).some((day) =>
    day.slots.some((slot) => slot.start.getTime() === start.getTime()),
  );
}
