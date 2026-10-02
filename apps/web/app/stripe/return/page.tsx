import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReturnRedirect } from '@/features/payments/components/return-redirect';
import { stripeReturnPath } from '@/lib/stripe-return';

export const metadata: Metadata = { title: 'Retour sur Creno' };

/**
 * Étape de retour depuis Stripe (paiement ou formulaire du prestataire). Page publique, sans
 * contrôle de session : en arrivant d'un autre site, le navigateur n'envoie pas le cookie de
 * refresh (`SameSite=Strict`), et après 15 min l'access token a expiré. Une page protégée
 * renverrait donc vers /login un utilisateur pourtant connecté. Depuis cette page, la navigation
 * suivante part de notre site : les deux cookies sont envoyés et la session est renouvelée.
 */
export default async function StripeReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string; checkout?: string; connect?: string }>;
}) {
  const to = stripeReturnPath(await searchParams);
  if (!to) notFound();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <ReturnRedirect to={to} />
    </main>
  );
}
