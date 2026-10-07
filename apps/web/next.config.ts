import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

// `/api/*` est relayé vers l'API par proxy.ts (avec l'IP du visiteur), plus par un rewrite : le
// navigateur appelle toujours le domaine du front, et les cookies httpOnly restent first-party.
// La Content Security Policy, qui porte un nonce par requête, est posée par proxy.ts aussi.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // L'adresse de `/search` porte la position du visiteur : un autre site (Mapbox, lien
          // sortant) ne reçoit que l'origine, jamais le chemin ni la query string.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // « Me localiser » sur la recherche : géolocalisation pour nous seuls, rien d'autre.
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self), camera=(), microphone=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Sourcemaps envoyées seulement si le jeton est là (build Vercel) ; sinon, build normal.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Les événements du navigateur passent par le front (/monitoring) : pas de domaine Sentry dans la
  // CSP, et les bloqueurs de publicité ne les arrêtent pas.
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
  telemetry: false,
});
