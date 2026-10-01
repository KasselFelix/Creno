import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { AUTH_COOKIES, type PublicUser, publicUserSchema } from '@creno/shared';

/** URL interne de l'API : jamais exposée au navigateur. */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * Utilisateur connecté, pour les Server Components. `cache` : un seul appel par requête, même si
 * l'en-tête et la page le demandent tous les deux. Le refresh de session est fait en amont par proxy.ts.
 */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const accessToken = (await cookies()).get(AUTH_COOKIES.access)?.value;
  if (!accessToken) return null;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/v1/users/me`, {
      headers: { cookie: `${AUTH_COOKIES.access}=${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const parsed = publicUserSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});
