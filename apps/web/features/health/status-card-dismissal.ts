import { useSyncExternalStore } from 'react';
import type { ApiStatus } from './api-status';

/**
 * Carte d'état de l'API (dev seulement) fermée par l'utilisateur : on retient l'état affiché à la
 * fermeture. Elle reste fermée tant que l'état est le même, et réapparaît dès qu'il change.
 */
export const STATUS_CARD_CLOSED_KEY = 'creno.dev.api-status-closed';

/** Vrai si la carte a été fermée sur ce même état. */
export function isStatusCardClosed(closedFor: string | null, status: ApiStatus): boolean {
  return closedFor === status;
}

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(STATUS_CARD_CLOSED_KEY);
  } catch {
    return null;
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === STATUS_CARD_CLOSED_KEY) listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function closeStatusCard(status: ApiStatus): void {
  try {
    window.localStorage.setItem(STATUS_CARD_CLOSED_KEY, status);
  } catch {
    // Stockage bloqué : la carte se ferme quand même jusqu'au prochain chargement.
  }
  listeners.forEach((l) => l());
}

/** `undefined` pendant le rendu serveur et l'hydratation : on ne sait pas encore. */
export function useStatusCardClosedFor(): string | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
