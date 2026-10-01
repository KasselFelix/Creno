import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { bookings, type Database, type DbHandle, toRange } from '@creno/db';
import { type BookingStatus, HOLD_MINUTES } from '@creno/shared';
import type { Interval } from '../availability/slots.engine.js';
import { DB } from '../database/database.module.js';

export interface BookingRow extends Interval {
  id: string;
  resourceId: string;
  status: BookingStatus;
  expiresAt: Date | null;
  priceCents: number;
  currency: string;
}

@Injectable()
export class BookingsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Verrou consultatif par client, relâché à la fin de la transaction : deux demandes du même
   * client passent l'une après l'autre, sans bloquer celles des autres clients.
   */
  async lockCustomer(customerId: string, tx: Database): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`);
  }

  /** Holds encore actifs d'un utilisateur. */
  async countActiveHolds(customerId: string, tx: Database): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.customerId, customerId),
          eq(bookings.status, 'pending'),
          sql`${bookings.expiresAt} > now()`,
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * Passe à `expired` les holds expirés qui chevauchent le créneau. Le prédicat de la contrainte
   * EXCLUDE ne peut pas utiliser now() : sans ce changement de statut, un hold expiré bloquerait
   * encore l'INSERT qui suit. Renvoie le nombre de holds libérés.
   */
  async expireOverlappingHolds(resourceId: string, slot: Interval, tx: Database): Promise<number> {
    const rows = await tx
      .update(bookings)
      .set({ status: 'expired' })
      .where(
        and(
          eq(bookings.resourceId, resourceId),
          eq(bookings.status, 'pending'),
          sql`${bookings.expiresAt} <= now()`,
          sql`${bookings.during} && ${toRange(slot.start, slot.end)}::tstzrange`,
        ),
      )
      .returning({ id: bookings.id });
    return rows.length;
  }

  /** Insère le hold. `expires_at` est calculé par la base : la même horloge que celle qui l'expire. */
  async insertHold(
    values: {
      resourceId: string;
      customerId: string;
      slot: Interval;
      priceCents: number;
      currency: string;
    },
    tx: Database,
  ): Promise<BookingRow> {
    const [row] = await tx
      .insert(bookings)
      .values({
        resourceId: values.resourceId,
        customerId: values.customerId,
        during: toRange(values.slot.start, values.slot.end),
        status: 'pending',
        expiresAt: sql`now() + make_interval(mins => ${HOLD_MINUTES})`,
        priceCents: values.priceCents,
        currency: values.currency,
      })
      .returning({
        id: bookings.id,
        resourceId: bookings.resourceId,
        status: bookings.status,
        expiresAt: bookings.expiresAt,
        priceCents: bookings.priceCents,
        currency: bookings.currency,
        start: sql<Date>`lower(${bookings.during})`.mapWith(bookings.createdAt),
        end: sql<Date>`upper(${bookings.during})`.mapWith(bookings.createdAt),
      });
    return row!;
  }
}
