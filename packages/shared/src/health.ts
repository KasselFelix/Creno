import { z } from 'zod';

const indicatorSchema = z.looseObject({ status: z.enum(["up", "down"]) });

/** Réponse de `GET /health/ready` (format @nestjs/terminus). */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  info: z.record(z.string(), indicatorSchema).optional(),
  error: z.record(z.string(), indicatorSchema).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
