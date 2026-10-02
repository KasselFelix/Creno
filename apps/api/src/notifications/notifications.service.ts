import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, DbHandle } from '@creno/db';
import type { SendNotificationJob } from '@creno/shared';
import { DB } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import { type NewNotification, NotificationsRepository } from './notifications.repository.js';
import { SEND_QUEUE } from './notifications.queues.js';
import { reminderInstantFor } from './reminder.js';

/**
 * Enregistre les notifications à envoyer. Chaque méthode s'appelle DANS la transaction qui change
 * le statut de la réservation : la ligne `notifications` et son job d'envoi sont validés ou
 * annulés avec elle (outbox transactionnelle). Rien n'est envoyé ici : c'est le rôle du worker.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly notifications: NotificationsRepository,
    private readonly jobs: JobsService,
  ) {}

  /** Réservation confirmée : confirmation au client, avis au prestataire, rappel planifié. */
  async bookingConfirmed(bookingId: string, tx: Database, now = new Date()): Promise<void> {
    const parties = await this.notifications.parties(bookingId, tx);
    if (!parties) return;
    const rows: NewNotification[] = [
      { bookingId, recipientId: parties.customerId, kind: 'booking_confirmed', channel: 'email' },
      { bookingId, recipientId: parties.ownerUserId, kind: 'booking_received', channel: 'email' },
    ];
    const reminderAt = reminderInstantFor(parties.start, now);
    if (reminderAt) {
      const reminder = {
        bookingId,
        recipientId: parties.customerId,
        kind: 'booking_reminder',
        status: 'scheduled',
        scheduledFor: reminderAt,
      } as const;
      rows.push({ ...reminder, channel: 'email' });
      if (parties.customerHasPhone) rows.push({ ...reminder, channel: 'sms' });
    }
    await this.enqueue(rows, tx);
  }

  /** Réservation confirmée puis annulée : le client est toujours prévenu, le prestataire s'il n'en est pas l'auteur. */
  async bookingCancelled(
    bookingId: string,
    by: 'customer' | 'provider',
    tx: Database,
  ): Promise<void> {
    const parties = await this.notifications.parties(bookingId, tx);
    if (!parties) return;
    const rows: NewNotification[] =
      by === 'provider'
        ? [
            {
              bookingId,
              recipientId: parties.customerId,
              kind: 'booking_cancelled_by_provider',
              channel: 'email',
            },
          ]
        : [
            {
              bookingId,
              recipientId: parties.customerId,
              kind: 'booking_cancelled',
              channel: 'email',
            },
            {
              bookingId,
              recipientId: parties.ownerUserId,
              kind: 'booking_cancelled',
              channel: 'email',
            },
          ];
    await this.enqueue(rows, tx);
  }

  /** Paiement arrivé trop tard (créneau repris ou réservation annulée) et remboursé. */
  async paymentRefundedLate(bookingId: string, tx: Database): Promise<void> {
    const parties = await this.notifications.parties(bookingId, tx);
    if (!parties) return;
    await this.enqueue(
      [
        {
          bookingId,
          recipientId: parties.customerId,
          kind: 'payment_refunded_late',
          channel: 'email',
        },
      ],
      tx,
    );
  }

  /**
   * Met en file les notifications planifiées dont l'heure est venue (rappels). Appelé par une tâche
   * planifiée : pg-boss supprime un job resté 14 jours en attente, alors qu'un créneau se réserve
   * des mois à l'avance. L'échéance vit donc dans notre table, pas dans un job différé.
   */
  async dispatchDue(): Promise<number> {
    const count = await this.handle.db.transaction(async (tx) => {
      const ids = await this.notifications.releaseDue(tx);
      for (const notificationId of ids) await this.sendJob(notificationId, tx);
      return ids.length;
    });
    if (count > 0) this.logger.log({ event: 'notification.reminders_dispatched', count });
    return count;
  }

  private async enqueue(rows: NewNotification[], tx: Database): Promise<void> {
    const inserted = await this.notifications.insert(rows, tx);
    for (const row of inserted) {
      if (row.status === 'pending') await this.sendJob(row.id, tx);
    }
  }

  private sendJob(notificationId: string, tx: Database): Promise<void> {
    return this.jobs.send(SEND_QUEUE, { notificationId } satisfies SendNotificationJob, { tx });
  }
}
