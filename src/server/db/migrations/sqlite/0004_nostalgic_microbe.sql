-- Money moves from REAL decimal units to INTEGER cents, recurring templates
-- gain generation bookkeeping, and query-shaped indexes are added.
-- Tables are rebuilt; scripts/migrate.mjs disables foreign-key enforcement
-- around the transaction and runs foreign_key_check before committing.
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
	`category` text DEFAULT 'general' NOT NULL,
	`date` text NOT NULL,
	`split_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`recurring_id` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_expenses`("id", "group_id", "title", "description", "amount", "currency", "exchange_rate", "amount_base", "paid_by", "category", "date", "split_type", "created_by", "created_at", "recurring_id") SELECT "id", "group_id", "title", "description", CAST(ROUND("amount" * 100) AS INTEGER), "currency", "exchange_rate", CAST(ROUND("amount_base" * 100) AS INTEGER), "paid_by", "category", "date", "split_type", "created_by", "created_at", NULL FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
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
	`category` text DEFAULT 'general' NOT NULL,
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_recurring_expenses`("id", "group_id", "title", "description", "amount", "currency", "exchange_rate", "amount_base", "paid_by", "category", "split_type", "splits", "recurrence", "start_date", "end_date", "generated_through", "created_by", "created_at") SELECT "id", "group_id", "title", "description", CAST(ROUND("amount" * 100) AS INTEGER), "currency", "exchange_rate", CAST(ROUND("amount_base" * 100) AS INTEGER), "paid_by", "category", "split_type", (SELECT json_group_object(j.key, CAST(ROUND(j.value * 100) AS INTEGER)) FROM json_each(r."splits") j), "recurrence", "start_date", "end_date", date('now', '-1 day'), "created_by", "created_at" FROM `recurring_expenses` r;--> statement-breakpoint
DROP TABLE `recurring_expenses`;--> statement-breakpoint
ALTER TABLE `__new_recurring_expenses` RENAME TO `recurring_expenses`;--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_group_created` ON `recurring_expenses` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_paid_by` ON `recurring_expenses` (`paid_by`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_created_by` ON `recurring_expenses` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_category` ON `recurring_expenses` (`category`);--> statement-breakpoint
CREATE TABLE `__new_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_user` text NOT NULL,
	`to_user` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_settlements`("id", "group_id", "from_user", "to_user", "amount", "note", "created_by", "created_at") SELECT "id", "group_id", "from_user", "to_user", CAST(ROUND("amount" * 100) AS INTEGER), "note", "created_by", "created_at" FROM `settlements`;--> statement-breakpoint
DROP TABLE `settlements`;--> statement-breakpoint
ALTER TABLE `__new_settlements` RENAME TO `settlements`;--> statement-breakpoint
CREATE INDEX `idx_settlements_group_created` ON `settlements` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_settlements_from` ON `settlements` (`from_user`);--> statement-breakpoint
CREATE INDEX `idx_settlements_to` ON `settlements` (`to_user`);--> statement-breakpoint
CREATE INDEX `idx_settlements_created_by` ON `settlements` (`created_by`);--> statement-breakpoint
CREATE TABLE `__new_expense_splits` (
	`expense_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `user_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_expense_splits`("expense_id", "user_id", "amount") SELECT "expense_id", "user_id", CAST(ROUND("amount" * 100) AS INTEGER) FROM `expense_splits`;--> statement-breakpoint
DROP TABLE `expense_splits`;--> statement-breakpoint
ALTER TABLE `__new_expense_splits` RENAME TO `expense_splits`;--> statement-breakpoint
CREATE INDEX `idx_expense_splits_user` ON `expense_splits` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_settlement_allocations` (
	`settlement_id` text NOT NULL,
	`debtor_id` text NOT NULL,
	`creditor_id` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`settlement_id`, `debtor_id`, `creditor_id`),
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`debtor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creditor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_settlement_allocations`("settlement_id", "debtor_id", "creditor_id", "amount") SELECT "settlement_id", "debtor_id", "creditor_id", CAST(ROUND("amount" * 100) AS INTEGER) FROM `settlement_allocations`;--> statement-breakpoint
DROP TABLE `settlement_allocations`;--> statement-breakpoint
ALTER TABLE `__new_settlement_allocations` RENAME TO `settlement_allocations`;--> statement-breakpoint
CREATE INDEX `idx_settlement_allocations_pair` ON `settlement_allocations` (`debtor_id`,`creditor_id`);--> statement-breakpoint
CREATE INDEX `idx_settlement_allocations_creditor` ON `settlement_allocations` (`creditor_id`);--> statement-breakpoint
ALTER TABLE `groups` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username_lower` ON `users` (lower("username"));--> statement-breakpoint
-- Expenses whose float shares were within the old tolerance but not exact:
-- give the difference to the largest share so every row reconciles exactly.
UPDATE `expense_splits` SET `amount` = `amount` + (
	SELECT e.`amount_base` - (SELECT SUM(s2.`amount`) FROM `expense_splits` s2 WHERE s2.`expense_id` = e.`id`)
	FROM `expenses` e WHERE e.`id` = `expense_splits`.`expense_id`
)
WHERE (`expense_id`, `user_id`) IN (
	SELECT `expense_id`, `user_id` FROM (
		SELECT s.`expense_id`, s.`user_id`,
			ROW_NUMBER() OVER (PARTITION BY s.`expense_id` ORDER BY s.`amount` DESC, s.`user_id`) AS rn
		FROM `expense_splits` s
		JOIN `expenses` e ON e.`id` = s.`expense_id`
		WHERE e.`amount_base` != (SELECT SUM(s3.`amount`) FROM `expense_splits` s3 WHERE s3.`expense_id` = e.`id`)
	) WHERE rn = 1
);