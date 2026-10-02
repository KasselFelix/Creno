import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { describeError } from './all-exceptions.filter.js';
import { loggableRequest, REDACT_PATHS, resolveRequestId } from './logger.js';

function captureLog(payload: object): string {
  let output = '';
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      output += chunk.toString();
      done();
    },
  });
  pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink).info(payload);
  return output;
}

describe('redaction des logs', () => {
  it('masque les données personnelles et les en-têtes sensibles, quel que soit le niveau', () => {
    const line = captureLog({
      email: 'a@b.fr',
      user: { phone: '0600000000', profile: { email: 'c@d.fr' } },
      body: { refreshToken: 'secret-token' },
      message: { to: 'dest@inataire.fr' },
      req: { headers: { authorization: 'Bearer x', cookie: 'sid=1' } },
    });
    for (const secret of [
      'a@b.fr',
      '0600000000',
      'c@d.fr',
      'secret-token',
      'dest@inataire.fr',
      'Bearer x',
      'sid=1',
    ]) {
      expect(line).not.toContain(secret);
    }
  });

  it('masque les paramètres et la ligne fautive portés par une erreur pg/Drizzle', () => {
    const line = captureLog({
      err: {
        params: ['lea@example.com'],
        query: 'insert…',
        detail: 'Failing row contains (lea@example.com)',
      },
    });
    expect(line).not.toContain('lea@example.com');
  });

  it('describeError retire les valeurs du message et de la pile d’une DrizzleQueryError', () => {
    const pgError = Object.assign(
      new Error('new row for relation "users" violates check constraint'),
      {
        code: '23514',
        detail: 'Failing row contains (lea@example.com, 0600000000)',
      },
    );
    const error = new DrizzleQueryError(
      'insert into "users" ("email", "phone") values ($1, $2)',
      ['lea@example.com', '0600000000'],
      pgError,
    );

    const serialized = JSON.stringify(describeError(error));

    expect(serialized).not.toContain('lea@example.com');
    expect(serialized).not.toContain('0600000000');
    expect(serialized).toContain('insert into');
    expect(serialized).toContain('23514');
    expect(serialized).toContain('violates check constraint');
  });

  it('describeError ne garde que nom, message, code SQL et pile', () => {
    const error = Object.assign(new Error('insert failed'), {
      params: ['lea@example.com'],
      cause: { code: '23514' },
    });
    const summary = describeError(error);
    expect(summary).toMatchObject({ name: 'Error', message: 'insert failed', code: '23514' });
    expect(JSON.stringify(summary)).not.toContain('lea@example.com');
  });
});

describe('resolveRequestId', () => {
  it('reprend un identifiant bien formé', () => {
    expect(resolveRequestId('trace-12345')).toBe('trace-12345');
  });

  it('remplace un identifiant vide, trop court ou mal formé par un UUID', () => {
    for (const bad of ['', 'abc', 'with space and more', 'x'.repeat(200), ['a', 'b']]) {
      expect(resolveRequestId(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('loggableRequest', () => {
  it('retire la query string des routes de recherche et de géocodage, sans tenir compte de la casse', () => {
    expect(
      loggableRequest({
        method: 'GET',
        url: '/v1/search/providers?lat=48.1&lng=2.4',
        query: { lat: '48.1', lng: '2.4' },
      }),
    ).toEqual({ method: 'GET', url: '/v1/search/providers?[redacted]', query: undefined });
    expect(loggableRequest({ url: '/v1/geocoding/search?q=10%20rue' }).url).toBe(
      '/v1/geocoding/search?[redacted]',
    );
    expect(
      loggableRequest({ url: '/V1/Search/providers?lat=48.1', query: { lat: '48.1' } }),
    ).toEqual({ url: '/V1/Search/providers?[redacted]', query: undefined });
  });

  it('laisse la query string des autres routes', () => {
    const slots = { url: '/v1/resources/abc/slots?from=2026-10-02', query: { from: '2026-10-02' } };
    expect(loggableRequest(slots)).toEqual(slots);
    expect(loggableRequest({ url: '/v1/search/providers' }).url).toBe('/v1/search/providers');
    expect(loggableRequest({ url: '/v1/searching?x=1' }).url).toBe('/v1/searching?x=1');
  });

  it('retire la query string du Referer sur toutes les routes', () => {
    const logged = loggableRequest({
      url: '/v1/users/me',
      headers: { host: 'api', referer: 'http://localhost:3000/search?lat=48.1&lng=2.4&place=Paix' },
    });
    expect(logged.headers).toEqual({
      host: 'api',
      referer: 'http://localhost:3000/search?[redacted]',
    });
  });
});
