import { describe, expect, it } from 'vitest';
import type { BookingDetail } from '@creno/shared';
import { bookingStatusView, isPayable } from './status';

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
  checkoutStarted: false,
  cancellableUntil: '2030-01-01T09:15:00.000Z',
  ...overrides,
});

describe('bookingStatusView', () => {
  it.each([
    [{}, 'En attente de paiement', 'waiting'],
    [{ cancellableUntil: null }, 'Délai de paiement dépassé', 'closed'],
    [{ status: 'confirmed', paymentStatus: 'succeeded' }, 'Confirmée', 'success'],
    [{ status: 'cancelled' }, 'Annulée', 'closed'],
    [
      { status: 'cancelled', paymentStatus: 'succeeded' },
      'Annulée · remboursement en cours',
      'closed',
    ],
    [{ status: 'cancelled', paymentStatus: 'refunded' }, 'Annulée · remboursée', 'closed'],
    [{ status: 'expired', paymentStatus: 'refunded' }, 'Expirée · remboursée', 'closed'],
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
