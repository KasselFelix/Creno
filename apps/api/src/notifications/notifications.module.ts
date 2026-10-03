import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import {
  EMAIL_GATEWAY,
  type EmailGateway,
  SMS_GATEWAY,
  type SmsGateway,
  UnconfiguredGateway,
} from './delivery.js';
import { MailpitEmailGateway } from './mailpit-email-gateway.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsWorker } from './notifications.worker.js';
import { ResendEmailGateway } from './resend-email-gateway.js';
import { TwilioSmsGateway } from './twilio-sms-gateway.js';

@Module({
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsWorker,
    {
      provide: EMAIL_GATEWAY,
      inject: [APP_CONFIG],
      // Resend si la clé est là ; sinon Mailpit (boîte de réception de dev) ; sinon rien ne part.
      useFactory: (config: AppConfig): EmailGateway => {
        if (config.RESEND_API_KEY) {
          return new ResendEmailGateway(config.RESEND_API_KEY, config.EMAIL_FROM);
        }
        if (config.MAILPIT_URL)
          return new MailpitEmailGateway(config.MAILPIT_URL, config.EMAIL_FROM);
        return new UnconfiguredGateway();
      },
    },
    {
      provide: SMS_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SmsGateway =>
        config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM
          ? new TwilioSmsGateway(
              config.TWILIO_ACCOUNT_SID,
              config.TWILIO_AUTH_TOKEN,
              config.TWILIO_FROM,
            )
          : new UnconfiguredGateway(),
    },
  ],
  // La passerelle email sert aussi aux emails d'inscription (module auth).
  exports: [NotificationsService, EMAIL_GATEWAY],
})
export class NotificationsModule {}
