import { type NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIES } from '@creno/shared';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const PROTECTED_PREFIXES = ['/account', '/dashboard'];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/** Demande de nouveaux cookies à l'API. Renvoie les en-têtes Set-Cookie (ou ceux qui effacent la session). */
async function refreshSession(request: NextRequest, refreshToken: string) {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `${AUTH_COOKIES.refresh}=${refreshToken}`,
        'user-agent': request.headers.get('user-agent') ?? '',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
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

/**
 * S'exécute avant chaque page (c'est le « middleware » de Next 16) :
 * 1. renouvelle la session côté serveur quand l'access token a expiré ;
 * 2. redirige les pages protégées vers /login quand il n'y a aucun cookie de session.
 * Contrôle de confort uniquement, basé sur la PRÉSENCE d'un cookie : il ne dit pas si la session est
 * encore valide. C'est pourquoi « déjà connecté → quitter /login » est décidé par les pages, après
 * vérification auprès de l'API : sinon un cookie périmé ferait boucler /account ⇄ /login.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let authenticated = request.cookies.has(AUTH_COOKIES.access);
  const refreshToken = request.cookies.get(AUTH_COOKIES.refresh)?.value;

  let setCookies: string[] = [];
  let requestHeaders: Headers | undefined;
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
    response = NextResponse.next(
      requestHeaders ? { request: { headers: requestHeaders } } : undefined,
    );
  }

  // Les attributs (HttpOnly, SameSite, Max-Age) décidés par l'API sont transmis tels quels.
  for (const line of setCookies) response.headers.append('set-cookie', line);
  return response;
}

export const config = {
  // Toutes les pages, sauf l'API (rewrite), les fichiers statiques et les images.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'],
};
