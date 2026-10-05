-- Pourquoi : distinguer une réservation confirmée puis annulée d'un hold annulé avant paiement, pour
-- ne jamais montrer au prestataire le client d'un panier abandonné.
ALTER TABLE "bookings" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
-- Reprise : une réservation a été confirmée si elle l'est encore, ou si l'email de confirmation a été
-- écrit pour elle (l'outbox l'enregistre dans la transaction de confirmation).
UPDATE "bookings" b
   SET "confirmed_at" = coalesce(
         (SELECT min(n."created_at") FROM "notifications" n
           WHERE n."booking_id" = b."id" AND n."kind" = 'booking_confirmed'),
         CASE WHEN b."status" = 'confirmed' THEN b."updated_at" END)
 WHERE b."status" IN ('confirmed', 'cancelled');
