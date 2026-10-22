/**
 * Couleur CSS → RVB sRGB (composantes entre 0 et 1, comme `rgb()` / 255), pour les dessins WebGL qui
 * attendent du RVB. La couleur est peinte sur un canvas 2D d'un pixel puis relue : tout format CSS
 * passe. C'est nécessaire en production, où le minifieur réécrit nos tokens `oklch()` en hex ou en
 * `lab()` selon le navigateur.
 */

export type Rgb = [number, number, number];

/** Ce que la conversion utilise d'un contexte 2D (remplaçable en test). */
export type ColorContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
};

let shared: ColorContext | null | undefined;

function sharedContext(): ColorContext | null {
  if (shared === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    shared = canvas.getContext('2d', { willReadFrequently: true });
  }
  return shared;
}

/** `null` si la couleur est illisible ou transparente, ou sans canvas 2D. */
export function cssColorToRgb(color: string, context = sharedContext()): Rgb | null {
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  // Une valeur illisible est ignorée par le canvas : le pixel reste transparent.
  context.fillStyle = 'transparent';
  context.fillStyle = color.trim();
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, alpha = 0] = Array.from(context.getImageData(0, 0, 1, 1).data);
  if (alpha === 0) return null;
  return [r / 255, g / 255, b / 255];
}
