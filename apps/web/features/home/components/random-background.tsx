'use client';

import { Pause, Play } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { pickHomeBackground } from '../background';
import { useAnimationRunning } from '../use-animation-running';
import { HomeSlotGrid } from './home-slot-grid';

/** Bande masquée (mobile) ou trop basse : rien n'est affiché, ni téléchargé. */
const MIN_HEIGHT_PX = 96;

/** `cobe` n'est téléchargé que si le tirage tombe sur le globe. */
const HomeGlobe = dynamic(() => import('./home-globe').then((module) => module.HomeGlobe), {
  ssr: false,
});

/**
 * Globe ou grille, tiré à chaque affichage de l'accueil (navigateur seulement, chargé avec
 * `ssr: false`) ; `?fond=globe|grille` force le fond pour les captures. Le bouton pause, qui flotte
 * en bas à droite par-dessus l'animation, l'arrête (WCAG 2.2.2) ; il disparaît quand le système
 * demande moins de mouvement.
 */
export function RandomBackground() {
  const [background] = useState(() =>
    pickHomeBackground(Math.random, new URLSearchParams(window.location.search).get('fond')),
  );
  const [paused, setPaused] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const { running, reduced } = useAnimationRunning(blockRef, paused);
  const [roomy, setRoomy] = useState(false);

  useEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoomy((entry?.contentRect.height ?? 0) >= MIN_HEIGHT_PX),
    );
    observer.observe(block);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={blockRef}
      data-background={background}
      className="animate-in fade-in absolute inset-0 duration-800 motion-reduce:animate-none"
    >
      {roomy && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {background === 'globe' ? (
              <HomeGlobe running={running} reduced={reduced} />
            ) : (
              <HomeSlotGrid dayCount={14} running={running} reduced={reduced} />
            )}
          </div>
          {!reduced && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-4 bottom-4 size-11 rounded-full shadow-md sm:right-6 lg:right-8"
              aria-label={paused ? "Relancer l'animation" : "Mettre l'animation en pause"}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? (
                <Play aria-hidden fill="currentColor" />
              ) : (
                <Pause aria-hidden fill="currentColor" />
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
