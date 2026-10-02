'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, Search } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Map as MapboxMap,
  type MapRef,
  Marker,
  NavigationControl,
  Popup,
  type ViewStateChangeEvent,
} from 'react-map-gl/mapbox';
import { roundCoordinate, type SearchProvider } from '@creno/shared';
import { Button } from '@/components/ui/button';
import { categoryLabels } from '@/features/providers/labels';
import { formatPrice } from '@/lib/format';

// Vue d'ensemble de la France métropolitaine, quand il n'y a ni lieu ni résultat.
const FRANCE = { longitude: 2.5, latitude: 46.6, zoom: 4.6 };
const SINGLE_POINT_ZOOM = 13;

export interface SearchMapProps {
  token: string;
  items: SearchProvider[];
  center?: { lat: number; lng: number };
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  /** Le visiteur demande une recherche autour du centre actuel de la carte. */
  onSearchArea: (center: { lat: number; lng: number }) => void;
}

/** Carte des résultats. Chargée côté navigateur uniquement (`dynamic(..., { ssr: false })`). */
export default function SearchMap({
  token,
  items,
  center,
  activeId,
  onActiveChange,
  onSearchArea,
}: SearchMapProps) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Résultats affichés au moment où le visiteur a déplacé la carte : tant que ce sont les mêmes, on
  // propose « Rechercher dans cette zone ». Une nouvelle recherche fait disparaître le bouton.
  const [movedOn, setMovedOn] = useState<SearchProvider[] | null>(null);
  const moved = movedOn === items;
  const selected = items.find((item) => item.id === selectedId);

  /** Cadre la carte sur les résultats et le centre de la recherche. */
  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: [number, number][] = items.map((item) => [item.longitude, item.latitude]);
    if (center) points.push([center.lng, center.lat]);

    if (points.length === 0) {
      map.flyTo({ center: [FRANCE.longitude, FRANCE.latitude], zoom: FRANCE.zoom });
    } else if (points.length === 1) {
      map.flyTo({ center: points[0], zoom: SINGLE_POINT_ZOOM });
    } else {
      const lngs = points.map(([lng]) => lng);
      const lats = points.map(([, lat]) => lat);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 64, maxZoom: 15, duration: 600 },
      );
    }
  }, [items, center]);

  useEffect(() => {
    if (loaded) fit();
  }, [loaded, fit]);

  // Seuls les déplacements du visiteur portent un `originalEvent` : un recadrage fait par le code
  // (fitBounds) n'en a pas, ce qui évite de proposer une nouvelle recherche après chaque résultat.
  const handleMoveEnd = (event: ViewStateChangeEvent) => {
    if ('originalEvent' in event && event.originalEvent) setMovedOn(items);
  };

  const searchHere = () => {
    const mapCenter = mapRef.current?.getCenter();
    if (!mapCenter) return;
    setMovedOn(null);
    onSearchArea({ lat: roundCoordinate(mapCenter.lat), lng: roundCoordinate(mapCenter.lng) });
  };

  return (
    <div className="relative size-full">
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={FRANCE}
        mapStyle={
          resolvedTheme === 'dark'
            ? 'mapbox://styles/mapbox/dark-v11'
            : 'mapbox://styles/mapbox/light-v11'
        }
        onLoad={() => setLoaded(true)}
        onMoveEnd={handleMoveEnd}
        // La carte était masquée (onglet Liste sur mobile) : on la recadre quand elle apparaît.
        onResize={() => {
          if (!moved) fit();
        }}
        onClick={() => setSelectedId(null)}
      >
        {/* En haut : la carte peut dépasser le bas de l'écran, le zoom doit rester visible. */}
        <NavigationControl position="top-right" showCompass={false} />
        {items.map((provider) => {
          const active = provider.id === activeId || provider.id === selectedId;
          return (
            <Marker
              key={provider.id}
              longitude={provider.longitude}
              latitude={provider.latitude}
              anchor="center"
              style={{ zIndex: active ? 1 : 0 }}
              onClick={(event) => {
                // Sinon le clic atteint la carte, qui referme l'infobulle.
                event.originalEvent.stopPropagation();
                setSelectedId(provider.id);
              }}
            >
              <button
                type="button"
                aria-label={`${provider.name}, ${categoryLabels[provider.category]}`}
                aria-pressed={provider.id === selectedId}
                data-active={active}
                className="group focus-visible:ring-ring/50 flex size-11 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-3"
                onMouseEnter={() => onActiveChange(provider.id)}
                onMouseLeave={() => onActiveChange(null)}
                onFocus={() => onActiveChange(provider.id)}
                onBlur={() => onActiveChange(null)}
              >
                <span className="border-foreground/20 bg-background text-foreground group-data-[active=true]:border-background group-data-[active=true]:bg-primary group-data-[active=true]:text-primary-foreground flex size-8 items-center justify-center rounded-full border-2 shadow-md transition-transform group-data-[active=true]:scale-125">
                  <MapPin aria-hidden className="size-4" />
                </span>
              </button>
            </Marker>
          );
        })}
        {selected && (
          <Popup
            longitude={selected.longitude}
            latitude={selected.latitude}
            anchor="bottom"
            offset={20}
            closeButton={false}
            closeOnClick={false}
            onClose={() => setSelectedId(null)}
          >
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {categoryLabels[selected.category]}
              </span>
              <span className="font-medium">{selected.name}</span>
              <span>À partir de {formatPrice(selected.minPriceCents, selected.currency)}</span>
              <Link
                href={`/providers/${selected.slug}`}
                className="text-primary inline-flex min-h-11 items-center font-medium underline underline-offset-4 md:min-h-0"
              >
                Voir les créneaux
              </Link>
            </div>
          </Popup>
        )}
      </MapboxMap>
      {moved && (
        <Button
          variant="secondary"
          className="absolute top-3 left-1/2 h-11 -translate-x-1/2 shadow-md md:h-9"
          onClick={searchHere}
        >
          <Search aria-hidden />
          Rechercher dans cette zone
        </Button>
      )}
    </div>
  );
}
