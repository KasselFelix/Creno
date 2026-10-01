import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <main
      role="status"
      aria-busy="true"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <span className="sr-only">Chargement de la fiche…</span>
    </main>
  );
}
