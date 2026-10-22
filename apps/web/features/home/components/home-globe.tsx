'use client';

import createGlobe from 'cobe';
import { useEffect, useRef } from 'react';
import { cssColorToRgb } from '@/lib/color';
import styles from './home-background.module.css';

type Globe = ReturnType<typeof createGlobe>;
type Location = [number, number];

/** Villes où la démo a des prestataires. */
const CITIES: Location[] = [
  [48.8566, 2.3522], // Paris
  [45.764, 4.8357], // Lyon
  [44.8378, -0.5792], // Bordeaux
];
/** Angle qui place la longitude de Paris face à nous (convention de cobe). */
const PHI_FRANCE = Math.PI - ((2.35 * Math.PI) / 180 - Math.PI / 2);
/** Inclinaison qui place la France près du haut de la calotte. */
const THETA = 0.05;
const SWAY = 0.45;
const SWAY_SPEED = 0.12;
/** Diamètre : 1000 px au plus, 125 % de la largeur de la bande, 3,2 fois sa hauteur. */
const MAX_DIAMETER = 1000;
const TOP_MARGIN = 24;

/**
 * La calotte d'un grand globe se lève dans la bande : le canvas couvre exactement la bande, le globe
 * y est agrandi et décalé vers le bas, si bien que seule la partie visible est calculée.
 */
function frame(width: number, height: number) {
  const diameter = Math.min(MAX_DIAMETER, width * 1.25, height * 3.2);
  // cobe dessine une sphère de rayon 0,8 (demi-hauteur du canvas = 1), agrandie par `scale`.
  const scale = diameter / (0.8 * height);
  // Centre du globe (en partant du bas, comme WebGL) : sous la bande, le haut à TOP_MARGIN du bord.
  const centerFromBottom = height - (TOP_MARGIN + diameter / 2);
  return { width, height, scale, offset: [0, (height - 2 * centerFromBottom) / scale] as Location };
}

/** Couleurs lues dans les tokens `--globe-*` ; `null` si l'une est illisible (rien n'est dessiné). */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const [baseColor, glowColor, markerColor] = [
    '--globe-base',
    '--globe-glow',
    '--globe-marker',
  ].map((token) => cssColorToRgb(style.getPropertyValue(token)));
  if (!baseColor || !glowColor || !markerColor) return null;
  const dark = document.documentElement.classList.contains('dark');
  return {
    baseColor,
    glowColor,
    markerColor,
    dark: dark ? 1 : 0,
    diffuse: dark ? 1.4 : 1.2,
    mapBrightness: dark ? 5 : 6,
  };
}

function markers(seconds: number, still: boolean) {
  return CITIES.map((location, index) => ({
    location,
    size:
      (index === 0 ? 0.018 : 0.013) *
      (still ? 1 : 1 + 0.35 * Math.sin(seconds * 2.2 + index * 1.3)),
  }));
}

/**
 * Globe 3D (cobe) centré sur la France, les villes de démo qui pulsent. cobe v2 déplace le canvas
 * dans un `div` à lui : le canvas est donc créé ici, hors de React, et le conteneur vidé au démontage.
 */
export function HomeGlobe({ running, reduced }: { running: boolean; reduced: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<Globe | null>(null);
  // Temps d'animation écoulé : une pause reprend là où elle s'est arrêtée.
  const elapsedRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const colors = palette();
    if (!container || !colors) return;
    const canvas = document.createElement('canvas');
    container.append(canvas);
    const { width, height } = container.getBoundingClientRect();
    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      ...frame(width, height),
      phi: PHI_FRANCE,
      theta: THETA,
      mapSamples: 20000,
      markers: markers(0, true),
      markerElevation: 0.01,
      ...colors,
    });
    globeRef.current = globe;

    const resize = new ResizeObserver(([entry]) => {
      if (entry) globe.update(frame(entry.contentRect.width, entry.contentRect.height));
    });
    resize.observe(container);
    // next-themes pose la classe dans son propre effet, après ceux de ses enfants : on suit la classe
    // elle-même, pas `resolvedTheme` (qui donnerait encore les couleurs de l'ancien thème).
    const theme = new MutationObserver(() => {
      const next = palette();
      if (next) globe.update(next);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      resize.disconnect();
      theme.disconnect();
      globe.destroy();
      globeRef.current = null;
      // `destroy` ne libère pas le contexte WebGL : sans ça, les allers-retours les accumulent.
      (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
        ?.getExtension('WEBGL_lose_context')
        ?.loseContext();
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const draw = () => {
      const seconds = elapsedRef.current;
      globe.update({
        phi: PHI_FRANCE + (reduced ? 0 : Math.sin(seconds * SWAY_SPEED) * SWAY),
        markers: markers(seconds, reduced),
      });
    };
    if (!running) {
      // Image fixe (mouvement réduit, pause, hors écran). cobe décode sa carte des terres en différé,
      // après la création du globe : on redessine la même image pendant une seconde, sans aucun
      // mouvement, pour que les continents apparaissent même si elle arrive après le premier dessin.
      let raf = 0;
      const until = performance.now() + 1000;
      const still = (now: number) => {
        draw();
        if (now < until) raf = requestAnimationFrame(still);
      };
      raf = requestAnimationFrame(still);
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      elapsedRef.current += (now - last) / 1000;
      last = now;
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, reduced]);

  return <div ref={containerRef} className={styles.globe} />;
}
