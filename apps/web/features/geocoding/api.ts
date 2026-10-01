'use client';

import { useQuery } from '@tanstack/react-query';
import { GEOCODING_QUERY_MIN, geocodingResponseSchema } from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

const FIVE_MINUTES = 5 * 60 * 1000;

/** Suggestions de lieux pour un texte saisi ; aucune requête sous 3 caractères. */
export function usePlaceSuggestions(text: string) {
  const query = text.trim();
  return useQuery({
    queryKey: ['geocoding', query] as const,
    queryFn: () =>
      apiFetch(`/v1/geocoding/search?${new URLSearchParams({ q: query })}`, {
        schema: geocodingResponseSchema,
      }),
    enabled: query.length >= GEOCODING_QUERY_MIN,
    // Une adresse ne change pas d'une minute à l'autre : revenir sur un texte déjà saisi ne rappelle pas l'API.
    staleTime: FIVE_MINUTES,
    // Pas de nouvel essai : la frappe suivante relance la recherche.
    retry: false,
  });
}
