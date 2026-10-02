'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BookingDetail,
  bookingDetailSchema,
  bookingListSchema,
  bookingSchema,
  type BookingsQuery,
  checkoutResponseSchema,
  type CreateBookingInput,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

export const bookingKeys = {
  all: ['bookings'] as const,
  list: (scope: BookingsQuery['scope']) => ['bookings', 'list', scope] as const,
  detail: (id: string) => ['bookings', 'detail', id] as const,
};

const LIST_PAGE_SIZE = 50;

export function useMyBookings(scope: BookingsQuery['scope']) {
  return useQuery({
    queryKey: bookingKeys.list(scope),
    queryFn: () =>
      apiFetch(`/v1/bookings?scope=${scope}&pageSize=${LIST_PAGE_SIZE}`, {
        schema: bookingListSchema,
      }),
  });
}

/**
 * Une réservation. `pollWhile` : tant qu'il renvoie vrai, la requête est relancée toutes les 2 s
 * (attente de la confirmation du paiement, qui arrive à l'API par le webhook Stripe).
 */
export function useBooking(id: string, pollWhile?: (booking: BookingDetail) => boolean) {
  return useQuery({
    queryKey: bookingKeys.detail(id),
    queryFn: () => apiFetch(`/v1/bookings/${id}`, { schema: bookingDetailSchema }),
    refetchInterval: (query) =>
      pollWhile && query.state.data && pollWhile(query.state.data) ? 2000 : false,
  });
}

export interface ReserveResult {
  bookingId: string;
  /** Page de paiement Stripe ; `null` si la réservation est gratuite, donc déjà confirmée. */
  checkoutUrl: string | null;
  /** Le créneau est bloqué mais le paiement n'a pas pu être lancé : il se reprend depuis la réservation. */
  checkoutError?: unknown;
}

/** Bloque le créneau (hold), puis lance le paiement. */
export function useReserve() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBookingInput): Promise<ReserveResult> => {
      const booking = await apiFetch('/v1/bookings', {
        method: 'POST',
        body: input,
        schema: bookingSchema,
      });
      try {
        const checkout = await apiFetch(`/v1/bookings/${booking.id}/checkout`, {
          method: 'POST',
          schema: checkoutResponseSchema,
        });
        return { bookingId: booking.id, checkoutUrl: checkout.checkoutUrl };
      } catch (checkoutError) {
        return { bookingId: booking.id, checkoutUrl: null, checkoutError };
      }
    },
    // Le créneau vient de changer d'état (bloqué, ou pris par quelqu'un d'autre).
    onSettled: (_data, _error, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['availability', input.resourceId] }),
        queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
      ]),
  });
}

/** Reprend le paiement d'un hold encore actif : renvoie la même session Stripe. */
export function useResumeCheckout() {
  return useMutation({
    mutationFn: (bookingId: string) =>
      apiFetch(`/v1/bookings/${bookingId}/checkout`, {
        method: 'POST',
        schema: checkoutResponseSchema,
      }),
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      apiFetch(`/v1/bookings/${bookingId}/cancel`, {
        method: 'POST',
        schema: bookingDetailSchema,
      }),
    onSuccess: (booking) => {
      queryClient.setQueryData(bookingKeys.detail(booking.id), booking);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bookings', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['availability', booking.resourceId] }),
      ]);
    },
  });
}
