import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADERS } from '@creno/shared';
import { clientIpHeaders, parseServerEnv } from './upstream';

// Secret construit à l'exécution : aucune chaîne en forme de secret dans le dépôt.
const SECRET = 's'.repeat(40);

describe('parseServerEnv', () => {
  it('accepte le dev local sans aucune variable', () => {
    expect(parseServerEnv({})).toEqual({
      API_INTERNAL_URL: undefined,
      CLIENT_IP_SECRET: undefined,
      VERCEL_ENV: undefined,
    });
    expect(parseServerEnv({ API_INTERNAL_URL: 'http://localhost:4000' }).API_INTERNAL_URL).toBe(
      'http://localhost:4000',
    );
  });

  it('exige une API en https sur Vercel, et le secret d’IP en production', () => {
    expect(() =>
      parseServerEnv({ VERCEL_ENV: 'preview', API_INTERNAL_URL: 'http://api.test' }),
    ).toThrow(/API_INTERNAL_URL/);
    expect(() =>
      parseServerEnv({ VERCEL_ENV: 'production', API_INTERNAL_URL: 'https://api.test' }),
    ).toThrow(/CLIENT_IP_SECRET/);
    expect(
      parseServerEnv({ VERCEL_ENV: 'preview', API_INTERNAL_URL: 'https://api.test' }).VERCEL_ENV,
    ).toBe('preview');
  });

  it('n’affiche jamais la valeur refusée', () => {
    const bad = 'trop-court-mais-secret';
    expect(() => parseServerEnv({ CLIENT_IP_SECRET: bad })).not.toThrow(new RegExp(bad));
  });
});

describe('clientIpHeaders', () => {
  const vercel = { VERCEL_ENV: 'production', CLIENT_IP_SECRET: SECRET };

  it('transmet l’IP réécrite par Vercel avec le secret', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.9' });
    expect(clientIpHeaders(headers, vercel)).toEqual({
      [CLIENT_IP_HEADERS.ip]: '203.0.113.9',
      [CLIENT_IP_HEADERS.secret]: SECRET,
    });
    const forwarded = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(clientIpHeaders(forwarded, vercel)[CLIENT_IP_HEADERS.ip]).toBe('203.0.113.9');
  });

  it('n’envoie rien hors de Vercel (en-têtes choisis par le navigateur) ni sans secret', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.9' });
    expect(clientIpHeaders(headers, { VERCEL_ENV: undefined, CLIENT_IP_SECRET: SECRET })).toEqual(
      {},
    );
    expect(
      clientIpHeaders(headers, { VERCEL_ENV: 'preview', CLIENT_IP_SECRET: undefined }),
    ).toEqual({});
    expect(clientIpHeaders(new Headers(), vercel)).toEqual({});
  });
});
