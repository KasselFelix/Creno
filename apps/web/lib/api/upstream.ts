import { z } from 'zod';
import { CLIENT_IP_HEADERS } from '@creno/shared';

/**
 * Délai des appels du serveur Next vers l'API. En production, l'API se met en veille après 5 min
 * sans requête et met 10 à 20 s à se réveiller : un délai plus court ferait croire à une panne au
 * premier visiteur (page en erreur, session perdue).
 */
export const API_TIMEOUT_MS = 25_000;

const DEV_API_URL = 'http://localhost:4000';

const serverEnvSchema = z
  .object({
    API_INTERNAL_URL: z.url().optional(),
    // Secret partagé avec l'API : elle ne croit l'IP du visiteur transmise que s'il l'accompagne.
    CLIENT_IP_SECRET: z.string().min(32, { error: '32 caractères minimum' }).optional(),
    // Posées par Vercel à l'exécution (`production`, `preview`) ; absentes en local.
    VERCEL_ENV: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const onVercel = env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
    if (onVercel && !env.API_INTERNAL_URL?.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_INTERNAL_URL'],
        message: 'URL https obligatoire',
      });
    }
    if (env.VERCEL_ENV === 'production' && !env.CLIENT_IP_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLIENT_IP_SECRET'],
        message: 'obligatoire en production',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(env: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse({
    API_INTERNAL_URL: env.API_INTERNAL_URL || undefined,
    CLIENT_IP_SECRET: env.CLIENT_IP_SECRET || undefined,
    VERCEL_ENV: env.VERCEL_ENV || undefined,
  });
  if (!result.success) {
    // Le nom de la variable et la règle, jamais la valeur.
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuration web invalide : ${problems}`);
  }
  return result.data;
}

/**
 * Variables du serveur Next, validées à l'exécution (pas au build : `next build` en CI n'a pas les
 * valeurs de production). Relues à chaque appel : quelques champs, et rien à invalider.
 */
export function serverEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

/** URL de l'API vue du serveur Next (jamais exposée au navigateur). */
export function apiInternalUrl(): string {
  return serverEnv().API_INTERNAL_URL ?? DEV_API_URL;
}

/**
 * En-têtes à ajouter à un appel serveur vers l'API, pour qu'elle compte les limites de débit par
 * visiteur et non par serveur Next. Seulement sur Vercel, qui réécrit `x-real-ip` (un visiteur ne
 * peut pas choisir son IP) ; en local, ces en-têtes viendraient du navigateur, donc rien.
 */
export function clientIpHeaders(
  incoming: Pick<Headers, 'get'>,
  env: Pick<ServerEnv, 'CLIENT_IP_SECRET' | 'VERCEL_ENV'> = serverEnv(),
): Record<string, string> {
  if (!env.VERCEL_ENV || !env.CLIENT_IP_SECRET) return {};
  const ip = incoming.get('x-real-ip') ?? incoming.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return {};
  return { [CLIENT_IP_HEADERS.ip]: ip, [CLIENT_IP_HEADERS.secret]: env.CLIENT_IP_SECRET };
}
