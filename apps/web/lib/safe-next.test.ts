import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('garde un chemin interne', () => {
    expect(safeNextPath('/account?tab=sessions')).toBe('/account?tab=sessions');
  });

  it.each([
    undefined,
    null,
    '',
    'account',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/%2F/../\t/evil.example',
  ])('retombe sur /account pour %j', (value) => {
    expect(safeNextPath(value)).toBe('/account');
  });

  it('ne sort jamais du site, même pour un chemin normalisé', () => {
    expect(safeNextPath('/a/../account')).toBe('/account');
    expect(safeNextPath('/search?q=//evil.example')).toBe('/search?q=//evil.example');
  });
});
