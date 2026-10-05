'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bookingDetailSchema,
  calendarSchema,
  providerBookingListSchema,
  providerBookingSchema,
  type ProviderBookingsQuery,
  providerStatsSchema,
} from '@creno/shared';
import { apiFetch } from '@/lib/api/client';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  bookings: (query: ProviderBookingsQuery) => ['dashboard', 'bookings', query] as const,
  calendar: (resourceId: string, from: string, to: string) =>
    ['dashboard', 'calendar', resourceId, from, to] as const,
  stats: (weekStart: string) => ['dashboard', 'stats', weekStart] as const,
};

function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

/** Réservations des ressources du prestataire (tableau paginé côté serveur). */
export function useProviderBookings(query: ProviderBookingsQuery) {
  return useQuery({
    queryKey: dashboardKeys.bookings(query),
    queryFn: () =>
      apiFetch(`/v1/providers/me/bookings?${queryString(query)}`, {
        schema: providerBookingListSchema,
      }),
    // Changer de page garde l'ancienne page affichée pendant le chargement de la suivante.
    placeholderData: keepPreviousData,
  });
}

/** Réservations confirmées et holds actifs d'une ressource sur la plage affichée par le calendrier. */
export function useCalendarBookings(
  resourceId: string,
  range: { from: string; to: string } | null,
) {
  return useQuery({
    queryKey: dashboardKeys.calendar(resourceId, range?.from ?? '', range?.to ?? ''),
    queryFn: () =>
      apiFetch(
        `/v1/providers/me/calendar?${queryString({ resourceId, from: range?.from, to: range?.to })}`,
        { schema: calendarSchema },
      ),
    enabled: range !== null,
    placeholderData: keepPreviousData,
  });
}

export function useWeekStats(weekStart: string | null) {
  return useQuery({
    queryKey: dashboardKeys.stats(weekStart ?? ''),
    queryFn: () =>
      apiFetch(`/v1/providers/me/stats?weekStart=${weekStart}`, { schema: providerStatsSchema }),
    enabled: weekStart !== null,
    placeholderData: keepPreviousData,
  });
}

/** Tout ce qu'un changement de réservation rend obsolète : dashboard, créneaux, vues client. */
function useInvalidateAfterChange() {
  const queryClient = useQueryClient();
  return (resourceId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['availability', resourceId] }),
      queryClient.invalidateQueries({ queryKey: ['bookings'] }),
    ]);
}

export function useRescheduleBooking() {
  const invalidate = useInvalidateAfterChange();
  return useMutation({
    mutationFn: ({ bookingId, start }: { bookingId: string; resourceId: string; start: string }) =>
      apiFetch(`/v1/bookings/${bookingId}/reschedule`, {
        method: 'POST',
        body: { start },
        schema: providerBookingSchema,
      }),
    // Réussi ou refusé (409), l'état du calendrier a pu changer : on relit tout.
    onSettled: (_data, _error, variables) => invalidate(variables.resourceId),
  });
}

export function useProviderCancelBooking() {
  const invalidate = useInvalidateAfterChange();
  return useMutation({
    mutationFn: ({ bookingId }: { bookingId: string; resourceId: string }) =>
      apiFetch(`/v1/bookings/${bookingId}/cancel`, {
        method: 'POST',
        schema: bookingDetailSchema,
      }),
    onSettled: (_data, _error, variables) => invalidate(variables.resourceId),
  });
}
