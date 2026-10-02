CREATE TABLE `app_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_user` ON `app_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_app_sessions_expires` ON `app_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`icon` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `category_translations` (
	`category_id` integer NOT NULL,
	`locale` text NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`category_id`, `locale`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expense_splits` (
	`expense_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` real NOT NULL,
	PRIMARY KEY(`expense_id`, `user_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`amount_base` real NOT NULL,
	`paid_by` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`date` text NOT NULL,
	`split_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_expenses_group` ON `expenses` (`group_id`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_group_members_user` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_members_creator` ON `group_members` (`group_id`) WHERE "group_members"."role" = 'creator';--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`base_currency` text NOT NULL,
	`simplify_transfers` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`amount_base` real NOT NULL,
	`paid_by` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`split_type` text NOT NULL,
	`splits` text NOT NULL,
	`recurrence` text NOT NULL,
	`start_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_group` ON `recurring_expenses` (`group_id`);--> statement-breakpoint
CREATE TABLE `settlement_allocations` (
	`settlement_id` text NOT NULL,
	`debtor_id` text NOT NULL,
	`creditor_id` text NOT NULL,
	`amount` real NOT NULL,
	PRIMARY KEY(`settlement_id`, `debtor_id`, `creditor_id`),
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`debtor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creditor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_settlement_allocations_pair` ON `settlement_allocations` (`debtor_id`,`creditor_id`);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_user` text NOT NULL,
	`to_user` text NOT NULL,
	`amount` real NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_settlements_group` ON `settlements` (`group_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);