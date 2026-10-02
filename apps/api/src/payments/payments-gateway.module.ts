import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import {
  PAYMENTS_GATEWAY,
  type PaymentsGateway,
  UnconfiguredPaymentsGateway,
} from './payments-gateway.js';
import { StripePaymentsGateway } from './stripe-payments-gateway.js';

/**
 * Fournit la passerelle de paiement seule : les modules `bookings` et `payments` l'importent tous
 * les deux, sans dépendre l'un de l'autre.
 */
@Module({
  providers: [
    {
      provide: PAYMENTS_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PaymentsGateway =>
        config.STRIPE_SECRET_KEY
          ? new StripePaymentsGateway(config.STRIPE_SECRET_KEY)
          : new UnconfiguredPaymentsGateway(),
    },
  ],
  exports: [PAYMENTS_GATEWAY],
})
export class PaymentsGatewayModule {}
