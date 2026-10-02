'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authResponseSchema,
  type CompleteRegistrationInput,
  type LoginInput,
  publicUserSchema,
  type RegisterInput,
  sessionListSchema,
  type UpdateMeInput,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

const sessionsKey = ['auth', 'sessions'] as const;

export function useLogin() {
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch('/v1/auth/login', { method: 'POST', body: input, schema: authResponseSchema }),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      // 202 sans corps : la suite se passe dans la boîte mail, quelle que soit l'adresse.
      apiFetch('/v1/auth/register', { method: 'POST', body: input }),
  });
}

export function useCompleteRegistration() {
  return useMutation({
    mutationFn: (input: CompleteRegistrationInput) =>
      apiFetch('/v1/auth/register/complete', {
        method: 'POST',
        body: input,
        schema: authResponseSchema,
      }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/v1/auth/logout', { method: 'POST' }),
    // On vide le cache : aucune donnée de l'utilisateur précédent ne doit rester en mémoire.
    onSettled: () => queryClient.clear(),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => apiFetch('/v1/auth/sessions', { schema: sessionListSchema }),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/v1/auth/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useUpdateMe() {
  return useMutation({
    mutationFn: (input: UpdateMeInput) =>
      apiFetch('/v1/users/me', { method: 'PATCH', body: input, schema: publicUserSchema }),
  });
}
