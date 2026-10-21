import { describe, expect, it } from 'vitest';
import { type ColorContext, cssColorToRgb } from './color';

/**
 * Faux contexte 2D : comme un vrai canvas, il ignore une couleur qu'il ne sait pas lire et garde la
 * précédente. Pas de canvas sous Vitest (Node).
 */
function fakeContext(known: Record<string, [number, number, number, number]>): ColorContext {
  let style = 'transparent';
  let pixel = [0, 0, 0, 0];
  const palette: Record<string, number[]> = { transparent: [0, 0, 0, 0], ...known };
  return {
    get fillStyle() {
      return style;
    },
    set fillStyle(value) {
      if (typeof value === 'string' && value in palette) style = value;
    },
    clearRect: () => {
      pixel = [0, 0, 0, 0];
    },
    fillRect: () => {
      pixel = palette[style]!;
    },
    getImageData: () => ({ data: pixel }),
  };
}

describe('cssColorToRgb', () => {
  const context = fakeContext({
    'oklch(1 0 0)': [255, 255, 255, 255],
    'lab(7.78201% 0 0)': [23, 23, 23, 255],
    '#e5e5e5': [229, 229, 229, 255],
    'oklch(1 0 0 / 0%)': [0, 0, 0, 0],
  });

  it('lit une couleur quel que soit son format (oklch en dev, hex ou lab en production)', () => {
    expect(cssColorToRgb('oklch(1 0 0)', context)).toEqual([1, 1, 1]);
    expect(cssColorToRgb(' lab(7.78201% 0 0) ', context)).toEqual([23 / 255, 23 / 255, 23 / 255]);
    expect(cssColorToRgb('#e5e5e5', context)).toEqual([229 / 255, 229 / 255, 229 / 255]);
  });

  it('ne garde pas la couleur précédente quand la suivante est illisible', () => {
    expect(cssColorToRgb('#e5e5e5', context)).not.toBeNull();
    expect(cssColorToRgb('var(--primary)', context)).toBeNull();
    expect(cssColorToRgb('', context)).toBeNull();
  });

  it('renvoie null pour une couleur transparente ou sans canvas 2D', () => {
    expect(cssColorToRgb('oklch(1 0 0 / 0%)', context)).toBeNull();
    expect(cssColorToRgb('oklch(1 0 0)', null)).toBeNull();
  });
});
