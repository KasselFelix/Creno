'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ExceptionsPanel } from '@/features/availability/components/exceptions-panel';
import { WeeklyHoursForm } from '@/features/availability/components/weekly-hours-form';
import { useMyResources } from '@/features/providers/api';
import { ResourceForm } from './resource-form';

export function BackToDashboard() {
  return (
    <Link
      href="/dashboard"
      className={buttonVariants({ variant: 'ghost', className: 'h-11 w-fit px-2' })}
    >
      <ArrowLeft aria-hidden className="size-4" />
      Espace prestataire
    </Link>
  );
}

/** Gestion d'une ressource du prestataire connecté : informations, horaires, fermetures. */
export function ResourceEditor({ resourceId }: { resourceId: string }) {
  const resources = useMyResources();

  if (resources.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <span className="sr-only">Chargement de la ressource…</span>
      </div>
    );
  }
  if (resources.isError) {
    return (
      <QueryError
        title="Impossible de charger la ressource"
        error={resources.error}
        onRetry={() => resources.refetch()}
      />
    );
  }
  const resource = resources.data.items.find((item) => item.id === resourceId);
  if (!resource) {
    return (
      <Alert>
        <AlertTitle>Ressource introuvable</AlertTitle>
        <AlertDescription>
          Cette ressource n&apos;existe pas ou ne fait pas partie de votre établissement.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{resource.name}</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Informations</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResourceForm resource={resource} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Horaires hebdomadaires</h2>
          </CardTitle>
          <CardDescription>
            Les créneaux proposés aux clients sont découpés dans ces plages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WeeklyHoursForm resourceId={resource.id} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Fermetures exceptionnelles</h2>
          </CardTitle>
          <CardDescription>
            Congés, travaux, jour férié : aucun créneau n&apos;est proposé pendant une fermeture.
            Dates et heures dans le fuseau {resource.timezone}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExceptionsPanel resourceId={resource.id} timezone={resource.timezone} />
        </CardContent>
      </Card>
    </>
  );
}
