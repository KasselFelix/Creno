ALTER TYPE "public"."notification_kind" ADD VALUE 'booking_moved';--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_booking_kind_channel_recipient_key";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reschedule_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rescheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "booking_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_kind_channel_recipient_revision_key" UNIQUE("booking_id","kind","channel","recipient_id","booking_revision");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reschedule_count_positive" CHECK ("bookings"."reschedule_count" >= 0);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rescheduled_has_date" CHECK (("bookings"."reschedule_count" = 0) = ("bookings"."rescheduled_at" IS NULL));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_revision_positive" CHECK ("notifications"."booking_revision" >= 0);