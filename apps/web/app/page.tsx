import { Suspense } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { ApiStatusCard, ApiStatusCardSkeleton } from '@/features/health/api-status-card';

export default function HomePage() {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">Creno</span>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-16">
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight">
            Réservez le bon créneau, au bon endroit.
          </h1>
          <p className="text-muted-foreground text-lg">
            Salles, coiffeurs, terrains, photographes : trouvez un prestataire sur la carte, choisissez un
            créneau libre et payez en ligne.
          </p>
        </div>
        <Suspense fallback={<ApiStatusCardSkeleton />}>
          <ApiStatusCard />
        </Suspense>
      </main>
    </>
  );
}
