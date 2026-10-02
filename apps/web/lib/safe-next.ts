import type { UserRole } from '@creno/shared';

export const DEFAULT_AFTER_LOGIN = '/account';

/** Page d'arrivée après connexion quand aucune destination n'est demandée : chacun dans son espace. */
export function homeFor(role: UserRole): string {
  return role === 'provider' ? '/dashboard' : DEFAULT_AFTER_LOGIN;
}

/** Destination après connexion : `?next=` s'il désigne une page interne, sinon l'espace du rôle. */
export function afterLoginPath(next: string | null | undefined, role: UserRole): string {
  return next ? safeNextPath(next) : homeFor(role);
}

const PLACEHOLDER_ORIGIN = 'http://creno.invalid';
// Caractères de contrôle (dont tabulation et saut de ligne) et antislash.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

/**
 * Destination après connexion (`?next=`). N'accepte qu'un chemin interne, pour qu'un lien piégé ne
 * redirige pas vers un autre site (open redirect). On valide avec le parseur d'URL du navigateur,
 * pas avec des tests de chaîne : il supprime par exemple les tabulations, et `/\t/evil.com`
 * deviendrait `//evil.com`.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || UNSAFE_CHARACTERS.test(next)) return DEFAULT_AFTER_LOGIN;
  try {
    const url = new URL(next, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_AFTER_LOGIN;
    // Le parseur normalise `/./` et `/../` : `/.//evil.com` devient `//evil.com`, qu'un navigateur
    // lit comme un autre site. On revérifie donc le chemin APRÈS normalisation.
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith('//') ? DEFAULT_AFTER_LOGIN : path;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
