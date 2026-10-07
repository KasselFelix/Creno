import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Global, Module } from '@nestjs/common';
import type { Request } from 'express';
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
  // Destinataire d'une notification (adresse email ou numéro).
  'to',
  'recipient',
];

/**
 * Chemins masqués par pino. Filet de sécurité : le code ne doit de toute façon pas logger de
 * donnée personnelle ni d'objet d'erreur brut (voir `describeError`).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  // Relais du front : le secret partagé, et l'IP du visiteur (donnée personnelle).
  'req.headers["x-creno-proxy-secret"]',
  'req.headers["x-creno-client-ip"]',
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
// Sans tenir compte de la casse, comme le routeur d'Express.
const PRIVATE_QUERY_ROUTE = /^\/v1\/(search|geocoding)(\/|\?|$)/i;

interface LoggedRequest {
  url?: string;
  query?: unknown;
  headers?: Record<string, unknown>;
}

function withoutQuery(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?[redacted]`;
}

/**
 * Requête à journaliser.
 * - Recherche et géocodage : sans query string.
 * - Toutes les routes : `Referer` sans query string. Le navigateur y met l'adresse de la page
 *   d'où part l'appel, donc `/search?lat=…&lng=…&place=…` pour tout appel fait depuis la recherche.
 */
export function loggableRequest<T extends LoggedRequest>(req: T): T {
  const logged = { ...req };
  if (logged.url && PRIVATE_QUERY_ROUTE.test(logged.url)) {
    logged.url = withoutQuery(logged.url);
    // pino-http recopie aussi la query string décodée (`req.query` d'Express).
    logged.query = undefined;
  }
  const referer = logged.headers?.referer;
  if (typeof referer === 'string') {
    logged.headers = { ...logged.headers, referer: withoutQuery(referer) };
  }
  return logged;
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
    // `requestId` au premier niveau de chaque log de la requête (accès et logs métier). `ipSource`
    // dit si l'IP du visiteur vient du front (secret valide) ou de la connexion, sans l'écrire.
    customProps: (req) => ({ requestId: req.id, ipSource: (req as Request).ipSource }),
    // Les sondes de santé sont appelées toutes les quelques secondes : pas de log d'accès.
    autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { req: loggableRequest },
  } satisfies Params['pinoHttp'];
  return { pinoHttp: stream ? [options, stream] : options };
}
