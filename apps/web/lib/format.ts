/** Formatage des prix, durées et dates. Les heures sont toujours affichées dans le fuseau de la ressource. */

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

/** 30 → « 30 min », 60 → « 1 h », 90 → « 1 h 30 ». */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Heure `HH:mm` d'un instant dans le fuseau donné. */
export function timeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

/** Date et heure d'un instant dans le fuseau donné, ex. « jeu. 8 oct. 2026, 10:00 ». */
export function dateTimeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/** Date du jour (`YYYY-MM-DD`) dans le fuseau donné : « aujourd'hui » pour la ressource. */
export function todayInZone(timeZone: string, now = new Date()): string {
  // Le format `en-CA` est AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

/** Décale une date locale `YYYY-MM-DD` de `days` jours calendaires. */
export function addDays(date: string, days: number): string {
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Libellé d'une date locale `YYYY-MM-DD` (qui n'est pas un instant : aucun fuseau n'intervient). */
export function formatLocalDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Numéro E.164 lisible : `+33639980001` → `+33 6 39 98 00 01` (les autres indicatifs restent tels quels). */
export function formatPhone(phone: string): string {
  const match = /^\+33(\d)(\d{8})$/.exec(phone);
  if (!match) return phone;
  return `+33 ${match[1]} ${match[2]!.replace(/(\d{2})(?=\d)/g, '$1 ')}`;
}
