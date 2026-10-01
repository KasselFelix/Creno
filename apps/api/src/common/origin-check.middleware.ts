import type { NextFunction, Request, Response } from 'express';
import { apiErrorSchema } from '@creno/shared';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Défense en profondeur contre le CSRF (en plus de SameSite) : une requête qui modifie des données
 * et annonce une origine doit venir du front. Sans en-tête Origin (curl, appels serveur à serveur),
 * elle passe : ce sont les cookies SameSite qui protègent alors.
 */
export function originCheck(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (!UNSAFE_METHODS.has(req.method) || !origin || origin === allowedOrigin) {
      next();
      return;
    }
    res.status(403).json(
      apiErrorSchema.parse({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Origine non autorisée.',
      }),
    );
  };
}
