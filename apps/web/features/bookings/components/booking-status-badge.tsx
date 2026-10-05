import { CircleCheck, CircleSlash, Clock } from 'lucide-react';
import type { BookingDetail } from '@creno/shared';
import { Badge } from '@/components/ui/badge';
import { type BookingStatusView, bookingStatusView, type BookingTone } from '../status';

// La couleur d'accent reste réservée aux actions : les statuts utilisent les tons neutres du thème.
const tones = {
  success: { variant: 'secondary', Icon: CircleCheck, className: '' },
  waiting: { variant: 'outline', Icon: Clock, className: '' },
  closed: { variant: 'outline', Icon: CircleSlash, className: 'text-muted-foreground' },
} as const satisfies Record<BookingTone, unknown>;

/** Statut d'une réservation, vue client. */
export function BookingStatusBadge({ booking }: { booking: BookingDetail }) {
  return <StatusBadge view={bookingStatusView(booking)} />;
}

/** Un statut : jamais porté par la couleur seule (icône + libellé). */
export function StatusBadge({ view: { label, tone } }: { view: BookingStatusView }) {
  const { variant, Icon, className } = tones[tone];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
