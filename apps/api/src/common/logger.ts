import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/env.js';

const REQUEST_ID_HEADER = 'x-request-id';

/** Logs JSON (pino) : un `requestId` par requête, et jamais de secret ni de donnée personnelle. */
export function loggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      // `requestId` au premier niveau de chaque log de la requête (accès et logs métier).
      customProps: (req) => ({ requestId: req.id }),
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // Les sondes de santé sont appelées toutes les quelques secondes : pas de log d'accès.
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.email',
          '*.phone',
          '*.password',
          '*.token',
        ],
        censor: '[redacted]',
      },
    },
  };
}
