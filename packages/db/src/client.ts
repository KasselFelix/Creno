import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
}

/** Crée un pool Postgres et l'instance Drizzle associée. Penser à `pool.end()` à l'arrêt. */
export function createDb(connectionString: string, options: PoolConfig = {}): DbHandle {
  const pool = new Pool({ connectionString, max: 10, ...options });
  return { db: drizzle(pool, { schema }), pool };
}
