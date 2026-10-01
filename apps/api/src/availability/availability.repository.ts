import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  type Database,
  type DbHandle,
  toRange,
} from '@creno/db';
import type { AvailabilityRule } from '@creno/shared';
import { DB } from '../database/database.module.js';
import type { Interval } from './slots.engine.js';

export interface ExceptionRow extends Interval {
  id: string;
  reason: string | null;
}

// Les bornes d'un tstzrange se lisent avec lower() / upper(), décodées comme un timestamptz.
const bounds = (during: typeof bookings.during | typeof availabilityExceptions.during) => ({
  start: sql<Date>`lower(${during})`.mapWith(bookings.createdAt),
  end: sql<Date>`upper(${during})`.mapWith(bookings.createdAt),
});

/** Postgres renvoie un `time` en `HH:MM:SS` ; l'API parle en `HH:mm` (`24:00:00` → `24:00`). */
const toHourMinute = (time: string) => time.slice(0, 5);

@Injectable()
export class AvailabilityRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async listRules(resourceId: string, tx: Database = this.handle.db): Promise<AvailabilityRule[]> {
    const rows = await tx
      .select({
        weekday: availabilityRules.weekday,
        startTime: availabilityRules.startTime,
        endTime: availabilityRules.endTime,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.resourceId, resourceId))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime));
    return rows.map((row) => ({
      weekday: row.weekday,
      startTime: toHourMinute(row.startTime),
      endTime: toHourMinute(row.endTime),
    }));
  }

  /** Remplace tout l'horaire : à appeler dans une transaction (suppression puis insertion). */
  async replaceRules(resourceId: string, rules: AvailabilityRule[], tx: Database): Promise<void> {
    await tx.delete(availabilityRules).where(eq(availabilityRules.resourceId, resourceId));
    if (rules.length > 0) {
      await tx.insert(availabilityRules).values(rules.map((rule) => ({ resourceId, ...rule })));
    }
  }

  /** Fermetures qui ne sont pas encore terminées à `after`, de la plus proche à la plus lointaine. */
  async listExceptions(resourceId: string, after: Date): Promise<ExceptionRow[]> {
    return this.handle.db
      .select({
        id: availabilityExceptions.id,
        reason: availabilityExceptions.reason,
        ...bounds(availabilityExceptions.during),
      })
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.resourceId, resourceId),
          sql`upper(${availabilityExceptions.during}) > ${after.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(sql`lower(${availabilityExceptions.during})`);
  }

  async createException(
    resourceId: string,
    interval: Interval,
    reason: string | null,
  ): Promise<ExceptionRow> {
    const [row] = await this.handle.db
      .insert(availabilityExceptions)
      .values({ resourceId, during: toRange(interval.start, interval.end), reason })
      .returning({
        id: availabilityExceptions.id,
        reason: availabilityExceptions.reason,
        ...bounds(availabilityExceptions.during),
      });
    return row!;
  }

  async deleteException(resourceId: string, exceptionId: string): Promise<boolean> {
    const rows = await this.handle.db
      .delete(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.id, exceptionId),
          eq(availabilityExceptions.resourceId, resourceId),
        ),
      )
      .returning({ id: availabilityExceptions.id });
    return rows.length > 0;
  }

  /** Fermetures qui chevauchent la fenêtre (index GiST sur `(resource_id, during)`). */
  async closuresBetween(resourceId: string, window: Interval): Promise<Interval[]> {
    return this.handle.db
      .select(bounds(availabilityExceptions.during))
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.resourceId, resourceId),
          sql`${availabilityExceptions.during} && ${toRange(window.start, window.end)}::tstzrange`,
        ),
      );
  }

  /**
   * Réservations qui occupent réellement un créneau dans la fenêtre : les `confirmed`, et les
   * `pending` dont le hold n'a pas expiré. La contrainte EXCLUDE, elle, compte encore un hold
   * expiré (son prédicat ne peut pas utiliser now()) : c'est ici qu'on l'ignore.
   */
  async busyBetween(resourceId: string, window: Interval): Promise<Interval[]> {
    return this.handle.db
      .select(bounds(bookings.during))
      .from(bookings)
      .where(
        and(
          eq(bookings.resourceId, resourceId),
          sql`${bookings.during} && ${toRange(window.start, window.end)}::tstzrange`,
          sql`(${bookings.status} = 'confirmed' OR (${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()))`,
        ),
      );
  }
}
