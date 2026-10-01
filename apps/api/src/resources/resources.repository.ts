import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { type Database, type DbHandle, providers, resources } from '@creno/db';
import type { CreateResourceInput, UpdateResourceInput } from '@creno/shared';
import { DB } from '../database/database.module.js';

export type ResourceRow = typeof resources.$inferSelect;
/** Ressource et utilisateur propriétaire (celui du prestataire), pour le contrôle de propriété. */
export type OwnedResourceRow = ResourceRow & { ownerUserId: string };

@Injectable()
export class ResourcesRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findById(id: string): Promise<ResourceRow | undefined> {
    return this.handle.db.query.resources.findFirst({ where: eq(resources.id, id) });
  }

  async findWithOwner(id: string): Promise<OwnedResourceRow | undefined> {
    const [row] = await this.handle.db
      .select({ ...getTableColumns(resources), ownerUserId: providers.userId })
      .from(resources)
      .innerJoin(providers, eq(providers.id, resources.providerId))
      .where(eq(resources.id, id));
    return row;
  }

  /** Verrouille la ligne jusqu'à la fin de la transaction : sérialise les écritures concurrentes. */
  async lock(id: string, tx: Database): Promise<void> {
    await tx.select({ id: resources.id }).from(resources).where(eq(resources.id, id)).for('update');
  }

  /** Identifiant du profil prestataire de l'utilisateur, s'il en a créé un. */
  async providerIdOfUser(userId: string): Promise<string | undefined> {
    const [row] = await this.handle.db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.userId, userId));
    return row?.id;
  }

  async listByProvider(
    providerId: string,
    { activeOnly }: { activeOnly: boolean },
  ): Promise<ResourceRow[]> {
    return this.handle.db
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.providerId, providerId),
          activeOnly ? eq(resources.isActive, true) : undefined,
        ),
      )
      .orderBy(asc(resources.createdAt), asc(resources.id));
  }

  async create(providerId: string, values: CreateResourceInput): Promise<ResourceRow> {
    const [row] = await this.handle.db
      .insert(resources)
      .values({ providerId, ...values })
      .returning();
    return row!;
  }

  async update(id: string, values: UpdateResourceInput): Promise<ResourceRow | undefined> {
    const [row] = await this.handle.db
      .update(resources)
      .set(values)
      .where(eq(resources.id, id))
      .returning();
    return row;
  }
}
