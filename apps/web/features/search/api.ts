'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchProvidersResponseSchema } from '@creno/shared';
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
