'use client';

import { ExternalLink, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Provider } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { UpcomingBookings } from '@/features/dashboard/components/upcoming-bookings';
import { WeekStats } from '@/features/dashboard/components/week-stats';
import { PaymentsCard, type StripeReturn } from '@/features/payments/components/payments-card';
import { formatDuration, formatPrice } from '@/lib/format';
import { useMyProvider, useMyResources } from '../api';
import { categoryLabels } from '../labels';
import { ProviderForm } from './provider-form';

export function ProviderDashboard({ stripeReturn }: { stripeReturn: StripeReturn }) {
  const provider = useMyProvider();

  if (provider.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <span className="sr-only">Chargement de votre espace…</span>
      </div>
    );
  }
  if (provider.isError) {
    return (
      <QueryError
        title="Impossible de charger votre profil"
        error={provider.error}
        onRetry={() => provider.refetch()}
      />
    );
  }
  if (!provider.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Créez votre profil prestataire</h2>
          </CardTitle>
          <CardDescription>
            Il présente votre établissement aux clients. Vous ajouterez ensuite vos ressources et
            leurs horaires.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderForm />
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <WeekStats />
      <UpcomingBookings />
      <ProfileCard provider={provider.data} />
      <PaymentsCard stripeReturn={stripeReturn} />
      <ResourcesCard />
    </>
  );
}

function ProfileCard({ provider }: { provider: Provider }) {
  const [editing, setEditing] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{provider.name}</h2>
        </CardTitle>
        <CardDescription>
          {categoryLabels[provider.category]} · {provider.address}, {provider.city}
        </CardDescription>
        <CardAction>
          <Button variant="outline" className="h-11" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Annuler' : 'Modifier'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing ? (
          <ProviderForm provider={provider} onSaved={() => setEditing(false)} />
        ) : (
          <>
            {provider.description && (
              <p className="text-muted-foreground whitespace-pre-line">{provider.description}</p>
            )}
            <Link
              href={`/providers/${provider.slug}`}
              className={buttonVariants({ variant: 'link', className: 'h-11 w-fit px-0' })}
            >
              Voir ma fiche publique
              <ExternalLink aria-hidden className="size-4" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ResourcesCard() {
  const resources = useMyResources();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Ressources</h2>
        </CardTitle>
        <CardDescription>
          Ce que vos clients réservent : une salle, un fauteuil, un terrain, une prestation.
        </CardDescription>
        <CardAction>
          <Link
            href="/dashboard/resources/new"
            aria-label="Nouvelle ressource"
            className={buttonVariants({ className: 'h-11' })}
          >
            <Plus aria-hidden className="size-4" />
            <span className="sm:hidden">Ajouter</span>
            <span className="hidden sm:inline">Nouvelle ressource</span>
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {resources.isPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">Chargement des ressources…</span>
          </div>
        ) : resources.isError ? (
          <QueryError
            title="Impossible de charger vos ressources"
            error={resources.error}
            onRetry={() => resources.refetch()}
          />
        ) : resources.data.items.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-muted-foreground">Vous n&apos;avez pas encore de ressource.</p>
            <Link
              href="/dashboard/resources/new"
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              Ajouter ma première ressource
            </Link>
          </div>
        ) : (
          <ul className="divide-y">
            {resources.data.items.map((resource) => (
              <li
                key={resource.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {resource.name}
                    <Badge variant={resource.isActive ? 'secondary' : 'outline'}>
                      {resource.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDuration(resource.slotMinutes)} ·{' '}
                    {formatPrice(resource.priceCents, resource.currency)}
                  </span>
                </div>
                <Link
                  href={`/dashboard/resources/${resource.id}`}
                  className={buttonVariants({ variant: 'outline', className: 'h-11' })}
                  aria-label={`Gérer ${resource.name}`}
                >
                  Gérer
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
