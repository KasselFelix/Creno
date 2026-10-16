import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nestjs', () => ({ captureException }));

const { captureLogLine, scrubEvent, sentryErrorStream } = await import('./sentry.js');
const { REDACT_PATHS } = await import('./logger.js');

describe('scrubEvent', () => {
  it('retire cookies, jetons, IP transmise, corps, et réduit l’utilisateur à son id', () => {
    const event = scrubEvent({
      request: {
        url: 'https://api.creno.test/v1/bookings',
        cookies: { creno_at: 'jeton' },
        data: { password: 'secret' },
        headers: {
          Authorization: 'Bearer jeton',
          cookie: 'creno_at=jeton',
          'x-creno-client-ip': '203.0.113.7',
          'x-creno-proxy-secret': 'secret-partage',
          'user-agent': 'Mozilla',
        },
        query_string: 'page=2',
      },
      user: { id: 'u1', email: 'lea@example.com', ip_address: '203.0.113.7' },
    });
    expect(event.request).toEqual({
      url: 'https://api.creno.test/v1/bookings',
      headers: { 'user-agent': 'Mozilla' },
      query_string: 'page=2',
    });
    expect(event.user).toEqual({ id: 'u1' });
  });

  it('retire la position et l’adresse de la recherche et du géocodage', () => {
    for (const path of ['/v1/search/providers', '/v1/geocoding/search', '/V1/Search/interpret']) {
      const event = scrubEvent({
        request: {
          url: `https://api.creno.test${path}?lat=48.1&lng=2.3`,
          query_string: 'lat=48.1',
        },
      });
      expect(event.request).toEqual({ url: `https://api.creno.test${path}` });
    }
  });
});

describe('logs error → Sentry', () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it('une erreur loggée part dans Sentry sans les valeurs masquées par pino', async () => {
    const stream = sentryErrorStream();
    const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, stream);
    logger.error(
      {
        event: 'notification.failed',
        notificationId: 'n1',
        email: 'lea@example.com',
        meta: { token: 'jeton-secret' },
        err: { name: 'DeliveryError', message: 'refusé', stack: 'DeliveryError: refusé\n    at x' },
      },
      'échec',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(captureException).toHaveBeenCalledOnce();
    const [error, context] = captureException.mock.calls[0]!;
    expect(error).toMatchObject({ name: 'DeliveryError', message: 'refusé' });
    expect(context).toMatchObject({
      tags: { event: 'notification.failed' },
      extra: { notificationId: 'n1' },
    });
    const sent = JSON.stringify([error, context, (error as Error).stack]);
    expect(sent).not.toContain('lea@example.com');
    expect(sent).not.toContain('jeton-secret');
  });

  it('ignore les niveaux inférieurs à error et les lignes illisibles', () => {
    captureLogLine(JSON.stringify({ level: 40, event: 'notification.retry' }));
    captureLogLine('pas du json');
    expect(captureException).not.toHaveBeenCalled();
  });
});
