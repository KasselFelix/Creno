'use client';

import { LoaderCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { ProviderBooking, Slot } from '@creno/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SlotChooser } from '@/features/availability/components/slot-chooser';
import { errorMessage } from '@/lib/api/errors';
import { formatPrice, timeInZone } from '@/lib/format';
import { useProviderCancelBooking, useRescheduleBooking } from '../api';
import { customerLabel, localDateOfBooking, slotLabel } from '../format';

/** Message affiché après un déplacement réussi : le client est prévenu par le worker. */
export const RESCHEDULED_TOAST = 'Réservation déplacée. Le client est prévenu par email.';

/**
 * Déplacement au clavier ou au toucher : le même choix de créneau que sur la fiche publique.
 * Alternative au glisser-déposer du calendrier, qui permet aussi de changer de jour sur mobile.
 */
export function RescheduleDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: ProviderBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<Slot | null>(null);
  const reschedule = useRescheduleBooking();
  const select = useCallback((slot: Slot | null) => setSelected(slot), []);

  function confirm() {
    if (!selected) return;
    reschedule.mutate(
      { bookingId: booking.id, resourceId: booking.resourceId, start: selected.start },
      {
        onSuccess: () => {
          toast.success(RESCHEDULED_TOAST);
          setSelected(null);
          onOpenChange(false);
        },
        onError: (error) => {
          // Créneau pris entre-temps : les créneaux se rechargent, le choix est à refaire.
          setSelected(null);
          toast.error(errorMessage(error));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Déplacer la réservation</DialogTitle>
          <DialogDescription>
            {customerLabel(booking)} · {booking.resourceName} · actuellement {slotLabel(booking)}.
            Le client sera prévenu par email.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <SlotChooser
            resource={{ id: booking.resourceId, timezone: booking.timezone }}
            initialDate={localDateOfBooking(booking)}
            title="Nouveau créneau"
            titleId={`reschedule-${booking.id}`}
            selectedStart={selected?.start ?? null}
            onSelect={select}
          />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => onOpenChange(false)}
            disabled={reschedule.isPending}
          >
            Annuler
          </Button>
          <Button className="h-11" onClick={confirm} disabled={!selected || reschedule.isPending}>
            {reschedule.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            {selected
              ? `Déplacer à ${timeInZone(selected.start, booking.timezone)}`
              : 'Choisissez un créneau'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Annulation par le prestataire : le client est remboursé intégralement et prévenu. */
export function ProviderCancelDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: ProviderBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cancel = useProviderCancelBooking();
  const paid = booking.paymentStatus === 'succeeded';

  function confirm() {
    cancel.mutate(
      { bookingId: booking.id, resourceId: booking.resourceId },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(
            paid
              ? 'Réservation annulée. Le client est remboursé et prévenu par email.'
              : 'Réservation annulée. Le client est prévenu par email.',
          );
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Annuler cette réservation ?</AlertDialogTitle>
          <AlertDialogDescription>
            {customerLabel(booking)} · {booking.resourceName}, {slotLabel(booking)}.{' '}
            {paid
              ? `Le client sera remboursé intégralement (${formatPrice(booking.priceCents, booking.currency)}) et prévenu par email.`
              : 'Le client sera prévenu par email et le créneau sera libéré.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" disabled={cancel.isPending}>
            Garder la réservation
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

/** Boutons « Déplacer… » et « Annuler » d'une réservation, selon ce que l'API autorise. */
export function BookingActions({
  booking,
  className = 'flex flex-wrap gap-2',
}: {
  booking: ProviderBooking;
  className?: string;
}) {
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | null>(null);
  if (!booking.reschedulable && !booking.cancellableUntil) return null;

  return (
    <div className={className}>
      {booking.reschedulable && (
        <Button
          variant="outline"
          className="h-11"
          aria-label={`Déplacer la réservation de ${customerLabel(booking)}, ${slotLabel(booking)}`}
          onClick={() => setDialog('reschedule')}
        >
          Déplacer…
        </Button>
      )}
      {booking.cancellableUntil && (
        <Button
          variant="outline"
          className="h-11"
          aria-label={`Annuler la réservation de ${customerLabel(booking)}, ${slotLabel(booking)}`}
          onClick={() => setDialog('cancel')}
        >
          Annuler
        </Button>
      )}
      <RescheduleDialog
        booking={booking}
        open={dialog === 'reschedule'}
        onOpenChange={(open) => setDialog(open ? 'reschedule' : null)}
      />
      <ProviderCancelDialog
        booking={booking}
        open={dialog === 'cancel'}
        onOpenChange={(open) => setDialog(open ? 'cancel' : null)}
      />
    </div>
  );
}
