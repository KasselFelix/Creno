import type { AvailabilityRule } from '@creno/shared';

// Un champ `time` ne sait pas afficher 24:00 : à l'écran, une fin à minuit s'écrit 00:00.

/** Règles de l'API → valeurs du formulaire. */
export const toForm = (rules: AvailabilityRule[]): AvailabilityRule[] =>
  rules.map((rule) => ({ ...rule, endTime: rule.endTime === '24:00' ? '00:00' : rule.endTime }));

/** Valeurs du formulaire → règles de l'API. Seule une heure de FIN à 00:00 signifie minuit. */
export const toApi = (rules: AvailabilityRule[]): AvailabilityRule[] =>
  rules.map((rule) => ({ ...rule, endTime: rule.endTime === '00:00' ? '24:00' : rule.endTime }));
