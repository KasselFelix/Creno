import type { BrowserOptions, NodeOptions } from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

/**
 * Réglages Sentry communs au navigateur et au serveur Next. Sans DSN (dev, CI), Sentry reste
 * désactivé. Le DSN n'est pas un secret (il ne permet que d'envoyer des erreurs) : il peut être
 * public. Erreurs seulement : ni traces de performance, ni Session Replay.
 */
export function sentryOptions(): BrowserOptions & NodeOptions {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    environment: vercelEnv === 'production' && demo ? 'demo' : (vercelEnv ?? 'development'),
    beforeSendLog: () => null,
    // Aucune donnée personnelle collectée automatiquement (utilisateur, cookies, en-têtes, corps,
    // query strings : celle de /search porte la position du visiteur).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}
