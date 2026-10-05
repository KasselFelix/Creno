import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { DashboardNav } from '@/features/dashboard/components/dashboard-nav';

/**
 * Cadre de l'espace prestataire. L'accès est contrôlé par chaque page (redirection vers la
 * connexion avec le bon `next=`) : un layout ne connaît pas le chemin demandé.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row md:py-10">
        <DashboardNav />
        <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
      </div>
    </>
  );
}
