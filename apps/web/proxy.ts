import { type NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIES, CLIENT_IP_HEADERS } from '@creno/shared';
import { API_TIMEOUT_MS, apiInternalUrl, clientIpHeaders } from '@/lib/api/upstream';
import { contentSecurityPolicy, generateNonce } from '@/lib/csp';
const PROTECTED_PREFIXES = ['/account', '/dashboard', '/bookings'];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/** Demande de nouveaux cookies à l'API. Renvoie les en-têtes Set-Cookie (ou ceux qui effacent la session). */
async function refreshSession(request: NextRequest, refreshToken: string) {
  try {
    const res = await fetch(`${apiInternalUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `${AUTH_COOKIES.refresh}=${refreshToken}`,
        'user-agent': request.headers.get('user-agent') ?? '',
        ...clientIpHeaders(request.headers),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    return { ok: res.ok, setCookies: res.headers.getSetCookie() };
  } catch {
    return { ok: false, setCookies: [] };
  }
}

/** Cookie de requête mis à jour, pour que les Server Components voient déjà la session renouvelée. */
function withRefreshedCookies(request: NextRequest, setCookies: string[]): Headers {
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) request.cookies.set(name, value);
    else request.cookies.delete(name);
  }
  return new Headers(request.headers);
}

/** Seules les routes versionnées de l'API sont relayées (le navigateur n'appelle rien d'autre). */
const API_PREFIX = '/api/v1/';

/**
 * Appel du navigateur à l'API (`/api/v1/*` sur le domaine du front, cookies first-party) : relayé
 * vers l'API, avec l'IP du visiteur et le secret qui la garantit. Les en-têtes `x-creno-*` envoyés
 * par le navigateur sont retirés : seul ce serveur peut les poser.
 *
 * La cible garde toujours l'hôte de l'API : on ne remplace que son chemin. `new URL(chemin, base)`
 * suivrait un chemin comme `//autre-site/x` vers un autre hôte, qui recevrait le secret partagé.
 */
function forwardToApi(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const api = new URL(apiInternalUrl());
  const target = new URL(api);
  target.pathname = pathname.slice('/api'.length);
  target.search = search;
  if (!pathname.startsWith(API_PREFIX) || pathname.includes('//') || target.origin !== api.origin) {
    return NextResponse.json(
      { statusCode: 404, code: 'NOT_FOUND', message: 'Élément introuvable.' },
      { status: 404 },
    );
  }

  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADERS.ip);
  headers.delete(CLIENT_IP_HEADERS.secret);
  for (const [name, value] of Object.entries(clientIpHeaders(request.headers))) {
    headers.set(name, value);
  }
  return NextResponse.rewrite(target, { request: { headers } });
}

/**
 * S'exécute avant chaque requête (c'est le « middleware » de Next 16) :
 * 1. relaie `/api/v1/*` vers l'API ;
 * 2. pose la Content Security Policy des pages, avec un nonce neuf ;
 * 3. renouvelle la session côté serveur quand l'access token a expiré ;
 * 4. redirige les pages protégées vers /login quand il n'y a aucun cookie de session.
 * Contrôle de confort uniquement, basé sur la PRÉSENCE d'un cookie : il ne dit pas si la session est
 * encore valide. C'est pourquoi « déjà connecté → quitter /login » est décidé par les pages, après
 * vérification auprès de l'API : sinon un cookie périmé ferait boucler /account ⇄ /login.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/api' || pathname.startsWith('/api/')) return forwardToApi(request);

  let authenticated = request.cookies.has(AUTH_COOKIES.access);
  const refreshToken = request.cookies.get(AUTH_COOKIES.refresh)?.value;

  let setCookies: string[] = [];
  let requestHeaders = new Headers(request.headers);
  if (!authenticated && refreshToken) {
    const refreshed = await refreshSession(request, refreshToken);
    authenticated = refreshed.ok;
    setCookies = refreshed.setCookies;
    requestHeaders = withRefreshedCookies(request, setCookies);
  }

  let response: NextResponse;
  if (!authenticated && matches(pathname, PROTECTED_PREFIXES)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    response = NextResponse.redirect(login);
  } else {
    // Next lit la CSP de la requête pour poser le nonce sur ses propres scripts ; le layout le lit
    // dans `x-nonce` pour le script de next-themes.
    const nonce = generateNonce();
    const policy = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === 'development' });
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', policy);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('content-security-policy', policy);
  }

  // Les attributs (HttpOnly, SameSite, Max-Age) décidés par l'API sont transmis tels quels.
  for (const line of setCookies) response.headers.append('set-cookie', line);
  return response;
}

export const config = {
  // Toutes les requêtes, sauf les fichiers statiques, les images et le tunnel Sentry (/monitoring).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.[a-z0-9]+$).*)'],
};
