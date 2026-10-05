'use client';

import type { CalendarOptions } from '@fullcalendar/react';
import frLocale from '@fullcalendar/react/locales/fr';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { AvailabilityException, ProviderBooking, Resource } from '@creno/shared';
import { EventCalendar } from '@/components/event-calendar';
import { QueryError } from '@/components/query-error';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateException,
  useDeleteException,
  useExceptions,
  useRules,
  useSlots,
} from '@/features/availability/api';
import { errorMessage } from '@/lib/api/errors';
import { addDays, dateTimeInZone, timeInZone } from '@/lib/format';
import { useMediaQuery } from '@/lib/use-media-query';
import { useCalendarBookings, useRescheduleBooking } from '../api';
import {
  businessHoursOf,
  type CalendarItem,
  calendarEvents,
  earliestStart,
  overlappingBookings,
  snapMinutes,
  wallTimeOf,
} from '../calendar';
import { customerLabel } from '../format';
import { RESCHEDULED_TOAST } from './booking-actions';
import { BookingDetailsSheet } from './booking-details-sheet';

type DropInfo = Parameters<NonNullable<CalendarOptions['eventDrop']>>[0];
type SelectInfo = Parameters<NonNullable<CalendarOptions['select']>>[0];
type DatesSetInfo = Parameters<NonNullable<CalendarOptions['datesSet']>>[0];

/** Plage affichée, en instants (requête du calendrier) et en dates locales (créneaux). */
interface VisibleRange {
  from: string;
  to: string;
  fromDate: string;
  toDate: string;
}

/** « mar. 20 oct. 2026, 10:00 – 11:00 » à partir de deux dates FullCalendar (avec décalage). */
const locales = [frLocale];
const desktopViews = ['timeGridWeek', 'timeGridDay'];
const mobileViews = ['timeGridDay', 'timeGridWeek'];

const rangeLabel = (startStr: string, endStr: string, timezone: string) =>
  `${dateTimeInZone(startStr, timezone)} – ${timeInZone(endStr, timezone)}`;

/**
 * Semaine (ou journée sur mobile) d'une ressource : réservations, holds et fermetures.
 * - Glisser une réservation la déplace, après confirmation ; l'API reste l'arbitre (409/422).
 * - Sélectionner une plage future la bloque (fermeture).
 * Chargé côté client uniquement (FullCalendar manipule le DOM).
 */
export default function ProviderCalendar({ resource }: { resource: Resource }) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [drop, setDrop] = useState<DropInfo | null>(null);
  const [selection, setSelection] = useState<SelectInfo | null>(null);
  const [reason, setReason] = useState('');
  const [opened, setOpened] = useState<CalendarItem | null>(null);

  const calendar = useCalendarBookings(resource.id, range && { from: range.from, to: range.to });
  const rules = useRules(resource.id);
  const exceptions = useExceptions(resource.id);
  const slots = useSlots(resource.id, range?.fromDate ?? '', range?.toDate ?? '', {
    enabled: range !== null,
  });
  const reschedule = useRescheduleBooking();
  const createException = useCreateException(resource.id);

  const bookings = useMemo(() => calendar.data?.items ?? [], [calendar.data]);
  const events = useMemo(
    () => calendarEvents(bookings, exceptions.data?.items ?? []),
    [bookings, exceptions.data],
  );
  // Débuts des créneaux libres : seule cible acceptée pendant un glisser-déposer.
  const freeStarts = useMemo(
    () =>
      new Set(
        (slots.data?.days ?? []).flatMap((day) =>
          day.slots.filter((slot) => slot.available).map((slot) => Date.parse(slot.start)),
        ),
      ),
    [slots.data],
  );
  const ruleList = useMemo(() => rules.data?.rules ?? [], [rules.data]);
  // Options stables : FullCalendar se reconfigure (et rappelle `datesSet`) quand une option change.
  const businessHours = useMemo(() => businessHoursOf(ruleList), [ruleList]);
  const snapDuration = useMemo(
    () => ({ minutes: snapMinutes(resource.slotMinutes, ruleList) }),
    [resource.slotMinutes, ruleList],
  );
  const scrollTime = useMemo(() => earliestStart(ruleList), [ruleList]);
  const onDatesSet = useCallback((info: DatesSetInfo) => {
    const next = {
      from: new Date(info.startStr).toISOString(),
      to: new Date(info.endStr).toISOString(),
      fromDate: info.startStr.slice(0, 10),
      // `endStr` est exclusif : le dernier jour affiché est la veille.
      toDate: addDays(info.endStr.slice(0, 10), -1),
    };
    // FullCalendar appelle `datesSet` pendant son propre rendu : la mise à jour est reportée, et
    // ignorée si la plage n'a pas changé (sinon chaque rendu en déclencherait un autre).
    queueMicrotask(() =>
      setRange((previous) =>
        previous?.from === next.from && previous.to === next.to ? previous : next,
      ),
    );
  }, []);

  if (rules.isError || exceptions.isError || calendar.isError) {
    return (
      <QueryError
        title="Impossible de charger le calendrier"
        error={rules.error ?? exceptions.error ?? calendar.error}
        onRetry={() => {
          void rules.refetch();
          void exceptions.refetch();
          void calendar.refetch();
        }}
      />
    );
  }

  function confirmDrop() {
    if (!drop) return;
    const info = drop;
    const booking = (info.event.extendedProps.item as CalendarItem & { type: 'booking' }).booking;
    setDrop(null);
    reschedule.mutate(
      {
        bookingId: booking.id,
        resourceId: resource.id,
        // `startStr` porte le décalage du fuseau de la ressource : c'est un instant sans ambiguïté.
        start: new Date(info.event.startStr).toISOString(),
      },
      {
        onSuccess: () => toast.success(RESCHEDULED_TOAST),
        onError: (error) => {
          info.revert();
          toast.error(errorMessage(error));
        },
      },
    );
  }

  function cancelDrop() {
    drop?.revert();
    setDrop(null);
  }

  function closeSelection() {
    selection?.view.calendar.unselect();
    setSelection(null);
    setReason('');
  }

  function confirmBlock() {
    if (!selection) return;
    const overlapping = overlappingBookings(
      bookings,
      new Date(selection.startStr),
      new Date(selection.endStr),
    );
    createException.mutate(
      {
        startLocal: wallTimeOf(selection.startStr),
        endLocal: wallTimeOf(selection.endStr),
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          closeSelection();
          toast.success(
            overlapping === 0
              ? 'Créneau bloqué.'
              : `Créneau bloqué. ${overlapping} réservation${overlapping > 1 ? 's' : ''} existante${overlapping > 1 ? 's restent' : ' reste'} maintenue${overlapping > 1 ? 's' : ''} : annulez-la${overlapping > 1 ? 's' : ''} si besoin.`,
          );
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  const dropped =
    drop && (drop.event.extendedProps.item as CalendarItem & { type: 'booking' }).booking;

  return (
    <>
      <EventCalendar
        // Changer de vue par défaut (desktop ↔ mobile) demande de recréer le calendrier.
        key={isDesktop ? 'week' : 'day'}
        availableViews={isDesktop ? desktopViews : mobileViews}
        locales={locales}
        locale="fr"
        timeZone={resource.timezone}
        height={isDesktop ? 720 : 600}
        allDaySlot={false}
        nowIndicator
        // Journée entière : une réservation hors des horaires actuels reste visible.
        scrollTime={scrollTime}
        businessHours={businessHours}
        snapDuration={snapDuration}
        events={events}
        editable
        eventDurationEditable={false}
        eventAllow={(span) => freeStarts.has(Date.parse(span.startStr))}
        eventDrop={setDrop}
        selectable
        selectMirror
        selectAllow={(span) => Date.parse(span.startStr) > Date.now()}
        select={setSelection}
        eventClick={(info) => setOpened(info.event.extendedProps.item as CalendarItem)}
        datesSet={onDatesSet}
      />

      <AlertDialog open={drop !== null} onOpenChange={(open) => !open && cancelDrop()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Déplacer cette réservation ?</AlertDialogTitle>
            <AlertDialogDescription>
              {dropped && drop
                ? `${customerLabel(dropped)} : au ${rangeLabel(drop.event.startStr, drop.event.endStr, resource.timezone)}. Le client sera prévenu par email.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Laisser en place</AlertDialogCancel>
            <Button className="h-11" onClick={confirmDrop}>
              Déplacer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={selection !== null} onOpenChange={(open) => !open && closeSelection()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquer ce créneau</DialogTitle>
            <DialogDescription>
              {selection
                ? `${rangeLabel(selection.startStr, selection.endStr, resource.timezone)}. Plus aucun client ne pourra réserver sur cette plage ; les réservations existantes ne sont pas annulées.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-reason">Motif (facultatif)</Label>
            <Input
              id="block-reason"
              className="h-11"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={closeSelection}>
              Annuler
            </Button>
            <Button className="h-11" onClick={confirmBlock} disabled={createException.isPending}>
              {createException.isPending && (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              )}
              Bloquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {opened?.type === 'booking' && (
        <BookingDetailsSheet
          booking={findBooking(bookings, opened.booking)}
          onClose={() => setOpened(null)}
        />
      )}
      {opened?.type === 'closure' && (
        <DeleteClosureDialog
          resourceId={resource.id}
          timezone={resource.timezone}
          closure={opened.closure}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}

/** Version à jour de la réservation ouverte (elle a pu être déplacée ou annulée depuis le clic). */
function findBooking(bookings: ProviderBooking[], opened: ProviderBooking): ProviderBooking {
  return bookings.find((booking) => booking.id === opened.id) ?? opened;
}

function DeleteClosureDialog({
  resourceId,
  timezone,
  closure,
  onClose,
}: {
  resourceId: string;
  timezone: string;
  closure: AvailabilityException;
  onClose: () => void;
}) {
  const remove = useDeleteException(resourceId);

  function confirm() {
    remove.mutate(closure.id, {
      onSuccess: () => {
        onClose();
        toast.success('Fermeture supprimée : la plage est de nouveau réservable.');
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer cette fermeture ?</AlertDialogTitle>
          <AlertDialogDescription>
            {rangeLabel(closure.start, closure.end, timezone)}
            {closure.reason ? ` · ${closure.reason}` : ''}. La plage redeviendra réservable.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" disabled={remove.isPending}>
            Garder la fermeture
          </AlertDialogCancel>
          <Button
            variant="destructive"
            className="h-11"
            onClick={confirm}
            disabled={remove.isPending}
          >
            {remove.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Supprimer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
