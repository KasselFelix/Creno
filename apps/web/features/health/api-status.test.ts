import { describe, expect, it } from 'vitest';
import { toApiStatus } from './api-status';

describe('toApiStatus', () => {
  it('up quand la base répond', () => {
    expect(toApiStatus(200, { status: 'ok', info: { database: { status: 'up' } } })).toBe('up');
  });

  it('down sur un 503 terminus', () => {
    expect(toApiStatus(503, { status: 'error', error: { database: { status: 'down' } } })).toBe('down');
  });

  it('down quand la réponse est invalide', () => {
    expect(toApiStatus(200, { hello: 'world' })).toBe('down');
    expect(toApiStatus(200, null)).toBe('down');
  });
});
