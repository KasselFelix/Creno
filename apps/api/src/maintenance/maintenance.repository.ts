import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { bookings, type DbHandle, sessions, stripeEvents } from '@creno/db';
import { STRIPE_EVENTS_RETENTION_DAYS } from '@creno/shared';
import { DB } from '../database/database.module.js';

@Injectable()
export class MaintenanceRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Passe à `expired` les holds dont l'échéance est passée, et renvoie leur session Checkout.
   * `SKIP LOCKED` : une ligne tenue par une réservation ou un webhook en cours est laissée au
   * passage suivant, ce job n'attend donc jamais un verrou (pas de deadlock avec eux).
   */
  async expireHolds(
    limit = 500,
  ): Promise<{ id: string; stripeCheckoutSessionId: string | null }[]> {
    const db = this.handle.db;
    const overdue = and(eq(bookings.status, 'pending'), lte(bookings.expiresAt, sql`now()`));
    const candidates = db
      .select({ id: bookings.id })
      .from(bookings)
      .where(overdue)
      .orderBy(asc(bookings.expiresAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    return db
      .update(bookings)
      .set({ status: 'expired' })
      .where(and(inArray(bookings.id, candidates), overdue))
      .returning({ id: bookings.id, stripeCheckoutSessionId: bookings.stripeCheckoutSessionId });
  }

  /** Supprime les sessions expirées ou révoquées, tous utilisateurs confondus. */
  async purgeSessions(): Promise<number> {
    const rows = await this.handle.db
      .delete(sessions)
      .where(or(isNotNull(sessions.revokedAt), lte(sessions.expiresAt, sql`now()`)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  /**
   * Supprime les événements Stripe anciens. Ils ne servent qu'à reconnaître un événement rejoué, et
   * Stripe ne renvoie plus un événement au-delà de quelques jours.
   */
  async purgeStripeEvents(): Promise<number> {
    const rows = await this.handle.db
      .delete(stripeEvents)
      .where(
        lte(
          stripeEvents.receivedAt,
          sql`now() - make_interval(days => ${STRIPE_EVENTS_RETENTION_DAYS})`,
        ),
      )
      .returning({ id: stripeEvents.id });
    return rows.length;
  }
}
