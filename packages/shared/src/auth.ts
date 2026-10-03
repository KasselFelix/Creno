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

/**
 * Première étape de l'inscription : une adresse, rien d'autre. Le reste du profil est saisi depuis
 * le lien reçu par email, donc par le titulaire de la boîte mail.
 */
export const registerSchema = z.object({ email: emailSchema });
export type RegisterInput = z.infer<typeof registerSchema>;

/** Durée de validité du lien envoyé à l'inscription. */
export const EMAIL_VERIFICATION_TTL_HOURS = 24;

/** Seconde étape, depuis le lien : le jeton prouve l'adresse, le reste crée le compte. */
export const completeRegistrationSchema = z.object({
  // Le format précis est vérifié par l'API : un lien abîmé donne la même erreur qu'un lien expiré.
  token: z.string().min(1, { error: "Lien d'inscription requis" }).max(200),
  password: passwordSchema,
  fullName: fullNameSchema,
  role: registrableRoleSchema,
});
export type CompleteRegistrationInput = z.infer<typeof completeRegistrationSchema>;

/** Contenu du job d'email d'inscription : un identifiant, jamais d'adresse ni de jeton. */
export const registrationEmailJobSchema = z.object({ pendingRegistrationId: z.uuid() });
export type RegistrationEmailJob = z.infer<typeof registrationEmailJobSchema>;

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
