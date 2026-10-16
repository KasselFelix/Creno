// Chargé avant l'application : `node --import ./dist/instrument.js dist/main.js` (l'API est en ESM,
// Sentry doit s'initialiser avant que les modules à instrumenter soient importés).
import * as Sentry from '@sentry/nestjs';
import { z } from 'zod';
import { scrubEvent } from './common/sentry.js';

const env = z
  .object({
    SENTRY_DSN: z
      .url({ protocol: /^https$/ })
      .optional()
      .catch(undefined),
    SENTRY_RELEASE: z.string().default('dev'),
    NODE_ENV: z.string().default('development'),
    DEMO_MODE: z.string().optional(),
  })
  .parse(process.env);

// Sans DSN (dev, tests, clone frais), rien n'est initialisé et rien ne part. Un DSN invalide est
// refusé ensuite par la validation de la configuration, au démarrage de l'API.
if (env.SENTRY_DSN && env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE,
    environment: env.NODE_ENV === 'production' && env.DEMO_MODE === 'true' ? 'demo' : env.NODE_ENV,
    // Erreurs seulement : pas de traces de performance (pas de `tracesSampleRate`), ni de journaux
    // Sentry. Les erreurs arrivent par les logs `error` (voir logger.ts).
    beforeSendLog: () => null,
    // Aucune donnée personnelle collectée automatiquement : ni utilisateur, ni cookie, ni en-tête,
    // ni corps, ni query string, ni paramètre de requête SQL, ni variable locale des stack traces.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend: (event) => scrubEvent(event),
  });
}
