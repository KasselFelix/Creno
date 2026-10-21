import { describe, expect, it } from 'vitest';
import type { BookingDetail } from '@creno/shared';
import { currentRefundText, refundPolicyFor, refundQuote } from './refund';

const HOUR = 3_600_000;
// Lundi 7 janvier 2030, 10:00 à Paris (heure d'hiver, UTC+1).
const START = '2030-01-07T09:00:00.000Z';
const hoursBefore = (hours: number) => new Date(Date.parse(START) - hours * HOUR);

const booking = (overrides: Partial<BookingDetail> = {}): BookingDetail => ({
  id: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a11',
  resourceId: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a12',
  start: START,
  end: '2030-01-07T10:00:00.000Z',
  status: 'confirmed',
  expiresAt: null,
  priceCents: 4500,
  currency: 'EUR',
  resourceName: 'Studio A',
  providerName: 'Studio Lumière',
  providerSlug: 'studio-lumiere',
  timezone: 'Europe/Paris',
  paymentStatus: 'succeeded',
  refundedCents: 0,
  refundDueCents: null,
  checkoutStarted: true,
  cancellableUntil: START,
  rescheduledAt: null,
  ...overrides,
});

describe('refundPolicyFor', () => {
  it('les paliers à venir, dans le fuseau de la ressource', () => {
    expect(refundPolicyFor(booking(), hoursBefore(72))).toBe(
      "Annulation gratuite jusqu'au sam. 5 janv. à 10:00, remboursée à 50 % jusqu'au dim. 6 janv. à 10:00, puis sans remboursement.",
    );
  });

  it('créneau pris moins de 24 h avant : non remboursable', () => {
    expect(refundPolicyFor(booking(), hoursBefore(10))).toBe(
      'Annulation sans remboursement (moins de 24 h avant le début).',
    );
  });
});

describe('currentRefundText', () => {
  it('le palier en cours et son échéance', () => {
    expect(currentRefundText(booking(), hoursBefore(72))).toBe(
      "Annulation gratuite jusqu'au sam. 5 janv. à 10:00.",
    );
    expect(currentRefundText(booking(), hoursBefore(36))).toBe(
      "Annulation remboursée à 50 % jusqu'au dim. 6 janv. à 10:00.",
    );
    expect(currentRefundText(booking(), hoursBefore(12))).toBe(
      'Annulation sans remboursement (moins de 24 h avant le début).',
    );
  });

  it('rien pour un créneau commencé, gratuit, ou un hold', () => {
    expect(currentRefundText(booking(), hoursBefore(-1))).toBeNull();
    expect(currentRefundText(booking({ priceCents: 0, paymentStatus: null }))).toBeNull();
    expect(currentRefundText(booking({ status: 'pending', paymentStatus: null }))).toBeNull();
  });
});

describe('refundQuote', () => {
  it('montant et pourcentage du palier en cours', () => {
    expect(refundQuote(booking(), hoursBefore(72))).toEqual({ refundDueCents: 4500, percent: 100 });
    expect(refundQuote(booking(), hoursBefore(36))).toEqual({ refundDueCents: 2250, percent: 50 });
    expect(refundQuote(booking(), hoursBefore(12))).toEqual({ refundDueCents: 0, percent: 0 });
  });

  it('déplacée par le prestataire il y a 1 h : intégral, même à 30 h du début', () => {
    const moved = booking({ rescheduledAt: hoursBefore(31).toISOString() });
    expect(refundQuote(moved, hoursBefore(30))).toEqual({ refundDueCents: 4500, percent: 100 });
  });

  it('rien à rembourser : gratuite, non payée ou commencée', () => {
    expect(refundQuote(booking({ priceCents: 0, paymentStatus: null }))).toBeNull();
    expect(refundQuote(booking({ paymentStatus: null }))).toBeNull();
    expect(refundQuote(booking(), hoursBefore(-1))).toBeNull();
  });
});
