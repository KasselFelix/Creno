'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import type { Marker as MapboxMarker } from 'mapbox-gl';
import { Search } from 'lucide-react';
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
import { roundCoordinate, type SearchProvider, type TimeRange } from '@creno/shared';
import { Button } from '@/components/ui/button';
import { categoryIcons } from '@/features/providers/category-icons';
import { categoryLabels } from '@/features/providers/labels';
import { formatPriceShort } from '@/lib/format';
import { markerLayer } from '../map-markers';
import { describeFreeSlots, providerHref } from '../params';

// Vue d'ensemble de la France métropolitaine, quand il n'y a ni lieu ni résultat.
const FRANCE = { longitude: 2.5, latitude: 46.6, zoom: 4.6 };
const SINGLE_POINT_ZOOM = 13;

/**
 * Mapbox pose `role="img"` et `aria-label="Map marker"` sur l'élément de chaque marqueur : les enfants
 * d'une image sont ignorés des lecteurs d'écran, qui entendraient « Map marker » au lieu du bouton.
 */
function exposeMarkerButton(marker: MapboxMarker | null) {
  const element = marker?.getElement();
  element?.removeAttribute('role');
  element?.removeAttribute('aria-label');
}

export interface SearchMapProps {
  token: string;
  items: SearchProvider[];
  /** Jour filtré : le lien ouvre la fiche sur ce jour. */
  date?: string;
  /** Plage horaire de ce jour : les créneaux comptés sont ceux de la plage. */
  timeRange?: TimeRange;
  center?: { lat: number; lng: number };
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  /** Prestataire choisi sur la carte : sa popup est ouverte et sa carte de la liste mise en évidence. */
  selectedId: string | null;
  onSelectedChange: (id: string | null) => void;
  /** Le visiteur demande une recherche autour du centre actuel de la carte. */
  onSearchArea: (center: { lat: number; lng: number }) => void;
}

/** Carte des résultats. Chargée côté navigateur uniquement (`dynamic(..., { ssr: false })`). */
export default function SearchMap({
  token,
  items,
  date,
  timeRange,
  center,
  activeId,
  onActiveChange,
  selectedId,
  onSelectedChange,
  onSearchArea,
}: SearchMapProps) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
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
    <div
      className="relative size-full"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedId) onSelectedChange(null);
      }}
    >
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
        onClick={() => onSelectedChange(null)}
      >
        {/* En haut : la carte peut dépasser le bas de l'écran, le zoom doit rester visible. */}
        <NavigationControl position="top-right" showCompass={false} />
        {items.map((provider) => {
          const { active, zIndex } = markerLayer(provider.id, { activeId, selectedId });
          const isSelected = provider.id === selectedId;
          const Icon = categoryIcons[provider.category];
          const price = formatPriceShort(provider.minPriceCents, provider.currency);
          return (
            <Marker
              key={provider.id}
              ref={exposeMarkerButton}
              longitude={provider.longitude}
              latitude={provider.latitude}
              anchor="center"
              style={{ zIndex }}
              onClick={(event) => {
                // Sinon le clic atteint la carte, qui referme l'infobulle.
                event.originalEvent.stopPropagation();
                onSelectedChange(isSelected ? null : provider.id);
              }}
            >
              {/* La pastille est le bouton lui-même : une marge invisible prendrait les clics des
                  pastilles voisines. L'échelle s'applique ici, Mapbox positionne le marqueur avec
                  `transform`. */}
              <button
                type="button"
                aria-label={`${provider.name}, ${categoryLabels[provider.category]}, à partir de ${price}`}
                aria-pressed={isSelected}
                data-active={active}
                className="border-foreground/20 bg-background text-foreground focus-visible:ring-ring/50 data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground flex h-8 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-sm font-semibold whitespace-nowrap tabular-nums shadow-md outline-none focus-visible:ring-3 data-[active=true]:scale-110 motion-safe:transition-transform"
                // Survol à la souris et focus au clavier seulement : un toucher émule un survol et
                // donne le focus, la pastille resterait inversée après sa désélection.
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') onActiveChange(provider.id);
                }}
                onPointerLeave={() => onActiveChange(null)}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible')) onActiveChange(provider.id);
                }}
                onBlur={() => onActiveChange(null)}
              >
                <Icon aria-hidden className="size-4" />
                {price}
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
            onClose={() => onSelectedChange(null)}
          >
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {categoryLabels[selected.category]}
              </span>
              <span className="font-medium">{selected.name}</span>
              <span>À partir de {formatPriceShort(selected.minPriceCents, selected.currency)}</span>
              {date && selected.availableSlots !== null && (
                <span>{describeFreeSlots(selected.availableSlots, date, timeRange)}</span>
              )}
              <Link
                href={providerHref(selected, date, timeRange)}
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
