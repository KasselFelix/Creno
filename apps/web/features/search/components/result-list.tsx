'use client';

import { CalendarCheck, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { SearchProvider, TimeRange } from '@creno/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryIcons } from '@/features/providers/category-icons';
import { categoryLabels } from '@/features/providers/labels';
import { formatPriceShort } from '@/lib/format';
import { describeFreeSlots, formatDistance, providerHref } from '../params';

export function ResultList({
  items,
  date,
  timeRange,
  activeId,
  selectedId,
  onActiveChange,
}: {
  items: SearchProvider[];
  /** Jour filtré : chaque carte dit combien de créneaux sont libres ce jour-là. */
  date?: string;
  /** Plage horaire de ce jour : les créneaux comptés sont ceux de la plage. */
  timeRange?: TimeRange;
  activeId: string | null;
  /** Prestataire choisi sur la carte : sa carte reste mise en évidence. */
  selectedId: string | null;
  onActiveChange: (id: string | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((provider) => {
        const Icon = categoryIcons[provider.category];
        return (
          // `id` : un clic sur la pastille fait défiler la page jusqu'ici.
          <li key={provider.id} id={resultElementId(provider.id)} className="scroll-my-4">
            <Card
              size="sm"
              data-active={provider.id === activeId || provider.id === selectedId}
              // Toute la carte est cliquable (le lien du titre est étiré) ; le survol ou le focus
              // met en évidence la pastille correspondante sur la carte.
              className="has-[a:focus-visible]:ring-ring/50 data-[active=true]:ring-primary relative transition-shadow has-[a:focus-visible]:ring-3 data-[active=true]:ring-2"
              onMouseEnter={() => onActiveChange(provider.id)}
              onMouseLeave={() => onActiveChange(null)}
              onFocus={() => onActiveChange(provider.id)}
              onBlur={() => onActiveChange(null)}
            >
              <CardHeader>
                <Badge variant="secondary">
                  <Icon aria-hidden data-icon="inline-start" />
                  {categoryLabels[provider.category]}
                </Badge>
                <CardTitle>
                  <Link
                    href={providerHref(provider, date, timeRange)}
                    className="outline-none after:absolute after:inset-0"
                  >
                    {provider.name}
                  </Link>
                </CardTitle>
                <CardDescription className="flex items-start gap-1.5">
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {provider.address}, {provider.city}
                    {provider.distanceMeters !== null && (
                      <> · à {formatDistance(provider.distanceMeters)}</>
                    )}
                  </span>
                </CardDescription>
                {date && provider.availableSlots !== null && (
                  <p className="text-primary flex items-center gap-1.5 text-sm font-medium">
                    <CalendarCheck aria-hidden className="size-4 shrink-0" />
                    {describeFreeSlots(provider.availableSlots, date, timeRange)}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  À partir de {formatPriceShort(provider.minPriceCents, provider.currency)}
                </span>
                <span className="text-muted-foreground">
                  {provider.resourceCount === 1
                    ? '1 prestation'
                    : `${provider.resourceCount} prestations`}
                </span>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Identifiant DOM de la carte d'un prestataire dans la liste. */
export function resultElementId(providerId: string): string {
  return `result-${providerId}`;
}

/** Même forme que les cartes de résultat, pendant le premier chargement. */
export function ResultListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex flex-col gap-3 rounded-xl border p-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
      <span className="sr-only">Recherche en cours…</span>
    </div>
  );
}
