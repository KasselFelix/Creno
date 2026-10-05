import { CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** La réservation a été déplacée par le prestataire (icône + libellé, jamais la couleur seule). */
export function RescheduledBadge({ label = 'Déplacée par le prestataire' }: { label?: string }) {
  return (
    <Badge variant="outline">
      <CalendarClock aria-hidden />
      {label}
    </Badge>
  );
}
