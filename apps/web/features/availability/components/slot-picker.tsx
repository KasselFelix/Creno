'use client';

import { Info } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Resource, Slot, TimeRange } from '@creno/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { ReserveButton } from '@/features/bookings/components/reserve-button';
import { formatDuration, formatLocalDate, formatPrice, timeInZone } from '@/lib/format';
import { SlotChooser } from './slot-chooser';

/** Ce qu'il faut pour réserver : la session du visiteur, et la capacité du prestataire à encaisser. */
interface BookingContext {
  isAuthenticated: boolean;
  /** Le compte Stripe du prestataire est actif. */
  onlinePayment: boolean;
  /** Chemin de la fiche, pour y revenir après connexion. */
  providerPath: string;
}

/**
 * Sélecteur de ressource, de jour et de créneau de la fiche publique d'un prestataire.
 * `initialResourceId` et `initialDate` viennent d'un résultat de recherche (« disponible le ») :
 * la fiche s'ouvre sur cette ressource et ce jour. Invalides, ils sont ignorés.
 */
export function SlotPicker({
  resources,
  initialResourceId,
  initialDate,
  timeRange,
  ...booking
}: {
  resources: Resource[];
  initialResourceId?: string;
  initialDate?: string;
  /** Plage horaire cherchée, mise en évidence sur tous les jours et toutes les ressources. */
  timeRange?: TimeRange;
} & BookingContext) {
  const initial = resources.find((item) => item.id === initialResourceId) ?? resources[0]!;
  const [resourceId, setResourceId] = useState(initial.id);
  const resource = resources.find((item) => item.id === resourceId) ?? resources[0]!;

  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="Ressource" className="grid gap-3 sm:grid-cols-2">
        {resources.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={item.id === resource.id}
            onClick={() => setResourceId(item.id)}
            className="bg-card hover:bg-muted/50 focus-visible:ring-ring aria-checked:border-primary aria-checked:ring-primary flex min-h-11 flex-col gap-1 rounded-lg border p-3 text-left outline-none focus-visible:ring-3 aria-checked:ring-1"
          >
            <span className="font-medium">{item.name}</span>
            <span className="text-muted-foreground text-sm">
              {formatDuration(item.slotMinutes)} · {formatPrice(item.priceCents, item.currency)}
            </span>
            {item.description && (
              <span className="text-muted-foreground text-sm">{item.description}</span>
            )}
          </button>
        ))}
      </div>
      {/* `key` : changer de ressource repart d'aujourd'hui, dans le fuseau de cette ressource. */}
      <ResourceSlots
        key={resource.id}
        resource={resource}
        booking={booking}
        initialDate={resource.id === initial.id ? initialDate : undefined}
        timeRange={timeRange}
      />
    </div>
  );
}

function ResourceSlots({
  resource,
  booking,
  initialDate,
  timeRange,
}: {
  resource: Resource;
  booking: BookingContext;
  initialDate?: string;
  timeRange?: TimeRange;
}) {
  const [selected, setSelected] = useState<{ slot: Slot; date: string } | null>(null);
  const select = useCallback(
    (slot: Slot | null, date: string) => setSelected(slot ? { slot, date } : null),
    [],
  );

  return (
    <section aria-labelledby="slots-title" className="flex flex-col gap-4">
      <SlotChooser
        resource={resource}
        initialDate={initialDate}
        timeRange={timeRange}
        titleId="slots-title"
        title="Choisissez un créneau"
        selectedStart={selected?.slot.start ?? null}
        onSelect={select}
      />

      {selected && (
        <Card className="sticky bottom-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{resource.name}</span>
              <span className="text-muted-foreground first-letter:uppercase">
                {formatLocalDate(selected.date, { weekday: 'long', day: 'numeric', month: 'long' })}{' '}
                · {timeInZone(selected.slot.start, resource.timezone)} –{' '}
                {timeInZone(selected.slot.end, resource.timezone)}
              </span>
            </div>
            <span className="text-lg font-semibold">
              {formatPrice(resource.priceCents, resource.currency)}
            </span>
            {resource.priceCents > 0 && !booking.onlinePayment ? (
              <Alert className="basis-full">
                <Info aria-hidden />
                <AlertDescription>
                  La réservation en ligne n&apos;est pas encore ouverte chez ce prestataire.
                </AlertDescription>
              </Alert>
            ) : (
              <ReserveButton
                resourceId={resource.id}
                start={selected.slot.start}
                timezone={resource.timezone}
                free={resource.priceCents === 0}
                isAuthenticated={booking.isAuthenticated}
                loginNext={booking.providerPath}
                onSlotLost={() => setSelected(null)}
              />
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
