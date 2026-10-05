import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BackToDashboard, ResourceEditor } from '@/features/resources/components/resource-editor';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Gérer une ressource — Creno' };

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/dashboard/resources/${id}`);
  if (user.role !== 'provider') redirect('/account');

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <BackToDashboard />
      <ResourceEditor resourceId={id} />
    </div>
  );
}
