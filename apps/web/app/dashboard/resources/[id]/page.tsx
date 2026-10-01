import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { BackToDashboard, ResourceEditor } from '@/features/resources/components/resource-editor';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Gérer une ressource — Creno' };

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/dashboard/resources/${id}`);
  if (user.role !== 'provider') redirect('/account');

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <BackToDashboard />
        <ResourceEditor resourceId={id} />
      </main>
    </>
  );
}
