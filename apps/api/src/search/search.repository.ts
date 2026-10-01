import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { type DbHandle, toPoint } from '@creno/db';
import type { ProviderCategory } from '@creno/shared';
import { DB } from '../database/database.module.js';

export interface SearchFilters {
  /** Centre de la recherche ; sans lui, pas de filtre de distance. */
  center?: { latitude: number; longitude: number };
  radiusMeters: number;
  category?: ProviderCategory;
  priceMaxCents?: number;
  limit: number;
}

// Index signature : exigée par `db.execute<T>()`.
export interface SearchRow extends Record<string, unknown> {
  id: string;
  name: string;
  slug: string;
  category: ProviderCategory;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  distance_meters: number | null;
  min_price_cents: number;
  resource_count: number;
  total: number;
}

@Injectable()
export class SearchRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Prestataires ayant au moins une ressource active, avec leur prix minimum.
   * - Avec un centre : `ST_DWithin` garde ceux du rayon (en mètres, via l'index GiST
   *   `providers_location_gix`), triés du plus proche au plus loin.
   * - Sans centre : tous, triés par nom.
   * - `JOIN LATERAL` : la sous-requête est évaluée pour chaque prestataire `p` (elle lit `p.id`).
   * - `count(*) OVER ()` : nombre de lignes avant `LIMIT`, sans seconde requête.
   * - Le tri se termine par `p.id` pour rester stable entre deux prestataires à la même distance.
   */
  async searchProviders(filters: SearchFilters): Promise<SearchRow[]> {
    const center = filters.center
      ? toPoint(filters.center.longitude, filters.center.latitude)
      : undefined;

    const conditions: SQL[] = [];
    if (center) {
      conditions.push(sql`ST_DWithin(p.location, ${center}, ${filters.radiusMeters})`);
    }
    if (filters.category) conditions.push(sql`p.category = ${filters.category}`);
    if (filters.priceMaxCents !== undefined) {
      conditions.push(sql`r.min_price_cents <= ${filters.priceMaxCents}`);
    }
    const where = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const distance = center ? sql`ST_Distance(p.location, ${center})` : undefined;

    const result = await this.handle.db.execute<SearchRow>(sql`
      SELECT p.id, p.name, p.slug, p.category, p.address, p.city,
             ST_Y(p.location::geometry) AS latitude,
             ST_X(p.location::geometry) AS longitude,
             ${distance ? sql`round(${distance})::int` : sql`NULL::int`} AS distance_meters,
             r.min_price_cents, r.resource_count,
             (count(*) OVER ())::int AS total
      FROM providers p
      JOIN LATERAL (
        SELECT min(price_cents) AS min_price_cents, count(*)::int AS resource_count
        FROM resources
        WHERE provider_id = p.id AND is_active
      ) r ON r.resource_count > 0
      ${where}
      ORDER BY ${distance ?? sql`p.name`}, p.id
      LIMIT ${filters.limit}
    `);
    return result.rows;
  }
}
