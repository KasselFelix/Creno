import { describe, expect, it } from 'vitest';
import { replaceRulesSchema } from '@creno/shared';
import { toApi, toForm } from './hours';

describe('horaires : fin à minuit', () => {
  const evening = { weekday: 5, startTime: '18:00', endTime: '24:00' };
  const morning = { weekday: 5, startTime: '00:00', endTime: '06:00' };

  it("affiche 24:00 comme 00:00 et le renvoie à l'API comme 24:00", () => {
    expect(toForm([evening])).toEqual([{ ...evening, endTime: '00:00' }]);
    expect(toApi(toForm([evening]))).toEqual([evening]);
  });

  it('ne touche pas à un début à 00:00', () => {
    expect(toApi(toForm([morning]))).toEqual([morning]);
  });

  it('une fin saisie à 00:00 passe la validation partagée une fois convertie', () => {
    const typed = [{ weekday: 5, startTime: '18:00', endTime: '00:00' }];
    expect(replaceRulesSchema.safeParse({ rules: typed }).success).toBe(false);
    expect(replaceRulesSchema.safeParse({ rules: toApi(typed) }).success).toBe(true);
  });
});
