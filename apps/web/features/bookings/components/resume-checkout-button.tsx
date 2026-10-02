'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import { bookingKeys, useResumeCheckout } from '../api';

/** Renvoie le client sur la page de paiement Stripe de son hold. */
export function ResumeCheckoutButton({ bookingId }: { bookingId: string }) {
  const resume = useResumeCheckout();
  const queryClient = useQueryClient();
  // Reste vrai pendant le départ vers Stripe : le bouton ne redevient pas cliquable entre-temps.
  const [leaving, setLeaving] = useState(false);
  const busy = resume.isPending || leaving;

  function pay() {
    resume.mutate(bookingId, {
      onSuccess: ({ checkoutUrl }) => {
        if (checkoutUrl) {
          setLeaving(true);
          window.location.assign(checkoutUrl);
          return;
        }
        // Réservation gratuite : elle vient d'être confirmée.
        void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      },
      onError: (error) => {
        toast.error(errorMessage(error));
        void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      },
    });
  }

  return (
    <Button className="h-11" onClick={pay} disabled={busy}>
      {busy ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : (
        <CreditCard aria-hidden className="size-4" />
      )}
      Payer maintenant
    </Button>
  );
}
