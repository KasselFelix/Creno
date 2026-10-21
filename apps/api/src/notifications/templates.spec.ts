import { describe, expect, it } from 'vitest';
import { notificationKinds } from '@creno/shared';
import {
  escapeHtml,
  formatSlot,
  type MessageData,
  renderEmail,
  renderReminderSms,
  SMS_MAX_LENGTH,
  toGsm7,
} from './templates.js';

const data = (overrides: Partial<MessageData> = {}): MessageData => ({
  kind: 'booking_confirmed',
  audience: 'customer',
  recipientName: 'Camille Martin',
  customerName: 'Camille Martin',
  resourceName: 'Studio A',
  providerName: 'Studio Lumière',
  // 10:00 à Paris (heure d'été, UTC+2).
  start: new Date('2026-10-15T08:00:00Z'),
  end: new Date('2026-10-15T09:00:00Z'),
  timezone: 'Europe/Paris',
  bookingStatus: 'confirmed',
  paidCents: 4500,
  refundDueCents: null,
  rescheduledAt: null,
  // Cinq jours avant le créneau : les trois paliers de remboursement sont à venir.
  sentAt: new Date('2026-10-10T08:00:00Z'),
  currency: 'EUR',
  bookingUrl: 'https://creno.test/bookings/123/confirmation',
  providerUrl: 'https://creno.test/providers/studio-lumiere',
  ...overrides,
});

// Caractères autorisés dans un SMS d'un seul segment (alphabet GSM-7 de base).
const GSM7_ONLY =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;

describe('formatSlot', () => {
  it('affiche le créneau dans le fuseau de la ressource, quel que soit celui du serveur', () => {
    const start = new Date('2026-10-15T08:00:00Z');
    const end = new Date('2026-10-15T09:00:00Z');
    expect(formatSlot(start, end, 'Europe/Paris')).toBe('jeudi 15 octobre 2026 de 10:00 à 11:00');
    expect(formatSlot(start, end, 'America/Montreal')).toBe(
      'jeudi 15 octobre 2026 de 04:00 à 05:00',
    );
  });

  it('après le passage à l’heure d’hiver, la même heure locale correspond à un autre instant', () => {
    // Le 25 octobre 2026, Paris repasse à UTC+1 : 10:00 locales = 09:00 UTC.
    const start = new Date('2026-10-26T09:00:00Z');
    expect(formatSlot(start, new Date('2026-10-26T10:00:00Z'), 'Europe/Paris')).toBe(
      'lundi 26 octobre 2026 de 10:00 à 11:00',
    );
  });
});

describe('renderEmail', () => {
  it('confirmation : sujet, date locale, montant et lien vers la réservation', () => {
    const email = renderEmail(data());
    expect(email.subject).toBe('Réservation confirmée : Studio A chez Studio Lumière');
    expect(email.text).toContain('Bonjour Camille Martin,');
    expect(email.text).toContain('jeudi 15 octobre 2026 de 10:00 à 11:00');
    expect(email.text).toMatch(/Paiement reçu : 45,00\s€\./);
    expect(email.text).toContain('https://creno.test/bookings/123/confirmation');
    expect(email.html).toContain('<a href="https://creno.test/bookings/123/confirmation">');
    expect(email.html).toContain('<html lang="fr">');
  });

  it('confirmation : les paliers de remboursement à venir, dans le fuseau de la ressource', () => {
    expect(renderEmail(data()).text).toContain(
      "Annulation gratuite jusqu'au mardi 13 octobre 2026 à 10:00, remboursée à 50 % jusqu'au mercredi 14 octobre 2026 à 10:00, puis sans remboursement.",
    );
    // Réservée 30 h avant le début : le remboursement intégral est déjà passé.
    const late = renderEmail(data({ sentAt: new Date('2026-10-14T02:00:00Z') }));
    expect(late.text).toContain(
      "Annulation remboursée à 50 % jusqu'au mercredi 14 octobre 2026 à 10:00, puis sans remboursement.",
    );
    expect(late.text).not.toContain('gratuite');
    const lastMinute = renderEmail(data({ sentAt: new Date('2026-10-15T06:00:00Z') }));
    expect(lastMinute.text).toContain(
      'Annulation sans remboursement (moins de 24 h avant le début).',
    );
  });

  it('réservation gratuite : aucun montant ni palier', () => {
    const email = renderEmail(data({ paidCents: null }));
    expect(email.text).toContain('Aucun paiement à prévoir.');
    expect(email.text).not.toContain('€');
    expect(email.text).not.toContain('Annulation');
  });

  it('échappe les noms saisis par les utilisateurs dans le HTML', () => {
    const email = renderEmail(
      data({
        kind: 'booking_received',
        audience: 'provider',
        customerName: '<script>alert(1)</script>',
        resourceName: 'Salle "A" & B',
      }),
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('Salle &quot;A&quot; &amp; B');
    // Le texte brut, lui, n'est pas du HTML : rien à échapper.
    expect(email.text).toContain('Salle "A" & B');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('garde le sujet sur une seule ligne, même si un nom contient des retours à la ligne', () => {
    const email = renderEmail(data({ resourceName: 'Studio\r\nBcc: victime@test.dev\tA' }));
    expect(email.subject).toBe(
      'Réservation confirmée : Studio Bcc: victime@test.dev A chez Studio Lumière',
    );
  });

  it('annulation : le client apprend son remboursement, le prestataire que le créneau est libre', () => {
    const cancelled = { kind: 'booking_cancelled', bookingStatus: 'cancelled' } as const;
    const toCustomer = renderEmail(data({ ...cancelled, refundDueCents: 4500 }));
    expect(toCustomer.text).toMatch(/Vous êtes remboursé de 45,00\s€\. Le remboursement apparaît/);
    expect(toCustomer.text).toContain('https://creno.test/providers/studio-lumiere');

    const toProvider = renderEmail(
      data({ ...cancelled, audience: 'provider', refundDueCents: 4500 }),
    );
    expect(toProvider.text).toContain('Camille Martin a annulé sa réservation de Studio A');
    expect(toProvider.text).toContain('Le client est remboursé intégralement.');
    expect(toProvider.text).toContain('Le créneau est de nouveau réservable.');

    const byProvider = renderEmail(
      data({ kind: 'booking_cancelled_by_provider', bookingStatus: 'cancelled' }),
    );
    expect(byProvider.subject).toBe('Réservation annulée par Studio Lumière');
    expect(byProvider.text).toContain('Studio Lumière a annulé votre réservation');
  });

  it('annulation à 50 % : le montant rendu au client et la part que garde le prestataire', () => {
    const half = {
      kind: 'booking_cancelled',
      bookingStatus: 'cancelled',
      refundDueCents: 2250,
    } as const;
    expect(renderEmail(data(half)).text).toMatch(
      /Vous êtes remboursé de 22,50\s€ sur 45,00\s€ \(annulation moins de 48 h avant le début\)\. Le remboursement apparaît/,
    );
    expect(renderEmail(data({ ...half, audience: 'provider' })).text).toMatch(
      /Le client est remboursé de 22,50\s€ ; vous conservez 22,50\s€ sur ce paiement, avant commission\./,
    );
  });

  it('annulation à 0 % : pas de remboursement, ni de délai bancaire', () => {
    const none = {
      kind: 'booking_cancelled',
      bookingStatus: 'cancelled',
      refundDueCents: 0,
    } as const;
    const toCustomer = renderEmail(data(none)).text;
    expect(toCustomer).toContain('Annulation moins de 24 h avant le début : pas de remboursement.');
    expect(toCustomer).not.toContain('relevé');
    expect(renderEmail(data({ ...none, audience: 'provider' })).text).toContain(
      'Annulation tardive : vous conservez le paiement, avant commission.',
    );
  });

  it('annulation d’une réservation gratuite : rien sur le remboursement', () => {
    const free = {
      kind: 'booking_cancelled',
      bookingStatus: 'cancelled',
      paidCents: null,
    } as const;
    expect(renderEmail(data(free)).text).not.toContain('rembours');
    expect(renderEmail(data({ ...free, audience: 'provider' })).text).not.toContain('rembours');
  });

  it('paiement tardif : le remboursement d’abord, puis la raison selon le cas', () => {
    const slotTaken = renderEmail(
      data({ kind: 'payment_refunded_late', bookingStatus: 'expired' }),
    );
    const paragraphs = slotTaken.text.split('\n\n');
    expect(paragraphs[2]).toMatch(/^Vous êtes remboursé de 45,00\s€\./);
    expect(slotTaken.text).toContain("réservé par quelqu'un d'autre");

    const cancelled = renderEmail(
      data({ kind: 'payment_refunded_late', bookingStatus: 'cancelled' }),
    );
    expect(cancelled.text).toContain("après l'annulation de la réservation");
  });

  it('déplacement : le nouvel horaire et un délai d’au moins 24 h pour annuler', () => {
    const email = renderEmail(data({ kind: 'booking_moved' }));
    expect(email.subject).toBe('Réservation déplacée : Studio A chez Studio Lumière');
    expect(email.text).toContain(
      'Nouvel horaire : Studio A, jeudi 15 octobre 2026 de 10:00 à 11:00.',
    );
    expect(email.text).toContain('remboursé intégralement pendant au moins 24 h');
    expect(email.text).toContain('https://creno.test/bookings/123/confirmation');

    const free = renderEmail(data({ kind: 'booking_moved', paidCents: null }));
    expect(free.text).not.toContain('remboursé');
    expect(free.text).toContain("Vous pouvez annuler en ligne jusqu'au début du créneau.");
  });

  it('chaque type de notification a un sujet et un corps', () => {
    for (const kind of notificationKinds) {
      const email = renderEmail(data({ kind }));
      expect(email.subject.length).toBeGreaterThan(10);
      expect(email.text).toContain('Studio A');
      expect(email.html).toContain('Studio A');
    }
  });
});

describe('SMS de rappel', () => {
  it('tient en un segment GSM-7, avec la date dans le fuseau de la ressource', () => {
    const sms = renderReminderSms(data({ kind: 'booking_reminder' }));
    expect(sms).toBe('Creno - Rappel : Studio A chez Studio Lumière, jeudi 15 octobre à 10:00.');
    expect(sms).toMatch(GSM7_ONLY);
  });

  it('remplace les caractères hors GSM-7 (un seul ferait tripler le prix du SMS)', () => {
    expect(toGsm7('Août : cœur, garçon, forêt, « Noël » — 5 €')).toBe(
      'Aout : coeur, garcon, foret, " Noel " - 5 ?',
    );
    const sms = renderReminderSms(
      data({
        kind: 'booking_reminder',
        resourceName: 'Séance photo “Été” 📸',
        providerName: 'L’atelier de Zoé',
        start: new Date('2026-08-04T08:00:00Z'),
      }),
    );
    expect(sms).toMatch(GSM7_ONLY);
    expect(sms).toContain('mardi 4 aout à 10:00');
  });

  it('reste sous 160 caractères avec des noms très longs', () => {
    const sms = renderReminderSms(
      data({
        kind: 'booking_reminder',
        resourceName: 'Grande salle de réunion panoramique du dernier étage avec terrasse',
        providerName: 'Centre d’affaires international de la presqu’île de Lyon Confluence',
        start: new Date('2026-09-23T08:00:00Z'),
      }),
    );
    expect(sms.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
    expect(sms).toMatch(/mercredi 23 septembre à 10:00\.$/);
  });
});
