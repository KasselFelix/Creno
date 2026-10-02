'use client';

import { useQuery } from '@tanstack/react-query';
import { GEOCODING_QUERY_MIN, geocodingResponseSchema } from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

const FIVE_MINUTES = 5 * 60 * 1000;

/** Requête de suggestions, partagée par le champ (hook) et par la validation d'un formulaire. */
export function placeSuggestionsQuery(text: string) {
  const query = text.trim();
  return {
    queryKey: ['geocoding', query] as const,
    queryFn: () =>
      apiFetch(`/v1/geocoding/search?${new URLSearchParams({ q: query })}`, {
        schema: geocodingResponseSchema,
      }),
    // Une adresse ne change pas d'une minute à l'autre : revenir sur un texte déjà saisi ne rappelle pas l'API.
    staleTime: FIVE_MINUTES,
    // Pas de nouvel essai : la frappe suivante relance la recherche.
    retry: false,
  };
}

/** Suggestions de lieux pour un texte saisi ; aucune requête sous 3 caractères. */
export function usePlaceSuggestions(text: string) {
  return useQuery({
    ...placeSuggestionsQuery(text),
    enabled: text.trim().length >= GEOCODING_QUERY_MIN,
  });
}
