import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PHONE_CODE_LENGTH, PHONE_CODE_TTL_MINUTES, phoneCodeJobSchema } from '@creno/shared';
import { JobsService, type ReceivedJob } from '../jobs/jobs.service.js';
import { DeliveryError, SMS_GATEWAY, type SmsGateway } from '../notifications/delivery.js';
import {
  PHONE_CODE_DEAD_QUEUE,
  PHONE_CODE_QUEUE,
  PHONE_CODE_RETRY_LIMIT,
} from './phone-code.queues.js';
import { hashPhoneCode } from './phone-verification.service.js';
import { PhoneVerificationsRepository } from './phone-verifications.repository.js';

export function phoneCodeSms(code: string): string {
  return `Creno : votre code est ${code}. Il expire dans ${PHONE_CODE_TTL_MINUTES} minutes. Ne le communiquez à personne.`;
}

/**
 * Envoie le code d'une demande de vérification. Le code naît ici : la base n'en garde que le hash
 * et le job ne transporte qu'un identifiant. Une reprise en crée un nouveau, qui remplace l'ancien.
 */
@Injectable()
export class PhoneCodeWorker implements OnModuleInit {
  private readonly logger = new Logger(PhoneCodeWorker.name);

  constructor(
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
    private readonly jobs: JobsService,
    private readonly verifications: PhoneVerificationsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    // La file morte d'abord : la file d'envoi la référence.
    await this.jobs.register({
      name: PHONE_CODE_DEAD_QUEUE,
      handler: (job) => this.giveUp(job),
    });
    await this.jobs.register({
      name: PHONE_CODE_QUEUE,
      queue: {
        retryLimit: PHONE_CODE_RETRY_LIMIT,
        retryDelay: 10,
        retryBackoff: true,
        // Un envoi dure 10 s au plus (timeout de la passerelle).
        expireInSeconds: 60,
        deadLetter: PHONE_CODE_DEAD_QUEUE,
      },
      handler: (job) => this.send(job),
    });
  }

  private async send(job: ReceivedJob): Promise<void> {
    const parsed = phoneCodeJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Un contenu invalide le restera : inutile de rejouer le job.
      this.logger.error({ event: 'user.phone_code_invalid_job', jobId: job.id });
      return;
    }
    const { phoneVerificationId } = parsed.data;
    const base = { phoneVerificationId, jobId: job.id };
    const request = await this.verifications.findById(phoneVerificationId);
    // Demande expirée, ou remplacée par une plus récente : son code ne serait jamais accepté.
    if (
      !request ||
      request.expiresAt <= new Date() ||
      (await this.verifications.latestIdFor(request.userId)) !== request.id
    ) {
      this.logger.log({ event: 'user.phone_code_skipped', ...base, reason: 'obsolete' });
      return;
    }

    const code = String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(PHONE_CODE_LENGTH, '0');
    const codeHash = hashPhoneCode(request.id, code);
    if (!(await this.verifications.setCodeHash(request.id, codeHash, job.retryCount > 0))) {
      this.logger.log({ event: 'user.phone_code_skipped', ...base, reason: 'obsolete' });
      return;
    }
    const attempt = job.retryCount + 1;

    try {
      await this.sms.send({ to: request.phone, body: phoneCodeSms(code) });
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      if (error.reason === 'not_configured') {
        this.logger.warn({ event: 'user.phone_code_skipped', ...base, reason: error.reason });
        return;
      }
      // Délai dépassé : Twilio a peut-être envoyé le SMS, et sans clé d'idempotence un nouvel
      // essai le doublerait. La personne peut redemander un code.
      if (!error.retryable || error.reason === 'timeout') {
        this.logger.error({
          event: 'user.phone_code_failed',
          ...base,
          reason: error.reason,
          attempt,
        });
        return;
      }
      this.logger.warn({ event: 'user.phone_code_retry', ...base, reason: error.reason, attempt });
      throw error;
    }
    this.logger.log({ event: 'user.phone_code_sent', ...base, attempt });
  }

  /** Reprises épuisées : la personne ne recevra pas ce code et devra en redemander un. */
  private async giveUp(job: ReceivedJob): Promise<void> {
    const parsed = phoneCodeJobSchema.safeParse(job.data);
    if (!parsed.success) return;
    this.logger.error({
      event: 'user.phone_code_failed',
      phoneVerificationId: parsed.data.phoneVerificationId,
      jobId: job.id,
      reason: 'retries_exhausted',
    });
  }
}
