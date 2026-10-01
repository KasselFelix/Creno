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
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'account',
  ])('retombe sur /account pour %s', (value) => {
    expect(safeNextPath(value)).toBe('/account');
  });
});
