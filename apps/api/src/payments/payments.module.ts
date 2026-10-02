import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ConnectService } from './connect.service.js';
import { PaymentsGatewayModule } from './payments-gateway.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsRepository } from './payments.repository.js';
import { StripeWebhookVerifier } from './stripe-webhook-verifier.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [PaymentsGatewayModule, BookingsModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsRepository, ConnectService, StripeWebhookVerifier, WebhookService],
})
export class PaymentsModule {}
