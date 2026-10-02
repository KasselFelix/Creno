import { describe, expect, it } from 'vitest';
import { stripeReturnPath } from './stripe-return';

const BOOKING = '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a11';

describe('stripeReturnPath', () => {
  it('mène à la page de la réservation après Checkout', () => {
    expect(stripeReturnPath({ booking: BOOKING, checkout: 'success' })).toBe(
      `/bookings/${BOOKING}/confirmation?checkout=success`,
    );
    expect(stripeReturnPath({ booking: BOOKING, checkout: 'cancelled' })).toBe(
      `/bookings/${BOOKING}/confirmation?checkout=cancelled`,
    );
  });

  it('mène à l’espace prestataire après le formulaire Stripe', () => {
    expect(stripeReturnPath({ connect: 'return' })).toBe('/dashboard?stripe=return');
    expect(stripeReturnPath({ connect: 'refresh' })).toBe('/dashboard?stripe=refresh');
  });

  it.each([
    {},
    { booking: BOOKING },
    { booking: BOOKING, checkout: 'paid' },
    { booking: '../../login', checkout: 'success' },
    { booking: '//evil.example', checkout: 'success' },
    { connect: 'https://evil.example' },
  ])('refuse %j', (params) => {
    expect(stripeReturnPath(params)).toBeNull();
  });
});
