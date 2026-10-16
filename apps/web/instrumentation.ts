// Sentry côté serveur Next (Server Components, proxy.ts, route du tunnel).
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') Sentry.init(sentryOptions());
}

// Erreurs de rendu serveur et du proxy.
export const onRequestError = Sentry.captureRequestError;
