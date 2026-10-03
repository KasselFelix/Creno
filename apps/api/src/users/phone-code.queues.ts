/** SMS de code de vérification (un job par ligne `phone_verifications`). */
export const PHONE_CODE_QUEUE = 'users.phone-code';
/** File morte : reçoit un job d'envoi de code qui a épuisé ses reprises. */
export const PHONE_CODE_DEAD_QUEUE = 'users.phone-code-dead';

/**
 * Reprises après le premier essai, seulement quand le fournisseur a clairement refusé de traiter
 * (429, 5xx) : le code expire en 10 minutes, inutile d'insister au-delà.
 */
export const PHONE_CODE_RETRY_LIMIT = 3;
