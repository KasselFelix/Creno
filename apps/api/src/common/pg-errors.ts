import { sqlState } from '@creno/db';
import { DomainError } from './domain-error.js';

/**
 * Traduit une violation de contrainte Postgres en erreur métier, ou renvoie `undefined`.
 * 40P01 (deadlock) n'est pas traduit ici : seul le service de réservation sait qu'un deadlock
 * résiduel (après `retryOnDeadlock`) signifie « créneau pris ». Ailleurs, c'est une 500.
 */
export function mapPgError(error: unknown): DomainError | undefined {
  switch (sqlState(error)) {
    case '23P01':
      return new DomainError('SLOT_UNAVAILABLE', 409, "Ce créneau n'est plus disponible.");
    case '23505':
      return new DomainError('ALREADY_EXISTS', 409, 'Cette ressource existe déjà.');
    case '23503':
      return new DomainError('INVALID_REFERENCE', 409, 'Une ressource liée est introuvable.');
    // Une contrainte CHECK refuse une valeur que la validation Zod aurait dû arrêter : c'est une
    // entrée invalide, pas une panne.
    case '23514':
      return new DomainError('VALIDATION_FAILED', 400, 'Données invalides.');
    default:
      return undefined;
  }
}

/** Nom de la contrainte violée, que l'erreur pg soit brute ou enveloppée par Drizzle (`cause`). */
export function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('constraint' in current && typeof current.constraint === 'string') {
      return current.constraint;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
