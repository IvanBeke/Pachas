-- `category` becomes a real foreign key to `categories`. It used to be text: mostly
-- category ids, but also the legacy literal 'general' (what forms defaulted to) and
-- possibly ids of categories that no longer exist. Ids that exist are kept; anything
-- else is moved to the General category. General is created first if it is missing
-- (an admin may have renamed it; the startup seed, which runs after migrations, would
-- recreate it anyway), so there is always a row to point at.
INSERT INTO `categories` (`title`, `icon`, `position`)
  SELECT 'General', '🧾', 0 WHERE NOT EXISTS (SELECT 1 FROM `categories` WHERE `title` = 'General');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`amount_base` integer NOT NULL,
	`paid_by` text NOT NULL,
	`category` integer NOT NULL,
	`date` text NOT NULL,
	`split_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`recurring_id` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_expenses`("id", "group_id", "title", "description", "amount", "currency", "exchange_rate", "amount_base", "paid_by", "category", "date", "split_type", "created_by", "created_at", "recurring_id") SELECT "id", "group_id", "title", "description", "amount", "currency", "exchange_rate", "amount_base", "paid_by", CASE
  WHEN "category" <> '' AND "category" NOT GLOB '*[^0-9]*'
    AND CAST("category" AS INTEGER) IN (SELECT c."id" FROM "categories" c)
  THEN CAST("category" AS INTEGER)
  ELSE (SELECT c."id" FROM "categories" c WHERE c."title" = 'General' ORDER BY c."position", c."id" LIMIT 1)
END, "date", "split_type", "created_by", "created_at", "recurring_id" FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_expenses_group_date` ON `expenses` (`group_id`,`date`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_expenses_category` ON `expenses` (`category`);--> statement-breakpoint
CREATE INDEX `idx_expenses_paid_by` ON `expenses` (`paid_by`);--> statement-breakpoint
CREATE INDEX `idx_expenses_created_by` ON `expenses` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_expenses_recurring_date` ON `expenses` (`recurring_id`,`date`) WHERE "recurring_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`amount_base` integer NOT NULL,
	`paid_by` text NOT NULL,
	`category` integer NOT NULL,
	`split_type` text NOT NULL,
	`splits` text NOT NULL,
	`recurrence` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`generated_through` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_recurring_expenses`("id", "group_id", "title", "description", "amount", "currency", "exchange_rate", "amount_base", "paid_by", "category", "split_type", "splits", "recurrence", "start_date", "end_date", "generated_through", "created_by", "created_at") SELECT "id", "group_id", "title", "description", "amount", "currency", "exchange_rate", "amount_base", "paid_by", CASE
  WHEN "category" <> '' AND "category" NOT GLOB '*[^0-9]*'
    AND CAST("category" AS INTEGER) IN (SELECT c."id" FROM "categories" c)
  THEN CAST("category" AS INTEGER)
  ELSE (SELECT c."id" FROM "categories" c WHERE c."title" = 'General' ORDER BY c."position", c."id" LIMIT 1)
END, "split_type", "splits", "recurrence", "start_date", "end_date", "generated_through", "created_by", "created_at" FROM `recurring_expenses`;--> statement-breakpoint
DROP TABLE `recurring_expenses`;--> statement-breakpoint
ALTER TABLE `__new_recurring_expenses` RENAME TO `recurring_expenses`;--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_group_created` ON `recurring_expenses` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_paid_by` ON `recurring_expenses` (`paid_by`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_created_by` ON `recurring_expenses` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_category` ON `recurring_expenses` (`category`);