'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ApiStatus } from './api-status';
import {
  closeStatusCard,
  isStatusCardClosed,
  useStatusCardClosedFor,
} from './status-card-dismissal';

/**
 * Carte d'état de l'API avec une croix pour la fermer. Elle reste fermée tant que l'état est le même
 * et réapparaît s'il change. Rien n'est affiché avant de savoir (rendu serveur, hydratation).
 */
export function DismissibleStatusCard({
  status,
  children,
}: {
  status: ApiStatus;
  children: React.ReactNode;
}) {
  const closedFor = useStatusCardClosedFor();
  // Si le stockage est bloqué, la fermeture vaut au moins jusqu'au prochain chargement.
  const [closedNow, setClosedNow] = useState(false);
  if (closedFor === undefined || closedNow || isStatusCardClosed(closedFor, status)) return null;

  return (
    <div className="relative">
      {children}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 size-11"
        aria-label="Fermer l'état de l'API"
        onClick={() => {
          setClosedNow(true);
          closeStatusCard(status);
        }}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
