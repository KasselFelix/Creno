# Creno

Marketplace de réservation de créneaux (salles, coiffeurs, terrains, photographes) : carte interactive, calendrier de disponibilités, paiement Stripe Connect, confirmations email/SMS et recherche en langage naturel.

> Projet portfolio en cours de construction, étape par étape. Étapes livrées : **socle technique** (monorepo, base de données, API, CI), **authentification** (comptes, sessions, rôles) et **disponibilités** (ressources, horaires, calcul des créneaux, hold de réservation).

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

Pour voir les créneaux d'un prestataire de démo : http://localhost:3000/providers/studio-lumiere. Connecté avec le compte prestataire, l'« Espace prestataire » (`/dashboard`) permet de gérer ressources, horaires et fermetures.

Au démarrage, l'API applique les migrations et, si la base est vide, charge un jeu de données de démo (3 prestataires à Paris, Lyon et Bordeaux). `pnpm db:seed` remet ce jeu de données à zéro à la demande.

**Comptes de démo** (développement uniquement), mot de passe `creno-demo-2026` :

| Rôle        | Email                        |
| ----------- | ---------------------------- |
| Client      | `lea.petit@example.com`      |
| Prestataire | `studio.lumiere@example.com` |
| Admin       | `admin@creno.dev`            |

> Après un changement de dépendances (`package.json`), reconstruire avec `docker compose up -d --build -V` : sans `-V`, Compose réutilise les anciens `node_modules` des conteneurs.

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
- _À venir : choix du modèle IA, retry / circuit breaker / fallback de la recherche._

## Disponibilités et réservation

- Un prestataire crée son profil, ses ressources, leurs **horaires hebdomadaires en heure locale** (plusieurs plages par jour) et ses fermetures exceptionnelles.
- `GET /v1/resources/:id/slots?from=&to=` renvoie les créneaux par jour local de la ressource ; un créneau occupé est marqué `available: false`.
- `POST /v1/bookings` pose un **hold de 15 minutes** (booking `pending`) : 409 si le créneau est pris, 422 s'il n'est pas proposé. Un hold expiré ne bloque plus rien, sans attendre de tâche de nettoyage.
- Garde-fous : 5 holds actifs par client (verrou par client, la limite tient face à des demandes simultanées), 200 fermetures à venir par ressource, limites de débit par IP sur les lectures publiques et sur les réservations.
- Le paiement et la confirmation arrivent à l'étape suivante ; la fiche publique affiche la grille sans bouton de réservation.

## Authentification et autorisations

- Inscription (client ou prestataire), connexion, « Mon compte » avec la liste des appareils connectés.
- Access token JWT de 15 min et refresh token de 30 jours, tous deux en cookies `HttpOnly` ; le navigateur ne parle qu'au front (`/api/*` est réécrit vers l'API), les cookies restent donc first-party.
- **Refresh rotatif** : chaque renouvellement remplace le refresh token (compare-and-swap en base). Un ancien token rejoué après 10 s révoque la session : c'est le signe d'un vol.
- Mots de passe hachés en argon2id ; même réponse et même durée pour « mauvais mot de passe » et « email inconnu ».
- Autorisation par **rôle** (`@Roles('admin')`) et par **propriété**, vérifiée dans les services : lire le compte ou révoquer la session d'un autre utilisateur renvoie 403 (tests IDOR).
- Helmet, vérification de l'en-tête `Origin`, limitation du nombre de tentatives sur les routes d'auth (429).

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) sur chaque PR et sur `main` : format, lint, typecheck, migrations sur une base PostGIS éphémère, tests, cohérence schéma/migrations (`drizzle-kit check`), build, et scan de secrets (gitleaks). _Déploiement Azure (API) et Vercel (web) : à venir._

## Observabilité

- Logs JSON (pino) avec un `requestId` par requête (repris de l'en-tête `x-request-id` s'il est fourni) et un champ `event` pour les événements métier ; emails, téléphones, cookies et en-têtes d'authentification sont masqués.
- `GET /health` (liveness, ne dépend pas de la base) et `GET /health/ready` (readiness, 503 si la base est injoignable).
- _Sentry : à venir._

## Variables d'environnement

| Variable                        | Utilisée par   | Défaut / exemple                                   | Rôle                                                                                                         |
| ------------------------------- | -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                      | api, web       | `development`                                      | environnement (obligatoire pour l'API : pas de valeur par défaut)                                            |
| `DB_PORT`                       | docker compose | `5432`                                             | port exposé de Postgres                                                                                      |
| `DATABASE_URL`                  | api, db        | `postgres://creno:creno@localhost:5432/creno`      | base principale                                                                                              |
| `DATABASE_URL_TEST`             | tests          | `postgres://creno:creno@localhost:5432/creno_test` | base des tests d'intégration                                                                                 |
| `API_PORT`                      | api            | `4000`                                             | port HTTP de l'API                                                                                           |
| `LOG_LEVEL`                     | api            | `info`                                             | niveau des logs pino                                                                                         |
| `WEB_ORIGIN`                    | api            | `http://localhost:3000`                            | origine autorisée (CORS)                                                                                     |
| `API_INTERNAL_URL`              | web (serveur)  | `http://localhost:4000`                            | URL de l'API pour le rewrite `/api/*` et les Server Components                                               |
| `JWT_ACCESS_SECRET`             | api            | valeur d'exemple (dev)                             | secret de signature des access tokens, 32 caractères minimum ; la valeur d'exemple est refusée en production |
| `ACCESS_TOKEN_TTL_MINUTES`      | api            | `15`                                               | durée de vie de l'access token                                                                               |
| `REFRESH_TOKEN_TTL_DAYS`        | api            | `30`                                               | durée de vie (glissante) d'une session                                                                       |
| `AUTH_RATE_LIMIT_PER_MINUTE`    | api            | `10`                                               | tentatives de login/inscription par minute et par IP (×3 pour le refresh)                                    |
| `PUBLIC_RATE_LIMIT_PER_MINUTE`  | api            | `120`                                              | lectures publiques (fiche, ressource, créneaux) par minute, par IP et par route                                         |
| `BOOKING_RATE_LIMIT_PER_MINUTE` | api            | `20`                                               | demandes de réservation par minute et par IP                                                                |
| `TRUST_PROXY`                   | api            | `false`                                            | nombre de proxys devant l'API (IP réelle pour le rate limit)                                                 |

La configuration de l'API est validée par Zod au démarrage (`apps/api/src/config/env.ts`) : une variable manquante ou invalide empêche l'API de démarrer. Aucun secret n'est versionné.
