'use client';

import dynamic from 'next/dynamic';

/** Tiré au sort dans le navigateur seulement : le rendu serveur ne réserve que la place. */
const RandomBackground = dynamic(
  () => import('./random-background').then((module) => module.RandomBackground),
  { ssr: false },
);

/**
 * Bloc du fond animé : il prend seulement l'espace libre sous la recherche, jusqu'au pied de page
 * (`flex-1`, `min-h-0`, `-mb-16` annule la marge basse de la page). Il n'allonge jamais la page et ne
 * passe sous aucun élément ; s'il n'y a pas la place, rien n'est affiché. Jusqu'aux bords de l'écran
 * sur mobile (`-mx-4`).
 */
export function HomeBackground() {
  return (
    <div className="relative -mx-4 -mb-16 min-h-0 flex-1 overflow-hidden">
      <RandomBackground />
    </div>
  );
}
