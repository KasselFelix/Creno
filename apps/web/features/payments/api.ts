'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectOnboardingSchema, connectStatusSchema } from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

export const paymentKeys = {
  connectStatus: ['payments', 'connect', 'status'] as const,
};

/** État du compte Stripe du prestataire connecté (lu en base). */
export function useConnectStatus() {
  return useQuery({
    queryKey: paymentKeys.connectStatus,
    queryFn: () => apiFetch('/v1/payments/connect/status', { schema: connectStatusSchema }),
  });
}

/** Demande un lien vers le formulaire d'inscription hébergé par Stripe. */
export function useStartOnboarding() {
  return useMutation({
    mutationFn: () =>
      apiFetch('/v1/payments/connect/onboarding', {
        method: 'POST',
        schema: connectOnboardingSchema,
      }),
  });
}

/** Relit l'état du compte chez Stripe, au retour du formulaire. */
export function useRefreshConnectStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch('/v1/payments/connect/refresh', { method: 'POST', schema: connectStatusSchema }),
    onSuccess: (status) => queryClient.setQueryData(paymentKeys.connectStatus, status),
  });
}
