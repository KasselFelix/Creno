import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BookingsTable } from '@/features/dashboard/components/bookings-table';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Réservations — Creno' };

export default async function DashboardBookingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard/bookings');
  if (user.role !== 'provider') redirect('/account');

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Réservations</h1>
      <BookingsTable />
    </>
  );
}
