import type { Delivery, SmsGateway, SmsMessage } from './delivery.js';
import { MailpitEmailGateway } from './mailpit-email-gateway.js';

/**
 * SMS de développement : sans compte Twilio, chaque SMS arrive dans Mailpit sous forme d'email
 * adressé à `<numéro>@sms.mailpit.local`. Rien ne part vers un vrai téléphone. Jamais en
 * production (`MAILPIT_URL` y est refusée).
 */
export class MailpitSmsGateway implements SmsGateway {
  private readonly mailpit: MailpitEmailGateway;

  constructor(baseUrl: string, fetchFn: typeof fetch = fetch) {
    this.mailpit = new MailpitEmailGateway(baseUrl, 'SMS Creno <sms@sms.mailpit.local>', fetchFn);
  }

  send(message: SmsMessage): Promise<Delivery> {
    return this.mailpit.send({
      to: `${message.to}@sms.mailpit.local`,
      subject: `SMS pour ${message.to}`,
      text: message.body,
      html: `<pre>${escapeHtml(message.body)}</pre>`,
      idempotencyKey: '',
    });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
