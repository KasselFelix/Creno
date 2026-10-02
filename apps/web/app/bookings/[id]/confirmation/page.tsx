import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { SiteHeader } from '@/components/site-header';
import { BookingConfirmation } from '@/features/bookings/components/booking-confirmation';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Votre réservation — Creno' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string }>;
};

/** Page de retour après Stripe Checkout (succès ou abandon), et page d'une réservation à payer. */
export default async function BookingConfirmationPage({ params, searchParams }: Props) {
  const [{ id }, { checkout }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  // proxy.ts redirige déjà ; ce contrôle reste la référence si le proxy est contourné ou mal configuré.
  if (!(await getCurrentUser())) redirect(`/login?next=/bookings/${id}/confirmation`);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10">
        {/* `checkout=success` ne prouve rien : il indique seulement qu'il faut attendre le webhook. */}
        <BookingConfirmation bookingId={id} paid={checkout === 'success'} />
      </main>
    </>
  );
}
