/**
 * État d'une pastille de la carte. Active (inversée) si elle est survolée (depuis la liste ou sur la
 * carte) ou sélectionnée ; la survolée passe devant la sélectionnée, qui passe devant les autres.
 */
export function markerLayer(
  id: string,
  { activeId, selectedId }: { activeId: string | null; selectedId: string | null },
): { active: boolean; zIndex: number } {
  if (id === activeId) return { active: true, zIndex: 2 };
  if (id === selectedId) return { active: true, zIndex: 1 };
  return { active: false, zIndex: 0 };
}

/** Garde un prestataire survolé ou sélectionné seulement s'il fait partie des nouveaux résultats. */
export function keepIfListed(id: string | null, items: readonly { id: string }[]): string | null {
  return id !== null && items.some((item) => item.id === id) ? id : null;
}
