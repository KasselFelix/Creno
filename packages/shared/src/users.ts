import { z } from 'zod';

export const userRoles = ['customer', 'provider', 'admin'] as const;
export const userRoleSchema = z.enum(userRoles);
export type UserRole = z.infer<typeof userRoleSchema>;

// trim() d'abord : avec Zod 4, le format d'un z.email() serait vérifié avant le trim.
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ error: 'Adresse email invalide' }));

/** Numéro au format international E.164, ex. +33612345678. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, { error: 'Numéro au format international, ex. +33612345678' })
  // Numéro français : toujours 9 chiffres après +33 (sans le 0). Un numéro trop long serait
  // refusé par l'opérateur au moment d'envoyer le SMS.
  .refine((phone) => !phone.startsWith('+33') || /^\+33\d{9}$/.test(phone), {
    error: 'Numéro français : +33 suivi de 9 chiffres, sans le 0, ex. +33612345678',
  });

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Nom requis' })
  .max(100, { error: '100 caractères maximum' });

/** Utilisateur tel qu'exposé par l'API : jamais de hash ni de donnée interne. */
export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  role: userRoleSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

// Strict : le téléphone ne passe plus par ici, seulement par la vérification d'un code.
export const updateMeSchema = z
  .strictObject({ fullName: fullNameSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucune modification' });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Durée de validité d'un code de vérification du téléphone. */
export const PHONE_CODE_TTL_MINUTES = 10;
export const PHONE_CODE_LENGTH = 6;
/** Tentatives de saisie par code, la bonne comprise. */
export const PHONE_CODE_MAX_ATTEMPTS = 5;
/** Plafonds de demandes de code : par compte et par heure, par numéro (tous comptes) sur 24 h. */
export const PHONE_CODES_PER_ACCOUNT_PER_HOUR = 3;
export const PHONE_CODES_PER_NUMBER_PER_DAY = 5;

export const requestPhoneCodeSchema = z.object({ phone: phoneSchema });
export type RequestPhoneCodeInput = z.infer<typeof requestPhoneCodeSchema>;

export const phoneCodeRequestedSchema = z.object({ expiresAt: z.iso.datetime({ offset: true }) });
export type PhoneCodeRequested = z.infer<typeof phoneCodeRequestedSchema>;

export const verifyPhoneSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${PHONE_CODE_LENGTH}}$`), {
      error: `Code à ${PHONE_CODE_LENGTH} chiffres`,
    }),
});
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;

/** Contenu du job d'envoi du code : un identifiant, jamais de numéro ni de code. */
export const phoneCodeJobSchema = z.object({ phoneVerificationId: z.uuid() });
export type PhoneCodeJob = z.infer<typeof phoneCodeJobSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const userListSchema = z.object({
  items: z.array(publicUserSchema),
  total: z.number().int(),
});
export type UserList = z.infer<typeof userListSchema>;
