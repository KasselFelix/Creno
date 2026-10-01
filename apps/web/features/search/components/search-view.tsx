'use client';

import { LoaderCircle, LocateFixed, MapPinOff, SlidersHorizontal } from 'lucide-react';
import { cn } from 'cn';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { roundCoordinate, SEARCH_RADIUS_KM_MAX, type SearchProvider } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlaceCombobox } from '@/features/geocoding/components/place-combobox';
import { publicEnv } from '@/lib/env';
import { useMediaQuery } from '@/lib/use-media-query';
import { useSearchProviders } from '../api';
import {
  countActiveFilters,
  describeResults,
  parseSearchParams,
  PLACE_MAP_POINT,
  PLACE_MY_POSITION,
  placeFieldText,
  searchHref,
  type SearchFilters,
} from '../params';
import { ResultList, ResultListSkeleton } from './result-list';
import { SearchFilterFields } from './search-filters';

// mapbox-gl a besoin du navigateur (WebGL, `window`) : jamais rendu côté serveur.
const SearchMap = dynamic(() => import('./search-map'), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const NO_ITEMS: SearchProvider[] = [];
const DESKTOP = '(min-width: 1024px)';
const GEOLOCATION_TIMEOUT_MS = 10_000;
const FIVE_MINUTES = 5 * 60 * 1000;

type View = 'list' | 'map';

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // L'URL est la source de vérité : filtres partageables, bouton retour fonctionnel.
  const filters = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const setFilters = (next: SearchFilters) => router.push(searchHref(next), { scroll: false });

  const results = useSearchProviders(filters);
  const items = results.data?.items ?? NO_ITEMS;
  const total = results.data?.total ?? 0;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [mapOpened, setMapOpened] = useState(false);
  const [locating, setLocating] = useState(false);
  const isDesktop = useMediaQuery(DESKTOP);
  // Sur mobile, la carte n'est chargée qu'à la première ouverture de l'onglet, puis reste montée.
  const showMap = isDesktop || mapOpened;
  const activeFilters = countActiveFilters(filters);
  const hasFilters = filters.category !== undefined || filters.priceMax !== undefined;

  function locate() {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      toast.error('Géolocalisation indisponible. Indiquez une ville ou une adresse.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setFilters({
          ...filters,
          // Position arrondie (≈ 100 m) avant d'aller dans l'URL et à l'API.
          center: {
            lat: roundCoordinate(position.coords.latitude),
            lng: roundCoordinate(position.coords.longitude),
          },
          place: PLACE_MY_POSITION,
        });
      },
      (error) => {
        setLocating(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Vous avez refusé la géolocalisation. Indiquez une ville ou une adresse.'
            : 'Position introuvable. Indiquez une ville ou une adresse.',
        );
      },
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: FIVE_MINUTES },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <Field className="lg:flex-1">
          <FieldLabel htmlFor="search-place">Ville ou adresse</FieldLabel>
          <PlaceCombobox
            // Remonté quand le lieu change ailleurs (bouton retour, « Autour de moi », carte).
            key={filters.place ?? ''}
            id="search-place"
            placeholder="Lyon, 12 rue Oberkampf Paris…"
            defaultText={placeFieldText(filters.place)}
            className="h-11 md:h-9"
            onSelect={(place) =>
              setFilters({
                ...filters,
                center: { lat: place.latitude, lng: place.longitude },
                place: place.kind === 'city' ? place.city : place.label,
              })
            }
          />
        </Field>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="h-11 flex-1 md:h-9 lg:flex-none"
            onClick={locate}
            disabled={locating}
          >
            {locating ? (
              <LoaderCircle aria-hidden className="animate-spin" />
            ) : (
              <LocateFixed aria-hidden />
            )}
            Autour de moi
          </Button>
          <Sheet>
            <SheetTrigger
              render={<Button variant="outline" className="h-11 flex-1 md:h-9 lg:hidden" />}
            >
              <SlidersHorizontal aria-hidden />
              Filtres{activeFilters > 0 && ` (${activeFilters})`}
            </SheetTrigger>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>Filtres</SheetTitle>
                <SheetDescription>Affinez les prestataires affichés.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-5 px-4">
                <SearchFilterFields idPrefix="sheet" filters={filters} onChange={setFilters} />
              </div>
              <SheetFooter>
                <SheetClose render={<Button className="h-11" />}>Voir les résultats</SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
        <div className="hidden gap-3 lg:grid lg:w-1/2 lg:grid-cols-3">
          <SearchFilterFields idPrefix="bar" filters={filters} onChange={setFilters} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:items-start lg:gap-6">
        {/* Onglets sur mobile seulement ; sur desktop, liste et carte sont côte à côte. */}
        <Tabs
          value={view}
          onValueChange={(value) => {
            setView(value as View);
            if (value === 'map') setMapOpened(true);
          }}
          className="lg:hidden"
        >
          <TabsList className="h-11! w-full">
            <TabsTrigger value="list">Liste</TabsTrigger>
            <TabsTrigger value="map">Carte</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className={cn('lg:col-span-2', view !== 'list' && 'max-lg:hidden')}>
          <section aria-label="Résultats" className="flex flex-col gap-4">
            <p aria-live="polite" className="text-muted-foreground text-sm">
              {results.isPending
                ? 'Recherche en cours…'
                : results.isError
                  ? ''
                  : describeResults(total, filters)}
            </p>
            {results.isPending ? (
              <ResultListSkeleton />
            ) : results.isError ? (
              <QueryError
                title="Recherche impossible"
                error={results.error}
                onRetry={() => void results.refetch()}
              />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-6 text-center">
                <p>
                  {filters.center
                    ? 'Aucun prestataire dans ce rayon.'
                    : 'Aucun prestataire ne correspond à ces filtres.'}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {filters.center && filters.radiusKm < SEARCH_RADIUS_KM_MAX && (
                    <Button
                      className="h-11 md:h-9"
                      onClick={() => setFilters({ ...filters, radiusKm: SEARCH_RADIUS_KM_MAX })}
                    >
                      Élargir à {SEARCH_RADIUS_KM_MAX} km
                    </Button>
                  )}
                  {hasFilters && (
                    <Button
                      variant="outline"
                      className="h-11 md:h-9"
                      onClick={() =>
                        setFilters({ ...filters, category: undefined, priceMax: undefined })
                      }
                    >
                      Réinitialiser les filtres
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div
                className={results.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}
              >
                <ResultList items={items} activeId={activeId} onActiveChange={setActiveId} />
              </div>
            )}
            {total > items.length && !results.isError && (
              <p className="text-muted-foreground text-sm">
                {items.length} premiers résultats sur {total} : réduisez le rayon ou filtrez pour
                voir les autres.
              </p>
            )}
          </section>
        </div>

        {/* Masquée (et non démontée) sur mobile hors de son onglet : la carte n'est chargée qu'une fois. */}
        <div className={cn('lg:sticky lg:top-4 lg:col-span-3', view !== 'map' && 'max-lg:hidden')}>
          <section
            aria-label="Carte des résultats"
            className="h-112 overflow-hidden rounded-lg border lg:h-160"
          >
            {!publicEnv.NEXT_PUBLIC_MAPBOX_TOKEN ? (
              <div className="bg-muted/50 flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
                <MapPinOff aria-hidden className="text-muted-foreground size-5" />
                <p className="font-medium">Carte indisponible</p>
                <p className="text-muted-foreground max-w-sm text-sm">
                  Aucun token Mapbox n&apos;est configuré. Les résultats restent consultables dans
                  la liste.
                </p>
              </div>
            ) : showMap ? (
              <SearchMap
                token={publicEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
                items={items}
                center={filters.center}
                activeId={activeId}
                onActiveChange={setActiveId}
                onSearchArea={(center) =>
                  setFilters({ ...filters, center, place: PLACE_MAP_POINT })
                }
              />
            ) : (
              <Skeleton className="size-full rounded-none" />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
