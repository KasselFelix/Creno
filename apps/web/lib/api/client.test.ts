import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiFetch } from './client';
import { ApiClientError } from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauthorized = () =>
  json(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Connexion requise.' });

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const calledUrls = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls.map(([url]) => url);

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('sur 401, renouvelle la session puis rejoue la requête', async () => {
    const fetchMock = mockFetch(unauthorized(), json(200, {}), json(200, { ok: true }));
    const data = await apiFetch('/v1/users/me', { schema: z.object({ ok: z.boolean() }) });
    expect(data).toEqual({ ok: true });
    expect(calledUrls(fetchMock)).toEqual([
      '/api/v1/users/me',
      '/api/v1/auth/refresh',
      '/api/v1/users/me',
    ]);
  });

  it.each(['/v1/auth/logout', '/v1/auth/sessions'])(
    'rejoue aussi %s (session expirée sur /account)',
    async (path) => {
      const fetchMock = mockFetch(
        unauthorized(),
        json(200, {}),
        new Response(null, { status: 204 }),
      );
      await apiFetch(path, { method: 'POST' });
      expect(calledUrls(fetchMock)).toEqual([`/api${path}`, '/api/v1/auth/refresh', `/api${path}`]);
    },
  );

  it.each(['/v1/auth/login', '/v1/auth/register', '/v1/auth/refresh'])(
    'ne tente pas de refresh pour %s',
    async (path) => {
      const fetchMock = mockFetch(
        json(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' }),
      );
      await expect(apiFetch(path, { method: 'POST', body: {} })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('renvoie l’erreur d’origine quand le refresh échoue', async () => {
    const fetchMock = mockFetch(
      unauthorized(),
      json(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: 'x' }),
    );
    await expect(apiFetch('/v1/users/me')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('expose les erreurs par champ de l’API et un message utilisateur', async () => {
    mockFetch(
      json(409, {
        statusCode: 409,
        code: 'EMAIL_TAKEN',
        message: 'technique',
        details: { fieldErrors: { email: ['Un compte existe déjà avec cet email.'] } },
      }),
    );
    const error = await apiFetch('/v1/auth/register', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      message: 'Un compte existe déjà avec cet email.',
      fieldErrors: { email: ['Un compte existe déjà avec cet email.'] },
    });
  });

  it('transforme une panne réseau en erreur NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(apiFetch('/v1/users/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
