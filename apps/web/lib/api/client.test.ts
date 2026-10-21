import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiFetch } from './client';
import { ApiClientError } from './errors';
import { getApiWakeState } from './wake';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it.each([
    '/v1/auth/login',
    '/v1/auth/register',
    '/v1/auth/register/complete',
    '/v1/auth/refresh',
  ])('ne tente pas de refresh pour %s', async (path) => {
    const fetchMock = mockFetch(
      json(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' }),
    );
    await expect(apiFetch(path, { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
      json(400, {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'technique',
        details: { fieldErrors: { email: ['Email invalide'] } },
      }),
    );
    const error = await apiFetch('/v1/auth/register', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      message: 'Certains champs sont invalides.',
      fieldErrors: { email: ['Email invalide'] },
    });
  });

  it('transforme une panne réseau en erreur NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(apiFetch('/v1/users/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('apiFetch et le réveil de l’API', () => {
  it('suit la requête et note la réponse de l’API', async () => {
    let during = -1;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        during = getApiWakeState().requests;
        return json(200, { ok: true });
      }),
    );
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await apiFetch('/v1/providers', { schema: z.object({ ok: z.boolean() }) });
    expect(during).toBe(1);
    expect(getApiWakeState()).toMatchObject({ requests: 0, lastContactAt: 1_000_000 });
  });

  it('une erreur de l’API compte comme une réponse', async () => {
    mockFetch(json(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Introuvable.' }));
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    await expect(apiFetch('/v1/providers/x')).rejects.toBeInstanceOf(ApiClientError);
    expect(getApiWakeState()).toMatchObject({ requests: 0, lastContactAt: 2_000_000 });
  });

  it('une erreur du relais ou du réseau ne compte pas, mais la requête est bien terminée', async () => {
    const before = getApiWakeState().lastContactAt;
    mockFetch(new Response(null, { status: 504 }));
    vi.spyOn(Date, 'now').mockReturnValue(3_000_000);
    await expect(apiFetch('/v1/providers')).rejects.toBeInstanceOf(ApiClientError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiFetch('/v1/providers')).rejects.toBeInstanceOf(ApiClientError);
    expect(getApiWakeState()).toMatchObject({ requests: 0, lastContactAt: before });
  });
});
