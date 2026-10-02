import {
  type ProviderCategory,
  providerCategorySchema,
  roundCoordinate,
  SEARCH_RADIUS_KM_DEFAULT,
  searchLatitudeSchema,
  searchLongitudeSchema,
  searchPriceMaxSchema,
  searchRadiusKmSchema,
} from '@creno/shared';

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

/**
 * Lit les filtres dans la query string. Un paramètre invalide (URL modifiée à la main) est ignoré :
 * la page s'affiche avec la valeur par défaut plutôt qu'une erreur.
 */
export function parseSearchParams(params: RawParams): SearchFilters {
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

  return {
    center,
    // Un libellé sans centre ne décrit rien.
    place: center && place ? place : undefined,
    radiusKm: read('radiusKm', searchRadiusKmSchema) ?? SEARCH_RADIUS_KM_DEFAULT,
    category: read('category', providerCategorySchema),
    priceMax: read('priceMax', searchPriceMaxSchema),
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
    filters.center !== undefined && filters.radiusKm !== SEARCH_RADIUS_KM_DEFAULT,
  ].filter(Boolean).length;
}

/** 850 → « 850 m », 3240 → « 3,2 km », 24800 → « 25 km ». */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

/** Phrase de résultat, lue par les lecteurs d'écran à chaque nouvelle recherche. */
export function describeResults(total: number, filters: SearchFilters): string {
  const count =
    total === 0 ? 'Aucun prestataire' : total === 1 ? '1 prestataire' : `${total} prestataires`;
  if (!filters.center) return count;
  const around = filters.place ? ` autour de ${filters.place}` : '';
  return `${count} dans un rayon de ${filters.radiusKm} km${around}`;
}
