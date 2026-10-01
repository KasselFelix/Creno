import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { ProviderDashboard } from '@/features/providers/components/provider-dashboard';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Espace prestataire — Creno' };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // proxy.ts redirige déjà ; ce contrôle reste la référence si le proxy est contourné ou mal configuré.
  if (!user) redirect('/login?next=/dashboard');
  // Confort d'affichage : c'est l'API qui refuse réellement l'accès à un autre rôle.
  if (user.role !== 'provider') redirect('/account');

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Espace prestataire</h1>
        <ProviderDashboard />
      </main>
    </>
  );
}
