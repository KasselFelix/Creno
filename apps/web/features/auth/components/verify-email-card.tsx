'use client';

import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { useVerifyEmail } from '../api';

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/**
 * Le jeton arrive dans le fragment de l'URL (`#…`), que le navigateur n'envoie jamais au serveur :
 * il n'existe donc que côté client. `null` pendant le rendu serveur et l'hydratation.
 */
function useHashToken(): string | null {
  return useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1),
    () => null,
  );
}

export function VerifyEmailCard() {
  const token = useHashToken();
  const verify = useVerifyEmail();

  function confirm() {
    if (!token) return;
    verify.mutate(
      { token },
      {
        // Le jeton a servi : on le retire de la barre d'adresse et de l'historique.
        onSuccess: () => window.history.replaceState(null, '', window.location.pathname),
      },
    );
  }

  if (verify.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CircleCheck aria-hidden className="text-primary size-8" />
          <CardTitle>
            <h1>Adresse confirmée</h1>
          </CardTitle>
          <CardDescription role="status">
            Votre compte est créé. Connectez-vous avec le mot de passe choisi à l&apos;inscription.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/login" className={buttonVariants({ className: 'h-11 w-full' })}>
            Se connecter
          </Link>
        </CardFooter>
      </Card>
    );
  }

  const refused =
    verify.error instanceof ApiClientError &&
    (verify.error.code === 'VERIFICATION_LINK_INVALID' ||
      verify.error.code === 'VALIDATION_FAILED');
  if (token === '' || refused) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Lien invalide ou expiré</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>
              Ce lien de confirmation a déjà servi, a expiré, ou est incomplet. Si votre compte est
              déjà créé, connectez-vous ; sinon, recommencez l&apos;inscription pour recevoir un
              nouveau lien.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row">
          <Link href="/register" className={buttonVariants({ className: 'h-11 w-full sm:flex-1' })}>
            Recommencer l&apos;inscription
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ variant: 'outline', className: 'h-11 w-full sm:flex-1' })}
          >
            Se connecter
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Confirmez votre adresse</h1>
        </CardTitle>
        <CardDescription>Dernière étape pour créer votre compte Creno.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {verify.isError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{errorMessage(verify.error)}</AlertDescription>
          </Alert>
        )}
        {token === null ? (
          <Skeleton className="h-11 w-full" />
        ) : (
          <Button className="h-11 w-full" onClick={confirm} disabled={verify.isPending}>
            {verify.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Confirmer mon adresse
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
