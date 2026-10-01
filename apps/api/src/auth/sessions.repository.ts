import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Database, type DbHandle, sessions } from '@creno/db';
import { DB } from '../database/database.module.js';

export type SessionRow = typeof sessions.$inferSelect;

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async create(
    values: { userId: string; refreshTokenHash: string; userAgent: string | null; expiresAt: Date },
    tx: Database = this.handle.db,
  ): Promise<SessionRow> {
    const [row] = await tx.insert(sessions).values(values).returning();
    return row!;
  }

  async findById(id: string): Promise<SessionRow | undefined> {
    return this.handle.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
  }

  /**
   * Rotation atomique (compare-and-swap) : ne réussit que si le hash présenté est encore le hash
   * courant. Deux refresh simultanés avec le même token ne peuvent donc pas réussir tous les deux.
   */
  async rotate(
    id: string,
    currentHash: string,
    nextHash: string,
    expiresAt: Date,
  ): Promise<SessionRow | undefined> {
    const [row] = await this.handle.db
      .update(sessions)
      .set({
        previousTokenHash: currentHash,
        refreshTokenHash: nextHash,
        rotatedAt: sql`now()`,
        lastUsedAt: sql`now()`,
        expiresAt,
      })
      .where(
        and(
          eq(sessions.id, id),
          eq(sessions.refreshTokenHash, currentHash),
          isNull(sessions.revokedAt),
        ),
      )
      .returning();
    return row;
  }

  async touch(id: string): Promise<void> {
    await this.handle.db
      .update(sessions)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(sessions.id, id));
  }

  async revoke(id: string): Promise<void> {
    await this.handle.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  /** Sessions encore utilisables d'un utilisateur, la plus récemment utilisée d'abord. */
  async listActive(userId: string): Promise<SessionRow[]> {
    return this.handle.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(sessions.lastUsedAt));
  }
}
