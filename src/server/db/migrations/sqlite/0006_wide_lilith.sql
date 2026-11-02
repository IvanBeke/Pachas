CREATE TABLE `category_title_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized_title` text NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_category_title_links_title` ON `category_title_links` (`normalized_title`);--> statement-breakpoint
CREATE INDEX `idx_category_title_links_category` ON `category_title_links` (`category_id`);