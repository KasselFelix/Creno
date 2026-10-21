'use client';

import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type BookingDetail, refundAmountChangedDetailsSchema } from '@creno/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { dateTimeInZone, formatPrice } from '@/lib/format';
import { useCancelBooking } from '../api';
import { type RefundQuote, refundQuote } from '../refund';

const BANK_DELAY = 'sur votre moyen de paiement, sous 5 à 10 jours selon votre banque';

/** Ce que l'annulation rend au client, dit avant qu'il confirme. */
function refundSentence(booking: BookingDetail, quote: RefundQuote | null): string {
  if (!quote) return 'Le créneau sera libéré pour les autres clients.';
  const price = formatPrice(booking.priceCents, booking.currency);
  if (quote.percent === 100) return `Vous serez remboursé de ${price} ${BANK_DELAY}.`;
  if (quote.percent === 0) {
    return 'Vous ne serez pas remboursé : le créneau commence dans moins de 24 h. Il sera libéré pour les autres clients.';
  }
  const due = formatPrice(quote.refundDueCents, booking.currency);
  return `Le créneau commence dans moins de 48 h. Vous serez remboursé de ${due} sur ${price} (${quote.percent} %) ${BANK_DELAY}.`;
}

/**
 * Bouton « Annuler » et sa confirmation, qui dit ce qu'il advient du paiement. Le montant est
 * calculé à l'ouverture et envoyé à l'API, qui le refuse si le palier a changé entre-temps : la
 * fenêtre affiche alors le montant renvoyé par l'API (pas celui de l'horloge du navigateur).
 */
export function CancelBookingDialog({ booking }: { booking: BookingDetail }) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [changed, setChanged] = useState(false);
  const cancel = useCancelBooking();

  function onOpenChange(next: boolean) {
    if (next) {
      setQuote(refundQuote(booking));
      setChanged(false);
    }
    setOpen(next);
  }

  function confirm() {
    cancel.mutate(
      { bookingId: booking.id, expectedRefundCents: quote?.refundDueCents },
      {
        onSuccess: (cancelled) => {
          setOpen(false);
          const due = cancelled.refundDueCents ?? 0;
          toast.success(
            due > 0
              ? `Réservation annulée. Remboursement de ${formatPrice(due, cancelled.currency)} lancé.`
              : 'Réservation annulée.',
          );
        },
        onError: (error) => {
          if (error instanceof ApiClientError && error.code === 'REFUND_AMOUNT_CHANGED') {
            const details = refundAmountChangedDetailsSchema.safeParse(error.details);
            if (details.success) {
              setQuote(details.data);
              setChanged(true);
              return;
            }
          }
          toast.error(errorMessage(error));
        },
      },
    );
  }

  const confirmLabel = !quote
    ? 'Annuler la réservation'
    : quote.percent === 0
      ? 'Annuler sans remboursement'
      : 'Annuler et être remboursé';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger
        render={<Button variant="outline" className="h-11" />}
        aria-label={`Annuler la réservation ${booking.resourceName}`}
      >
        Annuler
      </AlertDialogTrigger>
      {/* Plus large que la taille par défaut : les deux boutons du pied tiennent sur une ligne. */}
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Annuler cette réservation ?</AlertDialogTitle>
          <AlertDialogDescription>
            {booking.resourceName}, {dateTimeInZone(booking.start, booking.timezone)}.{' '}
            {refundSentence(booking, quote)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {changed && (
          <Alert>
            <CircleAlert aria-hidden />
            <AlertTitle>Le montant du remboursement vient de changer</AlertTitle>
            <AlertDescription>
              Un délai d’annulation vient de passer. Vérifiez le nouveau montant avant de confirmer.
            </AlertDescription>
          </Alert>
        )}
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
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
