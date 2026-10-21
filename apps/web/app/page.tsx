import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { ApiStatusCard, ApiStatusCardSkeleton } from '@/features/health/api-status-card';
import { HomeAiSearch } from '@/features/search/components/home-ai-search';

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
            Salles, coiffeurs, terrains, photographes : trouvez votre prestataire, choisissez un
            créneau libre, réservez et payez en ligne.
          </p>
        </div>
        <div className="max-w-3xl">
          <HomeAiSearch />
        </div>
        {/* Aide au développement (stack docker compose) : un visiteur n'a pas à voir l'état de l'API. */}
        {process.env.NODE_ENV === 'development' && (
          <Suspense fallback={<ApiStatusCardSkeleton />}>
            <ApiStatusCard />
          </Suspense>
        )}
      </main>
    </>
  );
}
