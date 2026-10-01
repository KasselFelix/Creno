'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreateResourceInput, resourceSchema, type UpdateResourceInput } from '@creno/shared';
import { providerKeys } from '@/features/providers/api';
import { apiFetch } from '@/lib/api/client';

export function useCreateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateResourceInput) =>
      apiFetch('/v1/resources', { method: 'POST', body: input, schema: resourceSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.myResources }),
  });
}

export function useUpdateResource(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateResourceInput) =>
      apiFetch(`/v1/resources/${resourceId}`, {
        method: 'PATCH',
        body: input,
        schema: resourceSchema,
      }),
    // La durée, le fuseau ou l'état actif changent les créneaux : tout ce qui en dépend est relu.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: providerKeys.myResources }),
        queryClient.invalidateQueries({ queryKey: ['availability', resourceId] }),
      ]),
  });
}
