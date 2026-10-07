/**
 * Content Security Policy des pages. Le nonce (valeur aléatoire par requête) autorise les scripts
 * de Next et celui de `next-themes` ; `strict-dynamic` étend la confiance aux scripts qu'ils
 * chargent. Toute page devient dynamique : une page pré-rendue au build n'aurait pas de nonce.
 */
export function contentSecurityPolicy(nonce: string, { dev }: { dev: boolean }): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // `unsafe-eval` : seulement en dev, pour le rechargement à chaud de Next.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Mapbox et FullCalendar posent des styles inline.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://*.mapbox.com'],
    'font-src': ["'self'"],
    // Mapbox (tuiles, styles, télémétrie). Sentry passe par le tunnel /monitoring (même origine).
    'connect-src': ["'self'", 'https://*.mapbox.com', ...(dev ? ['ws:'] : [])],
    // Mapbox GL dessine la carte dans des workers créés depuis un blob.
    'worker-src': ["'self'", 'blob:'],
    'child-src': ['blob:'],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    // Le paiement est une navigation (window.location) vers Stripe, pas un formulaire.
    'form-action': ["'self'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!dev) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** Nonce de 128 bits, en base64 (Web Crypto : disponible dans proxy.ts). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
