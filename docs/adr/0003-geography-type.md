# ADR 0003 — `geography(Point,4326)` pour la localisation des prestataires

- Statut : accepté
- Date : 2026-09-30

## Contexte

La recherche affiche les prestataires dans un rayon donné autour d'un point (« coiffeur à moins de 5 km »).

## Décision

Colonne `providers.location` en `geography(Point,4326)` (type personnalisé Drizzle), avec un index GiST. Écriture via `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` (longitude d'abord).

## Conséquences

- `ST_DWithin(location, point, 5000)` travaille directement en mètres, sur la sphère, et utilise l'index.
- Drizzle ne connaît pas `geography` : un `customType` de quelques lignes, et le SQL généré doit être relu (drizzle-kit met le type entre guillemets, corrigé dans `0001_initial_schema.sql`).

## Alternatives écartées

- **`geometry` (support natif Drizzle)** : distances en degrés, il faut caster en `::geography` à chaque requête pour raisonner en mètres.
- **Latitude/longitude en `numeric` + formule de Haversine** : pas d'index spatial, calcul fait à la main.
