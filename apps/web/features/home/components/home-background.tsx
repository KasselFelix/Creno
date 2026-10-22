'use client';

import dynamic from 'next/dynamic';

/** Tiré au sort dans le navigateur seulement : le rendu serveur ne réserve que la place. */
const RandomBackground = dynamic(
  () => import('./random-background').then((module) => module.RandomBackground),
  { ssr: false },
);

/**
 * Bande de l'animation sous la recherche, pleine largeur, réservée dès le rendu serveur (rien ne
 * bouge quand elle arrive) : 384 px au moins, elle grandit jusqu'au pied de page sur un grand écran.
 * Sur un petit écran, on la découvre en faisant défiler. Masquée sur mobile : rien n'y est téléchargé.
 */
export function HomeBackground() {
  return (
    <div className="relative hidden min-h-96 flex-1 overflow-hidden md:block">
      <RandomBackground />
    </div>
  );
}
