import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { ApiStatusCard } from '@/features/health/api-status-card';
import { HomeBackground } from '@/features/home/components/home-background';
import { HomeAiSearch } from '@/features/search/components/home-ai-search';

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-16 pb-8">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <h1 className="text-4xl font-semibold tracking-tight">
              Réservez le bon créneau, au bon endroit.
            </h1>
            <p className="text-muted-foreground max-w-2xl text-lg">
              Salles, coiffeurs, terrains, photographes : trouvez votre prestataire, choisissez un
              créneau libre, réservez et payez en ligne.
            </p>
          </div>
          <div className="mx-auto w-full max-w-3xl">
            <HomeAiSearch />
          </div>
        </div>
        {/* Bande pleine largeur sous la recherche, jusqu'au pied de page. */}
        <HomeBackground />
      </main>
      {/* Aide au développement (stack docker compose) : un visiteur n'a pas à voir l'état de l'API.
          Elle flotte par-dessus la page, à gauche du bouton pause de l'animation (`sm:right-20`),
          et se ferme d'une croix. */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed right-4 bottom-4 left-4 z-20 sm:right-20 sm:left-auto sm:w-sm">
          <Suspense fallback={null}>
            <ApiStatusCard />
          </Suspense>
        </div>
      )}
    </>
  );
}
