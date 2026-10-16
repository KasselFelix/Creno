import type { InterpretResponse } from '@creno/shared';
import { interpretationMatches } from './interpretation';
import type { SearchFilters } from './params';

/** Dernière phrase interprétée, et les filtres qu'elle a produits. */
export interface Handoff {
  query: string;
  response: InterpretResponse;
  applied: SearchFilters;
}

// En mémoire seulement (module du navigateur) : la phrase ne passe ni par l'URL, ni par un stockage
// du navigateur. Un rechargement la perd ; elle survit à une navigation (accueil → `/search`,
// bouton « Précédent »). Jamais écrite côté serveur : `remember` n'est appelé que par un événement.
let last: Handoff | null = null;

export function remember(handoff: Handoff): void {
  last = handoff;
}

/**
 * Relais à afficher pour ces filtres : seulement si la page montre encore ceux de l'interprétation
 * (même règle que la ligne « Compris »). Lecture pure, sans effacer le relais : un rendu en double
 * (React Strict Mode) ou un retour sur la même URL le retrouve.
 */
export function handoffFor(filters: SearchFilters): Handoff | null {
  return last && interpretationMatches(filters, last.applied) ? last : null;
}
