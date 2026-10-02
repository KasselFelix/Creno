import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';

/** Événement Stripe dont la signature a été vérifiée. `object` reste à valider avant usage. */
export interface VerifiedStripeEvent {
  id: string;
  type: string;
  object: unknown;
  /**
   * Vrai pour un événement d'un compte connecté (celui d'un prestataire) : il porte un champ
   * `account`, ou arrive par l'endpoint « Connect ». Seul `account.updated` est attendu de là.
   */
  connect: boolean;
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('Signature de webhook invalide');
    this.name = 'InvalidWebhookSignatureError';
  }
}

/**
 * Vérifie qu'un appel au webhook vient bien de Stripe : la signature est un HMAC du corps brut
 * (octet pour octet) et de l'heure d'envoi, calculé avec un secret partagé. Calcul local, sans
 * appel réseau : c'est pour cela qu'il n'est pas dans `PaymentsGateway`, et que les tests signent
 * de vrais événements.
 */
@Injectable()
export class StripeWebhookVerifier {
  private readonly secrets: { value: string; connect: boolean }[];

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.secrets = [
      { value: config.STRIPE_WEBHOOK_SECRET, connect: false },
      { value: config.STRIPE_CONNECT_WEBHOOK_SECRET, connect: true },
    ].filter((secret): secret is { value: string; connect: boolean } => Boolean(secret.value));
  }

  verify(rawBody: Buffer | undefined, signature: string | undefined): VerifiedStripeEvent {
    if (!rawBody || !signature) throw new InvalidWebhookSignatureError();
    for (const secret of this.secrets) {
      try {
        // Refuse aussi une signature de plus de 5 minutes (protection contre le rejeu).
        const event = Stripe.webhooks.constructEvent(rawBody, signature, secret.value);
        return {
          id: event.id,
          type: event.type,
          object: event.data.object,
          connect: secret.connect || Boolean(event.account),
        };
      } catch {
        // Essaie le secret suivant (endpoint « compte » puis endpoint « Connect »).
      }
    }
    throw new InvalidWebhookSignatureError();
  }
}
