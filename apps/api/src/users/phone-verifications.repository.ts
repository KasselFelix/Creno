import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { type Database, type DbHandle, phoneVerifications } from '@creno/db';
import { PHONE_CODE_MAX_ATTEMPTS } from '@creno/shared';
import { DB } from '../database/database.module.js';

export type PhoneVerificationRow = typeof phoneVerifications.$inferSelect;

@Injectable()
export class PhoneVerificationsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Verrous consultatifs tenus jusqu'à la fin de la transaction : les demandes d'un même compte
   * passent une par une (plafond exact), et tout ce qui touche un même numéro aussi (plafond par
   * numéro, un seul titulaire). Toujours dans cet ordre : compte, puis numéro. Les seconds
   * arguments séparent ces verrous de ceux des réservations (0) et des inscriptions (1).
   */
  async lockAccount(userId: string, tx: Database): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 3))`);
  }

  async lockPhone(phone: string, tx: Database): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${phone}, 2))`);
  }

  async countForAccountLastHour(userId: string, tx: Database): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(phoneVerifications)
      .where(
        and(
          eq(phoneVerifications.userId, userId),
          gt(phoneVerifications.createdAt, sql`now() - interval '1 hour'`),
        ),
      );
    return row?.total ?? 0;
  }

  /** Tous comptes confondus : c'est le téléphone qu'on protège des envois répétés. */
  async countForPhoneLastDay(phone: string, tx: Database): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(phoneVerifications)
      .where(
        and(
          eq(phoneVerifications.phone, phone),
          gt(phoneVerifications.createdAt, sql`now() - interval '24 hours'`),
        ),
      );
    return row?.total ?? 0;
  }

  async create(
    values: { userId: string; phone: string; expiresAt: Date },
    tx: Database,
  ): Promise<PhoneVerificationRow> {
    const [row] = await tx.insert(phoneVerifications).values(values).returning();
    return row!;
  }

  async findById(id: string): Promise<PhoneVerificationRow | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(phoneVerifications)
      .where(eq(phoneVerifications.id, id));
    return row;
  }

  /** Demande la plus récente du compte : la seule dont le code est accepté. */
  async latestIdFor(userId: string): Promise<string | undefined> {
    const [row] = await this.handle.db
      .select({ id: phoneVerifications.id })
      .from(phoneVerifications)
      .where(eq(phoneVerifications.userId, userId))
      .orderBy(desc(phoneVerifications.createdAt), desc(phoneVerifications.id))
      .limit(1);
    return row?.id;
  }

  /**
   * Hash du code qui va partir. Premier envoi : seulement sur une demande vierge. Reprise : seulement
   * si la demande porte encore le hash de l'essai précédent, c'est-à-dire si elle n'a été ni
   * consommée ni invalidée entre-temps (retrait du numéro). `false` : plus rien à envoyer.
   */
  async setCodeHash(id: string, codeHash: string, retry: boolean): Promise<boolean> {
    const rows = await this.handle.db
      .update(phoneVerifications)
      .set({ codeHash })
      .where(
        and(
          eq(phoneVerifications.id, id),
          eq(phoneVerifications.attempts, 0),
          retry ? isNotNull(phoneVerifications.codeHash) : isNull(phoneVerifications.codeHash),
        ),
      )
      .returning({ id: phoneVerifications.id });
    return rows.length > 0;
  }

  /**
   * Compte une tentative sur la demande la plus récente du compte, si elle est encore utilisable,
   * et la renvoie pour comparer le code. La tentative est comptée AVANT la comparaison et dans la
   * même instruction que le contrôle : deux requêtes parallèles se sérialisent sur le verrou de
   * ligne, et la seconde relit `attempts` à jour. Jamais plus de 5 comparaisons par code.
   */
  async consumeAttempt(
    userId: string,
  ): Promise<Pick<PhoneVerificationRow, 'id' | 'phone' | 'codeHash'> | undefined> {
    const latest = this.handle.db
      .select({ id: phoneVerifications.id })
      .from(phoneVerifications)
      .where(eq(phoneVerifications.userId, userId))
      .orderBy(desc(phoneVerifications.createdAt), desc(phoneVerifications.id))
      .limit(1);
    const [row] = await this.handle.db
      .update(phoneVerifications)
      .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
      .where(
        and(
          eq(phoneVerifications.id, latest),
          sql`${phoneVerifications.attempts} < ${PHONE_CODE_MAX_ATTEMPTS}`,
          gt(phoneVerifications.expiresAt, sql`now()`),
          isNotNull(phoneVerifications.codeHash),
        ),
      )
      .returning({
        id: phoneVerifications.id,
        phone: phoneVerifications.phone,
        codeHash: phoneVerifications.codeHash,
      });
    return row;
  }

  /**
   * Code accepté : la demande devient inutilisable (plus de hash). `false` : une autre requête
   * l'a consommée avant. Les lignes ne sont jamais supprimées ici : elles comptent dans les
   * plafonds pendant 24 h, et seul le ménage les retire.
   */
  async consume(id: string, tx: Database): Promise<boolean> {
    const rows = await tx
      .update(phoneVerifications)
      .set({ codeHash: null })
      .where(and(eq(phoneVerifications.id, id), isNotNull(phoneVerifications.codeHash)))
      .returning({ id: phoneVerifications.id });
    return rows.length > 0;
  }

  /** Plus aucun code du compte n'est accepté (numéro vérifié ou retiré). */
  async invalidateForUser(userId: string, tx: Database = this.handle.db): Promise<void> {
    await tx
      .update(phoneVerifications)
      .set({ codeHash: null })
      .where(and(eq(phoneVerifications.userId, userId), isNotNull(phoneVerifications.codeHash)));
  }
}
