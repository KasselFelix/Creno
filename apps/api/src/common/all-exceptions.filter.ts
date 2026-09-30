import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { type ApiError, type ErrorCode, healthResponseSchema } from '@creno/shared';
import { DomainError } from './domain-error.js';
import { mapPgError } from './pg-errors.js';

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
};

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
        res.status(exception.getStatus()).json(health.data);
        return;
      }
    }

    const body = this.toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error({ event: 'http.unhandled_error', err: exception }, 'Erreur non gérée');
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
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: codeByStatus[statusCode] ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'),
        message: exception.message,
      };
    }
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erreur interne.' };
  }
}
