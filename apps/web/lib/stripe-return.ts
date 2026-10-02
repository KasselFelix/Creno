import { z } from 'zod';

/**
 * Page interne à rejoindre au retour de Stripe, d'après les paramètres posés par l'API dans les
 * adresses de retour. Chaque valeur est validée et le chemin est construit ici : un lien forgé ne
 * peut mener nulle part ailleurs. `null` : paramètres inconnus.
 */
export function stripeReturnPath(params: {
  booking?: string;
  checkout?: string;
  connect?: string;
}): string | null {
  if (params.connect === 'return' || params.connect === 'refresh') {
    return `/dashboard?stripe=${params.connect}`;
  }
  if (
    z.uuid().safeParse(params.booking).success &&
    (params.checkout === 'success' || params.checkout === 'cancelled')
  ) {
    return `/bookings/${params.booking}/confirmation?checkout=${params.checkout}`;
  }
  return null;
}
