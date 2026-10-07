import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

describe('scrubEvent (web)', () => {
  it('retire la position et l’adresse de /search, les cookies et les en-têtes sensibles', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://creno.test/search?lat=48.1&lng=2.3&place=10%20rue',
        query_string: 'lat=48.1&lng=2.3',
        cookies: { creno_at: 'jeton' },
        headers: { Cookie: 'creno_at=jeton', 'x-creno-client-ip': '203.0.113.1', Accept: '*/*' },
      },
      user: { id: 'u1', ip_address: '203.0.113.1' },
    });
    expect(event.request).toEqual({ url: 'https://creno.test/search', headers: { Accept: '*/*' } });
    expect(event.user).toEqual({ id: 'u1' });
  });

  it('garde la query des autres pages', () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: 'https://creno.test/bookings?page=2', query_string: 'page=2' },
    });
    expect(event.request).toEqual({
      url: 'https://creno.test/bookings?page=2',
      query_string: 'page=2',
    });
  });
});

describe('scrubBreadcrumb', () => {
  it('nettoie les navigations et les appels de recherche ou de géocodage', () => {
    expect(
      scrubBreadcrumb({ category: 'navigation', data: { from: '/', to: '/search?lat=1&lng=2' } })
        .data,
    ).toEqual({ from: '/', to: '/search' });
    expect(
      scrubBreadcrumb({ category: 'fetch', data: { url: '/api/v1/geocoding/search?q=10%20rue' } })
        .data,
    ).toEqual({ url: '/api/v1/geocoding/search' });
    expect(
      scrubBreadcrumb({ category: 'fetch', data: { url: '/api/v1/bookings?page=2' } }).data,
    ).toEqual({ url: '/api/v1/bookings?page=2' });
  });
});
