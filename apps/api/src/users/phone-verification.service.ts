import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DbHandle, sqlState } from '@creno/db';
import {
  PHONE_CODE_TTL_MINUTES,
  PHONE_CODES_PER_ACCOUNT_PER_HOUR,
  PHONE_CODES_PER_NUMBER_PER_DAY,
  type PhoneCodeJob,
  type PhoneCodeRequested,
  type PublicUser,
} from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { DomainError } from '../common/domain-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SMS_GATEWAY, type SmsGateway, UnconfiguredGateway } from '../notifications/delivery.js';
import { PHONE_CODE_QUEUE } from './phone-code.queues.js';
import { PhoneVerificationsRepository } from './phone-verifications.repository.js';
import { toPublicUser } from './users.mapper.js';
import { UsersRepository } from './users.repository.js';

const PHONE_CODE_TTL_MS = PHONE_CODE_TTL_MINUTES * 60_000;

/** Hash d'un code, salé par l'id de sa demande : deux demandes au même code ont des hash différents. */
export function hashPhoneCode(phoneVerificationId: string, code: string): string {
  return createHash('sha256').update(`${phoneVerificationId}:${code}`).digest('hex');
}

/**
 * Vérification du téléphone. `users.phone` ne reçoit un numéro que lorsque son code a été saisi :
 * un numéro enregistré est donc toujours prouvé, et n'appartient qu'à un compte.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly verifications: PhoneVerificationsRepository,
    private readonly jobs: JobsService,
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
  ) {}

  /**
   * Demande d'un code : une ligne et le job qui enverra le SMS, dans la même transaction. La
   * réponse ne dit jamais si le numéro appartient déjà à un autre compte.
   */
  async requestCode(current: AuthUser, phone: string): Promise<PhoneCodeRequested> {
    // Sans passerelle SMS (démo sans Twilio), le code ne partirait jamais : on le dit tout de suite
    // plutôt que de laisser la personne attendre un SMS.
    if (this.sms instanceof UnconfiguredGateway) {
      this.logger.warn({ event: 'user.phone_code_unavailable', userId: current.id });
      throw new DomainError(
        'SMS_UNAVAILABLE',
        503,
        "La vérification par SMS n'est pas disponible pour le moment.",
      );
    }
    // Frein à la fraude vers des numéros surtaxés : refusé avant toute écriture.
    if (!this.config.SMS_ALLOWED_PREFIXES.some((prefix) => phone.startsWith(prefix))) {
      throw new DomainError(
        'PHONE_NOT_ALLOWED',
        400,
        'Ce numéro ne peut pas recevoir de SMS (seuls certains indicatifs sont acceptés).',
      );
    }
    const expiresAt = new Date(Date.now() + PHONE_CODE_TTL_MS);
    const user = await this.users.findById(current.id);
    // Déjà le numéro vérifié du compte : rien à prouver, aucun SMS.
    if (user?.phone === phone) return { expiresAt: expiresAt.toISOString() };

    const outcome = await this.handle.db.transaction(async (tx) => {
      await this.verifications.lockAccount(current.id, tx);
      if (
        (await this.verifications.countForAccountLastHour(current.id, tx)) >=
        PHONE_CODES_PER_ACCOUNT_PER_HOUR
      ) {
        return { capped: 'account' as const };
      }
      await this.verifications.lockPhone(phone, tx);
      if (
        (await this.verifications.countForPhoneLastDay(phone, tx)) >= PHONE_CODES_PER_NUMBER_PER_DAY
      ) {
        return { capped: 'phone' as const };
      }
      const row = await this.verifications.create({ userId: current.id, phone, expiresAt }, tx);
      // Le job naît avec la ligne (outbox transactionnelle) : pas de demande sans SMS.
      const job: PhoneCodeJob = { phoneVerificationId: row.id };
      await this.jobs.send(PHONE_CODE_QUEUE, job, { tx });
      return { id: row.id };
    });

    if ('capped' in outcome) {
      this.logger.warn({
        event: 'user.phone_code_capped',
        userId: current.id,
        scope: outcome.capped,
      });
      // Même message dans les deux cas : on ne dit pas qu'un autre compte a visé ce numéro.
      throw new DomainError(
        'TOO_MANY_REQUESTS',
        429,
        'Trop de codes demandés. Réessayez plus tard.',
      );
    }
    this.logger.log({
      event: 'user.phone_code_requested',
      userId: current.id,
      phoneVerificationId: outcome.id,
    });
    return { expiresAt: expiresAt.toISOString() };
  }

  /**
   * Saisie du code. La tentative est comptée avant la comparaison ; un code accepté consomme la
   * demande et enregistre le numéro, en le retirant du compte qui l'avait (transfert).
   */
  async verify(current: AuthUser, code: string): Promise<PublicUser> {
    const request = await this.verifications.consumeAttempt(current.id);
    if (!request) throw this.codeRejected(current.id, 'no_usable_request');
    if (!sameHash(request.codeHash, hashPhoneCode(request.id, code))) {
      throw this.codeRejected(current.id, 'wrong_code');
    }

    try {
      const { user, previousOwners } = await this.handle.db.transaction(async (tx) => {
        await this.verifications.lockPhone(request.phone, tx);
        // Même code envoyé deux fois en parallèle : une seule requête le consomme.
        if (!(await this.verifications.consume(request.id, tx))) {
          throw this.codeRejected(current.id, 'already_used');
        }
        const previousOwners = await this.users.releasePhone(request.phone, current.id, tx);
        const user = await this.users.setVerifiedPhone(current.id, request.phone, tx);
        await this.verifications.invalidateForUser(current.id, tx);
        return { user, previousOwners };
      });
      if (!user) throw new DomainError('NOT_FOUND', 404, 'Utilisateur introuvable.');
      for (const fromUserId of previousOwners) {
        this.logger.log({ event: 'user.phone_transferred', fromUserId, toUserId: current.id });
      }
      this.logger.log({ event: 'user.phone_verified', userId: current.id });
      return toPublicUser(user);
    } catch (error) {
      // Filet de sécurité : le verrou sérialise déjà les vérifications d'un même numéro.
      if (sqlState(error) === '23505') throw this.codeRejected(current.id, 'phone_taken');
      throw error;
    }
  }

  /** Retire le numéro : plus de SMS, et plus aucun code en cours n'est accepté. */
  async remove(current: AuthUser): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      await this.users.clearPhone(current.id, tx);
      await this.verifications.invalidateForUser(current.id, tx);
    });
    this.logger.log({ event: 'user.phone_removed', userId: current.id });
  }

  /** Une seule erreur quelle que soit la cause : la cause précise ne va que dans les logs. */
  private codeRejected(userId: string, reason: string): DomainError {
    this.logger.log({ event: 'user.phone_code_rejected', userId, reason });
    return new DomainError('PHONE_CODE_INVALID', 400, 'Code incorrect ou expiré.');
  }
}

function sameHash(stored: string | null, presented: string): boolean {
  if (!stored || stored.length !== presented.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(presented));
}
