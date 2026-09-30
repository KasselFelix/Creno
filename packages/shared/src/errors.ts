import { z } from 'zod';

/** Codes d'erreur métier partagés entre l'API et le front. */
export const errorCodes = [
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
  'SLOT_UNAVAILABLE',
  'ALREADY_EXISTS',
  'INVALID_REFERENCE',
  'FORBIDDEN_OWNERSHIP',
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Format unique des erreurs renvoyées par l'API. */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
