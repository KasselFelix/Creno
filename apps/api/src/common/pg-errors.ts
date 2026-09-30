import { sqlState } from '@creno/db';
import { DomainError } from './domain-error.js';

/**
 * Traduit une violation de contrainte Postgres en erreur métier, ou renvoie `undefined`.
 * 40P01 (deadlock) n'arrive qu'après épuisement de `retryOnDeadlock` sur une course de réservation.
 */
export function mapPgError(error: unknown): DomainError | undefined {
  switch (sqlState(error)) {
    case '23P01':
    case '40P01':
      return new DomainError('SLOT_UNAVAILABLE', 409, "Ce créneau n'est plus disponible.");
    case '23505':
      return new DomainError('ALREADY_EXISTS', 409, 'Cette ressource existe déjà.');
    case '23503':
      return new DomainError('INVALID_REFERENCE', 409, 'Une ressource liée est introuvable.');
    default:
      return undefined;
  }
}
