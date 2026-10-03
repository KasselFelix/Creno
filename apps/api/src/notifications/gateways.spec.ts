import { describe, expect, it, vi } from 'vitest';
import { DeliveryError, UnconfiguredGateway } from './delivery.js';
import { MailpitEmailGateway, parseSender } from './mailpit-email-gateway.js';
import { MailpitSmsGateway } from './mailpit-sms-gateway.js';
import { ResendEmailGateway } from './resend-email-gateway.js';
import { TwilioSmsGateway } from './twilio-sms-gateway.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const message = {
  to: 'client@test.dev',
  subject: 'Réservation confirmée',
  html: '<p>Bonjour</p>',
  text: 'Bonjour',
  idempotencyKey: 'notification-1',
};

// Fausses clés construites à l'exécution : aucune chaîne en forme de secret dans le dépôt.
const resendKey = ['re', 'x'.repeat(24)].join('_');
const twilioSid = `AC${'a'.repeat(32)}`;
const twilioToken = 'b'.repeat(32);

async function failure(promise: Promise<unknown>): Promise<DeliveryError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DeliveryError);
  return error as DeliveryError;
}

/** La requête envoyée par le dernier appel du faux `fetch`. */
function requestOf(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [url, init] = fetchFn.mock.calls.at(-1)!;
  return {
    url: String(url),
    headers: init?.headers as Record<string, string>,
    body: String(init?.body),
    method: init?.method,
  };
}

describe('ResendEmailGateway', () => {
  const gatewayWith = (fetchFn: typeof fetch) =>
    new ResendEmailGateway(resendKey, 'Creno <bonjour@creno.test>', fetchFn);

  it('envoie le message avec la clé d’API et la clé d’idempotence', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ id: 'msg_1' }));

    expect(await gatewayWith(fetchFn).send(message)).toEqual({ messageId: 'msg_1' });

    const request = requestOf(fetchFn);
    expect(request.url).toBe('https://api.resend.com/emails');
    expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBe(`Bearer ${resendKey}`);
    expect(request.headers['idempotency-key']).toBe('notification-1');
    expect(JSON.parse(request.body)).toEqual({
      from: 'Creno <bonjour@creno.test>',
      to: ['client@test.dev'],
      subject: 'Réservation confirmée',
      html: '<p>Bonjour</p>',
      text: 'Bonjour',
    });
  });

  it.each([429, 500, 503, 401])('HTTP %i → erreur à retenter', async (status) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'non' }, status));
    const error = await failure(gatewayWith(fetchFn).send(message));
    expect(error).toMatchObject({ reason: `http_${status}`, retryable: true });
  });

  it('HTTP 422 (adresse refusée) → erreur définitive, sans le destinataire dans le message', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'invalid' }, 422));
    const error = await failure(gatewayWith(fetchFn).send(message));
    expect(error).toMatchObject({ reason: 'http_422', retryable: false });
    expect(error.message).not.toContain('client@test.dev');
  });

  it('délai dépassé ou réseau coupé → erreur à retenter', async () => {
    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    expect(await failure(gatewayWith(timeout).send(message))).toMatchObject({
      reason: 'timeout',
      retryable: true,
    });
    const network = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await failure(gatewayWith(network).send(message))).toMatchObject({
      reason: 'network',
      retryable: true,
    });
  });

  it('réponse 200 illisible → message considéré comme parti (pas de doublon au rejeu)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    expect(await gatewayWith(fetchFn).send(message)).toEqual({ messageId: null });
  });
});

describe('TwilioSmsGateway', () => {
  const sms = { to: '+33612345678', body: 'Creno - Rappel' };

  it('envoie le SMS en formulaire, avec une authentification Basic', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ sid: 'SM1' }, 201));
    const gateway = new TwilioSmsGateway(twilioSid, twilioToken, '+33700000000', fetchFn);

    expect(await gateway.send(sms)).toEqual({ messageId: 'SM1' });

    const request = requestOf(fetchFn);
    expect(request.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
    );
    expect(request.headers.authorization).toBe(
      `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
    );
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      To: '+33612345678',
      From: '+33700000000',
      Body: 'Creno - Rappel',
    });
  });

  it('utilise un Messaging Service quand l’expéditeur en est un', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ sid: 'SM2' }, 201));
    const service = `MG${'c'.repeat(32)}`;
    await new TwilioSmsGateway(twilioSid, twilioToken, service, fetchFn).send(sms);
    const form = new URLSearchParams(requestOf(fetchFn).body);
    expect(form.get('MessagingServiceSid')).toBe(service);
    expect(form.has('From')).toBe(false);
  });

  it('numéro refusé (400) → définitif ; débit dépassé (429) → à retenter', async () => {
    const gatewayWith = (status: number) =>
      new TwilioSmsGateway(
        twilioSid,
        twilioToken,
        '+33700000000',
        vi.fn<typeof fetch>().mockResolvedValue(json({ code: 21211 }, status)),
      );
    expect(await failure(gatewayWith(400).send(sms))).toMatchObject({
      reason: 'http_400',
      retryable: false,
    });
    expect(await failure(gatewayWith(429).send(sms))).toMatchObject({ retryable: true });
  });
});

describe('MailpitEmailGateway', () => {
  it('dépose le message dans la boîte de développement', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ID: 'mp_1' }));
    const gateway = new MailpitEmailGateway(
      'http://mailpit:8025/',
      'Creno <dev@creno.test>',
      fetchFn,
    );

    expect(await gateway.send(message)).toEqual({ messageId: 'mp_1' });

    const request = requestOf(fetchFn);
    expect(request.url).toBe('http://mailpit:8025/api/v1/send');
    expect(JSON.parse(request.body)).toEqual({
      From: { Name: 'Creno', Email: 'dev@creno.test' },
      To: [{ Email: 'client@test.dev' }],
      Subject: 'Réservation confirmée',
      Text: 'Bonjour',
      HTML: '<p>Bonjour</p>',
    });
  });

  it('accepte un expéditeur sans nom', () => {
    expect(parseSender('dev@creno.test')).toEqual({ Email: 'dev@creno.test' });
  });
});

describe('MailpitSmsGateway', () => {
  it('dépose le SMS dans Mailpit, adressé au numéro, texte échappé en HTML', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ID: 'mp_2' }));
    const gateway = new MailpitSmsGateway('http://mailpit:8025', fetchFn);

    expect(await gateway.send({ to: '+33639980001', body: 'Code <123456> & co' })).toEqual({
      messageId: 'mp_2',
    });

    expect(JSON.parse(requestOf(fetchFn).body)).toMatchObject({
      To: [{ Email: '+33639980001@sms.mailpit.local' }],
      Subject: 'SMS pour +33639980001',
      Text: 'Code <123456> & co',
      HTML: '<pre>Code &#60;123456&#62; &#38; co</pre>',
    });
  });
});

describe('passerelle non configurée', () => {
  it('refuse l’envoi sans appel réseau, et sans reprise', async () => {
    const error = await failure(new UnconfiguredGateway().send());
    expect(error).toMatchObject({ reason: 'not_configured', retryable: false });
  });
});
