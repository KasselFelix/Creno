import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sendNotificationJobSchema } from '@creno/shared';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { JobsService, type ReceivedJob } from '../jobs/jobs.service.js';
import {
  type Delivery,
  DeliveryError,
  EMAIL_GATEWAY,
  type EmailGateway,
  SMS_GATEWAY,
  type SmsGateway,
} from './delivery.js';
import {
  DEAD_QUEUE,
  DISPATCH_QUEUE,
  SEND_QUEUE,
  SEND_RETRY_LIMIT,
} from './notifications.queues.js';
import { NotificationsRepository, type SendContext } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { type MessageData, renderEmail, renderReminderSms } from './templates.js';

/**
 * Exécute les jobs de notification. L'état de la réservation est revérifié au moment de l'envoi :
 * annuler une réservation ne demande donc d'annuler aucun job, le rappel se ferme tout seul.
 */
@Injectable()
export class NotificationsWorker implements OnModuleInit {
  private readonly logger = new Logger(NotificationsWorker.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsRepository,
    private readonly service: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // La file morte d'abord : la file d'envoi la référence.
    await this.jobs.register({ name: DEAD_QUEUE, handler: (job) => this.giveUp(job) });
    await this.jobs.register({
      name: SEND_QUEUE,
      queue: {
        retryLimit: SEND_RETRY_LIMIT,
        retryDelay: 30,
        retryBackoff: true,
        // Un envoi dure 10 s au plus (timeout des passerelles) : au-delà, le job est repris.
        expireInSeconds: 60,
        deadLetter: DEAD_QUEUE,
      },
      handler: (job) => this.send(job),
    });
    await this.jobs.register({
      name: DISPATCH_QUEUE,
      // Une seule exécution à la fois, et pas d'empilement si un passage prend du retard.
      queue: { policy: 'stately', retryLimit: 0, expireInSeconds: 120 },
      cron: '*/5 * * * *',
      handler: async () => {
        await this.service.dispatchDue();
      },
    });
  }

  private async send(job: ReceivedJob): Promise<void> {
    const parsed = sendNotificationJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Un contenu invalide le restera : inutile de rejouer le job.
      this.logger.error({ event: 'notification.invalid_job', jobId: job.id });
      return;
    }
    const id = parsed.data.notificationId;
    // Déjà envoyée (job livré deux fois) ou close : rien à faire.
    const attempt = await this.notifications.startAttempt(id);
    if (attempt === undefined) return;
    const context = await this.notifications.sendContext(id);
    if (!context) return;
    const base = {
      notificationId: id,
      bookingId: context.bookingId,
      kind: context.kind,
      channel: context.channel,
      jobId: job.id,
    };

    const obsolete = this.obsoleteReason(context, new Date());
    if (obsolete) {
      await this.notifications.close(id, 'skipped', obsolete);
      this.logger.log({ event: 'notification.skipped', ...base, reason: obsolete });
      return;
    }

    const startedAt = Date.now();
    let delivery: Delivery;
    try {
      delivery = await this.deliver(context);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      if (error.reason === 'not_configured') {
        await this.notifications.close(id, 'skipped', error.reason);
        this.logger.warn({ event: 'notification.skipped', ...base, reason: error.reason });
        return;
      }
      if (!error.retryable) {
        // Le fournisseur refuse ce message (adresse ou numéro invalide) : action requise.
        await this.notifications.close(id, 'failed', error.reason);
        this.logger.error({ event: 'notification.failed', ...base, reason: error.reason, attempt });
        return;
      }
      this.logger.warn({ event: 'notification.retry', ...base, reason: error.reason, attempt });
      throw error;
    }
    await this.notifications.markSent(id, delivery.messageId);
    this.logger.log({
      event: 'notification.sent',
      ...base,
      attempt,
      latencyMs: Date.now() - startedAt,
    });
  }

  /** Le job d'envoi a épuisé ses reprises (ou n'a jamais pu finir) : la notification est abandonnée. */
  private async giveUp(job: ReceivedJob): Promise<void> {
    const parsed = sendNotificationJobSchema.safeParse(job.data);
    if (!parsed.success) return;
    const id = parsed.data.notificationId;
    if (await this.notifications.close(id, 'failed', 'retries_exhausted')) {
      this.logger.error({
        event: 'notification.failed',
        notificationId: id,
        jobId: job.id,
        reason: 'retries_exhausted',
      });
    }
  }

  /** Raison pour laquelle la notification n'a plus lieu d'être, d'après l'état actuel de la réservation. */
  private obsoleteReason(context: SendContext, now: Date): string | null {
    switch (context.kind) {
      case 'booking_confirmed':
      case 'booking_received':
        return context.bookingStatus === 'confirmed' ? null : 'booking_not_confirmed';
      case 'booking_reminder':
        if (context.bookingStatus !== 'confirmed') return 'booking_not_confirmed';
        if (context.start <= now) return 'too_late';
        return context.channel === 'sms' && !context.recipientPhone ? 'no_phone' : null;
      case 'booking_cancelled':
      case 'booking_cancelled_by_provider':
        return context.bookingStatus === 'cancelled' ? null : 'booking_not_cancelled';
      case 'payment_refunded_late':
        return null;
    }
  }

  private deliver(context: SendContext): Promise<Delivery> {
    const data: MessageData = {
      kind: context.kind,
      audience: context.recipientIsCustomer ? 'customer' : 'provider',
      recipientName: context.recipientName,
      customerName: context.customerName,
      resourceName: context.resourceName,
      providerName: context.providerName,
      start: context.start,
      end: context.end,
      timezone: context.timezone,
      bookingStatus: context.bookingStatus,
      paidCents: context.paidCents,
      currency: context.currency,
      // Adresses construites ici, à partir de l'origine configurée.
      bookingUrl: `${this.config.WEB_ORIGIN}/bookings/${context.bookingId}/confirmation`,
      providerUrl: `${this.config.WEB_ORIGIN}/providers/${context.providerSlug}`,
    };
    if (context.channel === 'sms') {
      // `obsoleteReason` a écarté le cas sans numéro ; seul le rappel part par SMS.
      return this.sms.send({ to: context.recipientPhone ?? '', body: renderReminderSms(data) });
    }
    return this.email.send({
      to: context.recipientEmail,
      ...renderEmail(data),
      idempotencyKey: context.id,
    });
  }
}
