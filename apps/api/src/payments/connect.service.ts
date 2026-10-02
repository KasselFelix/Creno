import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConnectOnboarding, ConnectStatus } from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { DomainError } from '../common/domain-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import {
  PAYMENTS_GATEWAY,
  type PaymentsGateway,
  PaymentsGatewayError,
} from './payments-gateway.js';
import { PaymentsRepository, type ProviderPaymentsRow } from './payments.repository.js';

/** Compte Stripe Connect du prestataire : création, formulaire d'inscription, état. */
@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENTS_GATEWAY) private readonly gateway: PaymentsGateway,
    private readonly payments: PaymentsRepository,
  ) {}

  /**
   * Crée le compte Express au premier appel, puis renvoie un lien à usage unique vers le
   * formulaire hébergé par Stripe (identité, IBAN). Creno ne voit jamais ces données.
   */
  async startOnboarding(current: AuthUser): Promise<ConnectOnboarding> {
    let provider = await this.requireProvider(current);
    try {
      if (!provider.stripeAccountId) {
        // La clé d'idempotence (`account-<providerId>`) rend le même compte à deux appels simultanés.
        const { accountId } = await this.gateway.createConnectAccount({ providerId: provider.id });
        provider = await this.payments.attachAccount(provider.id, accountId);
      }
      const { url } = await this.gateway.createAccountLink({
        accountId: provider.stripeAccountId!,
        refreshUrl: `${this.config.WEB_ORIGIN}/stripe/return?connect=refresh`,
        returnUrl: `${this.config.WEB_ORIGIN}/stripe/return?connect=return`,
      });
      this.logger.log({ event: 'provider.payments_onboarding_started', providerId: provider.id });
      return { url };
    } catch (error) {
      throw this.gatewayFailure('onboarding', provider.id, error);
    }
  }

  async status(current: AuthUser): Promise<ConnectStatus> {
    return this.toStatus(await this.requireProvider(current));
  }

  /** Relit le compte chez Stripe : au retour du formulaire, sans attendre le webhook `account.updated`. */
  async refresh(current: AuthUser): Promise<ConnectStatus> {
    const provider = await this.requireProvider(current);
    if (!provider.stripeAccountId) return this.toStatus(provider);
    try {
      const state = await this.gateway.retrieveAccount(provider.stripeAccountId);
      const change = await this.payments.syncAccount(provider.stripeAccountId, state);
      if (change && change.wasEnabled !== change.enabled) {
        this.logger.log({
          event: 'provider.payments_status_changed',
          providerId: provider.id,
          chargesEnabled: change.enabled,
          source: 'refresh',
        });
      }
      return this.toStatus({ ...provider, ...state });
    } catch (error) {
      throw this.gatewayFailure('refresh', provider.id, error);
    }
  }

  private toStatus(provider: ProviderPaymentsRow): ConnectStatus {
    return {
      status: !provider.stripeAccountId
        ? 'not_started'
        : provider.chargesEnabled
          ? 'active'
          : 'pending',
      detailsSubmitted: provider.detailsSubmitted,
      feeBps: this.config.STRIPE_PLATFORM_FEE_BPS,
    };
  }

  private async requireProvider(current: AuthUser): Promise<ProviderPaymentsRow> {
    const provider = await this.payments.findProviderByUserId(current.id);
    if (!provider) {
      throw new DomainError(
        'PROVIDER_PROFILE_REQUIRED',
        409,
        "Créez votre profil prestataire avant d'activer les paiements.",
      );
    }
    return provider;
  }

  /** Une erreur qui ne vient pas de la passerelle est un bug chez nous : elle remonte telle quelle (500). */
  private gatewayFailure(operation: string, providerId: string, error: unknown): unknown {
    if (!(error instanceof PaymentsGatewayError)) return error;
    this.logger.warn({
      event: 'payment.gateway_failed',
      operation,
      providerId,
      reason: error.reason,
      code: error.code,
    });
    return new DomainError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      503,
      'Le paiement est momentanément indisponible. Réessayez dans un instant.',
    );
  }
}
