export const DEFAULT_AFTER_LOGIN = '/account';

/**
 * Destination après connexion (`?next=`). N'accepte qu'un chemin interne : pas d'URL absolue ni
 * de `//hôte`, pour qu'un lien piégé ne redirige pas vers un autre site (open redirect).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return DEFAULT_AFTER_LOGIN;
  }
  return next;
}
