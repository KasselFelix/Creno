'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  availabilityExceptionSchema,
  type CreateExceptionInput,
  exceptionListSchema,
  type ReplaceRulesInput,
  rulesResponseSchema,
  slotsResponseSchema,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

export const availabilityKeys = {
  all: (resourceId: string) => ['availability', resourceId] as const,
  rules: (resourceId: string) => ['availability', resourceId, 'rules'] as const,
  exceptions: (resourceId: string) => ['availability', resourceId, 'exceptions'] as const,
  slots: (resourceId: string, from: string, to: string) =>
    ['availability', resourceId, 'slots', from, to] as const,
};

export function useRules(resourceId: string) {
  return useQuery({
    queryKey: availabilityKeys.rules(resourceId),
    queryFn: () =>
      apiFetch(`/v1/resources/${resourceId}/availability-rules`, { schema: rulesResponseSchema }),
  });
}

export function useReplaceRules(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReplaceRulesInput) =>
      apiFetch(`/v1/resources/${resourceId}/availability-rules`, {
        method: 'PUT',
        body: input,
        schema: rulesResponseSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: availabilityKeys.all(resourceId) }),
  });
}

export function useExceptions(resourceId: string) {
  return useQuery({
    queryKey: availabilityKeys.exceptions(resourceId),
    queryFn: () =>
      apiFetch(`/v1/resources/${resourceId}/availability-exceptions`, {
        schema: exceptionListSchema,
      }),
  });
}

export function useCreateException(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExceptionInput) =>
      apiFetch(`/v1/resources/${resourceId}/availability-exceptions`, {
        method: 'POST',
        body: input,
        schema: availabilityExceptionSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: availabilityKeys.all(resourceId) }),
  });
}

export function useDeleteException(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (exceptionId: string) =>
      apiFetch(`/v1/resources/${resourceId}/availability-exceptions/${exceptionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: availabilityKeys.all(resourceId) }),
  });
}

/** Créneaux d'une ressource entre deux dates locales (incluses). */
export function useSlots(resourceId: string, from: string, to: string) {
  return useQuery({
    queryKey: availabilityKeys.slots(resourceId, from, to),
    queryFn: () =>
      apiFetch(`/v1/resources/${resourceId}/slots?from=${from}&to=${to}`, {
        schema: slotsResponseSchema,
      }),
  });
}
