'use client';

import { useMutation } from '@tanstack/react-query';
import {
  phoneCodeRequestedSchema,
  publicUserSchema,
  type RequestPhoneCodeInput,
  type VerifyPhoneInput,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

/** Envoie un code par SMS ; le numéro n'est enregistré qu'une fois le code saisi. */
export function useRequestPhoneCode() {
  return useMutation({
    mutationFn: (input: RequestPhoneCodeInput) =>
      apiFetch('/v1/users/me/phone', {
        method: 'POST',
        body: input,
        schema: phoneCodeRequestedSchema,
      }),
  });
}

export function useVerifyPhone() {
  return useMutation({
    mutationFn: (input: VerifyPhoneInput) =>
      apiFetch('/v1/users/me/phone/verify', {
        method: 'POST',
        body: input,
        schema: publicUserSchema,
      }),
  });
}

export function useRemovePhone() {
  return useMutation({
    mutationFn: () => apiFetch('/v1/users/me/phone', { method: 'DELETE' }),
  });
}
