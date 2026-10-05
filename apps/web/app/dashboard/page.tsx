import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProviderDashboard } from '@/features/providers/components/provider-dashboard';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Espace prestataire — Creno' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const { stripe } = await searchParams;
  const user = await getCurrentUser();
  // proxy.ts redirige déjà ; ce contrôle reste la référence si le proxy est contourné ou mal configuré.
  if (!user) redirect('/login?next=/dashboard');
  // Confort d'affichage : c'est l'API qui refuse réellement l'accès à un autre rôle.
  if (user.role !== 'provider') redirect('/account');

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Espace prestataire</h1>
      {/* `?stripe=` : posé par Stripe au retour du formulaire d'inscription du prestataire. */}
      <ProviderDashboard
        stripeReturn={stripe === 'return' || stripe === 'refresh' ? stripe : null}
      />
    </>
  );
}
