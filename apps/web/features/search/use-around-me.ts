'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { roundCoordinate } from '@creno/shared';
import { PLACE_MY_POSITION, type SearchFilters } from './params';

const GEOLOCATION_TIMEOUT_MS = 10_000;
const FIVE_MINUTES = 5 * 60 * 1000;

/** Échec de la géolocalisation, avec le message à afficher au visiteur. */
class GeolocationError extends Error {}

/** Position du visiteur, arrondie (≈ 100 m) avant d'aller dans l'URL et à l'API. */
function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      reject(
        new GeolocationError('Géolocalisation indisponible. Indiquez une ville ou une adresse.'),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude),
        }),
      (error) =>
        reject(
          new GeolocationError(
            error.code === error.PERMISSION_DENIED
              ? 'Vous avez refusé la géolocalisation. Indiquez une ville ou une adresse.'
              : 'Position introuvable. Indiquez une ville ou une adresse.',
          ),
        ),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: FIVE_MINUTES },
    );
  });
}

/**
 * « Autour de moi » : centre des filtres sur la position du visiteur. Partagé par l'accueil et
 * `/search`. Refus ou échec : un toast, et `null` (la page garde ses filtres).
 */
export function useAroundMe() {
  const [locating, setLocating] = useState(false);

  /** Les filtres `base` centrés sur la position du visiteur ; `null` si elle reste inconnue. */
  async function aroundMe(base: SearchFilters): Promise<SearchFilters | null> {
    setLocating(true);
    try {
      return { ...base, center: await currentPosition(), place: PLACE_MY_POSITION };
    } catch (error) {
      toast.error(
        error instanceof GeolocationError
          ? error.message
          : 'Position introuvable. Indiquez une ville ou une adresse.',
      );
      return null;
    } finally {
      setLocating(false);
    }
  }

  return { aroundMe, locating };
}
