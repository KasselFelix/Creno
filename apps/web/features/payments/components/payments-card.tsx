'use client';

import { CircleCheck, Clock, CreditCard, LoaderCircle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ConnectStatus } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api/errors';
import { useConnectStatus, useRefreshConnectStatus, useStartOnboarding } from '../api';

/** `return` : le prestataire revient du formulaire Stripe ; `refresh` : son lien avait expiré. */
export type StripeReturn = 'return' | 'refresh' | null;

const percent = (feeBps: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 }).format(
    feeBps / 10_000,
  );

/** Carte « Paiements » de l'espace prestataire : état du compte Stripe Connect et action à mener. */
export function PaymentsCard({ stripeReturn }: { stripeReturn: StripeReturn }) {
  const router = useRouter();
  const status = useConnectStatus();
  const onboarding = useStartOnboarding();
  const { mutate: refresh, isPending: refreshing } = useRefreshConnectStatus();
  // Reste vrai pendant le départ vers Stripe : le bouton ne redevient pas cliquable entre-temps.
  const [leaving, setLeaving] = useState(false);
  const handledReturn = useRef(false);

  useEffect(() => {
    if (!stripeReturn || handledReturn.current) return;
    handledReturn.current = true;
    // L'adresse est nettoyée tout de suite : un rechargement ne rejoue pas le retour de Stripe.
    router.replace('/dashboard');
    if (stripeReturn === 'refresh') {
      toast.info('Le lien Stripe a expiré. Relancez la configuration des paiements.');
      return;
    }
    refresh(undefined, {
      onSuccess: (fresh) => {
        if (fresh.status === 'active') toast.success('Paiements activés.');
        else toast.info('Stripe vérifie vos informations. Les paiements seront activés ensuite.');
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }, [stripeReturn, refresh, router]);

  function startOnboarding() {
    onboarding.mutate(undefined, {
      onSuccess: ({ url }) => {
        setLeaving(true);
        window.location.assign(url);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  const busy = onboarding.isPending || leaving;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Paiements</h2>
        </CardTitle>
        <CardDescription>
          Vos clients paient par carte à la réservation. Les paiements sont gérés par Stripe, qui
          vous verse le prix moins la commission Creno.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status.isPending || refreshing ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-56" />
            <span className="sr-only">Chargement de l&apos;état des paiements…</span>
          </div>
        ) : status.isError ? (
          <QueryError
            title="Impossible de charger l'état des paiements"
            error={status.error}
            onRetry={() => status.refetch()}
          />
        ) : (
          <ConnectState
            status={status.data}
            busy={busy}
            onStart={startOnboarding}
            onCheck={() =>
              refresh(undefined, {
                onSuccess: (fresh) => {
                  if (fresh.status === 'active') toast.success('Paiements activés.');
                  else toast.info('Votre compte Stripe n’est pas encore validé.');
                },
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectState({
  status,
  busy,
  onStart,
  onCheck,
}: {
  status: ConnectStatus;
  busy: boolean;
  onStart: () => void;
  /** Relit l'état du compte chez Stripe, sans attendre son webhook. */
  onCheck: () => void;
}) {
  const action = (label: string) => (
    <Button className="h-11 w-full sm:w-fit" onClick={onStart} disabled={busy}>
      {busy ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : (
        <CreditCard aria-hidden className="size-4" />
      )}
      {label}
    </Button>
  );

  if (status.status === 'active') {
    return (
      <div className="flex flex-col items-start gap-2">
        <Badge variant="secondary">
          <CircleCheck aria-hidden />
          Paiements activés
        </Badge>
        <p className="text-muted-foreground">
          Vos ressources sont réservables en ligne. Commission Creno : {percent(status.feeBps)} du
          prix de chaque réservation.
        </p>
      </div>
    );
  }
  if (status.status === 'pending') {
    return (
      <div className="flex flex-col items-start gap-3">
        <Badge variant="outline">
          <Clock aria-hidden />
          {status.detailsSubmitted ? 'Vérification en cours' : 'Configuration à terminer'}
        </Badge>
        <p className="text-muted-foreground">
          {status.detailsSubmitted
            ? 'Stripe vérifie vos informations. Vos ressources payantes seront réservables dès que votre compte sera validé.'
            : "Il manque des informations à Stripe pour vous verser l'argent. Vos ressources payantes ne sont pas encore réservables."}
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {action(
            status.detailsSubmitted ? 'Compléter mes informations' : 'Reprendre la configuration',
          )}
          <Button variant="outline" className="h-11" onClick={onCheck} disabled={busy}>
            <RefreshCw aria-hidden className="size-4" />
            Vérifier à nouveau
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground">
        Tant que les paiements ne sont pas activés, vos ressources payantes ne sont pas réservables.
        Stripe vous demandera votre identité et un IBAN (environ 5 minutes). Commission Creno :{' '}
        {percent(status.feeBps)} du prix de chaque réservation.
      </p>
      {action('Activer les paiements')}
    </div>
  );
}
