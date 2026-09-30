-- Pourquoi : la double réservation doit être impossible au niveau de la base, y compris quand deux
-- requêtes arrivent en même temps. Un check applicatif (SELECT puis INSERT) laisse une fenêtre de
-- course entre les deux ; une contrainte EXCLUDE est vérifiée atomiquement par Postgres.
--
-- Lecture : deux lignes ne peuvent pas avoir le même resource_id (=) ET des créneaux qui se
-- chevauchent (&&). btree_gist (migration 0000) permet de mettre un uuid dans un index GiST.
-- Les bornes sont [début, fin) : 10h-11h et 11h-12h ne se chevauchent pas.
--
-- Prédicat partiel : seules les réservations `pending` (hold de paiement) et `confirmed` bloquent
-- le créneau. Une réservation annulée ou expirée le libère.
--
-- Piège : le prédicat d'une contrainte doit être IMMUTABLE, donc il ne peut pas utiliser now().
-- Un `pending` dont expires_at est dépassé bloque ENCORE le créneau tant que sa ligne n'a pas
-- changé de statut. D'où deux règles côté API (voir CLAUDE.md) :
--   1. la transaction de réservation passe d'abord à `expired` les holds expirés qui chevauchent,
--      puis insère : c'est cette contrainte qui tranche ;
--   2. le calcul des créneaux libres ignore les `pending` avec expires_at <= now().
-- Violation → SQLSTATE 23P01 (exclusion_violation) → 409 SLOT_UNAVAILABLE.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("resource_id" WITH =, "during" WITH &&)
  WHERE ("status" IN ('pending', 'confirmed'));
