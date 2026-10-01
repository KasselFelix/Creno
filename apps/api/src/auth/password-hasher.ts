import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Hachage argon2id (paramètres par défaut de @node-rs/argon2, conformes aux recommandations OWASP). */
@Injectable()
export class PasswordHasher {
  // Hash d'un mot de passe jetable : vérifié quand l'email est inconnu, pour que la réponse
  // prenne le même temps qu'un vrai échec (pas d'indice sur l'existence du compte).
  private readonly dummyHash = hash('creno-timing-equalizer');

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    if (!passwordHash) {
      await verify(await this.dummyHash, password);
      return false;
    }
    return verify(passwordHash, password);
  }
}
