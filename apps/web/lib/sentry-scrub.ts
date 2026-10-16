import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// Pages et appels dont la query string porte la position du visiteur ou l'adresse tapée.
const PRIVATE_QUERY = /\/(search|api\/v1\/search|api\/v1\/geocoding)(\/|\?|$)/i;

/**
 * URL publiable : jamais de fragment (le lien d'inscription y porte son jeton, `#…`), et pas de
 * query sur la recherche (position, adresse).
 */
function cleanUrl(url: string): string {
  const withoutFragment = url.split('#')[0]!;
  return PRIVATE_QUERY.test(withoutFragment) ? withoutFragment.split('?')[0]! : withoutFragment;
}

/** Dernier filtre avant l'envoi à Sentry : ni jeton, ni position, ni adresse, ni cookie, ni corps. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const request = { ...event.request };
    delete request.cookies;
    delete request.data;
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) => !/^(authorization|cookie|x-creno-)/i.test(name),
        ),
      );
    }
    if (request.url) {
      const cleaned = cleanUrl(request.url);
      // Query retirée (recherche) : sa copie aussi.
      if (!cleaned.includes('?')) delete request.query_string;
      request.url = cleaned;
    }
    event.request = request;
  }
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  return event;
}

/** Fil d'Ariane (navigations, fetch) : mêmes règles pour les URL qu'il garde. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  const cleaned = { ...data };
  for (const key of ['url', 'from', 'to']) {
    if (typeof cleaned[key] === 'string') cleaned[key] = cleanUrl(cleaned[key]);
  }
  return { ...breadcrumb, data: cleaned };
}
