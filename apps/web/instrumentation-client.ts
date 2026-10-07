// Sentry dans le navigateur. Les événements passent par le tunnel /monitoring (next.config.ts).
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
