import { z } from 'zod';
import { resourceSchema } from './resources.js';

export const providerCategories = [
  'room',
  'hairdresser',
  'sports_field',
  'photographer',
  'other',
] as const;
export const providerCategorySchema = z.enum(providerCategories);
export type ProviderCategory = z.infer<typeof providerCategorySchema>;

const text = (max: number, required: string) =>
  z
    .string()
    .trim()
    .min(1, { error: required })
    .max(max, { error: `${max} caractères maximum` });

export const createProviderSchema = z.object({
  name: text(100, 'Nom requis'),
  category: providerCategorySchema,
  description: z.string().trim().max(2000, { error: '2000 caractères maximum' }),
  address: text(200, 'Adresse requise'),
  city: text(100, 'Ville requise'),
  // Remplies par le formulaire à partir de la suggestion d'adresse choisie (géocodage).
  latitude: z
    .number({ error: 'Latitude requise' })
    .min(-90, { error: 'Entre -90 et 90' })
    .max(90, { error: 'Entre -90 et 90' }),
  longitude: z
    .number({ error: 'Longitude requise' })
    .min(-180, { error: 'Entre -180 et 180' })
    .max(180, { error: 'Entre -180 et 180' }),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = createProviderSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucune modification' });
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

/** Profil prestataire tel qu'exposé par l'API : ni `userId` ni `stripeAccountId`. */
export const providerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  category: providerCategorySchema,
  description: z.string(),
  address: z.string(),
  city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});
export type Provider = z.infer<typeof providerSchema>;

/** Fiche publique : le profil et ses ressources actives. */
export const publicProviderSchema = providerSchema.extend({ resources: z.array(resourceSchema) });
export type PublicProvider = z.infer<typeof publicProviderSchema>;
