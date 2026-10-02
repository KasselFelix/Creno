import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { type Database, type DbHandle, pendingRegistrations } from '@creno/db';
import { DB } from '../database/database.module.js';

export type PendingRegistrationRow = typeof pendingRegistrations.$inferSelect;

@Injectable()
export class PendingRegistrationsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Verrou consultatif tenu jusqu'à la fin de la transaction : les inscriptions et confirmations
   * d'une même adresse passent une par une (plafond exact, un seul compte créé). `lower` : même
   * verrou quelle que soit la casse, comme la comparaison `citext`. Le second argument sépare ces
   * verrous de ceux des réservations.
   */
  async lockEmail(email: string, tx: Database): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(lower(${email}), 1))`);
  }

  /** Demandes de la dernière heure pour cette adresse (une demande = un email envoyé). */
  async countLastHour(email: string, tx: Database): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(pendingRegistrations)
      .where(
        and(
          eq(pendingRegistrations.email, email),
          gt(pendingRegistrations.createdAt, sql`now() - interval '1 hour'`),
        ),
      );
    return row?.total ?? 0;
  }

  async create(
    values: { email: string; expiresAt: Date },
    tx: Database,
  ): Promise<PendingRegistrationRow> {
    const [row] = await tx.insert(pendingRegistrations).values(values).returning();
    return row!;
  }

  async findById(
    id: string,
    tx: Database = this.handle.db,
  ): Promise<PendingRegistrationRow | undefined> {
    const [row] = await tx
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.id, id));
    return row;
  }

  /** Enregistre le hash du lien qui va partir. `false` : la ligne a disparu entre-temps (adresse confirmée par un autre lien). */
  async setTokenHash(id: string, tokenHash: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(pendingRegistrations)
      .set({ tokenHash })
      .where(eq(pendingRegistrations.id, id))
      .returning({ id: pendingRegistrations.id });
    return rows.length > 0;
  }

  /** À la création du compte : toutes les demandes de l'adresse disparaissent, leurs liens avec. */
  async deleteByEmail(email: string, tx: Database): Promise<void> {
    await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
  }
}
