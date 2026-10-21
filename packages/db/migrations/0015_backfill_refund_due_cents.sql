-- Pourquoi : avant le remboursement par paliers (ADR 0020), toute réservation annulée ou expirée
-- qui a un paiement a été remboursée intégralement (annulation, ou paiement arrivé trop tard). On
-- renseigne donc son montant dû : « montant dû NULL » signifie toujours « aucun paiement ».
UPDATE "bookings" AS b
SET "refund_due_cents" = p."amount_cents"
FROM "payments" AS p
WHERE p."booking_id" = b."id"
  AND b."status" IN ('cancelled', 'expired')
  AND b."refund_due_cents" IS NULL;
