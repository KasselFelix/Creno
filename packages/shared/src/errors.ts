import { z } from 'zod';

/** Codes d'erreur métier partagés entre l'API et le front. */
export const errorCodes = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
  'SLOT_UNAVAILABLE',
  'ALREADY_EXISTS',
  'INVALID_REFERENCE',
  'FORBIDDEN_OWNERSHIP',
  'REGISTRATION_LINK_INVALID',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'TOO_MANY_REQUESTS',
  'PROVIDER_PROFILE_REQUIRED',
  'SLOT_NOT_OFFERED',
  'HOLD_LIMIT_REACHED',
  'LIMIT_REACHED',
  'GEOCODING_UNAVAILABLE',
  'BOOKING_NOT_PAYABLE',
  'PROVIDER_PAYMENTS_NOT_READY',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'CANCELLATION_NOT_ALLOWED',
  'INVALID_WEBHOOK_SIGNATURE',
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
