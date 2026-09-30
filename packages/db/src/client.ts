import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
}

export interface CreateDbOptions extends PoolConfig {
  /**
   * Appelé quand une connexion inactive du pool est coupée (redémarrage de Postgres, failover…).
   * Sans écouteur, `pg` émet un événement `error` non géré et Node arrête tout le processus.
   * Le pool retire la connexion morte et en rouvre une à la requête suivante.
   */
  onIdleClientError?: (error: Error) => void;
}

/** Crée un pool Postgres et l'instance Drizzle associée. Penser à `pool.end()` à l'arrêt. */
export function createDb(
  connectionString: string,
  { onIdleClientError, ...options }: CreateDbOptions = {},
): DbHandle {
  const pool = new Pool({
    connectionString,
    max: 10,
    // Sans timeout, pg attend indéfiniment une base qui ne répond pas (réseau muet) :
    // la sonde /health/ready resterait pendante au lieu de répondre 503.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    ...options,
  });
  pool.on('error', (error) => onIdleClientError?.(error));
  return { db: drizzle(pool, { schema }), pool };
}
