import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LoginForm } from '@/features/auth/components/login-form';
import { safeNextPath } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Connexion — Creno' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Connexion</h1>
            </CardTitle>
            <CardDescription>Accédez à vos réservations et à votre compte.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={safeNextPath(next)} />
          </CardContent>
          <CardFooter className="text-muted-foreground text-sm">
            <p>
              Pas encore de compte ?{' '}
              <Link
                href="/register"
                className="text-foreground font-medium underline underline-offset-4"
              >
                Créer un compte
              </Link>
            </p>
          </CardFooter>
        </Card>
      </main>
    </>
  );
}
