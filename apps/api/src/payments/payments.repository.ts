import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Database, type DbHandle, payments, providers, stripeEvents } from '@creno/db';
import type { PaymentStatus } from '@creno/shared';
import { DB } from '../database/database.module.js';

/** Ce que l'API sait du compte Stripe Connect d'un prestataire. */
export interface ProviderPaymentsRow {
  id: string;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

const providerColumns = {
  id: providers.id,
  stripeAccountId: providers.stripeAccountId,
  chargesEnabled: providers.stripeChargesEnabled,
  detailsSubmitted: providers.stripeDetailsSubmitted,
};

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Enregistre l'événement Stripe. Renvoie faux s'il était déjà là (événement rejoué) : la clé
   * primaire sur l'identifiant de l'événement fait l'idempotence, `ON CONFLICT DO NOTHING` évite l'erreur.
   */
  async recordEvent(event: { id: string; type: string }, tx: Database): Promise<boolean> {
    const rows = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    return rows.length > 0;
  }

  async findByBooking(
    bookingId: string,
    tx: Database,
  ): Promise<{ id: string; stripePaymentIntentId: string } | undefined> {
    const [row] = await tx
      .select({ id: payments.id, stripePaymentIntentId: payments.stripePaymentIntentId })
      .from(payments)
      .where(eq(payments.bookingId, bookingId));
    return row;
  }

  async insert(
    values: {
      bookingId: string;
      stripePaymentIntentId: string;
      amountCents: number;
      feeCents: number;
      currency: string;
    },
    tx: Database,
  ): Promise<void> {
    await tx.insert(payments).values(values);
  }

  /** Reporte un remboursement constaté par Stripe. Renvoie la réservation concernée, s'il y en a une. */
  async recordRefund(
    paymentIntentId: string,
    refund: { refundedCents: number; full: boolean },
    tx: Database,
  ): Promise<{ bookingId: string; status: PaymentStatus } | undefined> {
    const [row] = await tx
      .update(payments)
      .set({
        // Stripe envoie le total remboursé : il ne peut qu'augmenter, même si deux événements se croisent.
        refundedCents: sql`least(greatest(${payments.refundedCents}, ${refund.refundedCents}), ${payments.amountCents})`,
        refundedAt: sql`coalesce(${payments.refundedAt}, now())`,
        ...(refund.full ? { status: 'refunded' as const } : {}),
      })
      .where(eq(payments.stripePaymentIntentId, paymentIntentId))
      .returning({ bookingId: payments.bookingId, status: payments.status });
    return row;
  }

  async findProviderByUserId(userId: string): Promise<ProviderPaymentsRow | undefined> {
    const [row] = await this.handle.db
      .select(providerColumns)
      .from(providers)
      .where(eq(providers.userId, userId));
    return row;
  }

  /** Rattache le compte Stripe au prestataire s'il n'en a pas encore, et renvoie l'état à jour. */
  async attachAccount(providerId: string, accountId: string): Promise<ProviderPaymentsRow> {
    await this.handle.db
      .update(providers)
      .set({ stripeAccountId: accountId })
      .where(and(eq(providers.id, providerId), isNull(providers.stripeAccountId)));
    const [row] = await this.handle.db
      .select(providerColumns)
      .from(providers)
      .where(eq(providers.id, providerId));
    return row!;
  }

  /**
   * Recopie l'état du compte Stripe. Renvoie l'état d'avant et d'après, ou `undefined` si aucun
   * prestataire ne porte ce compte.
   */
  async syncAccount(
    accountId: string,
    state: { chargesEnabled: boolean; detailsSubmitted: boolean },
    tx: Database = this.handle.db,
  ): Promise<{ providerId: string; wasEnabled: boolean; enabled: boolean } | undefined> {
    return tx.transaction(async (inner) => {
      const [before] = await inner
        .select({ id: providers.id, enabled: providers.stripeChargesEnabled })
        .from(providers)
        .where(eq(providers.stripeAccountId, accountId))
        .for('update');
      if (!before) return undefined;
      await inner
        .update(providers)
        .set({
          stripeChargesEnabled: state.chargesEnabled,
          stripeDetailsSubmitted: state.detailsSubmitted,
        })
        .where(eq(providers.id, before.id));
      return { providerId: before.id, wasEnabled: before.enabled, enabled: state.chargesEnabled };
    });
  }
}
