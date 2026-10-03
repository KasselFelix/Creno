import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { RegisterCard } from '@/features/auth/components/register-card';
import { getCurrentUser } from '@/lib/api/server';
import { DEFAULT_AFTER_LOGIN } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Créer un compte — Creno' };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect(DEFAULT_AFTER_LOGIN);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
        <RegisterCard />
      </main>
    </>
  );
}
