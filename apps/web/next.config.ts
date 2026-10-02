import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Le navigateur appelle /api/* sur le domaine du front : les cookies httpOnly restent first-party.
  // L'adresse de `/search` porte la position du visiteur : un autre site (Mapbox, lien sortant) ne
  // reçoit que l'origine, jamais le chemin ni la query string.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
