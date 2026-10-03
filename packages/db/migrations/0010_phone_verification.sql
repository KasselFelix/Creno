CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_verifications_phone_e164" CHECK ("phone_verifications"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_verifications_attempts_range" CHECK ("phone_verifications"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "phone_verifications_expiry_after_creation" CHECK ("phone_verifications"."expires_at" > "phone_verifications"."created_at")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
-- Pourquoi (ajouté à la main) : `users.phone` ne contiendra plus que des numéros prouvés par un code, et
-- uniques. Les numéros saisis avant cette étape ne l'ont jamais été (et pourraient être en double) :
-- ils sont retirés avant de poser les contraintes. Aucune production à cette date.
UPDATE "users" SET "phone" = NULL WHERE "phone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_verifications_user_id_created_at_idx" ON "phone_verifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "phone_verifications_phone_created_at_idx" ON "phone_verifications" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "phone_verifications_expires_at_idx" ON "phone_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_verified" CHECK (("users"."phone" IS NULL) = ("users"."phone_verified_at" IS NULL));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{6,14}$');