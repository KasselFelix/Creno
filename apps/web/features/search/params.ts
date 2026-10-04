import {
  isSearchDateInRange,
  localDateSchema,
  type ProviderCategory,
  providerCategorySchema,
  roundCoordinate,
  SEARCH_RADIUS_KM_DEFAULT,
  SEARCH_TIMEZONE,
  searchLatitudeSchema,
  searchLongitudeSchema,
  searchPriceMaxSchema,
  searchRadiusKmSchema,
  type SearchProvider,
} from '@creno/shared';
import { formatLocalDate, todayInZone } from '@/lib/format';

/** Filtres de l'écran de recherche. L'URL de `/search` en est la source de vérité. */
export interface SearchFilters {
  /** Centre de la recherche ; absent : tous les prestataires, sans distance. */
  center?: { lat: number; lng: number };
  /** Libellé du lieu choisi (« Lyon », « Autour de moi »), pour l'affichage seulement. */
  place?: string;
  radiusKm: number;
  category?: ProviderCategory;
  /** Prix maximum en centimes. */
  priceMax?: number;
  /** Jour où le prestataire doit avoir un créneau libre (`YYYY-MM-DD`). */
  date?: string;
}

const PLACE_MAX_LENGTH = 100;

/** Lieux qui ne viennent pas du champ de saisie : géolocalisation et centre de la carte. */
export const PLACE_MY_POSITION = 'ma position';
export const PLACE_MAP_POINT = 'ce point de la carte';

/** Texte à afficher dans le champ de lieu : vide pour un lieu qui n'a pas été saisi. */
export function placeFieldText(place: string | undefined): string {
  return !place || place === PLACE_MY_POSITION || place === PLACE_MAP_POINT ? '' : place;
}

type RawParams = { get(name: string): string | null };

/** Date du jour à l'heure de la recherche (Paris) : la plage du filtre « disponible le » en part. */
export function searchToday(now = new Date()): string {
  return todayInZone(SEARCH_TIMEZONE, now);
}

/**
 * Lit les filtres dans la query string. Un paramètre invalide (URL modifiée à la main) est ignoré :
 * la page s'affiche avec la valeur par défaut plutôt qu'une erreur. Une date hors de la plage
 * réservable (lien ancien) l'est aussi.
 */
export function parseSearchParams(params: RawParams, today = searchToday()): SearchFilters {
  const read = <T>(
    name: string,
    schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  ) => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const result = schema.safeParse(raw);
    return result.success ? result.data : undefined;
  };

  const lat = read('lat', searchLatitudeSchema);
  const lng = read('lng', searchLongitudeSchema);
  const center = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
  const place = params.get('place')?.trim().slice(0, PLACE_MAX_LENGTH);
  const date = read('date', localDateSchema);

  return {
    center,
    // Un libellé sans centre ne décrit rien.
    place: center && place ? place : undefined,
    radiusKm: read('radiusKm', searchRadiusKmSchema) ?? SEARCH_RADIUS_KM_DEFAULT,
    category: read('category', providerCategorySchema),
    priceMax: read('priceMax', searchPriceMaxSchema),
    date: date !== undefined && isSearchDateInRange(date, today) ? date : undefined,
  };
}

/** Paramètres envoyés à `GET /v1/search/providers` (sans le libellé du lieu). */
export function toApiParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.center) {
    params.set('lat', String(roundCoordinate(filters.center.lat)));
    params.set('lng', String(roundCoordinate(filters.center.lng)));
    params.set('radiusKm', String(filters.radiusKm));
  }
  if (filters.category) params.set('category', filters.category);
  if (filters.priceMax !== undefined) params.set('priceMax', String(filters.priceMax));
  if (filters.date) params.set('date', filters.date);
  return params;
}

/** Query string de la page `/search` : les valeurs par défaut sont omises pour une URL courte. */
export function toSearchParams(filters: SearchFilters): URLSearchParams {
  const params = toApiParams(filters);
  if (filters.radiusKm === SEARCH_RADIUS_KM_DEFAULT) params.delete('radiusKm');
  if (filters.center && filters.place) params.set('place', filters.place);
  return params;
}

export function searchHref(filters: SearchFilters): string {
  const query = toSearchParams(filters).toString();
  return query ? `/search?${query}` : '/search';
}

/** Nombre de filtres actifs hors lieu (affiché sur le bouton « Filtres » en mobile). */
export function countActiveFilters(filters: SearchFilters): number {
  return [
    filters.category !== undefined,
    filters.priceMax !== undefined,
    filters.date !== undefined,
    filters.center !== undefined && filters.radiusKm !== SEARCH_RADIUS_KM_DEFAULT,
  ].filter(Boolean).length;
}

/** « samedi 10 octobre ». */
export function formatSearchDay(date: string): string {
  return formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** « 3 créneaux libres le samedi 10 octobre ». */
export function describeFreeSlots(count: number, date: string): string {
  const slots = count === 1 ? '1 créneau libre' : `${count} créneaux libres`;
  return `${slots} le ${formatSearchDay(date)}`;
}

/** Lien vers la fiche ; avec une date, la fiche s'ouvre sur ce jour et sur la ressource libre. */
export function providerHref(provider: SearchProvider, date: string | undefined): string {
  const path = `/providers/${provider.slug}`;
  if (!date || !provider.availableResourceId) return path;
  return `${path}?${new URLSearchParams({ date, resource: provider.availableResourceId }).toString()}`;
}

/** 850 → « 850 m », 3240 → « 3,2 km », 24800 → « 25 km ». */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

/**
 * Phrase de résultat, lue par les lecteurs d'écran à chaque nouvelle recherche. `capped` : avec une
 * date, seuls les prestataires les plus proches ont été examinés, le total n'est qu'un minimum.
 */
export function describeResults(total: number, filters: SearchFilters, capped = false): string {
  let count =
    total === 0 ? 'Aucun prestataire' : total === 1 ? '1 prestataire' : `${total} prestataires`;
  if (capped) count = `Au moins ${total} prestataires`;
  if (filters.date) {
    count += `${total > 1 || capped ? ' disponibles' : ' disponible'} le ${formatSearchDay(filters.date)}`;
  }
  if (!filters.center) return count;
  const around = filters.place ? ` autour de ${filters.place}` : '';
  return `${count} dans un rayon de ${filters.radiusKm} km${around}`;
}
