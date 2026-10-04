import { Inject, Injectable } from '@nestjs/common';
import { and, asc, type Column, count, eq, lte, sql } from 'drizzle-orm';
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  type Database,
  type DbHandle,
  resources,
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

/**
 * Réservations qui occupent réellement un créneau : les `confirmed`, et les `pending` dont le hold
 * n'a pas expiré. La contrainte EXCLUDE, elle, compte encore un hold expiré (son prédicat ne peut
 * pas utiliser now()) : c'est ici qu'on l'ignore.
 */
const occupiesSlot = sql`(${bookings.status} = 'confirmed' OR (${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()))`;

/** `colonne = ANY($1)` : un seul paramètre (un tableau), quel que soit le nombre d'identifiants. */
const anyOf = (column: Column, ids: string[]) => sql`${column} = ANY(${sql.param(ids)}::uuid[])`;

/** Ressource active examinée par le filtre « disponible le » de la recherche. */
export interface DayResourceRow {
  id: string;
  providerId: string;
  timezone: string;
  slotMinutes: number;
}

export interface ResourceRuleRow extends AvailabilityRule {
  resourceId: string;
}

export interface ResourceIntervalRow extends Interval {
  resourceId: string;
}

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

  /** Fermetures non terminées d'une ressource (celles qui pèsent sur le calcul des créneaux). */
  async countUpcomingExceptions(resourceId: string, tx: Database): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.resourceId, resourceId),
          sql`upper(${availabilityExceptions.during}) > now()`,
        ),
      );
    return row?.total ?? 0;
  }

  async createException(
    resourceId: string,
    interval: Interval,
    reason: string | null,
    tx: Database = this.handle.db,
  ): Promise<ExceptionRow> {
    const [row] = await tx
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

  /** Réservations qui occupent réellement un créneau dans la fenêtre (voir `occupiesSlot`). */
  async busyBetween(resourceId: string, window: Interval): Promise<Interval[]> {
    return this.handle.db
      .select(bounds(bookings.during))
      .from(bookings)
      .where(
        and(
          eq(bookings.resourceId, resourceId),
          sql`${bookings.during} && ${toRange(window.start, window.end)}::tstzrange`,
          occupiesSlot,
        ),
      );
  }

  // Chargement par lot pour le filtre « disponible le » : une requête pour toutes les ressources
  // des prestataires candidats, au lieu d'une par ressource.

  /**
   * Ressources actives des prestataires, à `priceMaxCents` ou moins si le prix est filtré : seules
   * celles-là comptent. Triées par prix puis par identifiant, l'ordre du choix de la ressource du lien.
   */
  async activeResourcesOf(
    providerIds: string[],
    priceMaxCents?: number,
  ): Promise<DayResourceRow[]> {
    if (providerIds.length === 0) return [];
    return this.handle.db
      .select({
        id: resources.id,
        providerId: resources.providerId,
        timezone: resources.timezone,
        slotMinutes: resources.slotMinutes,
      })
      .from(resources)
      .where(
        and(
          anyOf(resources.providerId, providerIds),
          eq(resources.isActive, true),
          priceMaxCents === undefined ? undefined : lte(resources.priceCents, priceMaxCents),
        ),
      )
      .orderBy(asc(resources.priceCents), asc(resources.id));
  }

  /** Plages horaires d'un jour de la semaine (ISO), pour plusieurs ressources. */
  async rulesOn(resourceIds: string[], weekday: number): Promise<ResourceRuleRow[]> {
    if (resourceIds.length === 0) return [];
    const rows = await this.handle.db
      .select({
        resourceId: availabilityRules.resourceId,
        weekday: availabilityRules.weekday,
        startTime: availabilityRules.startTime,
        endTime: availabilityRules.endTime,
      })
      .from(availabilityRules)
      .where(
        and(
          anyOf(availabilityRules.resourceId, resourceIds),
          eq(availabilityRules.weekday, weekday),
        ),
      );
    return rows.map((row) => ({
      ...row,
      startTime: toHourMinute(row.startTime),
      endTime: toHourMinute(row.endTime),
    }));
  }

  /** Fermetures qui chevauchent la fenêtre, pour plusieurs ressources. */
  async closuresOf(resourceIds: string[], window: Interval): Promise<ResourceIntervalRow[]> {
    if (resourceIds.length === 0) return [];
    return this.handle.db
      .select({
        resourceId: availabilityExceptions.resourceId,
        ...bounds(availabilityExceptions.during),
      })
      .from(availabilityExceptions)
      .where(
        and(
          anyOf(availabilityExceptions.resourceId, resourceIds),
          sql`${availabilityExceptions.during} && ${toRange(window.start, window.end)}::tstzrange`,
        ),
      );
  }

  /** Réservations qui occupent un créneau dans la fenêtre, pour plusieurs ressources. */
  async busyOf(resourceIds: string[], window: Interval): Promise<ResourceIntervalRow[]> {
    if (resourceIds.length === 0) return [];
    return this.handle.db
      .select({ resourceId: bookings.resourceId, ...bounds(bookings.during) })
      .from(bookings)
      .where(
        and(
          anyOf(bookings.resourceId, resourceIds),
          sql`${bookings.during} && ${toRange(window.start, window.end)}::tstzrange`,
          occupiesSlot,
        ),
      );
  }
}
