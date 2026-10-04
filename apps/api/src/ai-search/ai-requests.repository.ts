import { Inject, Injectable } from '@nestjs/common';
import { gte, sql } from 'drizzle-orm';
import { aiRequests, type DbHandle } from '@creno/db';
import { DB } from '../database/database.module.js';

export type NewAiRequest = typeof aiRequests.$inferInsert;
export type AiRequestOutcome = NewAiRequest['outcome'];

@Injectable()
export class AiRequestsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Une ligne par phrase interprétée : jamais la phrase, ni le lieu (voir `AiRequestFilters`). */
  async insert(row: NewAiRequest): Promise<void> {
    await this.handle.db.insert(aiRequests).values(row);
  }

  /**
   * Appels au modèle depuis `since`, reprises comprises : c'est ce que compte le plafond journalier.
   * Lecture par l'index `ai_requests_created_at_idx`, limitée aux lignes de la journée.
   */
  async attemptsSince(since: Date): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: sql<number>`coalesce(sum(${aiRequests.attempts}), 0)::int` })
      .from(aiRequests)
      .where(gte(aiRequests.createdAt, since));
    return row?.total ?? 0;
  }
}
