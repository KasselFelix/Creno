import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { sqlState } from '@creno/db';
import { type ApiError, type ErrorCode, healthResponseSchema } from '@creno/shared';
import { DomainError } from './domain-error.js';
import { mapPgError } from './pg-errors.js';

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

const GENERIC_SERVER_ERROR = 'Erreur interne.';

/**
 * Résumé loggable d'une exception. On ne loggue jamais l'objet brut : une erreur Drizzle/pg porte
 * les paramètres de la requête et la ligne fautive (email, téléphone…).
 */
export function describeError(exception: unknown) {
  if (!(exception instanceof Error)) return { name: typeof exception };
  return {
    name: exception.name,
    message: exception.message,
    code: sqlState(exception),
    stack: exception.stack,
  };
}

/** Donne à toutes les erreurs le format `{ statusCode, code, message, details? }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    // Les sondes terminus (503) gardent leur format standard, attendu par Docker et Azure.
    if (exception instanceof HttpException) {
      const health = healthResponseSchema.safeParse(exception.getResponse());
      if (health.success) {
        res.status(exception.getStatus()).json(exception.getResponse());
        return;
      }
    }

    const body = this.toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        { event: 'http.unhandled_error', err: describeError(exception) },
        'Erreur non gérée',
      );
    }
    res.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    const domain = exception instanceof DomainError ? exception : mapPgError(exception);
    if (domain) {
      return {
        statusCode: domain.statusCode,
        code: domain.code,
        message: domain.message,
        ...(domain.details === undefined ? {} : { details: domain.details }),
      };
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: codeByStatus[statusCode] ?? 'BAD_REQUEST',
        message: exception.message,
      };
    }
    // 5xx : message générique, le détail reste dans les logs.
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    return { statusCode, code: 'INTERNAL_ERROR', message: GENERIC_SERVER_ERROR };
  }
}
