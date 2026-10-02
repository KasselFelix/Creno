import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { registrationEmailJobSchema } from '@creno/shared';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { JobsService, type ReceivedJob } from '../jobs/jobs.service.js';
import {
  DeliveryError,
  EMAIL_GATEWAY,
  type EmailGateway,
  type EmailMessage,
} from '../notifications/delivery.js';
import { UsersRepository } from '../users/users.repository.js';
import { PendingRegistrationsRepository } from './pending-registrations.repository.js';
import { accountExistsEmail, verificationEmail } from './registration-emails.js';
import {
  REGISTRATION_EMAIL_DEAD_QUEUE,
  REGISTRATION_EMAIL_QUEUE,
  REGISTRATION_EMAIL_RETRY_LIMIT,
} from './registration.queues.js';
import { TokensService } from './tokens.service.js';

/**
 * Envoie l'email qui suit une demande d'inscription. C'est ici, et non dans la requête HTTP, qu'on
 * regarde si l'adresse a déjà un compte : la requête fait le même travail dans les deux cas, et
 * seul le titulaire de la boîte mail voit la différence.
 */
@Injectable()
export class RegistrationWorker implements OnModuleInit {
  private readonly logger = new Logger(RegistrationWorker.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    private readonly jobs: JobsService,
    private readonly pending: PendingRegistrationsRepository,
    private readonly users: UsersRepository,
    private readonly tokens: TokensService,
  ) {}

  async onModuleInit(): Promise<void> {
    // La file morte d'abord : la file d'envoi la référence.
    await this.jobs.register({
      name: REGISTRATION_EMAIL_DEAD_QUEUE,
      handler: (job) => this.giveUp(job),
    });
    await this.jobs.register({
      name: REGISTRATION_EMAIL_QUEUE,
      queue: {
        retryLimit: REGISTRATION_EMAIL_RETRY_LIMIT,
        retryDelay: 30,
        retryBackoff: true,
        // Un envoi dure 10 s au plus (timeout de la passerelle) : au-delà, le job est repris.
        expireInSeconds: 60,
        deadLetter: REGISTRATION_EMAIL_DEAD_QUEUE,
      },
      handler: (job) => this.send(job),
    });
  }

  private async send(job: ReceivedJob): Promise<void> {
    const parsed = registrationEmailJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Un contenu invalide le restera : inutile de rejouer le job.
      this.logger.error({ event: 'auth.registration_email_invalid_job', jobId: job.id });
      return;
    }
    const pendingRegistrationId = parsed.data.pendingRegistrationId;
    const base = { pendingRegistrationId, jobId: job.id };
    const pending = await this.pending.findById(pendingRegistrationId);
    // Compte créé entre-temps par un autre lien, ou demande expirée : plus rien à envoyer.
    if (!pending || pending.expiresAt <= new Date()) {
      this.logger.log({ event: 'auth.registration_email_skipped', ...base, reason: 'obsolete' });
      return;
    }

    const existing = await this.users.findByEmail(pending.email);
    let message: EmailMessage;
    if (existing) {
      message = {
        to: existing.email,
        ...accountExistsEmail(existing.fullName, `${this.config.WEB_ORIGIN}/login`),
        idempotencyKey: `registration:${pending.id}`,
      };
    } else {
      // Le secret naît ici : la base n'en garde que le hash et le job ne le transporte pas. Une
      // reprise du job en crée donc un nouveau, qui remplace le précédent.
      const secret = this.tokens.newSecret();
      const tokenHash = this.tokens.hashSecret(secret);
      if (!(await this.pending.setTokenHash(pending.id, tokenHash))) {
        this.logger.log({ event: 'auth.registration_email_skipped', ...base, reason: 'obsolete' });
        return;
      }
      // Jeton dans le fragment (#) : le navigateur ne l'envoie pas au serveur web, il n'apparaît
      // donc ni dans ses logs ni dans un en-tête Referer.
      const url = `${this.config.WEB_ORIGIN}/register/complete#${this.tokens.formatToken(pending.id, secret)}`;
      message = {
        to: pending.email,
        ...verificationEmail(url),
        // Un lien différent est un email différent : la clé suit le secret.
        idempotencyKey: `registration:${pending.id}:${tokenHash.slice(0, 16)}`,
      };
    }
    const kind = existing ? 'account_exists' : 'verification';
    const attempt = job.retryCount + 1;

    try {
      await this.email.send(message);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      if (error.reason === 'not_configured') {
        this.logger.warn({
          event: 'auth.registration_email_skipped',
          ...base,
          reason: error.reason,
        });
        return;
      }
      if (!error.retryable) {
        // Le fournisseur refuse ce message (adresse invalide) : un nouvel essai n'y changerait rien.
        this.logger.error({
          event: 'auth.registration_email_failed',
          ...base,
          kind,
          reason: error.reason,
          attempt,
        });
        return;
      }
      this.logger.warn({
        event: 'auth.registration_email_retry',
        ...base,
        kind,
        reason: error.reason,
        attempt,
      });
      throw error;
    }
    this.logger.log({ event: 'auth.registration_email_sent', ...base, kind, attempt });
  }

  /** Reprises épuisées : la personne ne recevra rien et devra refaire sa demande. */
  private async giveUp(job: ReceivedJob): Promise<void> {
    const parsed = registrationEmailJobSchema.safeParse(job.data);
    if (!parsed.success) return;
    this.logger.error({
      event: 'auth.registration_email_failed',
      pendingRegistrationId: parsed.data.pendingRegistrationId,
      jobId: job.id,
      reason: 'retries_exhausted',
    });
  }
}
