import type { Provider } from '@creno/shared';
import type { ProviderRow } from './providers.repository.js';

/** Seule sortie autorisée d'un profil : ni `userId` ni identifiant de compte Stripe. */
export function toProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    address: row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}
