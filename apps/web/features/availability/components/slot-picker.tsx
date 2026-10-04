'use client';

import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';
import { BOOKING_HORIZON_DAYS, type Resource, type Slot } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReserveButton } from '@/features/bookings/components/reserve-button';
import {
  addDays,
  formatDuration,
  formatLocalDate,
  formatPrice,
  timeInZone,
  todayInZone,
} from '@/lib/format';
import { useSlots } from '../api';
import { WEEK, weekStartFor } from '../week';

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
  ...booking
}: { resources: Resource[]; initialResourceId?: string; initialDate?: string } & BookingContext) {
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
      />
    </div>
  );
}

function ResourceSlots({
  resource,
  booking,
  initialDate,
}: {
  resource: Resource;
  booking: BookingContext;
  initialDate?: string;
}) {
  const today = todayInZone(resource.timezone);
  // Date hors de la plage réservable (dans le fuseau de la ressource) : on part d'aujourd'hui.
  const initialWeek = initialDate ? weekStartFor(today, initialDate) : null;
  const [weekStart, setWeekStart] = useState(initialWeek ?? today);
  // `null` : aucun jour choisi à la main, on montre le premier jour qui a un créneau libre.
  const [pickedDate, setPickedDate] = useState<string | null>(
    initialWeek ? (initialDate ?? null) : null,
  );
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const slots = useSlots(resource.id, weekStart, addDays(weekStart, WEEK - 1));

  function showWeek(start: string) {
    setWeekStart(start);
    setPickedDate(null);
    setSelectedStart(null);
  }

  const days = slots.data?.days ?? [];
  const firstFreeDay = days.find((item) => item.slots.some((slot) => slot.available));
  const selectedDate = pickedDate ?? firstFreeDay?.date ?? weekStart;
  const day = days.find((item) => item.date === selectedDate);
  const selected = day?.slots.find((slot) => slot.start === selectedStart && slot.available);

  return (
    <section aria-labelledby="slots-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="slots-title" className="text-xl font-semibold tracking-tight">
          Choisissez un créneau
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="size-11"
            aria-label="Semaine précédente"
            disabled={weekStart <= today}
            onClick={() => showWeek(addDays(weekStart, -WEEK))}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-11"
            aria-label="Semaine suivante"
            disabled={addDays(weekStart, WEEK) > addDays(today, BOOKING_HORIZON_DAYS)}
            onClick={() => showWeek(addDays(weekStart, WEEK))}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      {slots.isPending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: WEEK }, (_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
          <span className="sr-only">Chargement des créneaux…</span>
        </div>
      ) : slots.isError ? (
        <QueryError
          title="Impossible de charger les créneaux"
          error={slots.error}
          onRetry={() => slots.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {days.map((item) => {
              const free = item.slots.filter((slot) => slot.available).length;
              return (
                <button
                  key={item.date}
                  type="button"
                  aria-pressed={item.date === selectedDate}
                  aria-label={`${formatLocalDate(item.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${free === 0 ? 'aucun créneau libre' : `${free} créneau${free > 1 ? 'x' : ''} libre${free > 1 ? 's' : ''}`}`}
                  onClick={() => {
                    setPickedDate(item.date);
                    setSelectedStart(null);
                  }}
                  className="hover:bg-muted focus-visible:ring-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground flex h-16 flex-col items-center justify-center rounded-lg border outline-none focus-visible:ring-3 aria-pressed:border-transparent"
                >
                  <span className="text-xs capitalize">
                    {formatLocalDate(item.date, { weekday: 'short' })}
                  </span>
                  <span className="font-semibold">
                    {formatLocalDate(item.date, { day: 'numeric' })}
                  </span>
                  <span aria-hidden className="text-xs opacity-80">
                    {free === 0 ? '–' : free}
                  </span>
                </button>
              );
            })}
          </div>

          <div aria-live="polite" className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              <span className="capitalize">
                {formatLocalDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>{' '}
              · heures affichées dans le fuseau {resource.timezone}
            </p>
            {!day || day.slots.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center">
                Aucun créneau ce jour. Essayez un autre jour de la semaine.
              </p>
            ) : (
              <SlotGrid
                slots={day.slots}
                timezone={resource.timezone}
                selectedStart={selected?.start ?? null}
                onSelect={setSelectedStart}
              />
            )}
          </div>
        </>
      )}

      {selected && (
        <Card className="sticky bottom-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{resource.name}</span>
              <span className="text-muted-foreground capitalize">
                {formatLocalDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}{' '}
                · {timeInZone(selected.start, resource.timezone)} –{' '}
                {timeInZone(selected.end, resource.timezone)}
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
                start={selected.start}
                free={resource.priceCents === 0}
                isAuthenticated={booking.isAuthenticated}
                loginNext={booking.providerPath}
                onSlotLost={() => setSelectedStart(null)}
              />
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function SlotGrid({
  slots,
  timezone,
  selectedStart,
  onSelect,
}: {
  slots: Slot[];
  timezone: string;
  selectedStart: string | null;
  onSelect: (start: string) => void;
}) {
  // Le jour du passage à l'heure d'hiver, une heure existe deux fois : on précise alors le décalage.
  const labels = slots.map((slot) => timeInZone(slot.start, timezone));
  const repeated = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));
  const offset = new Intl.DateTimeFormat('fr-FR', {
    timeZoneName: 'shortOffset',
    timeZone: timezone,
  });
  const offsetOf = (iso: string) =>
    offset.formatToParts(new Date(iso)).find((part) => part.type === 'timeZoneName')?.value ?? '';

  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {slots.map((slot, index) => {
        const label = repeated.has(labels[index]!)
          ? `${labels[index]} (${offsetOf(slot.start)})`
          : labels[index];
        return (
          <li key={slot.start}>
            {slot.available ? (
              <Button
                variant={slot.start === selectedStart ? 'default' : 'outline'}
                className="focus-visible:ring-ring h-11 w-full"
                aria-pressed={slot.start === selectedStart}
                onClick={() => onSelect(slot.start)}
              >
                {label}
              </Button>
            ) : (
              // Le statut n'est jamais porté par la couleur seule : le libellé « Pris » le dit.
              // `aria-disabled` plutôt que `disabled` : le créneau reste atteignable au clavier, et un
              // lecteur d'écran annonce qu'il existe mais qu'il est pris.
              <Button
                variant="outline"
                className="bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground h-11 w-full cursor-not-allowed flex-col gap-0 leading-tight active:translate-y-0!"
                aria-disabled="true"
                aria-label={`${label}, créneau déjà pris`}
              >
                <span className="line-through">{label}</span>
                <span className="text-xs">Pris</span>
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
