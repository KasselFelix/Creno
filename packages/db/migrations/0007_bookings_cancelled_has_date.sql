-- Pourquoi : une réservation annulée porte toujours sa date d'annulation (affichage, statistiques).
-- Les réservations annulées avant l'arrivée de la colonne `cancelled_at` reçoivent leur dernière
-- date de modification, puis la contrainte est posée.
UPDATE "bookings" SET "cancelled_at" = "updated_at" WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_has_date" CHECK ("bookings"."status" <> 'cancelled' OR "bookings"."cancelled_at" IS NOT NULL);