/** Envoi d'une notification (un job par ligne `notifications`). */
export const SEND_QUEUE = 'notifications.send';
/** File morte : reçoit un job d'envoi qui a épuisé ses reprises. */
export const DEAD_QUEUE = 'notifications.dead';
/** Tâche planifiée : met en file les rappels dont l'heure est venue. */
export const DISPATCH_QUEUE = 'notifications.dispatch-due';

/**
 * Plafonds par destinataire. L'adresse d'un compte est confirmée à l'inscription ; le téléphone ne
 * l'est pas encore (étape `phone-verification`) : un compte peut porter le numéro de quelqu'un
 * d'autre, et ces plafonds bornent ce qu'il peut lui faire recevoir.
 */
export const MAX_EMAILS_PER_RECIPIENT_PER_HOUR = 30;
export const MAX_SMS_PER_RECIPIENT_PER_DAY = 5;

/** Reprises d'un envoi, après le premier essai : 30 s, 1 min, 2 min, 4 min, 8 min (plus un aléa). */
export const SEND_RETRY_LIMIT = 5;
