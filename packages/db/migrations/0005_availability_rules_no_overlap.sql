-- Pourquoi : deux plages horaires du même jour ne doivent pas se chevaucher pour une ressource,
-- sinon le calcul des créneaux proposerait deux fois le même créneau. L'API le vérifie déjà avec
-- Zod pour répondre un 400 lisible ; cette contrainte est le filet de sécurité au niveau de la base.
--
-- Postgres n'a pas de type « intervalle d'heures » : on le crée (un range sur `time`), comme
-- tstzrange est un range sur `timestamptz`. Les bornes par défaut sont [début, fin) :
-- 09:00-12:00 et 12:00-14:00 se touchent sans se chevaucher.
CREATE TYPE "timerange" AS RANGE (subtype = time);
--> statement-breakpoint
-- Lecture : deux lignes ne peuvent pas avoir la même ressource (=), le même jour (=) ET des plages
-- qui se chevauchent (&&). btree_gist (migration 0000) permet de mettre un uuid et un smallint
-- dans un index GiST.
ALTER TABLE "availability_rules"
  ADD CONSTRAINT "availability_rules_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    "weekday" WITH =,
    timerange("start_time", "end_time") WITH &&
  );
