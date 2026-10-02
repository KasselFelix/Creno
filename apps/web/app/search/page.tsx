import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { ResultListSkeleton } from '@/features/search/components/result-list';
import { SearchView } from '@/features/search/components/search-view';

export const metadata: Metadata = {
  title: 'Rechercher un prestataire — Creno',
  description: 'Trouvez une salle, un coiffeur, un terrain ou un photographe près de vous.',
};

export default function SearchPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">Rechercher un prestataire</h1>
        {/* La vue lit les filtres dans l'URL (`useSearchParams`), ce qui exige une limite Suspense. */}
        <Suspense fallback={<ResultListSkeleton />}>
          <SearchView />
        </Suspense>
      </main>
    </>
  );
}
