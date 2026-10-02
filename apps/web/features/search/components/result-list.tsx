'use client';

import { MapPin } from 'lucide-react';
import Link from 'next/link';
import type { SearchProvider } from '@creno/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryLabels } from '@/features/providers/labels';
import { formatPrice } from '@/lib/format';
import { formatDistance } from '../params';

export function ResultList({
  items,
  activeId,
  onActiveChange,
}: {
  items: SearchProvider[];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((provider) => (
        <li key={provider.id}>
          <Card
            size="sm"
            data-active={provider.id === activeId}
            // Toute la carte est cliquable (le lien du titre est étiré) ; le survol ou le focus
            // met en évidence le marqueur correspondant sur la carte.
            className="has-[a:focus-visible]:ring-ring/50 data-[active=true]:ring-primary relative transition-shadow has-[a:focus-visible]:ring-3 data-[active=true]:ring-2"
            onMouseEnter={() => onActiveChange(provider.id)}
            onMouseLeave={() => onActiveChange(null)}
            onFocus={() => onActiveChange(provider.id)}
            onBlur={() => onActiveChange(null)}
          >
            <CardHeader>
              <Badge variant="secondary">{categoryLabels[provider.category]}</Badge>
              <CardTitle>
                <Link
                  href={`/providers/${provider.slug}`}
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
            </CardHeader>
            <CardContent className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                À partir de {formatPrice(provider.minPriceCents, provider.currency)}
              </span>
              <span className="text-muted-foreground">
                {provider.resourceCount === 1
                  ? '1 prestation'
                  : `${provider.resourceCount} prestations`}
              </span>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
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
