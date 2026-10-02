import { describe, expect, it } from 'vitest';
import { afterLoginPath, safeNextPath } from './safe-next';

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
    '/.//evil.example',
    '/..//evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
  ])('retombe sur /account pour %j', (value) => {
    expect(safeNextPath(value)).toBe('/account');
  });

  it('ne sort jamais du site, même pour un chemin normalisé', () => {
    expect(safeNextPath('/a/../account')).toBe('/account');
    expect(safeNextPath('/search?q=//evil.example')).toBe('/search?q=//evil.example');
  });
});

describe('afterLoginPath', () => {
  it('sans destination demandée, envoie chacun dans son espace', () => {
    expect(afterLoginPath(undefined, 'provider')).toBe('/dashboard');
    expect(afterLoginPath(undefined, 'customer')).toBe('/account');
    expect(afterLoginPath('', 'admin')).toBe('/account');
  });

  it('respecte une destination interne, et refuse un autre site', () => {
    expect(afterLoginPath('/providers/studio-lumiere', 'provider')).toBe(
      '/providers/studio-lumiere',
    );
    expect(afterLoginPath('//evil.example', 'provider')).toBe('/account');
  });
});
