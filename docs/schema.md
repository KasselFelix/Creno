# Schéma de la base de données

PostgreSQL 17 + PostGIS. Schéma source : `packages/db/src/schema/`, migrations : `packages/db/migrations/`.

```mermaid
erDiagram
  users ||--o| providers : "possède (rôle provider)"
  users ||--o{ bookings : "réserve (client)"
  users ||--o{ sessions : "appareils connectés"
  providers ||--o{ resources : propose
  resources ||--o{ availability_rules : "horaires hebdo"
  resources ||--o{ availability_exceptions : fermetures
  resources ||--o{ bookings : "est réservée"
  bookings ||--o| payments : "est payée par"
  bookings ||--o{ notifications : "déclenche"
  users ||--o{ notifications : "destinataire"

  users {
    uuid id PK
    citext email UK
    text full_name
    text phone "nullable"
    user_role role "customer | provider | admin"
    text password_hash "argon2id, nullable"
  }
  sessions {
    uuid id PK
    uuid user_id FK
    text refresh_token_hash "sha256 du secret courant"
    text previous_token_hash "accepté 10 s après rotation"
    timestamptz rotated_at
    text user_agent "200 caractères max"
    timestamptz expires_at
    timestamptz last_used_at
    timestamptz revoked_at "nullable"
  }
  providers {
    uuid id PK
    uuid user_id FK,UK
    text name
    text slug UK "dérivé du nom, stable"
    provider_category category
    text description
    text address
    text city
    geography location "Point 4326, index GiST"
    text stripe_account_id UK "compte Connect Express, nullable"
    boolean stripe_charges_enabled "peut recevoir des paiements"
    boolean stripe_details_submitted "formulaire Stripe rempli"
  }
  resources {
    uuid id PK
    uuid provider_id FK
    text name
    text description
    text timezone "IANA, ex. Europe/Paris"
    int slot_minutes "5..1440"
    int price_cents ">= 0"
    char currency
    boolean is_active "false = retirée de la fiche"
  }
  availability_rules {
    uuid id PK
    uuid resource_id FK
    smallint weekday "1 = lundi .. 7"
    time start_time "heure locale"
    time end_time "heure locale, 24:00 permis"
  }
  availability_exceptions {
    uuid id PK
    uuid resource_id FK
    tstzrange during
    text reason
  }
  bookings {
    uuid id PK
    uuid resource_id FK
    uuid customer_id FK
    tstzrange during "[début, fin)"
    booking_status status "pending | confirmed | cancelled | expired"
    timestamptz expires_at "fin du hold, si pending"
    int price_cents
    char currency
    timestamptz checkout_started_at "paiement lancé, hold prolongé"
    text stripe_checkout_session_id UK "nullable"
    timestamptz cancelled_at "obligatoire si cancelled"
  }
  payments {
    uuid id PK
    uuid booking_id FK,UK
    text stripe_payment_intent_id UK
    int amount_cents ">= 0"
    int fee_cents "commission, 0..amount"
    char currency
    payment_status status "succeeded | refunded"
    int refunded_cents "0..amount"
    timestamptz refunded_at "nullable"
  }
  stripe_events {
    text id PK "identifiant Stripe evt_…"
    text type
    timestamptz received_at
  }
  notifications {
    uuid id PK
    uuid booking_id FK
    uuid recipient_id FK
    notification_kind kind "confirmation, rappel, annulation…"
    notification_channel channel "email | sms"
    notification_status status "scheduled | pending | sent | failed | skipped"
    timestamptz scheduled_for "instant d'envoi voulu"
    int attempts ">= 0"
    text reason "motif de skipped / failed"
    text provider_message_id "nullable"
    timestamptz sent_at "obligatoire si sent"
  }
```

Toutes les tables ont `created_at` / `updated_at` (`timestamptz`) sauf les règles et exceptions de disponibilité et `stripe_events`. Montants en centimes (`integer`), dates en UTC (`timestamptz`), créneaux en `tstzrange` semi-ouverts `[début, fin)`.

## Migrations

| Fichier                                             | Contenu                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `0000_extensions.sql` (custom)                      | `postgis`, `btree_gist`, `citext`                                                                                    |
| `0001_initial_schema.sql` (générée)                 | tables, enums, clés étrangères, CHECK, index                                                                         |
| `0002_bookings_no_overlap.sql` (custom)             | contrainte d'exclusion anti double réservation                                                                       |
| `0003_bookings_constraints_hardening.sql` (générée) | index GiST non partiel sur `bookings (resource_id, during)`, bornes `[)` imposées, format des devises                |
| `0004_auth.sql` (générée)                           | `users.password_hash`, table `sessions`                                                                              |
| `0005_availability_rules_no_overlap.sql` (custom)   | type `timerange`, contrainte d'exclusion sur les plages horaires d'un même jour                                      |
| `0006_payments.sql` (générée)                       | tables `payments` et `stripe_events`, colonnes de paiement sur `bookings`, état Stripe sur `providers`               |
| `0007_bookings_cancelled_has_date.sql` (générée)    | reprise de `cancelled_at` sur les réservations déjà annulées, puis CHECK « annulée ⇒ date d'annulation »             |
| `0008_notifications.sql` (générée)                  | table `notifications` et ses enums, index partiels (rappels dus, holds à expirer), index de purge de `stripe_events` |

Le schéma `pgboss` (file de jobs) n'est pas dans ces migrations : pg-boss l'installe et le met à jour lui-même au démarrage de l'API.

## La contrainte `bookings_no_overlap`

```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (resource_id WITH =, during WITH &&)
  WHERE (status IN ('pending', 'confirmed'));
```

**Ce qu'elle garantit** : deux réservations actives d'une même ressource ne peuvent pas se chevaucher. Postgres le vérifie au moment de l'`INSERT`/`UPDATE`, de façon atomique : même deux requêtes simultanées ne peuvent pas passer toutes les deux. Un contrôle applicatif (« je vérifie que le créneau est libre, puis j'insère ») laisse une fenêtre entre les deux étapes.

- `resource_id WITH =` : même ressource ; `during WITH &&` : créneaux qui se chevauchent.
- `btree_gist` est nécessaire pour mettre un `uuid` (égalité) dans un index GiST avec un `tstzrange`.
- Bornes `[)` : 10h-11h et 11h-12h ne se chevauchent pas.
- **Prédicat partiel** : seules les réservations `pending` (hold de paiement de 15 min) et `confirmed` bloquent le créneau ; une réservation annulée ou expirée le libère.
- Violation → SQLSTATE `23P01` → réponse API `409 SLOT_UNAVAILABLE`.

**Piège du `now()`** : le prédicat d'une contrainte doit être immuable, il ne peut donc pas tester `expires_at > now()`. Un hold expiré bloque le créneau tant que sa ligne n'est pas passée à `expired`. La transaction de réservation commence donc par expirer les holds dépassés qui chevauchent le créneau, puis insère ; le calcul des créneaux libres ignore de lui-même les holds expirés.

**Deadlock** : deux insertions simultanées sur le même créneau peuvent s'attendre mutuellement pendant la vérification de la contrainte ; Postgres interrompt alors l'une d'elles avec `40P01` au lieu de `23P01`. La transaction est rejouée par `retryOnDeadlock` (`packages/db/src/errors.ts`), et le second essai obtient `23P01`. Couvert par `packages/db/test/bookings-constraints.test.ts`.

## Horaires, fermetures et calcul des créneaux

Les horaires d'une ressource sont des plages hebdomadaires en **heure locale** (`availability_rules` : jour ISO, `start_time`, `end_time`), une ligne par plage ; une pause est le trou entre deux lignes. Les fermetures (`availability_exceptions`) sont des intervalles d'instants (`tstzrange`), saisis en heure locale et convertis par l'API dans le fuseau de la ressource.

```sql
CREATE TYPE timerange AS RANGE (subtype = time);

ALTER TABLE availability_rules ADD CONSTRAINT availability_rules_no_overlap
  EXCLUDE USING gist (resource_id WITH =, weekday WITH =, timerange(start_time, end_time) WITH &&);
```

Deux plages du même jour ne peuvent pas se chevaucher, sinon un créneau serait proposé deux fois. Postgres n'a pas de type « intervalle d'heures » : la migration le crée, sur le modèle de `tstzrange`. `09:00-12:00` et `12:00-14:00` se touchent sans se chevaucher (bornes `[)`). L'API vérifie la même règle avec Zod pour répondre un 400 lisible ; la contrainte est le filet de sécurité. L'horaire d'une ressource est remplacé d'un bloc, dans une transaction qui verrouille la ligne de la ressource.

**Calcul des créneaux** (`apps/api/src/availability/slots.engine.ts`, [ADR 0006](adr/0006-slot-engine.md)) : trois requêtes quel que soit le nombre de jours (règles, fermetures, réservations), puis un calcul en mémoire.

1. Pour chaque jour local, les plages du jour de la semaine sont converties en instants dans le fuseau de la ressource (`24:00` = début du lendemain).
2. Chaque plage est découpée en créneaux de `slot_minutes` minutes **réelles** depuis l'ouverture.
3. Un créneau passé, au-delà de 90 jours ou qui chevauche une fermeture n'est pas proposé.
4. Un créneau qui chevauche une réservation `confirmed`, ou `pending` avec `expires_at > now()`, est proposé avec `available: false`. Un hold expiré est ignoré, même si sa ligne est encore `pending`.

La requête des réservations qui occupent une fenêtre :

```sql
SELECT lower(during), upper(during) FROM bookings
 WHERE resource_id = $1
   AND during && $2::tstzrange
   AND (status = 'confirmed' OR (status = 'pending' AND expires_at > now()));
```

**Hold de paiement** (`POST /v1/bookings`) : dans une même transaction, rejouée par `retryOnDeadlock`, l'API passe à `expired` les holds dépassés qui chevauchent le créneau, puis insère le booking `pending` avec `expires_at = now() + 15 min` (horloge de la base). Un verrou consultatif par client (`pg_advisory_xact_lock`) sérialise ses demandes : la limite de 5 holds actifs (2 sur une même ressource) tient même face à des requêtes parallèles. C'est `bookings_no_overlap` qui départage deux demandes simultanées : test `apps/api/test/bookings.e2e-spec.ts` (un 201, un 409).

## Paiement et webhook Stripe

Décisions : [ADR 0009](adr/0009-stripe-connect-payments.md). Trois règles tiennent dans le schéma.

**1. Un événement Stripe n'est traité qu'une fois.** Stripe renvoie un événement tant qu'il n'a pas reçu de 200, et peut l'envoyer deux fois. La clé primaire de `stripe_events` est l'identifiant de l'événement :

```sql
INSERT INTO stripe_events (id, type) VALUES ($1, $2)
ON CONFLICT DO NOTHING
RETURNING id;   -- aucune ligne renvoyée = déjà traité → 200, rien d'autre
```

L'insertion et le traitement sont dans **la même transaction** : si le traitement échoue, l'insertion est annulée, l'API répond 500 et Stripe renvoie l'événement. Deux envois simultanés du même événement s'attendent sur la clé primaire ; le second voit le conflit une fois le premier validé.

**2. Un seul paiement par réservation.** `payments.booking_id` et `payments.stripe_payment_intent_id` sont `UNIQUE` : deux événements différents pour la même session ne créent pas deux lignes. Les lignes de `payments` ne sont écrites que par le webhook ; `status` ne passe à `refunded` qu'à la réception de `charge.refunded`.

**3. Un paiement tardif ne vole pas un créneau.** À la réception de `checkout.session.completed`, la réservation est verrouillée (`SELECT … FOR UPDATE`) puis :

| Statut de la réservation                                                      | Effet                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending` (même si `expires_at` est passé : la ligne tient encore le créneau) | `confirmed`, `expires_at = NULL`                                                                                                                                 |
| `expired`                                                                     | retour à `confirmed` dans un **savepoint** ; si `bookings_no_overlap` lève `23P01` (créneau repris), la réservation reste `expired` et le paiement est remboursé |
| `cancelled`                                                                   | remboursement                                                                                                                                                    |
| `confirmed`                                                                   | rien                                                                                                                                                             |

Quand un remboursement est nécessaire, la transaction est annulée sans rien enregistrer, Stripe est appelé **hors transaction** (aucun verrou ni connexion tenus pendant l'appel réseau), puis une seconde transaction enregistre l'événement et le paiement. Si l'appel échoue, rien n'est enregistré et Stripe renvoie l'événement.

Un savepoint est un point de reprise à l'intérieur d'une transaction : quand la contrainte refuse la mise à jour, seule cette mise à jour est annulée, et la transaction continue (sans lui, Postgres refuserait toute requête suivante).

**Hold et session Checkout.** Au premier `POST /v1/bookings/:id/checkout`, une seule requête prolonge le hold, et seulement s'il court encore et n'a jamais été prolongé :

```sql
UPDATE bookings
   SET expires_at = now() + make_interval(mins => 31), checkout_started_at = now()
 WHERE id = $1 AND status = 'pending' AND expires_at > now() AND checkout_started_at IS NULL;
```

La session Stripe reçoit cette même échéance. `checkout_started_at` sert aussi au suivi des paniers abandonnés :

```sql
-- Holds expirés : jamais arrivés au paiement, ou abandonnés sur la page Stripe
SELECT count(*) FILTER (WHERE checkout_started_at IS NULL)     AS sans_paiement_lance,
       count(*) FILTER (WHERE checkout_started_at IS NOT NULL) AS abandonnes_chez_stripe
  FROM bookings b
 WHERE status = 'expired' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);
```

**Compte du prestataire.** `providers.stripe_charges_enabled` recopie l'état du compte Stripe (capacité de transfert active : le prestataire peut recevoir l'argent des réservations) (webhook `account.updated`, ou relecture au retour du formulaire). `CHECK (NOT stripe_charges_enabled OR stripe_account_id IS NOT NULL)` : pas de paiements actifs sans compte vers lequel verser. `stripe_account_id` ne sort jamais de l'API.

## Notifications et jobs

Décisions : [ADR 0010](adr/0010-notifications-outbox-pg-boss.md).

**Outbox transactionnelle.** `notifications` porte une ligne par message à envoyer. La ligne et son job d'envoi (table `pgboss.job`) sont écrits dans la transaction qui change le statut de la réservation : ils sont validés ou annulés avec elle. Le job ne contient que l'identifiant de la notification ; l'adresse et le numéro restent dans `users`.

**Un message par destinataire, quoi qu'il arrive.** `UNIQUE (booking_id, kind, channel, recipient_id)` : un webhook Stripe rejoué n'insère rien, donc ne crée aucun job.

```sql
INSERT INTO notifications (booking_id, recipient_id, kind, channel) VALUES ($1, $2, 'booking_confirmed', 'email')
ON CONFLICT DO NOTHING
RETURNING id, status;   -- rien de renvoyé : déjà notifié
```

**Cycle de vie** : `scheduled` (rappel à venir, pas encore de job) → `pending` (un job existe) → `sent`, `failed` (action requise) ou `skipped` (plus lieu d'être, ou canal non configuré). `notifications_sent_has_date` et `notifications_closed_has_reason` imposent la date d'envoi et le motif.

**Rappels.** La ligne du rappel est créée à la confirmation avec `scheduled_for = début − 24 h`. Toutes les 5 minutes, une tâche met en file celles qui sont dues ; l'index partiel `notifications_scheduled_for_idx … WHERE status = 'scheduled'` ne contient que les rappels à venir :

```sql
UPDATE notifications SET status = 'pending'
 WHERE id = ANY(ARRAY(SELECT id FROM notifications
                       WHERE status = 'scheduled' AND scheduled_for <= now()
                       ORDER BY scheduled_for LIMIT 500
                       FOR UPDATE SKIP LOCKED))
RETURNING id;
```

`FOR UPDATE SKIP LOCKED` verrouille les lignes lues et saute celles qu'une autre transaction tient déjà : deux instances qui passent en même temps se partagent les lignes au lieu de s'attendre, et aucune n'envoie deux fois. `= ANY(ARRAY(…))` plutôt que `IN (…)` : la sous-requête est évaluée une fois et l'UPDATE passe par la clé primaire ; avec `IN`, Postgres choisissait une semi-jointure qui relisait toute la table (constaté à l'EXPLAIN sur 80 000 lignes).

**Ménage.** Trois tâches planifiées : holds échus passés à `expired` (index partiel `bookings_pending_expires_at_idx`, même lecture `SKIP LOCKED` : une réservation ou un webhook en cours n'est jamais attendu), sessions expirées ou révoquées supprimées (parcours complet, une fois par nuit : le `OR` des deux conditions ne profiterait pas d'un index), événements Stripe de plus de 90 jours supprimés (`stripe_events_received_at_idx`). Aucune n'est nécessaire à la correction : un hold échu est déjà ignoré par le calcul des créneaux et libéré par la réservation suivante.

## Recherche par rayon

La position d'un prestataire est un point `geography(Point,4326)` ([ADR 0003](adr/0003-geography-type.md)), indexé en GiST (`providers_location_gix`). La recherche (`apps/api/src/search/search.repository.ts`, [ADR 0007](adr/0007-radius-search.md)) tient en une requête :

```sql
SELECT p.id, p.name, p.slug, p.category, p.address, p.city,
       ST_Y(p.location::geometry) AS latitude,
       ST_X(p.location::geometry) AS longitude,
       round(ST_Distance(p.location, $point))::int AS distance_meters,
       r.min_price_cents, r.resource_count,
       (count(*) OVER ())::int AS total
FROM providers p
JOIN LATERAL (
  SELECT min(price_cents) AS min_price_cents, count(*)::int AS resource_count
  FROM resources
  WHERE provider_id = p.id AND is_active
) r ON r.resource_count > 0
WHERE ST_DWithin(p.location, $point, $radius_m)
  AND p.category = $category
  AND r.min_price_cents <= $price_max
ORDER BY ST_Distance(p.location, $point), p.id
LIMIT $limit;
```

- `$point` vaut `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` : **longitude d'abord**. Une inversion place Paris au large de la Somalie ; un test le vérifie.
- `ST_DWithin(a, b, mètres)` répond « ces deux points sont-ils à moins de N mètres ? ». C'est lui qui utilise l'index : il commence par une comparaison de boîtes englobantes (`location && _st_expand(point, rayon)`), puis vérifie la distance exacte sur les lignes retenues. Filtrer avec `ST_Distance(...) < N` calculerait la distance de chaque ligne de la table.
- `JOIN LATERAL` : la sous-requête peut lire la ligne `p` en cours. Elle calcule le prix minimum et le nombre de ressources actives de chaque prestataire retenu ; `ON r.resource_count > 0` écarte ceux qui n'ont rien à réserver.
- `count(*) OVER ()` est une fonction de fenêtre : elle compte les lignes du résultat avant `LIMIT`, sans seconde requête. L'écran peut ainsi dire « 50 premiers résultats sur 132 ».
- Les conditions de catégorie, de prix et de rayon ne sont ajoutées que si le filtre est fourni. Sans centre : pas de distance, tri par nom.

Plan mesuré sur 50 000 prestataires répartis sur la France (rayon de 10 km autour de Paris, catégorie et prix filtrés) :

```
Bitmap Heap Scan on providers p (actual rows=5)
  Filter: ((category = 'hairdresser') AND st_dwithin(location, …, '10000'))
  Rows Removed by Filter: 22
  ->  Bitmap Index Scan on providers_location_gix (actual rows=27)
        Index Cond: (location && _st_expand(…, '10000'))
Execution Time: 8.654 ms
```

27 lignes lues sur 50 000. Sans centre, la requête parcourt toute la table (0,6 à 0,8 s à ce volume) : limite assumée, notée dans l'ADR 0007.

## Sessions et refresh token rotatif

Une ligne de `sessions` par appareil connecté (supprimée en cascade avec l'utilisateur). Le refresh token envoyé au navigateur vaut `<id de session>.<secret aléatoire de 256 bits>` ; la base ne stocke que `sha256(secret)` : une fuite de la table ne donne aucun token utilisable.

À chaque refresh, le secret est remplacé par un **compare-and-swap** :

```sql
UPDATE sessions
   SET previous_token_hash = refresh_token_hash, refresh_token_hash = $new, rotated_at = now(), …
 WHERE id = $1 AND refresh_token_hash = $presented AND revoked_at IS NULL
RETURNING *;
```

La condition sur `refresh_token_hash` rend la rotation atomique : deux refresh simultanés avec le même token ne peuvent pas réussir tous les deux. Le perdant, ou un onglet en retard, présente alors le hash « précédent » : il est accepté pendant 10 secondes (`rotated_at`), sans émettre de nouveau refresh token. Passé ce délai, un ancien token signale un vol ou un rejeu : `revoked_at` est renseigné et toute la session est invalidée.

Contraintes : `sessions_expiry_after_creation`, `sessions_user_agent_length` (≤ 200). Aucune adresse IP n'est stockée.

## Autres contraintes

- `bookings_pending_has_expiry` : un `pending` a toujours un `expires_at`.
- `bookings_during_valid` / `availability_exceptions_during_valid` : créneau non vide, borné, et toujours `[début, fin)` (même en SQL direct).
- `bookings_currency_format`, `resources_currency_format` : code ISO 4217 (3 majuscules).
- `resources_slot_minutes_range`, `*_price_cents_positive`, `availability_rules_weekday_range`, `availability_rules_time_order`, `availability_rules_no_overlap`.
- `providers_user_id_unique` : un seul profil prestataire par compte ; `providers_slug_unique` : une adresse de fiche publique par prestataire.
- `resources.timezone` n'a pas de contrainte en base (la liste des fuseaux n'est pas immuable) : il est validé par le schéma Zod partagé.
- Index GiST : `providers_location_gix` (recherche par rayon), `availability_exceptions_resource_during_gix`, `bookings_resource_id_during_gix`. Ce dernier complète l'index de l'EXCLUDE, qui est partiel (`pending`/`confirmed`) : il sert la clé étrangère vers `resources` et les requêtes par ressource sur tous les statuts (historique, dashboard, occupation).
