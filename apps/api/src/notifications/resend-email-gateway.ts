import { z } from 'zod';
import { type Delivery, type EmailGateway, type EmailMessage, postToProvider } from './delivery.js';

const responseSchema = z.object({ id: z.string() });

/** Envoi d'emails par l'API HTTP de Resend (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailGateway implements EmailGateway {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<Delivery> {
    const body = await postToProvider(this.fetchFn, 'https://api.resend.com/emails', {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        // Un job rejoué après un envoi réussi ne produit pas un second email (clé gardée 24 h).
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    const parsed = responseSchema.safeParse(body);
    return { messageId: parsed.success ? parsed.data.id : null };
  }
}
