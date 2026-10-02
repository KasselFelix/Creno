import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

afterEach(() => vi.unstubAllGlobals());

describe('proxy', () => {
  it('redirige une page protégée vers /login quand il n’y a aucun cookie de session', async () => {
    const res = await proxy(request('/account?tab=sessions'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Faccount%3Ftab%3Dsessions',
    );
  });

  it('protège aussi les réservations, et garde la page de retour de Stripe comme destination', async () => {
    const path = '/bookings/3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a11/confirmation?checkout=success';
    const res = await proxy(request(path));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent(path)}`,
    );
  });

  it('laisse passer une page protégée quand un access token est présent', async () => {
    const res = await proxy(request('/account', 'creno_at=un-jeton'));
    expect(res.headers.get('location')).toBeNull();
  });

  // Régression : un cookie périmé faisait boucler /account ⇄ /login. La présence d'un cookie ne
  // prouve pas que la session est valide : ce sont les pages qui décident, après appel à l'API.
  it.each(['/login', '/register'])(
    'ne redirige jamais %s sur la seule présence d’un cookie',
    async (path) => {
      const res = await proxy(request(path, 'creno_at=jeton-perime'));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it('renouvelle la session quand seul le refresh token est présent, et transmet les cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: [
          ['set-cookie', 'creno_at=nouveau-at; Path=/; HttpOnly; SameSite=Lax'],
          ['set-cookie', 'creno_rt=nouveau-rt; Path=/; HttpOnly; SameSite=Strict'],
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await proxy(request('/account', 'creno_rt=ancien-rt'));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.cookie).toBe('creno_rt=ancien-rt');
    expect(init.headers).not.toHaveProperty('x-forwarded-for');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('creno_at=nouveau-at'),
        expect.stringContaining('creno_rt=nouveau-rt'),
      ]),
    );
  });

  it('redirige vers /login et efface les cookies quand le refresh échoue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 401,
          headers: [['set-cookie', 'creno_rt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']],
        }),
      ),
    );
    const res = await proxy(request('/account', 'creno_rt=mort'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Faccount');
    expect(res.headers.getSetCookie().join()).toContain('creno_rt=;');
  });
});
