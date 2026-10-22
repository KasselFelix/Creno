'use client';

import dynamic from 'next/dynamic';

/** Tiré au sort dans le navigateur seulement : le rendu serveur ne réserve que la place. */
const RandomBackground = dynamic(
  () => import('./random-background').then((module) => module.RandomBackground),
  { ssr: false },
);

/**
 * Bande de l'animation sous la recherche, pleine largeur, réservée dès le rendu serveur (rien ne
 * bouge quand elle arrive) : 256 px sur mobile, où son haut dépasse au bas du premier écran ; 384 px
 * au moins sur desktop, jusqu'au pied de page. Sur un petit écran, on la découvre en faisant défiler.
 */
export function HomeBackground() {
  return (
    <div className="relative h-64 overflow-hidden md:h-auto md:min-h-96 md:flex-1">
      <RandomBackground />
    </div>
  );
}
