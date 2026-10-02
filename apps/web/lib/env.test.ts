import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('accepte un token public et son absence', () => {
    // Token construit à l'exécution : aucune chaîne ressemblant à une clé dans le repo.
    const token = ['pk', 'exemple'].join('.');
    expect(parsePublicEnv({ NEXT_PUBLIC_MAPBOX_TOKEN: token }).NEXT_PUBLIC_MAPBOX_TOKEN).toBe(
      token,
    );
    expect(parsePublicEnv({}).NEXT_PUBLIC_MAPBOX_TOKEN).toBeUndefined();
    expect(
      parsePublicEnv({ NEXT_PUBLIC_MAPBOX_TOKEN: '' }).NEXT_PUBLIC_MAPBOX_TOKEN,
    ).toBeUndefined();
  });

  it('refuse un token secret, sans recopier sa valeur dans le message', () => {
    const secret = ['sk', 'ne-doit-pas-fuiter'].join('.');
    expect(() => parsePublicEnv({ NEXT_PUBLIC_MAPBOX_TOKEN: secret })).toThrow(
      /NEXT_PUBLIC_MAPBOX_TOKEN/,
    );
    expect(() => parsePublicEnv({ NEXT_PUBLIC_MAPBOX_TOKEN: secret })).not.toThrow(
      /ne-doit-pas-fuiter/,
    );
  });
});
