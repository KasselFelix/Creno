import { z } from 'zod';
import { type Delivery, type EmailGateway, type EmailMessage, postToProvider } from './delivery.js';

const responseSchema = z.object({ ID: z.string() });

/** `Nom <adresse>` ou `adresse` → les deux champs attendus par Mailpit. */
export function parseSender(from: string): { Email: string; Name?: string } {
  const match = /^(.*) <([^<>]+)>$/.exec(from);
  return match ? { Name: match[1]!.trim(), Email: match[2]! } : { Email: from };
}

/**
 * Boîte de réception de développement (Mailpit, service docker `mailpit`) : les emails n'arrivent
 * nulle part ailleurs que dans son interface web. Jamais en production.
 */
export class MailpitEmailGateway implements EmailGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<Delivery> {
    const body = await postToProvider(
      this.fetchFn,
      `${this.baseUrl.replace(/\/$/, '')}/api/v1/send`,
      {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: parseSender(this.from),
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
        }),
      },
    );
    const parsed = responseSchema.safeParse(body);
    return { messageId: parsed.success ? parsed.data.ID : null };
  }
}
