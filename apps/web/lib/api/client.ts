import type { z } from 'zod';
import { ApiClientError, toApiClientError } from './errors';

interface ApiFetchOptions<T extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Schéma Zod de `@creno/shared` pour valider la réponse. Absent : pas de corps attendu (204). */
  schema?: T;
}

/** Routes où un 401 est la réponse attendue (identifiants ou session invalides) : pas de nouvel essai. */
const NO_REFRESH_RETRY = new Set([
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/register/complete',
  '/v1/auth/refresh',
]);

let refreshing: Promise<boolean> | null = null;

/** Un seul refresh à la fois, même si plusieurs requêtes reçoivent 401 en même temps. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function send(
  path: string,
  { method = 'GET', body }: ApiFetchOptions<z.ZodType>,
): Promise<Response> {
  return fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Appel de l'API depuis le navigateur, via le relais `/api/v1/*` de proxy.ts (cookies HttpOnly first-party).
 * Sur 401, tente un refresh de session puis rejoue la requête une fois.
 */
export async function apiFetch<T extends z.ZodType>(
  path: string,
  options: ApiFetchOptions<T> & { schema: T },
): Promise<z.output<T>>;
export async function apiFetch(path: string, options?: ApiFetchOptions<z.ZodType>): Promise<void>;
export async function apiFetch(
  path: string,
  options: ApiFetchOptions<z.ZodType> = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await send(path, options);
    if (res.status === 401 && !NO_REFRESH_RETRY.has(path) && (await refreshSession())) {
      res = await send(path, options);
    }
  } catch {
    throw new ApiClientError(null, 0);
  }
  if (!res.ok) throw await toApiClientError(res);
  if (!options.schema) return undefined;
  return options.schema.parse(await res.json());
}
