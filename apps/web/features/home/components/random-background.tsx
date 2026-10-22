'use client';

import { Pause, Play } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { pickHomeBackground } from '../background';
import { useAnimationRunning } from '../use-animation-running';
import { HomeSlotGrid } from './home-slot-grid';

/** En dessous, la place libre sous la recherche est trop basse : rien n'est affiché. */
const MIN_HEIGHT_PX = 96;

/** `cobe` n'est téléchargé que si le tirage tombe sur le globe. */
const HomeGlobe = dynamic(() => import('./home-globe').then((module) => module.HomeGlobe), {
  ssr: false,
});

/**
 * Globe ou grille, tiré à chaque affichage de l'accueil (navigateur seulement, chargé avec
 * `ssr: false`) ; `?fond=globe|grille` force le fond pour les captures. Le bouton pause arrête
 * l'animation (WCAG 2.2.2) ; il disparaît quand le système demande moins de mouvement. Le bloc ne
 * prend que l'espace libre de la page : trop bas (mobile, petit écran), le fond n'est pas affiché.
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
        </>
      )}
    </div>
  );
}
