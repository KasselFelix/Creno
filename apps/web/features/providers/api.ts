'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateProviderInput,
  type Provider,
  providerSchema,
  resourceListSchema,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/errors';

export const providerKeys = {
  me: ['providers', 'me'] as const,
  myResources: ['providers', 'me', 'resources'] as const,
};

/** Profil du prestataire connecté ; `null` tant qu'il ne l'a pas créé (404 de l'API). */
export function useMyProvider() {
  return useQuery({
    queryKey: providerKeys.me,
    queryFn: async (): Promise<Provider | null> => {
      try {
        return await apiFetch('/v1/providers/me', { schema: providerSchema });
      } catch (error) {
        if (error instanceof ApiClientError && error.statusCode === 404) return null;
        throw error;
      }
    },
  });
}

/** Crée le profil, ou le modifie s'il existe déjà. */
export function useSaveProvider(exists: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProviderInput) =>
      apiFetch(exists ? '/v1/providers/me' : '/v1/providers', {
        method: exists ? 'PATCH' : 'POST',
        body: input,
        schema: providerSchema,
      }),
    onSuccess: (provider) => queryClient.setQueryData(providerKeys.me, provider),
  });
}

export function useMyResources() {
  return useQuery({
    queryKey: providerKeys.myResources,
    queryFn: () => apiFetch('/v1/providers/me/resources', { schema: resourceListSchema }),
  });
}
