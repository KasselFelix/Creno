'use client';

import dynamic from 'next/dynamic';

/** Tiré au sort dans le navigateur seulement : le rendu serveur ne réserve que la place. */
const RandomBackground = dynamic(
  () => import('./random-background').then((module) => module.RandomBackground),
  { ssr: false },
);

/**
 * Bloc du fond animé, sous la recherche : réservé dès le rendu serveur (rien ne bouge quand le fond
 * arrive), jusqu'aux bords de l'écran sur mobile (`-mx-4`).
 */
export function HomeBackground() {
  return (
    <div className="relative -mx-4 min-h-60 flex-1 overflow-hidden sm:min-h-72">
      <RandomBackground />
    </div>
  );
}
