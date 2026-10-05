# ADR 0015 — Déplacement d'une réservation par le prestataire

- Statut : accepté
- Date : 2026-10-05

## Contexte

Le dashboard prestataire (étape 8) permet de déplacer une réservation dans le calendrier, par glisser-déposer ou par un choix de créneau au clavier. Trois questions se posaient :

1. Qu'est-ce qui garantit qu'une réservation déplacée ne tombe pas sur un créneau pris ?
2. Le client doit-il accepter le nouvel horaire ?
3. Comment prévenir le client et reprogrammer le rappel de la veille, alors que l'outbox de notifications (ADR 0010) n'accepte qu'un message par réservation, type, canal et destinataire ?

## Décision

**La contrainte `bookings_no_overlap` arbitre.** Le déplacement est un `UPDATE bookings SET during = …` sur la ligne verrouillée (`FOR UPDATE`), dans la même transaction que l'expiration des holds échus du créneau visé, sous `retryOnDeadlock`. `23P01` (ou un deadlock persistant) → `409 SLOT_UNAVAILABLE`. Aucun contrôle applicatif « le créneau est-il libre ? » : la base tranche, comme à la création (ADR 0002).

Règles, dans le service :

- seule une réservation `confirmed`, pas encore commencée, se déplace (`409 RESCHEDULE_NOT_ALLOWED` sinon) ;
- vers un créneau **proposé** par la ressource (horaires, fermetures, horizon : `422 SLOT_NOT_OFFERED` sinon), de même durée ; si la durée des créneaux de la ressource a changé depuis la réservation, le déplacement est refusé (il faudrait sinon vérifier une plage qui ne correspond à aucun créneau) ;
- le paiement ne change pas : ni prix recalculé, ni nouvel appel à Stripe.

**Le client est prévenu, il n'a pas à accepter.** Un circuit « proposition → acceptation » demanderait un nouveau statut, un lien, une expiration et le blocage de deux créneaux à la fois. En échange, une réservation déplacée par le prestataire (`rescheduled_at` renseigné) reste **annulable et remboursée par le client jusqu'à son début**, au lieu de 24 h avant : il n'a pas choisi ce nouvel horaire.

**Les notifications ont une révision.** `bookings.reschedule_count` compte les déplacements ; `notifications.booking_revision` entre dans la clé d'unicité. Un déplacement crée de nouvelles lignes (`booking_moved`, rappels) avec la nouvelle révision, et ferme les rappels encore planifiés (`skipped`, `rescheduled`). Le worker écarte un rappel ou un `booking_moved` d'une ancienne révision (`superseded`).

## Alternatives écartées

- **Recycler les lignes existantes** (`ON CONFLICT DO UPDATE … status = 'pending'`) : l'id de la ligne sert de clé d'idempotence chez Resend, gardée 24 h. Un deuxième déplacement dans la journée réutiliserait la clé : Resend renverrait la première réponse sans envoyer, ou répondrait 409 (contenu différent), soit une notification `failed` et une alerte Sentry. Il aurait aussi fallu remettre `attempts` à 0, en course avec un job déjà en cours.
- **Index unique partiel excluant `booking_moved`** : la valeur d'enum ajoutée dans la même série de migrations ne peut pas être citée avant le commit, et Drizzle applique toutes les migrations dans une seule transaction (voir `docs/schema.md`).
- **Déplacement libre (hors horaires)** : le calendrier contredirait les horaires affichés au client, et l'occupation compterait des réservations hors ouverture.

## Conséquences

- Un test de concurrence prouve que deux déplacements vers le même créneau donnent un 200 et un 409, et qu'un déplacement face à une réservation client n'en laisse passer qu'un.
- L'historique des messages est conservé (une ligne par révision), et deux déplacements rapprochés n'envoient que l'email du plus récent s'il n'était pas encore parti.
- L'email de déplacement est écrit au moment de l'envoi : il donne l'horaire en vigueur, pas l'ancien.
- Côté interface, le calendrier n'accepte le dépôt que sur un créneau libre (`eventAllow`, à partir des créneaux de l'API), avec un pas d'aimantation égal au PGCD de la durée des créneaux et des heures de début des horaires ; l'API reste l'arbitre.
