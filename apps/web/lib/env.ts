import { z } from 'zod';

/**
 * Variables d'environnement lues par le navigateur. Next les recopie dans le JavaScript envoyé au
 * client : rien de sensible ici. Chaque variable doit être écrite en toutes lettres
 * (`process.env.NEXT_PUBLIC_…`) pour être remplacée à la compilation.
 */
const publicEnvSchema = z.object({
  // Token PUBLIC Mapbox (`pk.…`), restreint par URL chez Mapbox. Un token secret (`sk.…`) est refusé.
  // Facultatif : sans lui, la recherche fonctionne en liste seule.
  NEXT_PUBLIC_MAPBOX_TOKEN: z
    .string()
    .regex(/^pk\./, { error: 'token public attendu (pk.…), jamais un token secret' })
    .optional(),
  // Démo publique (paiements Stripe en mode test) : bandeau en haut de chaque page.
  NEXT_PUBLIC_DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // DSN Sentry du front : public par nature (il ne permet que d'envoyer des erreurs).
  NEXT_PUBLIC_SENTRY_DSN: z.url({ protocol: /^https$/ }).optional(),
});

export function parsePublicEnv(env: Record<string, string | undefined>) {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_MAPBOX_TOKEN: env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined,
    NEXT_PUBLIC_DEMO_MODE: env.NEXT_PUBLIC_DEMO_MODE || undefined,
    NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  });
  if (!result.success) {
    // On n'affiche que le nom de la variable et la règle, jamais la valeur.
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuration web invalide : ${problems}`);
  }
  return result.data;
}

export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
