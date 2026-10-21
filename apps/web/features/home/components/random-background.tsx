'use client';

import { Pause, Play } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { pickHomeBackground } from '../background';
import { useAnimationRunning } from '../use-animation-running';
import { HomeSlotGrid } from './home-slot-grid';

/** `cobe` n'est téléchargé que si le tirage tombe sur le globe. */
const HomeGlobe = dynamic(() => import('./home-globe').then((module) => module.HomeGlobe), {
  ssr: false,
});

/**
 * Globe ou grille, tiré à chaque affichage de l'accueil (navigateur seulement, chargé avec
 * `ssr: false`) ; `?fond=globe|grille` force le fond pour les captures. Le bouton pause arrête
 * l'animation (WCAG 2.2.2) ; il disparaît quand le système demande moins de mouvement.
 */
export function RandomBackground() {
  const [background] = useState(() =>
    pickHomeBackground(Math.random, new URLSearchParams(window.location.search).get('fond')),
  );
  const [paused, setPaused] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const { running, reduced } = useAnimationRunning(blockRef, paused);

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
          <HomeSlotGrid running={running} reduced={reduced} />
        )}
      </div>
      {!reduced && (
        <Button
          variant="ghost"
          size="icon"
          className="text-foreground absolute top-2 right-4 size-11"
          aria-label={paused ? "Relancer l'animation" : "Mettre l'animation en pause"}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </Button>
      )}
    </div>
  );
}
