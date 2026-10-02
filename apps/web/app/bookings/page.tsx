import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { MyBookings } from '@/features/bookings/components/my-bookings';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Mes réservations — Creno' };

export default async function BookingsPage() {
  // proxy.ts redirige déjà ; ce contrôle reste la référence si le proxy est contourné ou mal configuré.
  if (!(await getCurrentUser())) redirect('/login?next=/bookings');

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Mes réservations</h1>
        <MyBookings />
      </main>
    </>
  );
}
