import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type DbHandle, providers, toPoint } from '@creno/db';
import type { ProviderCategory } from '@creno/shared';
import { DB } from '../database/database.module.js';

// `location` est un point géographique : on le relit en latitude / longitude (ST_Y / ST_X).
const columns = {
  id: providers.id,
  userId: providers.userId,
  name: providers.name,
  slug: providers.slug,
  category: providers.category,
  description: providers.description,
  address: providers.address,
  city: providers.city,
  latitude: sql<number>`ST_Y(${providers.location}::geometry)`,
  longitude: sql<number>`ST_X(${providers.location}::geometry)`,
  stripeChargesEnabled: providers.stripeChargesEnabled,
};

export interface ProviderRow {
  id: string;
  userId: string;
  name: string;
  slug: string;
  category: ProviderCategory;
  description: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  /** Le compte Stripe du prestataire peut encaisser (l'identifiant du compte, lui, ne sort jamais d'ici). */
  stripeChargesEnabled: boolean;
}

export interface ProviderValues {
  name: string;
  category: ProviderCategory;
  description: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
}

@Injectable()
export class ProvidersRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findByUserId(userId: string): Promise<ProviderRow | undefined> {
    const [row] = await this.handle.db
      .select(columns)
      .from(providers)
      .where(eq(providers.userId, userId));
    return row;
  }

  async findBySlug(slug: string): Promise<ProviderRow | undefined> {
    const [row] = await this.handle.db
      .select(columns)
      .from(providers)
      .where(eq(providers.slug, slug));
    return row;
  }

  async create(userId: string, slug: string, values: ProviderValues): Promise<ProviderRow> {
    const { latitude, longitude, ...rest } = values;
    const [row] = await this.handle.db
      .insert(providers)
      .values({ userId, slug, ...rest, location: toPoint(longitude, latitude) })
      .returning(columns);
    return row!;
  }

  async update(id: string, values: ProviderValues): Promise<ProviderRow | undefined> {
    const { latitude, longitude, ...rest } = values;
    const [row] = await this.handle.db
      .update(providers)
      .set({ ...rest, location: toPoint(longitude, latitude) })
      .where(eq(providers.id, id))
      .returning(columns);
    return row;
  }
}
