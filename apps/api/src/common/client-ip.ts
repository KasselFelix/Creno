import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { CLIENT_IP_HEADERS } from '@creno/shared';

declare global {
  // Augmentation de la requête Express (même mécanisme que `req.user` de Passport).
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** IP du visiteur : celle transmise par le front (secret valide), sinon celle de la connexion. */
      clientIp?: string;
      /** D'où vient `clientIp` : journalisé (sans l'IP) pour vérifier en production que le secret passe. */
      ipSource?: 'header' | 'socket';
    }
  }
}

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Le front (serveur Next sur Vercel) appelle l'API pour le compte du visiteur : sans ce relais,
 * toutes les requêtes auraient l'IP de Vercel et partageraient les mêmes compteurs de rate limit.
 * L'IP transmise n'est crue que si le secret partagé l'accompagne ; sinon (Stripe, appel direct,
 * dev local), on garde `req.ip`, calculée par Express selon `TRUST_PROXY`.
 */
export function clientIpMiddleware(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const forwarded = req.headers[CLIENT_IP_HEADERS.ip];
    const proof = req.headers[CLIENT_IP_HEADERS.secret];
    const trusted =
      secret !== undefined &&
      typeof proof === 'string' &&
      typeof forwarded === 'string' &&
      isIP(forwarded) !== 0 &&
      sameSecret(proof, secret);
    req.clientIp = trusted ? forwarded : req.ip;
    req.ipSource = trusted ? 'header' : 'socket';
    next();
  };
}

interface TrackedRequest {
  clientIp?: string;
  ip?: string;
  user?: { id: string };
}

/** Clé de rate limit par IP réelle du visiteur. */
export function trackByIp(req: Record<string, unknown>): string {
  const { clientIp, ip } = req as TrackedRequest;
  return `ip:${clientIp ?? ip ?? 'unknown'}`;
}

/**
 * Par utilisateur s'il est connecté, sinon par IP. Réservé aux limites qui protègent la charge de
 * l'API (`public`, `bookings`) : celles qui protègent un coût par envoi (SMS, IA) ou des identifiants
 * restent par IP, sinon chaque compte créé ouvrirait un nouveau quota.
 */
export function trackByUserOrIp(req: Record<string, unknown>): string {
  const { user } = req as TrackedRequest;
  return user?.id ? `user:${user.id}` : trackByIp(req);
}
