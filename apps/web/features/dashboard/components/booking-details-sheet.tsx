'use client';

import { CHECKOUT_MINUTES, type ProviderBooking } from '@creno/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusBadge } from '@/features/bookings/components/booking-status-badge';
import { RescheduledBadge } from '@/features/bookings/components/rescheduled-badge';
import { providerBookingStatusView } from '@/features/bookings/status';
import { dateTimeInZone, formatPrice } from '@/lib/format';
import { customerLabel, slotLabel } from '../format';
import { BookingActions } from './booking-actions';

const paymentLabels = {
  succeeded: 'Payée',
  refunded: 'Remboursée',
} as const;

/** Détail d'une réservation ouverte depuis le calendrier, avec ses actions. */
export function BookingDetailsSheet({
  booking,
  onClose,
}: {
  booking: ProviderBooking;
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{customerLabel(booking)}</SheetTitle>
          <SheetDescription className="first-letter:uppercase">
            {slotLabel(booking)}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge view={providerBookingStatusView(booking)} />
            {booking.rescheduledAt && booking.status === 'confirmed' && (
              <RescheduledBadge label="Déplacée" />
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 [&_dt]:whitespace-nowrap">
            <dt className="text-muted-foreground">Ressource</dt>
            <dd>{booking.resourceName}</dd>
            {booking.customer && (
              <>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="min-w-0 break-all">
                  <a
                    href={`mailto:${booking.customer.email}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {booking.customer.email}
                  </a>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Montant</dt>
            <dd>
              {formatPrice(booking.priceCents, booking.currency)}
              {booking.paymentStatus ? ` · ${paymentLabels[booking.paymentStatus]}` : ''}
            </dd>
            {booking.rescheduledAt && (
              <>
                <dt className="text-muted-foreground">Déplacée le</dt>
                <dd>{dateTimeInZone(booking.rescheduledAt, booking.timezone)}</dd>
              </>
            )}
          </dl>
          {booking.status === 'pending' && (
            <p className="text-muted-foreground">
              Le client est en train de payer : le créneau est bloqué au plus {CHECKOUT_MINUTES}{' '}
              minutes, puis libéré sans paiement.
            </p>
          )}
          <BookingActions booking={booking} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
