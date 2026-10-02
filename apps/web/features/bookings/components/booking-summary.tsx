import { CalendarDays, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { BookingDetail } from '@creno/shared';
import { dateTimeInZone, formatPrice, timeInZone } from '@/lib/format';

/** Ce qui a été réservé : prestataire, ressource, date dans le fuseau de la ressource, prix. */
export function BookingSummary({ booking }: { booking: BookingDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium">{booking.resourceName}</span>
      <span className="text-muted-foreground flex items-center gap-2 text-sm">
        <MapPin aria-hidden className="size-4 shrink-0" />
        <Link
          href={`/providers/${booking.providerSlug}`}
          className="hover:text-foreground truncate underline underline-offset-4"
        >
          {booking.providerName}
        </Link>
      </span>
      <span className="text-muted-foreground flex items-center gap-2 text-sm">
        <CalendarDays aria-hidden className="size-4 shrink-0" />
        <span>
          <span className="capitalize">{dateTimeInZone(booking.start, booking.timezone)}</span> –{' '}
          {timeInZone(booking.end, booking.timezone)}
        </span>
      </span>
      <span className="text-sm font-medium">
        {booking.priceCents === 0 ? 'Gratuit' : formatPrice(booking.priceCents, booking.currency)}
      </span>
    </div>
  );
}
