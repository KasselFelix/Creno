import { describe, expect, it } from 'vitest';
import { slugify, withSuffix } from './slug.js';

describe('slugify', () => {
  it('retire les accents, la ponctuation et les tirets en trop', () => {
    expect(slugify('Studio Lumière')).toBe('studio-lumiere');
    expect(slugify("  L'Atelier — Coupe & Barbe ! ")).toBe('l-atelier-coupe-barbe');
  });

  it('ne produit jamais un slug vide ou réservé', () => {
    expect(slugify('日本')).toMatch(/^prestataire-[0-9a-f]{6}$/);
    expect(slugify('Me')).toMatch(/^me-[0-9a-f]{6}$/);
  });

  it('borne la longueur', () => {
    expect(slugify('a'.repeat(200))).toHaveLength(60);
  });

  it('withSuffix ajoute un suffixe aléatoire', () => {
    expect(withSuffix('studio')).toMatch(/^studio-[0-9a-f]{6}$/);
    expect(withSuffix('studio')).not.toBe(withSuffix('studio'));
  });
});
