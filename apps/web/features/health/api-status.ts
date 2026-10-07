import { healthResponseSchema } from '@creno/shared';
import { API_TIMEOUT_MS, apiInternalUrl } from '@/lib/api/upstream';

export type ApiStatus = 'up' | 'down';

/** Interprète la réponse de `GET /health/ready` : tout ce qui n'est pas un « ok » valide compte comme indisponible. */
export function toApiStatus(httpStatus: number, body: unknown): ApiStatus {
  if (httpStatus !== 200) return 'down';
  const parsed = healthResponseSchema.safeParse(body);
  return parsed.success && parsed.data.status === 'ok' ? 'up' : 'down';
}

/** Appel serveur (Server Component) : l'URL interne de l'API n'est jamais exposée au navigateur. */
export async function fetchApiStatus(): Promise<ApiStatus> {
  try {
    // Le premier appel après une mise en veille réveille l'API : la carte d'état s'affiche en différé
    // (Suspense) pendant ce temps.
    const res = await fetch(`${apiInternalUrl()}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    return toApiStatus(res.status, await res.json().catch(() => null));
  } catch {
    return 'down';
  }
}
