CREATE TABLE "pending_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_registrations_expiry_after_creation" CHECK ("pending_registrations"."expires_at" > "pending_registrations"."created_at")
);
--> statement-breakpoint
-- Pourquoi (ajusté à la main) : `ADD COLUMN … NOT NULL` sans valeur par défaut échoue sur une table déjà
-- peuplée. Les comptes créés avant la vérification d'email sont considérés vérifiés à leur date de
-- création (aucune production à cette date), puis la colonne devient obligatoire.
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = "created_at";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_verified_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "pending_registrations_email_created_at_idx" ON "pending_registrations" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "pending_registrations_expires_at_idx" ON "pending_registrations" USING btree ("expires_at");