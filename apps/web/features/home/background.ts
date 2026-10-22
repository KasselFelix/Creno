import { addDays, formatLocalDate } from '@/lib/format';

/** Fond animé de l'accueil, tiré au hasard à chaque affichage. */
export type HomeBackground = 'globe' | 'grid';

/**
 * 50/50 entre le globe et la grille. `forced` (paramètre `?fond=globe|grille`) impose un fond, pour
 * les captures de vérification ; une valeur inconnue est ignorée.
 */
export function pickHomeBackground(random: () => number, forced?: string | null): HomeBackground {
  if (forced === 'globe') return 'globe';
  if (forced === 'grille') return 'grid';
  return random() < 0.5 ? 'globe' : 'grid';
}

/** Deux semaines de créneaux, de 9 h à 18 h avec la pause de midi. */
export const GRID_DAYS = 14;
export const SLOT_HOURS = [9, 10, 11, 12, 14, 15, 16, 17, 18] as const;

export type SlotCell = { time: string; taken: boolean };
export type SlotGrid = {
  days: { date: string; label: string }[];
  rows: { hour: number; label: string; cells: SlotCell[] }[];
};

/** Part des créneaux pris : plus forte le week-end. */
const TAKEN_SHARE = { week: 0.15, weekend: 0.55 };

/**
 * Grille décorative à partir du lundi de la semaine de `today` (date locale `YYYY-MM-DD`), sur
 * `dayCount` jours (deux semaines par défaut). Une même graine donne toujours la même grille.
 */
export function buildSlotGrid(today: string, seed: number, dayCount = GRID_DAYS): SlotGrid {
  const random = seededRandom(seed);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(monday, index);
    return { date, label: formatLocalDate(date, { weekday: 'short', day: 'numeric' }) };
  });
  const rows = SLOT_HOURS.map((hour) => ({
    hour,
    label: `${hour} h`,
    cells: days.map((_, day) => {
      const share = day % 7 >= 5 ? TAKEN_SHARE.weekend : TAKEN_SHARE.week;
      const minutes = random() < 0.5 ? '00' : '30';
      return { time: `${String(hour).padStart(2, '0')}:${minutes}`, taken: random() < share };
    }),
  }));
  return { days, rows };
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
