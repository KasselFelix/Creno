# ADR 0001 — Monorepo pnpm + Turborepo, API NestJS séparée du front Next.js

- Statut : accepté
- Date : 2026-09-30

## Contexte

Creno a un front web (et plus tard une app mobile Expo) qui partagent les mêmes règles de validation et les mêmes codes d'erreur que l'API. Le projet sert aussi de vitrine : la structure doit être lisible et chaque couche testable.

## Décision

- Un monorepo **pnpm workspaces + Turborepo** : `apps/api`, `apps/web`, `packages/shared` (schémas Zod, codes d'erreur), `packages/db` (Drizzle, migrations, seed), `packages/config`.
- Une **API NestJS dédiée** plutôt que les Route Handlers de Next.js : webhooks Stripe, jobs pg-boss, logique de réservation transactionnelle et app mobile ont besoin d'un backend indépendant du front, avec injection de dépendances et modules par domaine.
- TypeScript 6.0 (TS 7 n'est pas encore supporté par typescript-eslint), modules ESM partout (NestJS 12 est ESM-only).

## Conséquences

- Les schémas Zod sont écrits une seule fois et utilisés par le front et l'API.
- Turbo met en cache lint/typecheck/test/build par package.
- Deux déploiements distincts (Vercel pour le web, Azure Container Apps pour l'API) et un CORS/rewrite à configurer.

## Alternatives écartées

- **Next.js seul (Route Handlers + Server Actions)** : plus simple au départ, mais mélange UI et logique métier, et moins adapté aux workers et à l'app mobile.
- **Nx** : plus puissant, mais plus de configuration que nécessaire pour 2 apps et 3 packages.
