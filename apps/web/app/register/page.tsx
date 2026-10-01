import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RegisterForm } from '@/features/auth/components/register-form';
import { getCurrentUser } from '@/lib/api/server';
import { DEFAULT_AFTER_LOGIN } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Créer un compte — Creno' };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect(DEFAULT_AFTER_LOGIN);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Créer un compte</h1>
            </CardTitle>
            <CardDescription>Gratuit, en moins d&apos;une minute.</CardDescription>
          </CardHeader>
          <CardContent>
            <RegisterForm />
          </CardContent>
          <CardFooter className="text-muted-foreground text-sm">
            <p>
              Déjà inscrit ?{' '}
              <Link
                href="/login"
                className="text-foreground font-medium underline underline-offset-4"
              >
                Se connecter
              </Link>
            </p>
          </CardFooter>
        </Card>
      </main>
    </>
  );
}
