import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { testDatabaseUrl } from './global-setup.js';

describe('createDb', () => {
  it("survit à la coupure d'une connexion inactive et en rouvre une", async () => {
    const errors: Error[] = [];
    const { db, pool } = createDb(testDatabaseUrl(), {
      max: 1,
      onIdleClientError: (e) => errors.push(e),
    });
    const admin = createDb(testDatabaseUrl(), { max: 1 });
    try {
      const { rows } = await db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      // Simule un redémarrage de Postgres : le serveur termine la connexion inactive du pool.
      await admin.db.execute(sql`SELECT pg_terminate_backend(${rows[0]!.pid})`);
      await expect.poll(() => errors.length).toBe(1);

      const again = await db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
      expect(again.rows[0]?.ok).toBe(1);
    } finally {
      await Promise.all([pool.end(), admin.pool.end()]);
    }
  });
});
