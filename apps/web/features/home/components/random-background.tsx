'use client';

import { Pause, Play } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/lib/use-media-query';
import { pickHomeBackground } from '../background';
import { useAnimationRunning } from '../use-animation-running';
import { HomeSlotGrid } from './home-slot-grid';

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
  // Deux semaines sur desktop ; une seule sur un écran étroit, pour que les cases restent lisibles.
  const dayCount = useMediaQuery('(min-width: 768px)') ? 14 : 7;

  return (
    <div
      ref={blockRef}
      data-background={background}
      className="animate-in fade-in absolute inset-0 duration-800 motion-reduce:animate-none"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {background === 'globe' ? (
          <HomeGlobe running={running} reduced={reduced} />
        ) : (
          <HomeSlotGrid key={dayCount} dayCount={dayCount} running={running} reduced={reduced} />
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
    </div>
  );
}
