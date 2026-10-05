import { describe, expect, it } from 'vitest';
import { statsQuerySchema } from './index.js';

describe('statsQuerySchema', () => {
  it('accepte un lundi', () => {
    expect(statsQuerySchema.safeParse({ weekStart: '2026-10-19' }).success).toBe(true);
  });

  it.each([
    ['un dimanche', '2026-10-25'],
    ['un mardi', '2026-10-20'],
    ['une date invalide', '2026-02-30'],
    ['un format inattendu', '19/10/2026'],
  ])('refuse %s', (_label, weekStart) => {
    expect(statsQuerySchema.safeParse({ weekStart }).success).toBe(false);
  });
});
