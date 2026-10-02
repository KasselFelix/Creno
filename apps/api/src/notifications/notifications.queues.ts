/** Envoi d'une notification (un job par ligne `notifications`). */
export const SEND_QUEUE = 'notifications.send';
/** File morte : reçoit un job d'envoi qui a épuisé ses reprises. */
export const DEAD_QUEUE = 'notifications.dead';
/** Tâche planifiée : met en file les rappels dont l'heure est venue. */
export const DISPATCH_QUEUE = 'notifications.dispatch-due';

/** Reprises d'un envoi, après le premier essai : 30 s, 1 min, 2 min, 4 min, 8 min (plus un aléa). */
export const SEND_RETRY_LIMIT = 5;
