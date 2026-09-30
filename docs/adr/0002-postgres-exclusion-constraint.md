# ADR 0002 — PostgreSQL et contrainte d'exclusion contre la double réservation

- Statut : accepté
- Date : 2026-09-30

## Contexte

Règle métier n°1 : un créneau ne peut jamais être réservé deux fois, même si deux clients cliquent en même temps. Le paiement Stripe prend plusieurs minutes : le créneau doit être bloqué pendant ce temps.

## Décision

- **PostgreSQL** plutôt que MongoDB : données très relationnelles (prestataires, ressources, réservations, paiements), transactions multi-tables, types `tstzrange` et contraintes d'exclusion, PostGIS pour la recherche géographique.
- La garantie est portée par la base : `EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (status IN ('pending','confirmed'))`. Aucun contrôle applicatif ne la remplace.
- **Hold de paiement** : une réservation `pending` avec `expires_at = now() + 15 min` bloque le créneau pendant le Checkout Stripe. Comme le prédicat de la contrainte ne peut pas utiliser `now()`, l'expiration est appliquée à la volée (UPDATE des holds expirés avant l'INSERT) ; un job de nettoyage ne sert qu'au ménage.
- Les insertions concurrentes peuvent produire un deadlock (`40P01`) : la transaction est rejouée (`retryOnDeadlock`).

## Conséquences

- Test de concurrence reproductible : sur deux insertions simultanées, exactement une réussit.
- Les erreurs `23P01` sont traduites en `409 SLOT_UNAVAILABLE` par un seul helper côté API.
- Un paiement qui arrive après l'expiration du hold, alors que le créneau a été repris, doit être remboursé automatiquement (étape paiements).

## Alternatives écartées

- **Vérification applicative (SELECT puis INSERT)** : fenêtre de course entre les deux requêtes.
- **Verrou `SELECT … FOR UPDATE` sur la ressource** : sérialise toutes les réservations d'une ressource, et reste une convention que chaque requête doit respecter.
- **Niveau d'isolation SERIALIZABLE** : correct, mais plus de rejets à gérer et moins explicite qu'une contrainte déclarative.

Inspiré de `HajibagheriLabs/Openings` et `0211IkeVenLouie/slotline` (MIT), qui utilisent la même approche.
