'use client';

import { CircleCheck, CircleSlash, Clock, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import type { BookingDetail } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBooking } from '../api';
import { isPayable } from '../status';
import { BookingSummary } from './booking-summary';
import { CancelBookingDialog } from './cancel-booking-dialog';
import { ResumeCheckoutButton } from './resume-checkout-button';

/** Durée pendant laquelle on attend la confirmation du paiement avant de proposer d'actualiser. */
const CONFIRMATION_WAIT_MS = 30_000;

interface Props {
  bookingId: string;
  /** Vrai au retour de Stripe après un paiement : la confirmation peut mettre quelques secondes. */
  paid: boolean;
}

/**
 * Page de retour après Stripe. Le navigateur ne « sait » pas si le paiement a réussi : il demande
 * l'état de la réservation à l'API, qui ne la confirme qu'à la réception du webhook Stripe.
 */
export function BookingConfirmation({ bookingId, paid }: Props) {
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const awaitingPayment = (booking: BookingDetail) => paid && booking.status === 'pending';
  const booking = useBooking(bookingId, (data) => awaitingPayment(data) && !waitedTooLong);
  const waiting = booking.data ? awaitingPayment(booking.data) : false;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setWaitedTooLong(true), CONFIRMATION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (booking.isPending) {
    return (
      <div role="status" aria-busy="true">
        <Skeleton className="h-72 w-full rounded-xl" />
        <span className="sr-only">Chargement de votre réservation…</span>
      </div>
    );
  }
  if (booking.isError) {
    return (
      <QueryError
        title="Impossible de charger cette réservation"
        error={booking.error}
        onRetry={() => booking.refetch()}
      />
    );
  }

  const data = booking.data;
  const view = viewOf(data, waiting, waitedTooLong);
  const backToProvider = (
    <Link
      href={`/providers/${data.providerSlug}`}
      className={buttonVariants({ variant: 'outline', className: 'h-11' })}
    >
      Choisir un autre créneau
    </Link>
  );

  return (
    <Card>
      <CardHeader>
        <div className="text-muted-foreground mb-2">{view.icon}</div>
        <CardTitle>
          {/* `aria-live` : le passage de « en cours » à « confirmée » est annoncé sans rechargement. */}
          <h1 aria-live="polite" className="text-2xl font-semibold tracking-tight">
            {view.title}
          </h1>
        </CardTitle>
        <CardDescription>{view.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <BookingSummary booking={data} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {waiting && waitedTooLong && (
          <Button
            className="h-11"
            onClick={() => {
              setWaitedTooLong(false);
              void booking.refetch();
            }}
          >
            Actualiser
          </Button>
        )}
        {!waiting && isPayable(data) && <ResumeCheckoutButton bookingId={data.id} />}
        {!waiting && data.cancellableUntil && <CancelBookingDialog booking={data} />}
        {!view.open && backToProvider}
        <Link href="/bookings" className={buttonVariants({ variant: 'ghost', className: 'h-11' })}>
          Mes réservations
        </Link>
      </CardFooter>
    </Card>
  );
}

interface View {
  icon: ReactNode;
  title: string;
  description: string;
  /** La réservation est encore en cours (payable, en attente ou confirmée). */
  open: boolean;
}

/** Heure locale du visiteur : l'échéance du hold le concerne lui, pas le fuseau de la ressource. */
const localTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function viewOf(booking: BookingDetail, waiting: boolean, waitedTooLong: boolean): View {
  const refund =
    booking.paymentStatus === 'refunded'
      ? ' Votre paiement a été remboursé.'
      : booking.paymentStatus === 'succeeded'
        ? ' Votre paiement est en cours de remboursement (5 à 10 jours selon votre banque).'
        : '';

  if (waiting) {
    return {
      icon: <LoaderCircle aria-hidden className="size-8 animate-spin" />,
      title: 'Paiement en cours de validation…',
      description: waitedTooLong
        ? 'La confirmation prend plus de temps que prévu. Votre paiement est bien parti : actualisez dans un instant, ou retrouvez cette réservation dans « Mes réservations ».'
        : 'Nous attendons la confirmation de Stripe. Cela prend quelques secondes, ne fermez pas cette page.',
      open: true,
    };
  }
  switch (booking.status) {
    case 'confirmed':
      return {
        icon: <CircleCheck aria-hidden className="text-primary size-8" />,
        title: 'Réservation confirmée',
        description:
          booking.priceCents === 0
            ? 'Votre créneau est réservé.'
            : 'Votre paiement est accepté et votre créneau est réservé.',
        open: true,
      };
    case 'pending':
      return isPayable(booking) && booking.expiresAt
        ? {
            icon: <Clock aria-hidden className="size-8" />,
            title: 'Paiement en attente',
            description: `Votre créneau est bloqué jusqu'à ${localTime.format(new Date(booking.expiresAt))}. Sans paiement d'ici là, il sera remis à disposition.`,
            open: true,
          }
        : {
            icon: <CircleSlash aria-hidden className="size-8" />,
            title: 'Délai de paiement dépassé',
            description: "Le créneau n'est plus bloqué. Vous n'avez pas été débité.",
            open: false,
          };
    case 'cancelled':
      return {
        icon: <CircleSlash aria-hidden className="size-8" />,
        title: 'Réservation annulée',
        description: `Cette réservation a été annulée.${refund}`,
        open: false,
      };
    case 'expired':
      return {
        icon: <CircleSlash aria-hidden className="size-8" />,
        title: booking.paymentStatus ? 'Créneau perdu' : 'Réservation expirée',
        description: booking.paymentStatus
          ? `Votre paiement est arrivé après la fin du délai, et le créneau avait été repris.${refund}`
          : "Le délai de paiement est dépassé. Vous n'avez pas été débité.",
        open: false,
      };
  }
}
