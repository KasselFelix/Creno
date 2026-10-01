import { Inject, Injectable, Logger } from '@nestjs/common';
import { addMinutes } from 'date-fns';
import { type DbHandle, PG_DEADLOCK_DETECTED, retryOnDeadlock, sqlState } from '@creno/db';
import {
  type Booking,
  type CreateBookingInput,
  HOLD_MINUTES,
  MAX_ACTIVE_HOLDS,
} from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { DomainError } from '../common/domain-error.js';
import { mapPgError } from '../common/pg-errors.js';
import { DB } from '../database/database.module.js';
import { ResourcesService } from '../resources/resources.service.js';
import { type BookingRow, BookingsRepository } from './bookings.repository.js';

const toBooking = (row: BookingRow): Booking => ({
  id: row.id,
  resourceId: row.resourceId,
  start: row.start.toISOString(),
  end: row.end.toISOString(),
  status: row.status,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  priceCents: row.priceCents,
  currency: row.currency,
});

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly bookings: BookingsRepository,
    private readonly resources: ResourcesService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Bloque un créneau pendant le paiement (hold de 15 min, booking `pending`).
   *
   * Ce qui empêche la double réservation n'est aucun des contrôles ci-dessous : c'est la contrainte
   * `bookings_no_overlap` de la base, vérifiée au moment de l'INSERT, même quand deux requêtes
   * arrivent en même temps.
   */
  async createHold(current: AuthUser, input: CreateBookingInput): Promise<Booking> {
    const resource = await this.resources.requireActive(input.resourceId);
    const start = new Date(input.start);
    const slot = { start, end: addMinutes(start, resource.slotMinutes) };

    // Distingue « ce créneau n'existe pas » (422) de « ce créneau est pris » (409, plus bas).
    if (!(await this.availability.isOffered(resource, start))) {
      throw new DomainError(
        'SLOT_NOT_OFFERED',
        422,
        "Ce créneau n'est pas proposé par cette ressource.",
      );
    }
    // Frein au blocage gratuit d'un agenda. Contrôle applicatif assumé : deux requêtes simultanées
    // peuvent dépasser la limite d'une unité, ce qui est sans conséquence.
    if ((await this.bookings.countActiveHolds(current.id)) >= MAX_ACTIVE_HOLDS) {
      throw new DomainError(
        'HOLD_LIMIT_REACHED',
        409,
        `Vous avez déjà ${MAX_ACTIVE_HOLDS} réservations en attente de paiement.`,
      );
    }

    let attempts = 0;
    try {
      const { row, released } = await retryOnDeadlock(() => {
        attempts += 1;
        return this.handle.db.transaction(async (tx) => {
          const released = await this.bookings.expireOverlappingHolds(resource.id, slot, tx);
          const row = await this.bookings.insertHold(
            {
              resourceId: resource.id,
              customerId: current.id,
              slot,
              // Le prix vient toujours de la ressource, jamais du client.
              priceCents: resource.priceCents,
              currency: resource.currency,
            },
            tx,
          );
          return { row, released };
        });
      });
      if (attempts > 1) this.logDeadlockRetry(resource.id, attempts);
      this.logger.log({
        event: 'booking.hold_created',
        bookingId: row.id,
        resourceId: resource.id,
        holdMinutes: HOLD_MINUTES,
        expiredHoldsReleased: released,
      });
      return toBooking(row);
    } catch (error) {
      if (attempts > 1) this.logDeadlockRetry(resource.id, attempts);
      const state = sqlState(error);
      // Un deadlock qui persiste après les rejeux signifie qu'une autre transaction tient le créneau.
      if (state === '23P01' || state === PG_DEADLOCK_DETECTED) {
        this.logger.log({
          event: 'booking.slot_conflict',
          resourceId: resource.id,
          sqlState: state,
        });
        throw new DomainError('SLOT_UNAVAILABLE', 409, "Ce créneau n'est plus disponible.");
      }
      throw mapPgError(error) ?? error;
    }
  }

  private logDeadlockRetry(resourceId: string, attempts: number): void {
    this.logger.warn({ event: 'booking.deadlock_retried', resourceId, attempts });
  }
}
