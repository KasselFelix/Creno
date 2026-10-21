'use client';

import { CreditCard, LoaderCircle, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { HOLD_MINUTES } from '@creno/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { useReserve } from '../api';
import { refundPolicyFor } from '../refund';

interface Props {
  resourceId: string;
  /** Début du créneau choisi (instant ISO). */
  start: string;
  /** Fuseau de la ressource : les échéances d'annulation s'affichent dans ce fuseau. */
  timezone: string;
  free: boolean;
  isAuthenticated: boolean;
  /** Page à retrouver après connexion. */
  loginNext: string;
  /** Le créneau n'est plus réservable (pris entre-temps, ou plus proposé). */
  onSlotLost: () => void;
}

/** Action principale de la fiche prestataire : bloque le créneau puis envoie sur Stripe Checkout. */
export function ReserveButton({
  resourceId,
  start,
  timezone,
  free,
  isAuthenticated,
  loginNext,
  onSlotLost,
}: Props) {
  const router = useRouter();
  const reserve = useReserve();
  // Reste vrai pendant le départ vers Stripe : le bouton ne redevient pas cliquable entre-temps.
  const [leaving, setLeaving] = useState(false);
  const busy = reserve.isPending || leaving;

  if (!isAuthenticated) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(loginNext)}`}
        className={buttonVariants({ className: 'h-11 w-full sm:w-auto' })}
      >
        <LogIn aria-hidden className="size-4" />
        Se connecter pour réserver
      </Link>
    );
  }

  function submit() {
    reserve.mutate(
      { resourceId, start },
      {
        onSuccess: ({ bookingId, checkoutUrl, checkoutError }) => {
          if (checkoutUrl) {
            setLeaving(true);
            window.location.assign(checkoutUrl);
            return;
          }
          // Gratuit (déjà confirmé), ou paiement à reprendre : la page de la réservation dit lequel.
          if (checkoutError) toast.error(errorMessage(checkoutError));
          setLeaving(true);
          router.push(`/bookings/${bookingId}/confirmation`);
        },
        onError: (error) => {
          toast.error(errorMessage(error));
          if (
            error instanceof ApiClientError &&
            (error.code === 'SLOT_UNAVAILABLE' || error.code === 'SLOT_NOT_OFFERED')
          ) {
            onSlotLost();
          }
        },
      },
    );
  }

  return (
    <div className="flex basis-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">
          {free
            ? 'Réservation gratuite, confirmée immédiatement.'
            : `Le créneau est bloqué ${HOLD_MINUTES} min, le temps de payer par carte.`}
        </p>
        {/* Les paliers du créneau choisi, avant de payer : un créneau proche rembourse moins. */}
        {!free && (
          <p className="text-muted-foreground text-sm">
            {refundPolicyFor({ start, rescheduledAt: null, timezone })}
          </p>
        )}
      </div>
      <Button className="h-11 w-full sm:w-auto" onClick={submit} disabled={busy}>
        {busy ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <CreditCard aria-hidden className="size-4" />
        )}
        {free ? 'Réserver' : 'Réserver et payer'}
      </Button>
    </div>
  );
}
