-- Pourquoi : suite à la review de l'étape 1. (1) index GiST (resource_id, during) non partiel : l'index
-- de l'EXCLUDE ne couvre que pending/confirmed, or la FK et l'historique/dashboard lisent tous les statuts.
-- (2) les créneaux doivent être [début, fin) même en SQL direct. (3) devises au format ISO 4217 (3 majuscules).
ALTER TABLE "availability_exceptions" DROP CONSTRAINT "availability_exceptions_during_not_empty";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_during_valid";--> statement-breakpoint
CREATE INDEX "bookings_resource_id_during_gix" ON "bookings" USING gist ("resource_id","during");--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_during_valid" CHECK (NOT isempty("availability_exceptions"."during") AND NOT lower_inf("availability_exceptions"."during") AND NOT upper_inf("availability_exceptions"."during") AND lower_inc("availability_exceptions"."during") AND NOT upper_inc("availability_exceptions"."during"));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_currency_format" CHECK ("bookings"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_during_valid" CHECK (NOT isempty("bookings"."during") AND NOT lower_inf("bookings"."during") AND NOT upper_inf("bookings"."during") AND lower_inc("bookings"."during") AND NOT upper_inc("bookings"."during"));--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_currency_format" CHECK ("resources"."currency" ~ '^[A-Z]{3}$');