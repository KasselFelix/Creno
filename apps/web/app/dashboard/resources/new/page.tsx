import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BackToDashboard } from '@/features/resources/components/resource-editor';
import { ResourceForm } from '@/features/resources/components/resource-form';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Nouvelle ressource — Creno' };

export default async function NewResourcePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard/resources/new');
  if (user.role !== 'provider') redirect('/account');

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <BackToDashboard />
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Nouvelle ressource</h1>
            </CardTitle>
            <CardDescription>
              Vous définirez ses horaires juste après l&apos;avoir créée.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResourceForm />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
