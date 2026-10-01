CREATE TYPE "public"."group_role" AS ENUM('creator', 'admin', 'member');--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "role" "group_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_group_members_creator" ON "group_members" USING btree ("group_id") WHERE "group_members"."role" = 'creator';