import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';

/** Événement Stripe dont la signature a été vérifiée. `object` reste à valider avant usage. */
export interface VerifiedStripeEvent {
  id: string;
  type: string;
  object: unknown;
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
  private readonly secrets: string[];

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.secrets = [config.STRIPE_WEBHOOK_SECRET, config.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
      (secret): secret is string => Boolean(secret),
    );
  }

  verify(rawBody: Buffer | undefined, signature: string | undefined): VerifiedStripeEvent {
    if (!rawBody || !signature) throw new InvalidWebhookSignatureError();
    for (const secret of this.secrets) {
      try {
        // Refuse aussi une signature de plus de 5 minutes (protection contre le rejeu).
        const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
        return { id: event.id, type: event.type, object: event.data.object };
      } catch {
        // Essaie le secret suivant (endpoint « compte » puis endpoint « Connect »).
      }
    }
    throw new InvalidWebhookSignatureError();
  }
}
