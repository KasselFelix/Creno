// Premier code exécuté dans le navigateur, avant l'application.
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { sentryOptions } from '@/lib/sentry-options';

// Zod compile ses schémas avec `new Function` quand il le peut, et le teste au premier usage : la
// CSP (sans `unsafe-eval`) refuse et signale une violation. Mode sans compilation : même résultat.
z.config({ jitless: true });

// Sentry dans le navigateur. Les événements passent par le tunnel /monitoring (next.config.ts).
Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
