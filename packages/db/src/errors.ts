/** Code SQLSTATE d'une erreur pg, qu'elle soit brute ou enveloppée par Drizzle (`cause`). */
export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export const PG_DEADLOCK_DETECTED = '40P01';

/**
 * Rejoue `fn` si Postgres a interrompu la transaction pour deadlock.
 *
 * Deux INSERT simultanés sur un même créneau peuvent s'attendre mutuellement pendant la
 * vérification de la contrainte EXCLUDE : Postgres en tue un avec 40P01 au lieu de 23P01.
 * Au second essai, l'autre transaction est validée et la contrainte renvoie bien 23P01.
 * `fn` doit ouvrir sa propre transaction, pour être rejouée en entier.
 */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (sqlState(error) !== PG_DEADLOCK_DETECTED || attempt >= attempts) throw error;
    }
  }
}
