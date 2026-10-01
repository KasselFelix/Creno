import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Global, Module } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { AppConfig } from '../config/env.js';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_FORMAT = /^[A-Za-z0-9._-]{8,128}$/;

const SENSITIVE_KEYS = [
  'email',
  'phone',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
];

/**
 * Chemins masqués par pino. Filet de sécurité : le code ne doit de toute façon pas logger de
 * donnée personnelle ni d'objet d'erreur brut (voir `describeError`).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  // Erreurs Drizzle/pg : paramètres de la requête et ligne fautive.
  'err.params',
  'err.query',
  'err.detail',
  'err.cause.params',
  'err.cause.detail',
];

// Routes dont la query string porte une donnée personnelle : position du visiteur, adresse saisie.
const PRIVATE_QUERY_PREFIXES = ['/v1/search', '/v1/geocoding'];

interface LoggedRequest {
  url?: string;
  query?: unknown;
}

/** Requête à journaliser : sans query string pour les routes de recherche et de géocodage. */
export function loggableRequest<T extends LoggedRequest>(req: T): T {
  const url = req.url;
  if (!url || !PRIVATE_QUERY_PREFIXES.some((prefix) => url.startsWith(prefix))) return req;
  const queryStart = url.indexOf('?');
  return {
    ...req,
    url: queryStart === -1 ? url : `${url.slice(0, queryStart)}?[redacted]`,
    // pino-http recopie aussi la query string décodée (`req.query` d'Express).
    query: undefined,
  };
}

/** Reprend l'identifiant de requête du client s'il est bien formé, sinon en génère un. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && REQUEST_ID_FORMAT.test(incoming) ? incoming : randomUUID();
}

/** Destination des logs : stdout par défaut ; remplacée dans les tests pour inspecter les logs. */
export const LOG_STREAM = Symbol('LOG_STREAM');

@Global()
@Module({ providers: [{ provide: LOG_STREAM, useValue: null }], exports: [LOG_STREAM] })
export class LogStreamModule {}

/** Logs JSON (pino) : un `requestId` par requête, et jamais de secret ni de donnée personnelle. */
export function loggerParams(config: AppConfig, stream: DestinationStream | null = null): Params {
  const options = {
    // En test, silence… sauf si un test capture les logs pour les vérifier.
    level: config.NODE_ENV === 'test' && !stream ? 'silent' : config.LOG_LEVEL,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    // `requestId` au premier niveau de chaque log de la requête (accès et logs métier).
    customProps: (req) => ({ requestId: req.id }),
    // Les sondes de santé sont appelées toutes les quelques secondes : pas de log d'accès.
    autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { req: loggableRequest },
  } satisfies Params['pinoHttp'];
  return { pinoHttp: stream ? [options, stream] : options };
}
