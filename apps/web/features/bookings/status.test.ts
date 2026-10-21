import { describe, expect, it } from 'vitest';
import type { BookingDetail } from '@creno/shared';
import { bookingStatusView, isPayable, providerBookingStatusView } from './status';

const booking = (overrides: Partial<BookingDetail>): BookingDetail => ({
  id: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a11',
  resourceId: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a12',
  start: '2030-01-07T09:00:00.000Z',
  end: '2030-01-07T10:00:00.000Z',
  status: 'pending',
  expiresAt: '2030-01-01T09:15:00.000Z',
  priceCents: 4500,
  currency: 'EUR',
  resourceName: 'Studio A',
  providerName: 'Studio Lumière',
  providerSlug: 'studio-lumiere',
  timezone: 'Europe/Paris',
  paymentStatus: null,
  refundedCents: 0,
  refundDueCents: null,
  checkoutStarted: false,
  cancellableUntil: '2030-01-01T09:15:00.000Z',
  rescheduledAt: null,
  ...overrides,
});

describe('bookingStatusView', () => {
  it.each([
    [{}, 'En attente de paiement', 'waiting'],
    [{ cancellableUntil: null }, 'Délai de paiement dépassé', 'closed'],
    [{ status: 'confirmed', paymentStatus: 'succeeded' }, 'Confirmée', 'success'],
    [{ status: 'cancelled' }, 'Annulée', 'closed'],
    [{ status: 'cancelled', refundDueCents: 0 }, 'Annulée · non remboursée', 'closed'],
    [{ status: 'cancelled', refundDueCents: 4500 }, 'Annulée · remboursement en cours', 'closed'],
    [
      { status: 'cancelled', refundDueCents: 4500, refundedCents: 4500 },
      'Annulée · remboursée',
      'closed',
    ],
    [{ status: 'cancelled', refundDueCents: 2250 }, 'Annulée · remboursement en cours', 'closed'],
    [
      { status: 'cancelled', refundDueCents: 2250, refundedCents: 2250 },
      'Annulée · remboursée à 50 %',
      'closed',
    ],
    // 45,01 € à 50 % : 22,50 € rendus, affichés « 50 % ».
    [
      { status: 'cancelled', priceCents: 4501, refundDueCents: 2250, refundedCents: 2250 },
      'Annulée · remboursée à 50 %',
      'closed',
    ],
    [
      { status: 'expired', refundDueCents: 4500, refundedCents: 4500 },
      'Expirée · remboursée',
      'closed',
    ],
    [{ status: 'expired' }, 'Expirée', 'closed'],
  ] as const)('%j → %s', (overrides, label, tone) => {
    expect(bookingStatusView(booking(overrides))).toEqual({ label, tone });
  });
});

describe('isPayable', () => {
  it('vrai seulement pour un hold dont l’échéance n’est pas passée', () => {
    expect(isPayable(booking({}))).toBe(true);
    expect(isPayable(booking({ cancellableUntil: null }))).toBe(false);
    expect(isPayable(booking({ status: 'confirmed' }))).toBe(false);
  });
});

describe('providerBookingStatusView', () => {
  const refund = { priceCents: 4500, refundDueCents: null, refundedCents: 0 };
  it.each([
    [{ status: 'pending' }, 'Paiement en cours', 'waiting'],
    [{ status: 'confirmed' }, 'Confirmée', 'success'],
    [{ status: 'cancelled', refundDueCents: 4500 }, 'Annulée · remboursement en cours', 'closed'],
    [
      { status: 'cancelled', refundDueCents: 2250, refundedCents: 2250 },
      'Annulée · remboursée à 50 %',
      'closed',
    ],
    [{ status: 'cancelled', refundDueCents: 0 }, 'Annulée · non remboursée', 'closed'],
    [{ status: 'cancelled' }, 'Annulée', 'closed'],
  ] as const)('%o → %s', (overrides, label, tone) => {
    expect(providerBookingStatusView({ ...refund, ...overrides })).toEqual({ label, tone });
  });
});
