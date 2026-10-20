import { useId } from 'react';

/**
 * Logo de Creno : une page de calendrier cochée (même dessin que `app/icon.svg`). Il prend la
 * couleur du texte (`currentColor`) ; les anneaux et la coche sont découpés, donc transparents.
 * Décoratif : le nom « Creno » est toujours écrit à côté.
 */
export function CrenoLogo({ className }: { className?: string }) {
  const cut = useId();
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden className={className}>
      <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
        {/* Masque : blanc = visible, noir = découpé (des niveaux, pas des couleurs d'interface). */}
        <rect width="32" height="32" fill="white" />
        <rect x="6.5" y="0.5" width="7" height="11" rx="3.5" fill="black" />
        <rect x="18.5" y="0.5" width="7" height="11" rx="3.5" fill="black" />
        <path
          d="M10 20 14.5 24.5 22.5 16"
          fill="none"
          stroke="black"
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <rect x="2" y="7" width="28" height="23" rx="6" mask={`url(#${cut})`} />
      <rect x="8" y="2" width="4" height="8" rx="2" />
      <rect x="20" y="2" width="4" height="8" rx="2" />
    </svg>
  );
}
