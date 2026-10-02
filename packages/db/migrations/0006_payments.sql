-- Pourquoi : paiement des réservations (étape 5). `payments` garde une ligne par paiement reçu,
-- `stripe_events` les événements Stripe déjà traités (un événement rejoué n'est pas traité deux fois).
-- Sur `bookings`, la session Checkout et le moment où le paiement a été lancé (le hold n'est prolongé
-- qu'une fois) ; sur `providers`, l'état du compte Stripe Connect.
CREATE TYPE "public"."payment_status" AS ENUM('succeeded', 'refunded');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_status" DEFAULT 'succeeded' NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payments_amount_cents_positive" CHECK ("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_fee_cents_range" CHECK ("payments"."fee_cents" BETWEEN 0 AND "payments"."amount_cents"),
	CONSTRAINT "payments_refunded_cents_range" CHECK ("payments"."refunded_cents" BETWEEN 0 AND "payments"."amount_cents"),
	CONSTRAINT "payments_currency_format" CHECK ("payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "checkout_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stripe_charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stripe_details_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id");--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_stripe_account_id_unique" UNIQUE("stripe_account_id");--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_charges_need_account" CHECK (NOT "providers"."stripe_charges_enabled" OR "providers"."stripe_account_id" IS NOT NULL);