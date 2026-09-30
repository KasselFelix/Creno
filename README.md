# Creno

Marketplace de réservation de créneaux (salles, coiffeurs, terrains, photographes) : carte interactive, calendrier de disponibilités, paiement Stripe Connect, confirmations email/SMS et recherche en langage naturel.

> Projet portfolio en cours de construction, étape par étape. Étape actuelle : **socle technique** (monorepo, base de données, API, CI).

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

Au démarrage, l'API applique les migrations et charge un jeu de données de démo (3 prestataires à Paris, Lyon et Bordeaux).

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

C'est la base, et non le code applicatif, qui garantit qu'un créneau n'est jamais réservé deux fois, même quand deux clients valident à la même milliseconde. Un test lance deux insertions concurrentes sur deux connexions et vérifie qu'exactement une réussit ([packages/db/test/bookings-constraints.test.ts](packages/db/test/bookings-constraints.test.ts)). Détails, piège du `now()` et gestion du deadlock : [docs/schema.md](docs/schema.md).

## Pourquoi ce choix technique

- **PostgreSQL plutôt que MongoDB** : données relationnelles, transactions, `tstzrange` + contraintes d'exclusion, PostGIS. → [ADR 0002](docs/adr/0002-postgres-exclusion-constraint.md)
- **API NestJS séparée de Next.js** : webhooks, jobs et app mobile ont besoin d'un backend indépendant. → [ADR 0001](docs/adr/0001-monorepo-nest-next.md)
- **`geography` plutôt que `geometry`** : distances en mètres, index sphérique. → [ADR 0003](docs/adr/0003-geography-type.md)
- **Horaires en heure locale + fuseau IANA** : les changements d'heure ne décalent pas les horaires. → [ADR 0004](docs/adr/0004-date-fns-timezones.md)
- _À venir : choix du modèle IA, retry / circuit breaker / fallback de la recherche._

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) sur chaque PR et sur `main` : format, lint, typecheck, migrations sur une base PostGIS éphémère, tests, cohérence schéma/migrations (`drizzle-kit check`), build, et scan de secrets (gitleaks). _Déploiement Azure (API) et Vercel (web) : à venir._

## Observabilité

- Logs JSON (pino) avec un `requestId` par requête (repris de l'en-tête `x-request-id` s'il est fourni) et un champ `event` pour les événements métier ; emails, téléphones, cookies et en-têtes d'authentification sont masqués.
- `GET /health` (liveness, ne dépend pas de la base) et `GET /health/ready` (readiness, 503 si la base est injoignable).
- _Sentry : à venir._

## Variables d'environnement

| Variable            | Utilisée par   | Défaut / exemple                                   | Rôle                                                           |
| ------------------- | -------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `NODE_ENV`          | api, web       | `development`                                      | environnement                                                  |
| `DB_PORT`           | docker compose | `5432`                                             | port exposé de Postgres                                        |
| `DATABASE_URL`      | api, db        | `postgres://creno:creno@localhost:5432/creno`      | base principale                                                |
| `DATABASE_URL_TEST` | tests          | `postgres://creno:creno@localhost:5432/creno_test` | base des tests d'intégration                                   |
| `API_PORT`          | api            | `4000`                                             | port HTTP de l'API                                             |
| `LOG_LEVEL`         | api            | `info`                                             | niveau des logs pino                                           |
| `WEB_ORIGIN`        | api            | `http://localhost:3000`                            | origine autorisée (CORS)                                       |
| `API_INTERNAL_URL`  | web (serveur)  | `http://localhost:4000`                            | URL de l'API pour le rewrite `/api/*` et les Server Components |

La configuration de l'API est validée par Zod au démarrage (`apps/api/src/config/env.ts`) : une variable manquante ou invalide empêche l'API de démarrer. Aucun secret n'est versionné.
