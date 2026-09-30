CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT 1 NOT NULL,
	"amount_base" numeric(14, 2) NOT NULL,
	"paid_by" uuid NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"split_type" text NOT NULL,
	"splits" jsonb NOT NULL,
	"recurrence" text NOT NULL,
	"start_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recurring_expenses_group" ON "recurring_expenses" USING btree ("group_id");