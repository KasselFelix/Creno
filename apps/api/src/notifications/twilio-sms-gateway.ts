import { z } from 'zod';
import { type Delivery, postToProvider, type SmsGateway, type SmsMessage } from './delivery.js';

const responseSchema = z.object({ sid: z.string() });

/**
 * Envoi de SMS par l'API HTTP de Twilio (https://www.twilio.com/docs/messaging/api/message-resource).
 * Twilio n'a pas de clé d'idempotence : si le processus meurt entre l'envoi et l'enregistrement du
 * statut, le job rejoué renvoie le SMS. Cas rare, accepté (voir docs/adr/0010).
 */
export class TwilioSmsGateway implements SmsGateway {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    /** Numéro expéditeur (E.164) ou identifiant d'un Messaging Service (`MG…`). */
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<Delivery> {
    const form = new URLSearchParams({ To: message.to, Body: message.body });
    form.set(this.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', this.from);
    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const body = await postToProvider(
      this.fetchFn,
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    const parsed = responseSchema.safeParse(body);
    return { messageId: parsed.success ? parsed.data.sid : null };
  }
}
