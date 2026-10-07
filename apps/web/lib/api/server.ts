import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { z } from 'zod';
import { AUTH_COOKIES, type PublicUser, publicUserSchema } from '@creno/shared';
import { API_TIMEOUT_MS, apiInternalUrl, clientIpHeaders } from './upstream';

/** En-têtes communs des appels serveur : l'IP du visiteur, pour ses limites de débit à l'API. */
async function upstreamHeaders(): Promise<Record<string, string>> {
  return clientIpHeaders(await headers());
}

/**
 * Utilisateur connecté, pour les Server Components. `cache` : un seul appel par requête, même si
 * l'en-tête et la page le demandent tous les deux. Le refresh de session est fait en amont par proxy.ts.
 */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const accessToken = (await cookies()).get(AUTH_COOKIES.access)?.value;
  if (!accessToken) return null;
  try {
    const res = await fetch(`${apiInternalUrl()}/v1/users/me`, {
      headers: { cookie: `${AUTH_COOKIES.access}=${accessToken}`, ...(await upstreamHeaders()) },
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = publicUserSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});

/**
 * Lecture d'une route publique de l'API depuis un Server Component. Renvoie `null` sur 404 ;
 * toute autre erreur est levée et affichée par le `error.tsx` de la page.
 */
export async function serverFetch<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.output<T> | null> {
  const res = await fetch(`${apiInternalUrl()}${path}`, {
    headers: await upstreamHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return schema.parse(await res.json());
}
