import type { BookingStatus, NotificationKind } from '@creno/shared';

/** Ce qu'un gabarit peut afficher. Relu en base au moment de l'envoi, jamais porté par le job. */
export interface MessageData {
  kind: NotificationKind;
  /** Le destinataire est le client de la réservation, ou le prestataire propriétaire. */
  audience: 'customer' | 'provider';
  recipientName: string;
  customerName: string;
  resourceName: string;
  providerName: string;
  start: Date;
  end: Date;
  /** Fuseau IANA de la ressource : les heures s'affichent toujours dans ce fuseau. */
  timezone: string;
  bookingStatus: BookingStatus;
  /** Montant encaissé pour cette réservation ; `null` si elle n'a pas été payée (gratuite). */
  paidCents: number | null;
  currency: string;
  /** Page de la réservation (client). */
  bookingUrl: string;
  /** Fiche publique du prestataire, pour réserver un autre créneau. */
  providerUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Les noms (client, ressource, prestataire) sont saisis par des utilisateurs : toujours échappés en HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** « jeudi 15 octobre 2026 de 10:00 à 11:00 », dans le fuseau de la ressource. */
export function formatSlot(start: Date, end: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: timezone });
  const time = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: timezone });
  return `${day.format(start)} de ${time.format(start)} à ${time.format(end)}`;
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

interface EmailParts {
  subject: string;
  title: string;
  /** Paragraphes en texte brut : ils sont échappés au rendu HTML. */
  paragraphs: string[];
  action?: { label: string; url: string };
}

const REFUND_DELAY = 'Le remboursement apparaît sur votre relevé sous quelques jours ouvrés.';

function parts(data: MessageData): EmailParts {
  const slot = formatSlot(data.start, data.end, data.timezone);
  const what = `${data.resourceName} chez ${data.providerName}`;
  const paid = data.paidCents !== null ? formatMoney(data.paidCents, data.currency) : null;
  const seeBooking = { label: 'Voir ma réservation', url: data.bookingUrl };
  const rebook = { label: 'Choisir un autre créneau', url: data.providerUrl };

  switch (data.kind) {
    case 'booking_confirmed':
      return {
        subject: `Réservation confirmée : ${what}`,
        title: 'Votre réservation est confirmée',
        paragraphs: [
          `${what}, ${slot}.`,
          paid ? `Paiement reçu : ${paid}.` : 'Aucun paiement à prévoir.',
        ],
        action: seeBooking,
      };
    case 'booking_received':
      return {
        subject: `Nouvelle réservation : ${data.resourceName}`,
        title: 'Nouvelle réservation',
        paragraphs: [
          `${data.customerName} a réservé ${data.resourceName}, ${slot}.`,
          paid ? `Montant payé par le client : ${paid}.` : 'Réservation gratuite.',
        ],
      };
    case 'booking_cancelled':
      if (data.audience === 'provider') {
        return {
          subject: `Réservation annulée : ${data.resourceName}`,
          title: 'Une réservation a été annulée',
          paragraphs: [
            `${data.customerName} a annulé sa réservation de ${data.resourceName}, ${slot}.`,
            'Le créneau est de nouveau réservable.',
          ],
        };
      }
      return {
        subject: `Réservation annulée : ${what}`,
        title: 'Votre réservation est annulée',
        paragraphs: [
          `Vous avez annulé ${what}, ${slot}.`,
          ...(paid ? [`Vous êtes remboursé de ${paid}. ${REFUND_DELAY}`] : []),
        ],
        action: rebook,
      };
    case 'booking_cancelled_by_provider':
      return {
        subject: `Réservation annulée par ${data.providerName}`,
        title: 'Votre réservation a été annulée',
        paragraphs: [
          `${data.providerName} a annulé votre réservation : ${data.resourceName}, ${slot}.`,
          ...(paid ? [`Vous êtes remboursé de ${paid}. ${REFUND_DELAY}`] : []),
        ],
        action: rebook,
      };
    case 'payment_refunded_late':
      return {
        subject: `Paiement remboursé : ${what}`,
        title: 'Votre paiement est remboursé',
        paragraphs: [
          paid ? `Vous êtes remboursé de ${paid}. ${REFUND_DELAY}` : REFUND_DELAY,
          data.bookingStatus === 'cancelled'
            ? `Votre paiement est arrivé après l'annulation de la réservation (${what}, ${slot}).`
            : `Le délai de paiement était dépassé et le créneau a été réservé par quelqu'un d'autre entre-temps (${what}, ${slot}). La réservation n'a donc pas pu être confirmée.`,
        ],
        action: rebook,
      };
    case 'booking_reminder':
      return {
        subject: `Rappel : ${what}`,
        title: 'Votre réservation approche',
        paragraphs: [`${what}, ${slot}.`],
        action: seeBooking,
      };
  }
}

/** Un sujet tient sur une ligne : les noms saisis ne doivent pas y glisser de retour à la ligne. */
const oneLine = (value: string) => value.replace(/[\p{Cc}\s]+/gu, ' ').trim();

export function renderEmail(data: MessageData): RenderedEmail {
  const { subject: rawSubject, title, paragraphs, action } = parts(data);
  const subject = oneLine(rawSubject);
  const greeting = `Bonjour ${data.recipientName},`;

  const text = [
    greeting,
    title,
    ...paragraphs,
    ...(action ? [`${action.label} : ${action.url}`] : []),
    'Creno',
  ].join('\n\n');

  // Mise en page volontairement minimale : les clients mail ignorent les feuilles de style.
  const p = (content: string) => `<p style="margin:0 0 16px">${content}</p>`;
  const html = [
    '<!doctype html>',
    '<html lang="fr"><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">',
    '<div style="max-width:560px;margin:0 auto">',
    p(escapeHtml(greeting)),
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>`,
    ...paragraphs.map((paragraph) => p(escapeHtml(paragraph))),
    ...(action ? [p(`<a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a>`)] : []),
    p('Creno'),
    '</div></body></html>',
  ].join('');

  return { subject, html, text };
}

/** Longueur d'un SMS d'un seul segment dans l'alphabet GSM-7. */
export const SMS_MAX_LENGTH = 160;

// Alphabet GSM-7 de base. Un seul caractère hors de cet ensemble fait passer tout le SMS en
// UCS-2 : 70 caractères par segment au lieu de 160, donc un SMS facturé deux ou trois fois.
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM7_SUBSTITUTES: Record<string, string> = {
  œ: 'oe',
  Œ: 'OE',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '-',
  ' ': ' ',
  ' ': ' ',
};

/** Ramène un texte à l'alphabet GSM-7 : « août » → « aout », « ç » → « c ». */
export function toGsm7(value: string): string {
  return Array.from(value, (char) => {
    if (GSM7.has(char)) return char;
    const substitute = GSM7_SUBSTITUTES[char];
    if (substitute) return substitute;
    // Décompose la lettre accentuée et ne garde que sa base (ê → e).
    const base = char.normalize('NFD').replace(/\p{M}/gu, '');
    return base.length === 1 && GSM7.has(base) ? base : '?';
  }).join('');
}

const shorten = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}.` : value;

/** SMS de rappel : un seul segment, sans lien (une adresse de réservation prendrait la moitié du message). */
export function renderReminderSms(data: MessageData): string {
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: data.timezone,
  }).format(data.start);
  const time = new Intl.DateTimeFormat('fr-FR', {
    timeStyle: 'short',
    timeZone: data.timezone,
  }).format(data.start);
  const what = `${shorten(data.resourceName, 40)} chez ${shorten(data.providerName, 40)}`;
  return toGsm7(`Creno - Rappel : ${what}, ${day} à ${time}.`).slice(0, SMS_MAX_LENGTH);
}
