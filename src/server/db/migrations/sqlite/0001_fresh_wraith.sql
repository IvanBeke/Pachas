DROP INDEX `idx_group_members_creator`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_members_creator` ON `group_members` (`group_id`) WHERE "role" = 'creator';