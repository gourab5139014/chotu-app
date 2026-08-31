CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`summary` text NOT NULL,
	`metadata` text,
	`ip` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_ix` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_ix` ON `audit_log` (`target_type`,`target_id`);