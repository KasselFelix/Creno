import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { describeError } from './all-exceptions.filter.js';
import { REDACT_PATHS, resolveRequestId } from './logger.js';

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
      req: { headers: { authorization: 'Bearer x', cookie: 'sid=1' } },
    });
    for (const secret of ['a@b.fr', '0600000000', 'c@d.fr', 'secret-token', 'Bearer x', 'sid=1']) {
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
