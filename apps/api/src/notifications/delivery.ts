/** Jetons d'injection des passerelles d'envoi : les adapters réels sont remplacés par des faux dans les tests. */
export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');
export const SMS_GATEWAY = Symbol('SMS_GATEWAY');

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Deux envois avec la même clé ne donnent qu'un email (si le fournisseur le permet). */
  idempotencyKey: string;
}

export interface SmsMessage {
  /** Numéro au format international (E.164). */
  to: string;
  body: string;
}

export interface Delivery {
  /** Identifiant du message chez le fournisseur, s'il en donne un. */
  messageId: string | null;
}

export interface EmailGateway {
  send(message: EmailMessage): Promise<Delivery>;
}

export interface SmsGateway {
  send(message: SmsMessage): Promise<Delivery>;
}

export type DeliveryFailure =
  'not_configured' | 'timeout' | 'network' | 'invalid_response' | `http_${number}`;

/**
 * Échec d'un envoi. `reason` est loggable et enregistrable : il ne contient ni destinataire ni
 * contenu. `retryable` : un nouvel essai peut réussir (panne, débit dépassé), sinon l'envoi est
 * abandonné (adresse ou numéro refusé).
 */
export class DeliveryError extends Error {
  constructor(
    readonly reason: DeliveryFailure,
    readonly retryable: boolean,
  ) {
    super(`Envoi impossible (${reason})`);
    this.name = 'DeliveryError';
  }
}

const TIMEOUT_MS = 10_000;

/**
 * Appel HTTP d'un fournisseur d'envoi, avec timeout ; renvoie le corps JSON de la réponse. 408, 429 et 5xx se retentent ; 401 et 403
 * aussi (clé à corriger de notre côté, le message reste valable) ; un autre 4xx est un refus du
 * message lui-même.
 */
export async function postToProvider(
  fetchFn: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { accept: 'application/json', ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new DeliveryError(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      true,
    );
  }
  if (!res.ok) {
    const retryable = res.status >= 500 || [401, 403, 408, 429].includes(res.status);
    throw new DeliveryError(`http_${res.status}`, retryable);
  }
  // 2xx : le message est accepté. Un corps illisible ne fait perdre que l'identifiant du message.
  return res.json().catch(() => undefined);
}

/** Sans configuration, rien ne part : la notification est marquée `skipped`. */
export class UnconfiguredGateway implements EmailGateway, SmsGateway {
  send(): Promise<Delivery> {
    return Promise.reject(new DeliveryError('not_configured', false));
  }
}
