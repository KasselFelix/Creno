import { z } from 'zod';

/** Délai entre le rappel et le début du créneau. */
export const REMINDER_LEAD_HOURS = 24;
/** Durée de conservation des événements Stripe déjà traités (Stripe ne rejoue pas au-delà de 30 jours). */
export const STRIPE_EVENTS_RETENTION_DAYS = 90;

/**
 * - `booking_confirmed` : au client, sa réservation est confirmée ;
 * - `booking_received` : au prestataire, une nouvelle réservation ;
 * - `booking_cancelled` : au client et au prestataire, quand le client annule ;
 * - `booking_cancelled_by_provider` : au client, quand le prestataire annule ;
 * - `payment_refunded_late` : au client, son paiement est arrivé trop tard et a été remboursé ;
 * - `booking_reminder` : au client, la veille du créneau.
 */
export const notificationKinds = [
  'booking_confirmed',
  'booking_received',
  'booking_cancelled',
  'booking_cancelled_by_provider',
  'payment_refunded_late',
  'booking_reminder',
] as const;
export const notificationKindSchema = z.enum(notificationKinds);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationChannels = ['email', 'sms'] as const;
export const notificationChannelSchema = z.enum(notificationChannels);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/**
 * - `scheduled` : à envoyer plus tard (rappel), aucun job n'existe encore ;
 * - `pending` : un job d'envoi existe ;
 * - `sent`, `failed` (action requise), `skipped` (plus lieu d'être, ou canal non configuré).
 */
export const notificationStatuses = ['scheduled', 'pending', 'sent', 'failed', 'skipped'] as const;
export const notificationStatusSchema = z.enum(notificationStatuses);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** Contenu d'un job d'envoi : un identifiant, jamais d'adresse, de numéro ni de texte. */
export const sendNotificationJobSchema = z.object({ notificationId: z.uuid() });
export type SendNotificationJob = z.infer<typeof sendNotificationJobSchema>;
