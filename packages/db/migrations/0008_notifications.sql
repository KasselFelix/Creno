CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('booking_confirmed', 'booking_received', 'booking_cancelled', 'booking_cancelled_by_provider', 'payment_refunded_late', 'booking_reminder');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('scheduled', 'pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_booking_kind_channel_recipient_key" UNIQUE("booking_id","kind","channel","recipient_id"),
	CONSTRAINT "notifications_attempts_positive" CHECK ("notifications"."attempts" >= 0),
	CONSTRAINT "notifications_sent_has_date" CHECK ("notifications"."status" <> 'sent' OR "notifications"."sent_at" IS NOT NULL),
	CONSTRAINT "notifications_closed_has_reason" CHECK ("notifications"."status" NOT IN ('failed', 'skipped') OR "notifications"."reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_scheduled_for_idx" ON "notifications" USING btree ("scheduled_for") WHERE "notifications"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_idx" ON "notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "bookings_pending_expires_at_idx" ON "bookings" USING btree ("expires_at") WHERE "bookings"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "stripe_events_received_at_idx" ON "stripe_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");