import { Suspense } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { ApiStatusCard, ApiStatusCardSkeleton } from '@/features/health/api-status-card';
import { HomeSearch } from '@/features/search/components/home-search';

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-16">
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight">
            Réservez le bon créneau, au bon endroit.
          </h1>
          <p className="text-muted-foreground text-lg">
            Salles, coiffeurs, terrains, photographes : trouvez un prestataire sur la carte,
            choisissez un créneau libre et payez en ligne.
          </p>
        </div>
        <div className="flex max-w-3xl flex-col gap-3">
          <HomeSearch />
          <Link
            href="/search"
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4"
          >
            Voir tous les prestataires
          </Link>
        </div>
        <Suspense fallback={<ApiStatusCardSkeleton />}>
          <ApiStatusCard />
        </Suspense>
      </main>
    </>
  );
}
