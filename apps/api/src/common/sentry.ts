import { Writable } from 'node:stream';
import * as Sentry from '@sentry/nestjs';
import { CLIENT_IP_HEADERS } from '@creno/shared';

// Routes dont la query string porte une donnée personnelle (position, adresse) : comme les logs.
const PRIVATE_QUERY_ROUTE = /\/v1\/(search|geocoding)(\/|\?|$)/i;
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  CLIENT_IP_HEADERS.ip,
  CLIENT_IP_HEADERS.secret,
]);
// Niveau pino `error` (50) et au-delà : une action est requise, l'événement part dans Sentry.
const PINO_ERROR = 50;

/**
 * Dernier filtre avant l'envoi à Sentry : ni cookie, ni jeton, ni IP transmise, ni corps de requête,
 * ni position ou adresse recherchée ; de l'utilisateur, seul son id.
 */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    const request = { ...event.request };
    delete request.cookies;
    delete request.data;
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase()),
        ),
      );
    }
    if (request.url && PRIVATE_QUERY_ROUTE.test(request.url)) {
      request.url = request.url.split('?')[0];
      delete request.query_string;
    }
    event.request = request;
  }
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  return event;
}

interface LoggedError {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
}

interface LogLine {
  level?: number;
  event?: string;
  msg?: string;
  requestId?: string;
  err?: LoggedError;
  [key: string]: unknown;
}

/** Ligne de log pino (JSON) → événement Sentry. Pas d'objet requête : il est déjà dans les logs. */
export function captureLogLine(raw: string): void {
  let line: LogLine;
  try {
    line = JSON.parse(raw) as LogLine;
  } catch {
    return;
  }
  if ((line.level ?? 0) < PINO_ERROR) return;
  const { err, event, msg, requestId, userId, jobId, notificationId, bookingId, reason } = line;
  const error = new Error(err?.message ?? msg ?? event ?? 'Erreur');
  error.name = err?.name ?? event ?? 'Error';
  if (err?.stack) error.stack = err.stack;
  Sentry.captureException(error, {
    level: 'error',
    // Regroupe les erreurs par événement métier (`notification.failed`…) plutôt que par message.
    fingerprint: event ? ['{{ default }}', event] : undefined,
    tags: { event: event ?? 'unknown', ...(err?.code ? { sqlState: err.code } : {}) },
    extra: { requestId, userId, jobId, notificationId, bookingId, reason },
  });
}

/**
 * Destination pino réservée aux logs `error` : elle reçoit la ligne JSON déjà passée par la
 * redaction de pino (emails, jetons… masqués), donc aucune donnée masquée ne peut partir chez Sentry.
 */
export function sentryErrorStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const raw of chunk.toString().split('\n')) if (raw) captureLogLine(raw);
      done();
    },
  });
}
