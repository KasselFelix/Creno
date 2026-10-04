# Creno

Marketplace de réservation de créneaux (salles, coiffeurs, terrains, photographes) : carte interactive, calendrier de disponibilités, paiement Stripe Connect, confirmations email/SMS et recherche en langage naturel.

> Projet portfolio en cours de construction, étape par étape. Étapes livrées : **socle technique** (monorepo, base de données, API, CI), **authentification** (comptes, sessions, rôles), **disponibilités** (ressources, horaires, calcul des créneaux, hold de réservation), **recherche géographique** (prestataires dans un rayon, liste et carte) **réservation payée** (Stripe Connect, Checkout, webhook idempotent, annulation remboursée), **notifications** (emails et SMS de rappel par jobs pg-boss, outbox transactionnelle, tâches de ménage), **inscription par lien envoyé par email** (le compte naît depuis le lien, l'inscription ne révèle pas qui est inscrit) et **recherche en langage naturel** (phrase → filtres validés par Zod, Mistral avec repli par mots-clés, filtre « disponible le »).

## Démarrer

Prérequis : Docker (avec Compose v2). Pour développer hors Docker : Node 24 et pnpm 10.

```bash
cp .env.example .env      # optionnel : les valeurs par défaut suffisent
docker compose up
```

| Service              | URL                                                                     |
| -------------------- | ----------------------------------------------------------------------- |
| Front (Next.js)      | http://localhost:3000                                                   |
| API (NestJS)         | http://localhost:4000 — `/health`, `/health/ready`, Swagger sur `/docs` |
| PostgreSQL + PostGIS | `localhost:5432` (bases `creno` et `creno_test`)                        |
| Mailpit              | http://localhost:8025 — tous les emails envoyés par l'API en local      |

Pour chercher un prestataire : http://localhost:3000/search (liste et carte ; la carte demande un token Mapbox, voir ci-dessous). Pour voir les créneaux d'un prestataire de démo : http://localhost:3000/providers/studio-lumiere. Connecté en client, « Mes réservations » (`/bookings`) liste les réservations. Connecté avec le compte prestataire, l'« Espace prestataire » (`/dashboard`) permet de gérer ressources, horaires et fermetures.

Au démarrage, l'API applique les migrations et, si la base est vide, charge un jeu de données de démo (24 prestataires autour de Paris, Lyon et Bordeaux, aux horaires variés ; Padel Mérignac est complet le samedi qui suit le chargement, pour voir le filtre « disponible le »). `pnpm db:seed` remet ce jeu de données à zéro à la demande.

**Comptes de démo** (développement uniquement), mot de passe `creno-demo-2026` :

| Rôle        | Email                        |
| ----------- | ---------------------------- |
| Client      | `lea.petit@example.com`      |
| Prestataire | `studio.lumiere@example.com` |
| Admin       | `admin@creno.dev`            |

**Créer un compte en local** : l'inscription ne demande qu'un email ; le lien arrive dans Mailpit (http://localhost:8025) et mène au formulaire où l'on choisit son rôle, son nom et son mot de passe.

**Carte** : créer un token public (`pk.…`) sur https://account.mapbox.com, le restreindre par URL, puis le mettre dans `.env` (`NEXT_PUBLIC_MAPBOX_TOKEN`). Sans token, la recherche fonctionne en liste seule.

**Paiements (facultatif)** : sans clé Stripe, tout démarre et les routes de paiement répondent 503. Pour payer une réservation en local, il faut un compte Stripe en **mode test** avec Connect activé :

```bash
# 1. Clé secrète de test (https://dashboard.stripe.com/test/apikeys) dans .env : STRIPE_SECRET_KEY=sk_test_…
# 2. Démarrer avec le relais de webhooks (Stripe CLI dans un conteneur)
docker compose --profile stripe up -d
docker compose logs stripe-cli | grep whsec_     # → STRIPE_WEBHOOK_SECRET dans .env
docker compose up -d api                         # relit .env
```

Ensuite : connecté en prestataire, « Espace prestataire » → « Activer les paiements » (formulaire Stripe de test) ; connecté en client, réserver un créneau et payer avec la carte `4242 4242 4242 4242`. Pour ne pas refaire l'onboarding après chaque `pnpm db:seed`, mettre l'identifiant du compte créé (`acct_…`) dans `SEED_STRIPE_ACCOUNT_ID`.

**Recherche en langage naturel (facultatif)** : sans clé, la phrase est analysée par mots-clés et tout fonctionne. Pour l'interpréter avec Mistral : créer une clé sur https://console.mistral.ai (offre gratuite « Experiment », sans carte bancaire), **désactiver l'entraînement sur vos données** (Settings → Privacy, activé par défaut sur l'offre gratuite), puis la mettre dans `.env` (`MISTRAL_API_KEY`) et relancer l'API (`docker compose up -d api`).

> Après un changement de dépendances (`package.json`), reconstruire avec `docker compose up -d --build -V` : sans `-V` (`--renew-anon-volumes`), Compose réutilise les anciens `node_modules` des conteneurs.

## Commandes

```bash
pnpm dev                                  # toute la stack en local (hors Docker, base via `docker compose up db`)
pnpm lint && pnpm typecheck && pnpm test  # vérifications (les tests utilisent la base creno_test)
pnpm build
pnpm db:generate --name <nom>             # migration générée depuis le schéma Drizzle
pnpm db:custom <nom>                      # migration SQL écrite à la main (contraintes, extensions)
pnpm db:migrate && pnpm db:seed
```

## Architecture

```
apps/api         NestJS 12 — un module par domaine (controller → service → repository)
apps/web         Next.js 16 (App Router), Tailwind 4, shadcn/ui
packages/shared  schémas Zod et codes d'erreur partagés par le front et l'API
packages/db      schéma Drizzle, migrations, seed, client Postgres
packages/config  tsconfig, ESLint, Prettier
docs/            schéma de la base, décisions d'architecture (ADR)
```

- **Schéma relationnel** : [docs/schema.md](docs/schema.md) (diagramme + explication des contraintes).
- **Décisions** : [docs/adr/](docs/adr/).

## La requête mise en avant : la double réservation est impossible

```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (resource_id WITH =, during WITH &&)
  WHERE (status IN ('pending', 'confirmed'));
```

C'est la base, et non le code applicatif, qui garantit qu'un créneau n'est jamais réservé deux fois, même quand deux clients valident à la même milliseconde. Deux tests le prouvent : deux insertions concurrentes sur deux connexions ([packages/db/test/bookings-constraints.test.ts](packages/db/test/bookings-constraints.test.ts)), et deux `POST /v1/bookings` simultanés qui donnent exactement un 201 et un `409 SLOT_UNAVAILABLE` ([apps/api/test/bookings.e2e-spec.ts](apps/api/test/bookings.e2e-spec.ts)). Détails, piège du `now()` et gestion du deadlock : [docs/schema.md](docs/schema.md).

## Pourquoi ce choix technique

- **PostgreSQL plutôt que MongoDB** : données relationnelles, transactions, `tstzrange` + contraintes d'exclusion, PostGIS. → [ADR 0002](docs/adr/0002-postgres-exclusion-constraint.md)
- **API NestJS séparée de Next.js** : webhooks, jobs et app mobile ont besoin d'un backend indépendant. → [ADR 0001](docs/adr/0001-monorepo-nest-next.md)
- **`geography` plutôt que `geometry`** : distances en mètres, index sphérique. → [ADR 0003](docs/adr/0003-geography-type.md)
- **Horaires en heure locale + fuseau IANA** : les changements d'heure ne décalent pas les horaires. → [ADR 0004](docs/adr/0004-date-fns-timezones.md)
- **Créneaux calculés par un moteur pur en TypeScript** : `now` est un paramètre, les jours de 23 h et de 25 h sont des tests unitaires sans base. → [ADR 0006](docs/adr/0006-slot-engine.md)
- **Cookies `HttpOnly` + sessions en base avec refresh token rotatif** : tokens hors de portée d'un XSS, révocation par appareil, détection de token volé. → [ADR 0005](docs/adr/0005-auth-cookies-rotating-refresh.md)
- **Recherche par cercle (centre + rayon), plafonnée à 50 résultats** : `ST_DWithin` sur l'index GiST, filtres dans l'URL, pas de pagination ni de clustering. → [ADR 0007](docs/adr/0007-radius-search.md)
- **Géocodage par l'API Adresse de l'État, derrière une interface** : sans clé, coordonnées stockables, appelée par l'API (timeout, repli, faux en test). → [ADR 0008](docs/adr/0008-geocoding-provider.md)
- **Stripe Connect en destination charge, webhook comme seule source de vérité** : le prestataire reçoit le prix moins la commission, le hold est aligné sur la session Checkout, un événement rejoué ne fait rien. → [ADR 0009](docs/adr/0009-stripe-connect-payments.md)
- **Notifications par outbox transactionnelle sur pg-boss** : le message à envoyer est écrit dans la transaction qui confirme la réservation, puis envoyé par un job avec reprises ; pas de Redis. → [ADR 0010](docs/adr/0010-notifications-outbox-pg-boss.md)
- **L'email d'abord, le compte depuis le lien** : la première étape ne lit jamais `users`, donc sa réponse ne peut pas révéler qui est inscrit ; le mot de passe est choisi par celui qui a reçu le lien, jamais par l'auteur de la demande. → [ADR 0011](docs/adr/0011-pending-registration-uniform-signup.md)
- **Recherche en langage naturel par Mistral Small, le modèle ne produit que des filtres** : sortie contrainte par un JSON Schema généré depuis le schéma Zod partagé, revalidée par ce schéma, jamais de SQL ; offre gratuite hébergée dans l'UE, ~0,12 $ les 1 000 recherches au tarif payant (comparé à Claude Haiku 4.5 et Sonnet 5.5 dans l'ADR). → [ADR 0013](docs/adr/0013-ai-search-mistral.md)
- **Timeout, une seule reprise, circuit breaker, plafond journalier, repli par mots-clés** : la recherche marche toujours, l'IA en panne, lente ou hors budget ne donne jamais d'erreur 5xx, et chaque appel est mesuré (latence, tokens, coût) dans `ai_requests`. → [ADR 0013](docs/adr/0013-ai-search-mistral.md)
- **Filtre « disponible le » calculé par le moteur de créneaux, pas en SQL** : 200 candidats de la recherche, chargement par lot (5 requêtes), même résultat que la fiche du prestataire, changements d'heure compris. → [ADR 0014](docs/adr/0014-date-filter-slot-engine.md)

## Recherche géographique

```sql
SELECT p.name, round(ST_Distance(p.location, $point))::int AS distance_meters,
       r.min_price_cents, (count(*) OVER ())::int AS total
FROM providers p
JOIN LATERAL (
  SELECT min(price_cents) AS min_price_cents, count(*)::int AS resource_count
  FROM resources WHERE provider_id = p.id AND is_active
) r ON r.resource_count > 0
WHERE ST_DWithin(p.location, $point, $radius_m)
ORDER BY ST_Distance(p.location, $point), p.id
LIMIT 50;
```

- `GET /v1/search/providers?lat=&lng=&radiusKm=&category=&priceMax=&date=` : prestataires dans le rayon, triés par distance, avec leur prix minimum. Avec `date`, seuls ceux qui ont un créneau libre ce jour-là, avec leur nombre de créneaux libres ([ADR 0014](docs/adr/0014-date-filter-slot-engine.md)). `ST_DWithin` s'appuie sur l'index GiST : 27 lignes lues sur 50 000 pour un rayon de 10 km (plan dans [docs/schema.md](docs/schema.md)).
- `/search` : champ « Ville ou adresse » à suggestions, « Autour de moi », filtres, liste et carte côte à côte (onglets sur mobile). Les filtres sont dans l'URL : la recherche se partage et le bouton retour fonctionne.
- `GET /v1/geocoding/search?q=` : suggestions d'adresses. Si le service de l'État ne répond pas, la route renvoie 503 et l'écran reste utilisable (géolocalisation, carte, saisie manuelle des coordonnées côté prestataire).
- La position du visiteur est arrondie à environ 100 m, jamais enregistrée et absente des logs (query string et en-tête `Referer` compris). La carte, elle, est servie par Mapbox, qui reçoit la zone affichée.

## Recherche en langage naturel

En haut de `/search`, on tape « un terrain de foot à Bordeaux samedi pour moins de 40 € » : la page applique les filtres compris (affichés sous le champ, corrigeables à la main) et dit ce qu'elle n'a pas pris en compte (« “après 18 h” n'est pas pris en compte »).

- `POST /v1/search/interpret` : la phrase part en `POST` (jamais dans une URL), le modèle renvoie des filtres validés par Zod, le géocodeur place le lieu. « Près de moi » fait demander sa position au navigateur.
- **Repli** : clé absente, circuit ouvert, plafond du jour atteint, timeout, erreur ou sortie invalide → analyse par mots-clés, réponse `200` avec `source: "keywords"` et le message « Recherche simplifiée par mots-clés ».
- **Limites** : `AI_RATE_LIMIT_PER_MINUTE` phrases par minute et par IP, `AI_DAILY_REQUEST_CAP` appels au modèle par jour (toutes IP confondues), timeout `AI_TIMEOUT_MS` par appel.
- **Vie privée** : la phrase n'est ni journalisée ni enregistrée (seulement sa longueur) ; `ai_requests` ne garde ni lieu ni coordonnées, et ses lignes sont purgées après 90 jours. La phrase est envoyée à Mistral AI (hébergé dans l'UE).
- Tests : repli sur sortie invalide, timeout et erreurs ([apps/api/test/ai-search.e2e-spec.ts](apps/api/test/ai-search.e2e-spec.ts)), reprise, circuit et plafond ([apps/api/test/ai-search-resilience.e2e-spec.ts](apps/api/test/ai-search-resilience.e2e-spec.ts)), aucune phrase dans les logs sur tous les chemins ([apps/api/test/ai-search-logs.e2e-spec.ts](apps/api/test/ai-search-logs.e2e-spec.ts)).

Coût, latence et replis par jour (le coût est calculé au tarif payant, même sur l'offre gratuite) :

```sql
SELECT date_trunc('day', created_at) AS day,
       count(*) FILTER (WHERE outcome = 'success') AS ai_ok,
       count(*) FILTER (WHERE outcome <> 'success') AS fallbacks,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE attempts > 0) AS p95_ms,
       sum(cost_usd_micros) / 1e6 AS cost_usd
FROM ai_requests GROUP BY 1 ORDER BY 1 DESC;
```

```bash
# Les dernières interprétations
docker compose exec db psql -U creno -c "select outcome, model, attempts, latency_ms, input_tokens, output_tokens, cost_usd_micros from ai_requests order by created_at desc limit 5;"
```

## Disponibilités et réservation

- Un prestataire crée son profil, ses ressources, leurs **horaires hebdomadaires en heure locale** (plusieurs plages par jour) et ses fermetures exceptionnelles.
- `GET /v1/resources/:id/slots?from=&to=` renvoie les créneaux par jour local de la ressource ; un créneau occupé est marqué `available: false`.
- `POST /v1/bookings` pose un **hold de 15 minutes** (booking `pending`) : 409 si le créneau est pris, 422 s'il n'est pas proposé. Un hold expiré ne bloque plus rien, sans attendre de tâche de nettoyage.
- Garde-fous : 5 holds actifs par client et 2 par ressource, 5 réservations gratuites à venir par client (verrou par client, la limite tient face à des demandes simultanées), 200 fermetures à venir par ressource, limites de débit par IP sur les lectures publiques et sur les réservations.

## Paiement

```sql
INSERT INTO stripe_events (id, type) VALUES ($1, $2)
ON CONFLICT DO NOTHING
RETURNING id;   -- rien de renvoyé : événement déjà traité
```

- **Prestataire** : la carte « Paiements » de son espace ouvre un compte Stripe Connect Express (formulaire hébergé par Stripe). Tant que le compte n'est pas actif, ses ressources payantes ne sont pas réservables.
- **Client** : « Réserver et payer » bloque le créneau, puis redirige vers Stripe Checkout. Le prix vient de la base, la commission (`STRIPE_PLATFORM_FEE_BPS`, 10 % par défaut) est calculée par le serveur. Le hold de 15 min est prolongé une fois à 31 min au lancement du paiement, et la session Stripe expire au même instant.
- **Confirmation** : seul le webhook `POST /v1/payments/webhook` confirme une réservation. Signature vérifiée sur le corps brut (sinon 400), événement enregistré et traité dans la même transaction : rejoué, il ne fait rien ; en échec, il n'est pas enregistré et Stripe le renvoie. La page de retour interroge l'API jusqu'à « Confirmée ».
- **Paiement arrivé trop tard** : si le créneau a été repris, la contrainte d'exclusion le signale et le client est remboursé automatiquement (log `payment.late_refund`).
- **Annulation** : dans « Mes réservations », remboursement total jusqu'à 24 h avant le début ; le prestataire peut toujours annuler (API). Le remboursement est demandé avant de libérer le créneau, et reprend le versement au prestataire et la commission.
- Tests : signature invalide, événement rejoué ou reçu deux fois en même temps, paiement tardif, remboursement en échec ([apps/api/test/payments-webhook.e2e-spec.ts](apps/api/test/payments-webhook.e2e-spec.ts)) ; checkout, annulation et accès à la réservation d'un autre ([apps/api/test/bookings-payments.e2e-spec.ts](apps/api/test/bookings-payments.e2e-spec.ts)).

## Notifications et jobs

- **Emails** : confirmation au client et avis au prestataire quand une réservation est confirmée, email d'annulation (avec le montant remboursé), email « paiement remboursé » quand un paiement arrive sur un créneau déjà repris. **Rappel** 24 h avant le créneau, par email et par SMS si le client a vérifié son téléphone.
- **Outbox transactionnelle** : la ligne `notifications` et son job sont écrits dans la transaction qui change le statut de la réservation. Pas de notification pour un changement annulé, pas de changement sans notification, et aucun appel à un service externe pendant une requête ou un webhook.
- **pg-boss** (file de jobs dans Postgres) : 5 reprises en backoff exponentiel, puis file morte → notification `failed` et log `error`. Un job ne contient que l'identifiant de la notification, jamais d'adresse ni de numéro.
- **En local**, les emails **et les SMS** arrivent dans Mailpit (http://localhost:8025) sans aucun compte (un SMS y est un email adressé à `<numéro>@sms.mailpit.local`). Avec `RESEND_API_KEY`, les emails partent par Resend ; avec les trois variables `TWILIO_*`, les SMS partent par Twilio. Sans rien, les notifications sont marquées `skipped`.
- **Garde-fous** : SMS réservés aux préfixes autorisés (`SMS_ALLOWED_PREFIXES`, mobiles français par défaut), 5 SMS par jour et 30 emails par heure au plus pour un même destinataire ; au-delà, la notification est `skipped`. L'adresse email d'un compte est prouvée (le compte naît depuis le lien envoyé à l'inscription), et le téléphone aussi (voir ci-dessous).
- **Téléphone vérifié** : dans « Mon compte », on saisit son numéro, on reçoit un code à 6 chiffres par SMS (10 min, 5 essais), et le numéro n'est enregistré qu'une fois le code saisi. Un numéro vérifié n'appartient qu'à un compte (index unique) ; prouver un numéro déjà pris le transfère. Plafonds : 3 codes par compte et par heure, 5 par numéro sur 24 h, `PHONE_CODE_RATE_LIMIT_PER_HOUR` par IP ([ADR 0012](docs/adr/0012-verified-phone-only.md), tests dans [apps/api/test/phone-verification.e2e-spec.ts](apps/api/test/phone-verification.e2e-spec.ts)).
- **Tâches planifiées** : rappels dus et holds expirés toutes les 5 min, purge horaire des inscriptions jamais terminées et des demandes de code SMS périmées, purge nocturne des sessions mortes, des événements Stripe et des lignes `ai_requests` de plus de 90 jours.
- Tests : idempotence, transaction annulée, rappel, reprises et file morte ([apps/api/test/notifications.e2e-spec.ts](apps/api/test/notifications.e2e-spec.ts)) ; ménage ([apps/api/test/maintenance.e2e-spec.ts](apps/api/test/maintenance.e2e-spec.ts)).

```bash
# Suivre les notifications et les tâches planifiées
docker compose exec db psql -U creno -c "select kind, channel, status, reason, sent_at from notifications order by created_at desc limit 10;"
docker compose exec db psql -U creno -c "select name, cron from pgboss.schedule;"
```

## Authentification et autorisations

- Inscription (client ou prestataire) **par lien envoyé par email** : on ne saisit d'abord que son adresse, puis rôle, nom et mot de passe depuis le lien reçu ; le formulaire répond la même chose que l'adresse soit déjà inscrite ou non. Connexion, « Mon compte » avec la liste des appareils connectés.
- Access token JWT de 15 min et refresh token de 30 jours, tous deux en cookies `HttpOnly` ; le navigateur ne parle qu'au front (`/api/*` est réécrit vers l'API), les cookies restent donc first-party.
- **Refresh rotatif** : chaque renouvellement remplace le refresh token (compare-and-swap en base). Un ancien token rejoué après 10 s révoque la session : c'est le signe d'un vol.
- Mots de passe hachés en argon2id ; même réponse et même durée pour « mauvais mot de passe » et « email inconnu ».
- Autorisation par **rôle** (`@Roles('admin')`) et par **propriété**, vérifiée dans les services : lire le compte ou révoquer la session d'un autre utilisateur renvoie 403 (tests IDOR).
- Helmet, vérification de l'en-tête `Origin`, limitation du nombre de tentatives sur les routes d'auth (429).

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) sur chaque PR et sur `main` : format, lint, typecheck, migrations sur une base PostGIS éphémère, tests, cohérence schéma/migrations (`drizzle-kit check`), build, et scan de secrets (gitleaks). _Déploiement Azure (API) et Vercel (web) : à venir._

## Observabilité

- Paiements : `payment.late_refund` et `payment.gateway_failed` en `warn`, `payment.amount_mismatch` en `error` ; ni email, ni identifiant de compte, ni corps d'événement Stripe dans les logs.
- Notifications : `notification.sent` (latence, numéro d'essai), `notification.retry` et `notification.skipped` (canal non configuré) en `warn`, `notification.failed` en `error` ; les logs d'un job portent un `jobId` à la place du `requestId`, jamais de destinataire ni de contenu. Ménage : `maintenance.holds_expired`, `maintenance.sessions_purged`, `maintenance.stripe_events_purged`.
- Recherche en langage naturel : `ai.request` (issue, tentatives, latence, tokens, coût ; `info` si le modèle a répondu, `warn` en repli, `error` si la clé est refusée), `ai.retry`, `ai.circuit_opened` et `ai.budget_exceeded` en `warn`, `ai.circuit_closed` en `info`, `ai.persist_failed` en `error` ; jamais la phrase, le lieu ni le message d'une erreur du fournisseur. `search.performed` dit si une date était demandée (`hasDate`).
- Logs JSON (pino) avec un `requestId` par requête (repris de l'en-tête `x-request-id` s'il est fourni) et un champ `event` pour les événements métier ; emails, téléphones, cookies et en-têtes d'authentification sont masqués, ainsi que la query string des routes de recherche et de géocodage (position du visiteur, adresse saisie).
- `GET /health` (liveness, ne dépend pas de la base) et `GET /health/ready` (readiness, 503 si la base est injoignable).
- _Sentry : à venir._

## Variables d'environnement

| Variable                           | Utilisée par     | Défaut / exemple                                   | Rôle                                                                                                                         |
| ---------------------------------- | ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | api, web         | `development`                                      | environnement (obligatoire pour l'API : pas de valeur par défaut)                                                            |
| `DB_PORT`                          | docker compose   | `5432`                                             | port exposé de Postgres                                                                                                      |
| `DATABASE_URL`                     | api, db          | `postgres://creno:creno@localhost:5432/creno`      | base principale                                                                                                              |
| `DATABASE_URL_TEST`                | tests            | `postgres://creno:creno@localhost:5432/creno_test` | base des tests d'intégration                                                                                                 |
| `API_PORT`                         | api              | `4000`                                             | port HTTP de l'API                                                                                                           |
| `LOG_LEVEL`                        | api              | `info`                                             | niveau des logs pino                                                                                                         |
| `WEB_ORIGIN`                       | api              | `http://localhost:3000`                            | origine autorisée (CORS)                                                                                                     |
| `API_INTERNAL_URL`                 | web (serveur)    | `http://localhost:4000`                            | URL de l'API pour le rewrite `/api/*` et les Server Components                                                               |
| `JWT_ACCESS_SECRET`                | api              | valeur d'exemple (dev)                             | secret de signature des access tokens, 32 caractères minimum ; la valeur d'exemple est refusée en production                 |
| `ACCESS_TOKEN_TTL_MINUTES`         | api              | `15`                                               | durée de vie de l'access token                                                                                               |
| `REFRESH_TOKEN_TTL_DAYS`           | api              | `30`                                               | durée de vie (glissante) d'une session                                                                                       |
| `AUTH_RATE_LIMIT_PER_MINUTE`       | api              | `10`                                               | tentatives de login/inscription par minute et par IP (×3 pour le refresh)                                                    |
| `REGISTRATION_RATE_LIMIT_PER_HOUR` | api              | `20`                                               | demandes d'inscription par heure et par IP (chacune envoie un email)                                                         |
| `PUBLIC_RATE_LIMIT_PER_MINUTE`     | api              | `120`                                              | lectures publiques (fiche, ressource, créneaux, recherche, géocodage) par minute, par IP et par route                        |
| `BOOKING_RATE_LIMIT_PER_MINUTE`    | api              | `20`                                               | demandes de réservation par minute et par IP                                                                                 |
| `PHONE_CODE_RATE_LIMIT_PER_HOUR`   | api              | `10`                                               | demandes de code de vérification du téléphone par heure et par IP (chacune envoie un SMS)                                    |
| `TRUST_PROXY`                      | api              | `false`                                            | nombre de proxys devant l'API (IP réelle pour le rate limit)                                                                 |
| `GEOCODER_URL`                     | api              | `https://data.geopf.fr/geocodage`                  | géocodeur d'adresses (API Adresse de l'État, sans clé)                                                                       |
| `STRIPE_SECRET_KEY`                | api, stripe-cli  | vide                                               | clé secrète Stripe ; vide : paiements indisponibles (503). Clé de test obligatoire hors production                           |
| `STRIPE_WEBHOOK_SECRET`            | api              | vide                                               | secret de signature du webhook (`whsec_…`), affiché par le service `stripe-cli`                                              |
| `STRIPE_CONNECT_WEBHOOK_SECRET`    | api              | vide                                               | production : secret de l'endpoint « Connect » (`account.updated`)                                                            |
| `STRIPE_PLATFORM_FEE_BPS`          | api              | `1000`                                             | commission Creno en points de base (1000 = 10 %)                                                                             |
| `SEED_STRIPE_ACCOUNT_ID`           | seed             | vide                                               | compte Express de test rattaché à « Studio Lumière » par le seed                                                             |
| `RESEND_API_KEY`                   | api              | vide                                               | clé API Resend (`re_…`) pour les emails ; obligatoire en production                                                          |
| `EMAIL_FROM`                       | api              | `Creno <onboarding@resend.dev>`                    | expéditeur des emails (domaine vérifié chez Resend)                                                                          |
| `MAILPIT_URL`                      | api              | `http://mailpit:8025` (docker compose)             | boîte de réception de dev, utilisée sans clé Resend ; refusée en production                                                  |
| `TWILIO_ACCOUNT_SID`               | api              | vide                                               | compte Twilio pour les SMS (code, rappel) ; les trois variables `TWILIO_*` ensemble, ou aucune                               |
| `TWILIO_AUTH_TOKEN`                | api              | vide                                               | jeton d'authentification Twilio                                                                                              |
| `TWILIO_FROM`                      | api              | vide                                               | numéro expéditeur (`+33…`) ou Messaging Service (`MG…`)                                                                      |
| `SMS_ALLOWED_PREFIXES`             | api              | `+336,+337`                                        | préfixes des numéros qui peuvent recevoir un SMS (mobiles français par défaut)                                               |
| `MISTRAL_API_KEY`                  | api              | vide                                               | clé Mistral AI pour la recherche en langage naturel ; vide : analyse par mots-clés. Désactiver l'entraînement dans le compte |
| `AI_MODEL`                         | api              | `mistral-small-2603`                               | version datée du modèle (son tarif sert au calcul du coût)                                                                   |
| `AI_TIMEOUT_MS`                    | api              | `3000`                                             | timeout de chaque appel au modèle (de 100 à 10 000 ms)                                                                       |
| `AI_RATE_LIMIT_PER_MINUTE`         | api              | `10`                                               | phrases interprétées par minute et par IP                                                                                    |
| `AI_DAILY_REQUEST_CAP`             | api              | `500`                                              | appels au modèle par jour (UTC), toutes IP confondues ; `0` coupe l'IA                                                       |
| `JOBS_WORKERS_ENABLED`             | api              | `true`                                             | `false` : l'instance crée des jobs sans les exécuter (ni workers, ni tâches planifiées)                                      |
| `NEXT_PUBLIC_MAPBOX_TOKEN`         | web (navigateur) | vide                                               | token **public** Mapbox (`pk.…`) pour la carte ; vide : liste seule. Un token secret est refusé                              |

La configuration de l'API est validée par Zod au démarrage (`apps/api/src/config/env.ts`) : une variable manquante ou invalide empêche l'API de démarrer. Les variables lues par le navigateur le sont dans `apps/web/lib/env.ts`. Aucun secret n'est versionné.
