import { SkipThrottle } from '@nestjs/throttler';

/** Limites de débit nommées, déclarées dans `ThrottlerModule` (auth.module.ts). Compteur par IP. */
export const THROTTLERS = ['credentials', 'refresh', 'public', 'bookings'] as const;
export type ThrottlerName = (typeof THROTTLERS)[number];

/**
 * `ThrottlerGuard` applique par défaut TOUTES les limites nommées : ce décorateur n'en garde
 * qu'une seule (ou aucune, sans argument). Chaque limite reçoit une valeur explicite, pour que le
 * décorateur d'une route l'emporte sur celui de son contrôleur.
 */
export const OnlyThrottle = (name?: ThrottlerName) =>
  SkipThrottle(Object.fromEntries(THROTTLERS.map((n) => [n, n !== name])));
