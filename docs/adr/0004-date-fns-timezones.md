# ADR 0004 — Horaires en heure locale + fuseau IANA, `date-fns` et `@date-fns/tz`

- Statut : accepté
- Date : 2026-09-30

## Contexte

Un coiffeur ouvre « du lundi au vendredi, 9h-18h » en heure de Paris, été comme hiver. Si l'on stocke ces horaires en UTC, ils se décalent d'une heure à chaque changement d'heure.

## Décision

- Les règles hebdomadaires sont stockées en **heure locale** (`time`) et la ressource porte son **fuseau IANA** (`Europe/Paris`). La conversion en instants UTC se fait jour par jour.
- Les réservations sont des instants UTC (`tstzrange`).
- Côté TypeScript : **`date-fns` + `@date-fns/tz`** (légers, fonctionnels, utilisables côté front et API).
- Les cas de changement d'heure (journée de 23 h ou 25 h, heure inexistante ou répétée) sont couverts par des tests à l'étape « disponibilités ».

## Alternatives écartées

- **Temporal (polyfill)** : l'API la plus juste pour ce problème, mais encore récente et polyfillée sur Node 24.
- **Luxon** : mature, mais plus lourd côté front.
- **dayjs** (utilisé par Cal.com) : les plugins de fuseau sont moins fiables autour des changements d'heure.
