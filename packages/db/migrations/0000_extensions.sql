-- Pourquoi : PostGIS pour la recherche géographique, btree_gist pour mélanger un uuid (égalité)
-- et un tstzrange (chevauchement) dans la même contrainte EXCLUDE, citext pour les emails.
-- IF NOT EXISTS : en local, docker/db/init.sql les a déjà créées ; sur Azure et en CI, c'est ici.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
