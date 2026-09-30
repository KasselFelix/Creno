import type { ErrorCode } from '@creno/shared';

/** Erreur métier : le filtre global la traduit en `{ statusCode, code, message, details? }`. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
