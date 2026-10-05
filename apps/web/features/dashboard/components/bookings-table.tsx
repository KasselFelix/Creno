'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ProviderBookingsQuery } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/features/bookings/components/booking-status-badge';
import { RescheduledBadge } from '@/features/bookings/components/rescheduled-badge';
import { providerBookingStatusView } from '@/features/bookings/status';
import { useMyResources } from '@/features/providers/api';
import { formatPrice } from '@/lib/format';
import { useProviderBookings } from '../api';
import { slotLabel } from '../format';
import { BookingActions } from './booking-actions';

type Scope = ProviderBookingsQuery['scope'];
type StatusFilter = NonNullable<ProviderBookingsQuery['status']>;

const ALL = 'all';
const PAGE_SIZE = 20;
const statusItems = [
  { value: ALL, label: 'Tous les statuts' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'pending', label: 'Paiement en cours' },
  { value: 'cancelled', label: 'Annulées' },
];

/** Réservations du prestataire : à venir ou passées, filtrables par ressource et par statut. */
export function BookingsTable() {
  const [scope, setScope] = useState<Scope>('upcoming');
  const [status, setStatus] = useState<StatusFilter | undefined>();
  const [resourceId, setResourceId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const resources = useMyResources();
  const bookings = useProviderBookings({ scope, status, resourceId, page, pageSize: PAGE_SIZE });

  const resourceItems = [
    { value: ALL, label: 'Toutes les ressources' },
    ...(resources.data?.items ?? []).map((resource) => ({
      value: resource.id,
      label: resource.name,
    })),
  ];
  const pages = bookings.data ? Math.max(1, Math.ceil(bookings.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={scope}
        onValueChange={(value) => {
          setScope(value as Scope);
          setPage(1);
        }}
      >
        <TabsList className="h-13! w-full sm:w-80">
          <TabsTrigger value="upcoming">À venir</TabsTrigger>
          <TabsTrigger value="past">Passées</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bookings-resource">Ressource</Label>
          <Select
            items={resourceItems}
            value={resourceId ?? ALL}
            onValueChange={(value) => {
              setResourceId(value === ALL ? undefined : (value as string));
              setPage(1);
            }}
          >
            <SelectTrigger id="bookings-resource" className="h-11! w-full md:h-9!">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resourceItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bookings-status">Statut</Label>
          <Select
            items={statusItems}
            value={status ?? ALL}
            onValueChange={(value) => {
              setStatus(value === ALL ? undefined : (value as StatusFilter));
              setPage(1);
            }}
          >
            <SelectTrigger id="bookings-status" className="h-11! w-full md:h-9!">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <section aria-label={scope === 'upcoming' ? 'Réservations à venir' : 'Réservations passées'}>
        {bookings.isPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
            <span className="sr-only">Chargement des réservations…</span>
          </div>
        ) : bookings.isError ? (
          <QueryError
            title="Impossible de charger vos réservations"
            error={bookings.error}
            onRetry={() => bookings.refetch()}
          />
        ) : bookings.data.items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center">
            {scope === 'upcoming'
              ? 'Aucune réservation à venir avec ces filtres.'
              : 'Aucune réservation passée avec ces filtres.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Sous 768 px, des cartes : un tableau de six colonnes cacherait les actions. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {bookings.data.items.map((booking) => (
                <li key={booking.id} className="flex flex-col gap-3 rounded-lg border p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge view={providerBookingStatusView(booking)} />
                    {booking.rescheduledAt && booking.status === 'confirmed' && (
                      <RescheduledBadge label="Déplacée" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium first-letter:uppercase">{slotLabel(booking)}</span>
                    <span className="text-muted-foreground">
                      {booking.resourceName} · {formatPrice(booking.priceCents, booking.currency)}
                    </span>
                    {booking.customer ? (
                      <span className="min-w-0 break-all">
                        {booking.customer.fullName} ·{' '}
                        <a
                          href={`mailto:${booking.customer.email}`}
                          className="text-muted-foreground underline-offset-4 hover:underline"
                        >
                          {booking.customer.email}
                        </a>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Paiement en cours</span>
                    )}
                  </div>
                  <BookingActions booking={booking} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créneau</TableHead>
                    <TableHead>Ressource</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.data.items.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell className="font-medium first-letter:uppercase">
                        {slotLabel(booking)}
                      </TableCell>
                      <TableCell>{booking.resourceName}</TableCell>
                      <TableCell>
                        {booking.customer ? (
                          <div className="flex flex-col">
                            <span>{booking.customer.fullName}</span>
                            <a
                              href={`mailto:${booking.customer.email}`}
                              className="text-muted-foreground underline-offset-4 hover:underline"
                            >
                              {booking.customer.email}
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Paiement en cours</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge view={providerBookingStatusView(booking)} />
                          {booking.rescheduledAt && booking.status === 'confirmed' && (
                            <RescheduledBadge label="Déplacée" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPrice(booking.priceCents, booking.currency)}
                      </TableCell>
                      <TableCell>
                        <BookingActions booking={booking} className="flex justify-end gap-2" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-end gap-2 text-sm">
                <Button
                  variant="outline"
                  className="size-11"
                  aria-label="Page précédente"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </Button>
                <span aria-live="polite">
                  Page {page} sur {pages}
                </span>
                <Button
                  variant="outline"
                  className="size-11"
                  aria-label="Page suivante"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight aria-hidden className="size-4" />
                </Button>
              </nav>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
