# ADR 0006 — Calcul des créneaux par un moteur pur en TypeScript

- Statut : accepté
- Date : 2026-10-01

## Contexte

Les créneaux d'une ressource se déduisent de ses horaires hebdomadaires (heure locale), de ses fermetures et de ses réservations. Le calcul doit rester juste les jours de changement d'heure, et il est appelé à chaque affichage d'une fiche : il doit être rapide et facile à tester.

Deux endroits possibles : une requête SQL (`generate_series` + `AT TIME ZONE`), ou du code TypeScript.

## Décision

- Le calcul est une **fonction pure** (`apps/api/src/availability/slots.engine.ts`) : elle reçoit les règles, les fermetures, les réservations et `now`, et ne lit ni la base ni l'horloge. Un chargeur séparé (`AvailabilityService.getSlots`) fait trois requêtes, quel que soit le nombre de jours.
- La **base reste le seul arbitre** de la double réservation (`bookings_no_overlap`, ADR 0002). Le moteur ne sert qu'à l'affichage et à refuser un créneau qui n'existe pas (`422 SLOT_NOT_OFFERED`).
- **Changements d'heure** : chaque borne de plage est convertie en instant dans le fuseau de la ressource, puis on avance en minutes réelles.
  - Jour de 23 h : moins de créneaux ; aucun ne tombe sur l'heure inexistante. Une borne posée sur cette heure est décalée vers l'avant.
  - Jour de 25 h : plus de créneaux ; l'heure répétée est proposée deux fois, comme deux instants distincts. Une borne posée sur cette heure prend la première occurrence.
  - `24:00` est le début du lendemain, jamais « + 24 h ».
- **Durée = pas de la grille** (`slot_minutes`). Horizon de 90 jours calendaires locaux, 31 jours au plus par requête.

## Conséquences

- Les cas de changement d'heure sont des tests unitaires sans base (`slots.engine.spec.ts`) : dates fixes, `now` injecté.
- Une réservation prise sur une ancienne grille (durée ou horaires modifiés depuis) bloque tous les créneaux qu'elle chevauche : le moteur compare des intervalles, pas des numéros de créneau.
- Le filtre « hold expiré » existe à deux endroits, volontairement : dans la requête qui charge les réservations (affichage) et dans la transaction de réservation (écriture).

## Alternatives écartées

- **Tout en SQL** : une seule requête, mais les cas de changement d'heure ne se testent qu'avec une base, et la politique (heure inexistante, heure répétée) est implicite dans `AT TIME ZONE`.
- **Créneaux matérialisés** en table : lecture triviale, mais il faut les régénérer à chaque changement d'horaire et ils dérivent des règles.
- **Buffers, préavis minimum, horaires à cheval sur minuit, versionnement des horaires** (présents dans Openings et Cal.com) : hors périmètre du MVP.

Inspirations : Openings (`src/lib/scheduling/availability.ts`, moteur pur et tests de changement d'heure) et slotline (`src/timezone.ts`).
