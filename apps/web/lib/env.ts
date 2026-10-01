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
});

export function parsePublicEnv(env: Record<string, string | undefined>) {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_MAPBOX_TOKEN: env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined,
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
});
