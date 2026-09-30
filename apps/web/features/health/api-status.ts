import { healthResponseSchema } from '@creno/shared';

export type ApiStatus = 'up' | 'down';

/** Interprète la réponse de `GET /health/ready` : tout ce qui n'est pas un « ok » valide compte comme indisponible. */
export function toApiStatus(httpStatus: number, body: unknown): ApiStatus {
  if (httpStatus !== 200) return 'down';
  const parsed = healthResponseSchema.safeParse(body);
  return parsed.success && parsed.data.status === 'ok' ? 'up' : 'down';
}

/** Appel serveur (Server Component) : l'URL interne de l'API n'est jamais exposée au navigateur. */
export async function fetchApiStatus(): Promise<ApiStatus> {
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    return toApiStatus(res.status, await res.json().catch(() => null));
  } catch {
    return 'down';
  }
}
