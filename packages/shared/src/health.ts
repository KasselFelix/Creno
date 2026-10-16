import { z } from 'zod';

const indicatorSchema = z.looseObject({ status: z.enum(['up', 'down']) });

/** Réponse de `GET /health/ready` (format @nestjs/terminus). */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  info: z.record(z.string(), indicatorSchema).optional(),
  error: z.record(z.string(), indicatorSchema).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Réponse de `GET /health` (vivacité) : `release` = SHA du commit déployé, `dev` en local. */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  release: z.string().min(1),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

/**
 * En-têtes posés par le front (serveur Next) sur chaque appel à l'API : l'IP du visiteur, et le
 * secret partagé qui prouve que c'est bien le front qui l'affirme. Sans le bon secret, l'API ignore
 * l'IP transmise et garde l'adresse de la connexion.
 */
export const CLIENT_IP_HEADERS = {
  ip: 'x-creno-client-ip',
  secret: 'x-creno-proxy-secret',
} as const;
