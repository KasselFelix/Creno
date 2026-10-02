import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import {
  PAYMENTS_GATEWAY,
  type PaymentsGateway,
  PaymentsGatewayError,
} from '../payments/payments-gateway.js';
import { MaintenanceRepository } from './maintenance.repository.js';

export const EXPIRE_HOLDS_QUEUE = 'maintenance.expire-holds';
export const PURGE_SESSIONS_QUEUE = 'maintenance.purge-sessions';
export const PURGE_STRIPE_EVENTS_QUEUE = 'maintenance.purge-stripe-events';
export const PURGE_PENDING_REGISTRATIONS_QUEUE = 'maintenance.purge-pending-registrations';

// Une seule exécution à la fois ; pas de reprise : le passage suivant refait le travail.
const queue = { policy: 'stately', retryLimit: 0, expireInSeconds: 300 } as const;

/**
 * Tâches de ménage planifiées. Aucune n'est nécessaire à la correction : un hold expiré est déjà
 * ignoré par le calcul des créneaux et libéré par la réservation suivante. Elles gardent les
 * tables propres et ferment les sessions Checkout devenues inutiles.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @Inject(PAYMENTS_GATEWAY) private readonly gateway: PaymentsGateway,
    private readonly jobs: JobsService,
    private readonly maintenance: MaintenanceRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.register({
      name: EXPIRE_HOLDS_QUEUE,
      queue,
      cron: '*/5 * * * *',
      handler: async () => {
        await this.expireHolds();
      },
    });
    await this.jobs.register({
      name: PURGE_SESSIONS_QUEUE,
      queue,
      cron: '15 3 * * *',
      handler: async () => {
        await this.purgeSessions();
      },
    });
    await this.jobs.register({
      name: PURGE_STRIPE_EVENTS_QUEUE,
      queue,
      cron: '30 3 * * *',
      handler: async () => {
        await this.purgeStripeEvents();
      },
    });
    await this.jobs.register({
      name: PURGE_PENDING_REGISTRATIONS_QUEUE,
      queue,
      // Toutes les heures : ces lignes portent un hash de mot de passe, autant ne pas les garder.
      cron: '10 * * * *',
      handler: async () => {
        await this.purgePendingRegistrations();
      },
    });
  }

  async expireHolds(): Promise<number> {
    const expired = await this.maintenance.expireHolds();
    // Au mieux : fermer la page de paiement évite un paiement tardif, que le webhook saurait de
    // toute façon traiter (confirmation si le créneau est libre, sinon remboursement).
    for (const { id, stripeCheckoutSessionId } of expired) {
      if (!stripeCheckoutSessionId) continue;
      await this.gateway.expireCheckoutSession(stripeCheckoutSessionId).catch((error: unknown) => {
        this.logger.warn({
          event: 'payment.gateway_failed',
          operation: 'expire_session',
          bookingId: id,
          reason: error instanceof PaymentsGatewayError ? error.reason : 'unknown',
        });
      });
    }
    if (expired.length > 0) {
      this.logger.log({ event: 'maintenance.holds_expired', count: expired.length });
    }
    return expired.length;
  }

  async purgeSessions(): Promise<number> {
    const count = await this.maintenance.purgeSessions();
    this.logger.log({ event: 'maintenance.sessions_purged', count });
    return count;
  }

  async purgeStripeEvents(): Promise<number> {
    const count = await this.maintenance.purgeStripeEvents();
    this.logger.log({ event: 'maintenance.stripe_events_purged', count });
    return count;
  }

  async purgePendingRegistrations(): Promise<number> {
    const count = await this.maintenance.purgePendingRegistrations();
    this.logger.log({ event: 'maintenance.pending_registrations_purged', count });
    return count;
  }
}
