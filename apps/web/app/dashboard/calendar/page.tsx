import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CalendarView } from '@/features/dashboard/components/calendar-view';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Calendrier — Creno' };

export default async function DashboardCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string }>;
}) {
  const { resource } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard/calendar');
  if (user.role !== 'provider') redirect('/account');

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Calendrier</h1>
      <CalendarView initialResourceId={resource} />
    </>
  );
}
