'use client';

import Link from 'next/link';
import { QueryError } from '@/components/query-error';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/features/bookings/components/booking-status-badge';
import { RescheduledBadge } from '@/features/bookings/components/rescheduled-badge';
import { providerBookingStatusView } from '@/features/bookings/status';
import { useProviderBookings } from '../api';
import { customerLabel, slotLabel } from '../format';
import { BookingActions } from './booking-actions';

/** Les prochaines réservations, avec un lien vers le tableau complet. */
export function UpcomingBookings() {
  const bookings = useProviderBookings({ scope: 'upcoming', page: 1, pageSize: 5 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Prochaines réservations</h2>
        </CardTitle>
        <CardAction>
          <Link
            href="/dashboard/bookings"
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            Tout voir
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {bookings.isPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">Chargement des réservations…</span>
          </div>
        ) : bookings.isError ? (
          <QueryError
            title="Impossible de charger vos réservations"
            error={bookings.error}
            onRetry={() => bookings.refetch()}
          />
        ) : bookings.data.items.length === 0 ? (
          <p className="text-muted-foreground">Aucune réservation à venir.</p>
        ) : (
          <ul className="divide-y">
            {bookings.data.items.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium first-letter:uppercase">{slotLabel(booking)}</span>
                  <span className="text-muted-foreground">
                    {booking.resourceName} · {customerLabel(booking)}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge view={providerBookingStatusView(booking)} />
                    {booking.rescheduledAt && booking.status === 'confirmed' && (
                      <RescheduledBadge label="Déplacée" />
                    )}
                  </div>
                </div>
                <BookingActions booking={booking} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
