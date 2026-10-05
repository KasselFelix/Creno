'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { QueryError } from '@/components/query-error';
import { buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyResources } from '@/features/providers/api';

const calendarSkeleton = (
  <div role="status" aria-busy="true">
    <Skeleton className="h-150 w-full rounded-xl" />
    <span className="sr-only">Chargement du calendrier…</span>
  </div>
);

// FullCalendar (et le polyfill Temporal) ne sont chargés que sur cette page, et seulement côté client.
const ProviderCalendar = dynamic(() => import('./provider-calendar'), {
  ssr: false,
  loading: () => calendarSkeleton,
});

/** Choix de la ressource (mémorisé dans l'URL) et son calendrier. */
export function CalendarView({ initialResourceId }: { initialResourceId?: string }) {
  const router = useRouter();
  const resources = useMyResources();
  const [resourceId, setResourceId] = useState(initialResourceId);

  if (resources.isPending) return calendarSkeleton;
  if (resources.isError) {
    return (
      <QueryError
        title="Impossible de charger vos ressources"
        error={resources.error}
        onRetry={() => resources.refetch()}
      />
    );
  }
  const items = resources.data.items;
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
        <p>Créez d&apos;abord une ressource : son calendrier s&apos;affichera ici.</p>
        <Link
          href="/dashboard/resources/new"
          className={buttonVariants({ variant: 'outline', className: 'h-11' })}
        >
          Ajouter une ressource
        </Link>
      </div>
    );
  }
  // Ressource de l'URL inconnue (supprimée, ou d'un autre compte) : la première.
  const resource = items.find((item) => item.id === resourceId) ?? items[0]!;
  const selectItems = items.map((item) => ({ value: item.id, label: item.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:max-w-xs">
        <Label htmlFor="calendar-resource">Ressource</Label>
        <Select
          items={selectItems}
          value={resource.id}
          onValueChange={(value) => {
            const id = value as string;
            setResourceId(id);
            router.replace(`/dashboard/calendar?resource=${id}`, { scroll: false });
          }}
        >
          <SelectTrigger id="calendar-resource" className="h-11! w-full md:h-9!">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          Heures affichées dans le fuseau {resource.timezone}. Glissez une réservation pour la
          déplacer, sélectionnez une plage libre pour la bloquer.
        </p>
      </div>
      {/* `key` : une autre ressource repart d'un calendrier neuf (fuseau, horaires, plage). */}
      <ProviderCalendar key={resource.id} resource={resource} />
    </div>
  );
}
