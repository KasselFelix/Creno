import type { SearchProvider } from '@creno/shared';
import type { SearchRow } from './search.repository.js';

/** Seule sortie autorisée d'un résultat de recherche : rien d'autre que ces champs publics. */
export function toSearchProvider(row: SearchRow): SearchProvider {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    address: row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceMeters: row.distance_meters,
    minPriceCents: row.min_price_cents,
    // Une seule devise à ce stade (voir la spec de l'étape 3).
    currency: 'EUR',
    resourceCount: row.resource_count,
    // Sans date demandée, les créneaux ne sont pas comptés.
    availableSlots: null,
    availableResourceId: null,
  };
}
