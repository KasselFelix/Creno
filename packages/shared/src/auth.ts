import { z } from 'zod';
import { emailSchema, fullNameSchema, publicUserSchema } from './users.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `${PASSWORD_MIN_LENGTH} caractères minimum` })
  .max(PASSWORD_MAX_LENGTH, { error: `${PASSWORD_MAX_LENGTH} caractères maximum` });

/** Rôles choisissables à l'inscription : `admin` n'en fait jamais partie. */
export const registrableRoleSchema = z.enum(['customer', 'provider']);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  role: registrableRoleSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Pas de règle de longueur au login : on ne révèle pas la politique, on compare au hash.
  password: z.string().min(1, { error: 'Mot de passe requis' }).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const authResponseSchema = z.object({ user: publicUserSchema });
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const sessionSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionListSchema = z.object({ items: z.array(sessionSchema) });
export type SessionList = z.infer<typeof sessionListSchema>;

/** Noms des cookies d'authentification (posés par l'API, lus par le proxy Next). */
export const AUTH_COOKIES = { access: 'creno_at', refresh: 'creno_rt' } as const;
