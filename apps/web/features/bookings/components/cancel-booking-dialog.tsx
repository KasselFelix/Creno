'use client';

import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type BookingDetail, FREE_CANCELLATION_HOURS } from '@creno/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import { dateTimeInZone, formatPrice } from '@/lib/format';
import { useCancelBooking } from '../api';

/** Bouton « Annuler » et sa confirmation, qui dit ce qu'il advient du paiement. */
export function CancelBookingDialog({ booking }: { booking: BookingDetail }) {
  const [open, setOpen] = useState(false);
  const cancel = useCancelBooking();
  const paid = booking.paymentStatus === 'succeeded';
  // Une réservation déplacée par le prestataire reste annulable jusqu'à son début.
  const cancellationWindow = booking.rescheduledAt
    ? "Le prestataire ayant déplacé cette réservation, l'annulation en ligne est possible jusqu'au début du créneau."
    : `L'annulation en ligne est possible jusqu'à ${FREE_CANCELLATION_HOURS} h avant le début.`;

  function confirm() {
    cancel.mutate(booking.id, {
      onSuccess: () => {
        setOpen(false);
        toast.success(
          paid ? 'Réservation annulée. Le remboursement est lancé.' : 'Réservation annulée.',
        );
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="outline" className="h-11" />}
        aria-label={`Annuler la réservation ${booking.resourceName}`}
      >
        Annuler
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Annuler cette réservation ?</AlertDialogTitle>
          <AlertDialogDescription>
            {booking.resourceName}, {dateTimeInZone(booking.start, booking.timezone)}.{' '}
            {paid
              ? `Vous serez remboursé de ${formatPrice(booking.priceCents, booking.currency)} sur votre moyen de paiement, sous 5 à 10 jours selon votre banque. ${cancellationWindow}`
              : 'Le créneau sera libéré pour les autres clients.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" disabled={cancel.isPending}>
            Garder ma réservation
          </AlertDialogCancel>
          <Button
            variant="destructive"
            className="h-11"
            onClick={confirm}
            disabled={cancel.isPending}
          >
            {cancel.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Annuler la réservation
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
