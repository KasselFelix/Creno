import type { PublicUser } from '@creno/shared';
import type { UserRow } from './users.repository.js';

/** Seule sortie autorisée d'un utilisateur : jamais de `passwordHash`. */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}
