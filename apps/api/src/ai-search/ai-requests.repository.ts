import { Inject, Injectable } from '@nestjs/common';
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
}
