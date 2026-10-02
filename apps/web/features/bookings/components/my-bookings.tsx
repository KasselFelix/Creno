'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type BookingDetail, type BookingsQuery, FREE_CANCELLATION_HOURS } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMyBookings } from '../api';
import { isPayable } from '../status';
import { BookingStatusBadge } from './booking-status-badge';
import { BookingSummary } from './booking-summary';
import { CancelBookingDialog } from './cancel-booking-dialog';
import { ResumeCheckoutButton } from './resume-checkout-button';

type Scope = BookingsQuery['scope'];

const empty: Record<Scope, string> = {
  upcoming: "Vous n'avez aucune réservation à venir.",
  past: 'Aucune réservation passée ou annulée.',
};

/** Réservations du client : à venir (avec paiement à reprendre et annulation), et historique. */
export function MyBookings() {
  const [scope, setScope] = useState<Scope>('upcoming');
  const bookings = useMyBookings(scope);

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
        {/* 52 px : les onglets eux-mêmes font alors 45 px de haut (cible tactile). */}
        <TabsList className="h-13! w-full sm:w-80">
          <TabsTrigger value="upcoming">À venir</TabsTrigger>
          <TabsTrigger value="past">Historique</TabsTrigger>
        </TabsList>
      </Tabs>

      <section aria-label={scope === 'upcoming' ? 'Réservations à venir' : 'Historique'}>
        {bookings.isPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-36 w-full rounded-xl" />
            <span className="sr-only">Chargement de vos réservations…</span>
          </div>
        ) : bookings.isError ? (
          <QueryError
            title="Impossible de charger vos réservations"
            error={bookings.error}
            onRetry={() => bookings.refetch()}
          />
        ) : bookings.data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <p>{empty[scope]}</p>
            <Link href="/search" className={buttonVariants({ className: 'h-11' })}>
              Trouver un créneau
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {bookings.data.items.map((booking) => (
              <li key={booking.id}>
                <BookingCard booking={booking} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BookingCard({ booking }: { booking: BookingDetail }) {
  const payable = isPayable(booking);
  const tooLateToCancel = booking.status === 'confirmed' && !booking.cancellableUntil;
  const upcoming = new Date(booking.end) > new Date();

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <BookingStatusBadge booking={booking} />
          <BookingSummary booking={booking} />
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {payable && <ResumeCheckoutButton bookingId={booking.id} />}
            {booking.cancellableUntil && <CancelBookingDialog booking={booking} />}
          </div>
          {tooLateToCancel && upcoming && (
            <p className="text-muted-foreground text-sm sm:max-w-56 sm:text-right">
              Annulation en ligne impossible à moins de {FREE_CANCELLATION_HOURS} h du début.
              Contactez le prestataire.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
