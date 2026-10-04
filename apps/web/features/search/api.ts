'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  type InterpretRequest,
  interpretResponseSchema,
  searchProvidersResponseSchema,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';
import { type SearchFilters, toApiParams } from './params';

export const searchKeys = {
  providers: (query: string) => ['search', 'providers', query] as const,
};

/** Prestataires correspondant aux filtres. */
export function useSearchProviders(filters: SearchFilters) {
  const query = toApiParams(filters).toString();
  return useQuery({
    queryKey: searchKeys.providers(query),
    queryFn: () =>
      apiFetch(`/v1/search/providers${query ? `?${query}` : ''}`, {
        schema: searchProvidersResponseSchema,
      }),
    // Garde la liste précédente affichée pendant qu'un nouveau filtre charge : pas de clignotement.
    placeholderData: keepPreviousData,
  });
}

/**
 * Phrase → filtres. En `POST` : la phrase n'apparaît ni dans l'URL ni dans les logs d'accès.
 * Une mutation plutôt qu'une requête : chaque envoi est une action du visiteur, rien à mettre en cache.
 */
export function useInterpretSearch() {
  return useMutation({
    mutationFn: (body: InterpretRequest) =>
      apiFetch('/v1/search/interpret', {
        method: 'POST',
        body,
        schema: interpretResponseSchema,
      }),
  });
}
