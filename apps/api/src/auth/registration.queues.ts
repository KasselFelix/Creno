/** Email envoyé après une demande d'inscription (un job par ligne `pending_registrations`). */
export const REGISTRATION_EMAIL_QUEUE = 'auth.registration-email';
/** File morte : reçoit un job d'email d'inscription qui a épuisé ses reprises. */
export const REGISTRATION_EMAIL_DEAD_QUEUE = 'auth.registration-email-dead';

/**
 * Emails d'inscription par adresse et par heure. L'adresse n'est pas encore prouvée : sans ce
 * plafond, le formulaire servirait à bombarder la boîte mail de quelqu'un d'autre.
 */
export const MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR = 3;

/** Reprises d'un envoi, après le premier essai : 30 s, 1 min, 2 min, 4 min, 8 min (plus un aléa). */
export const REGISTRATION_EMAIL_RETRY_LIMIT = 5;
