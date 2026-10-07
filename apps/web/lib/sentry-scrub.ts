import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// Pages et appels dont la query string porte la position du visiteur ou l'adresse tapée.
const PRIVATE_QUERY = /\/(search|api\/v1\/search|api\/v1\/geocoding)(\/|\?|$)/i;

function withoutPrivateQuery(url: string): string {
  return PRIVATE_QUERY.test(url) ? url.split('?')[0]! : url;
}

/** Dernier filtre avant l'envoi à Sentry : ni position, ni adresse, ni cookie, ni corps. */
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
      const cleaned = withoutPrivateQuery(request.url);
      if (cleaned !== request.url) {
        request.url = cleaned;
        delete request.query_string;
      }
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
    if (typeof cleaned[key] === 'string') cleaned[key] = withoutPrivateQuery(cleaned[key]);
  }
  return { ...breadcrumb, data: cleaned };
}
