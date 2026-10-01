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
  .regex(/^\+[1-9]\d{6,14}$/, { error: 'Numéro au format international, ex. +33612345678' });

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

export const updateMeSchema = z
  .object({ fullName: fullNameSchema, phone: phoneSchema.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucune modification' });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

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
