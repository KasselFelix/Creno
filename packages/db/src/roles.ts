import { sql } from 'drizzle-orm';
import { escapeIdentifier, escapeLiteral } from 'pg';
import type { Database } from './client.js';

/** Schémas que l'API lit et écrit : métier (`public`) et file de jobs (`pgboss`). */
const APP_SCHEMAS = ['public', 'pgboss'] as const;

export interface AppRole {
  name: string;
  password: string;
}

/** Utilisateur et mot de passe d'une URL Postgres (`postgres://user:password@host/db`). */
export function roleOf(connectionString: string): AppRole {
  const url = new URL(connectionString);
  return { name: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}

/**
 * Crée (ou remet à jour) le rôle de l'API et lui donne ses droits, sans aucun DDL : lire et écrire
 * les tables, utiliser les séquences et les fonctions de pg-boss. Les objets créés plus tard par le
 * rôle de migration (celui qui exécute ceci) reçoivent les mêmes droits. Idempotent.
 *
 * Les requêtes contiennent le mot de passe : l'appelant ne doit jamais journaliser une erreur brute.
 */
export async function ensureAppRole(db: Database, role: AppRole): Promise<void> {
  const name = escapeIdentifier(role.name);
  const password = escapeLiteral(role.password);
  const existing = await db.execute<{ powerful: boolean }>(
    sql`SELECT rolsuper OR rolcreatedb OR rolcreaterole AS powerful FROM pg_roles WHERE rolname = ${role.name}`,
  );
  const current = existing.rows[0];
  // Écrire SUPERUSER, CREATEDB ou CREATEROLE dans un ALTER ROLE exige de détenir soi-même
  // l'attribut, même pour le laisser à faux : le rôle de migration d'Azure n'est pas
  // superutilisateur. Un rôle existant est donc vérifié, pas réécrit.
  if (current?.powerful) {
    throw new Error(`Le rôle applicatif ${role.name} a des droits d'administration : refusé.`);
  }
  // Le mot de passe est réécrit à chaque passage : il suit celui du coffre de secrets (rotation).
  await db.execute(
    sql.raw(
      current
        ? `ALTER ROLE ${name} WITH LOGIN PASSWORD ${password}`
        : `CREATE ROLE ${name} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${password}`,
    ),
  );

  const schemas = APP_SCHEMAS.map(escapeIdentifier).join(', ');
  const statements = [
    `GRANT CONNECT ON DATABASE ${escapeIdentifier(await currentDatabase(db))} TO ${name}`,
    // Depuis PostgreSQL 15, plus personne ne peut créer d'objet dans `public` par défaut ; on le
    // réaffirme pour une base créée autrement.
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    `GRANT USAGE ON SCHEMA ${schemas} TO ${name}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemas} TO ${name}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schemas} TO ${name}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schemas} TO ${name}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemas} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${name}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemas} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${name}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemas} GRANT EXECUTE ON FUNCTIONS TO ${name}`,
  ];
  for (const statement of statements) await db.execute(sql.raw(statement));
}

async function currentDatabase(db: Database): Promise<string> {
  const result = await db.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  return result.rows[0]!.name;
}
