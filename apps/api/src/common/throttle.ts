import { SkipThrottle } from '@nestjs/throttler';

/** Limites de débit nommées, déclarées dans `ThrottlerModule` (auth.module.ts). Compteur par IP. */
export const THROTTLERS = [
  'credentials',
  'refresh',
  'registration',
  'public',
  'bookings',
  'phone',
] as const;
export type ThrottlerName = (typeof THROTTLERS)[number];

/**
 * `ThrottlerGuard` applique par défaut TOUTES les limites nommées : ce décorateur ne garde que
 * celles qu'on lui donne (aucune, sans argument). Chaque limite reçoit une valeur explicite, pour
 * que le décorateur d'une route l'emporte sur celui de son contrôleur.
 */
export const OnlyThrottle = (...names: ThrottlerName[]) =>
  SkipThrottle(Object.fromEntries(THROTTLERS.map((n) => [n, !names.includes(n)])));
