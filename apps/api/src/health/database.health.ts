import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@creno/db';
import { DB } from '../database/database.module.js';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly indicators: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.indicators.check(key);
    try {
      await this.handle.db.execute(sql`SELECT 1`);
      return indicator.up();
    } catch {
      return indicator.down({ message: 'Base de données injoignable' });
    }
  }
}
