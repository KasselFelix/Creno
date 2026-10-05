'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ProviderStats } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyResources } from '@/features/providers/api';
import { addDays, formatDuration, formatLocalDate, formatPrice, todayInZone } from '@/lib/format';
import { useWeekStats } from '../api';
import { mondayOf } from '../calendar';

const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const formatOccupancy = (value: number | null) => (value === null ? '—' : percent.format(value));
const hours = (minutes: number) => (minutes === 0 ? '0 h' : formatDuration(minutes));

/** Occupation et chiffre d'affaires d'une semaine, au total et par ressource. */
export function WeekStats() {
  const resources = useMyResources();
  const [picked, setPicked] = useState<string | null>(null);
  // Semaine courante dans le fuseau de la première ressource (celui où le prestataire travaille).
  const timezone =
    resources.data?.items[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const thisWeek = resources.data ? mondayOf(todayInZone(timezone)) : null;
  const weekStart = picked ?? thisWeek;
  const stats = useWeekStats(weekStart);

  return (
    <section aria-labelledby="week-stats-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="week-stats-title" className="text-xl font-semibold tracking-tight">
          {weekStart
            ? `Semaine du ${formatLocalDate(weekStart, { day: 'numeric', month: 'long' })}`
            : 'Cette semaine'}
        </h2>
        {weekStart && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              className="size-11"
              aria-label="Semaine précédente"
              onClick={() => setPicked(addDays(weekStart, -7))}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={weekStart === thisWeek}
              onClick={() => setPicked(null)}
            >
              Cette semaine
            </Button>
            <Button
              variant="outline"
              className="size-11"
              aria-label="Semaine suivante"
              onClick={() => setPicked(addDays(weekStart, 7))}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {resources.isError || stats.isError ? (
        <QueryError
          title="Impossible de charger les statistiques"
          error={resources.error ?? stats.error}
          onRetry={() => (resources.isError ? resources.refetch() : stats.refetch())}
        />
      ) : resources.data && resources.data.items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <p>Créez d&apos;abord une ressource : son occupation s&apos;affichera ici.</p>
          <Link
            href="/dashboard/resources/new"
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            Ajouter une ressource
          </Link>
        </div>
      ) : !stats.data ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-32 rounded-xl" />
          <span className="sr-only">Chargement des statistiques…</span>
        </div>
      ) : (
        <StatsContent stats={stats.data} />
      )}
    </section>
  );
}

function StatsContent({ stats }: { stats: ProviderStats }) {
  const { totals } = stats;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi
          title="Occupation"
          value={formatOccupancy(totals.occupancy)}
          detail={`${hours(totals.bookedMinutes)} réservées sur ${hours(totals.openMinutes)} ouvertes`}
        />
        <Kpi
          title="Chiffre d'affaires"
          value={formatPrice(totals.revenueCents, stats.currency)}
          detail="Montant brut des réservations confirmées"
        />
        <Kpi
          title="Réservations confirmées"
          value={String(totals.confirmedCount)}
          detail="Qui commencent cette semaine"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Occupation par ressource</h3>
          </CardTitle>
          <CardDescription>
            Part des heures d&apos;ouverture réservées (horaires moins fermetures), passé et à venir
            de la semaine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-4">
            {stats.resources.map((resource) => (
              <li key={resource.resourceId} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    {resource.name}
                    {!resource.isActive && <Badge variant="outline">Désactivée</Badge>}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {formatOccupancy(resource.occupancy)} · {hours(resource.bookedMinutes)} /{' '}
                    {hours(resource.openMinutes)} ·{' '}
                    {formatPrice(resource.revenueCents, stats.currency)}
                  </span>
                </div>
                <Progress
                  value={resource.occupancy === null ? 0 : Math.round(resource.occupancy * 100)}
                  aria-label={`Occupation de ${resource.name} : ${formatOccupancy(resource.occupancy)}`}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function Kpi({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{detail}</p>
      </CardContent>
    </Card>
  );
}
