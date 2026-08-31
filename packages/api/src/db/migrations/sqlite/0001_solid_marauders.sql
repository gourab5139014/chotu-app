CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_hash_uq` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`user_agent` text,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_hash_uq` ON `session` (`token_hash`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` text,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`password_hash` text,
	`must_change_password` integer DEFAULT false NOT NULL,
	`unit_system` text NOT NULL,
	`currency_code` text NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deactivated_at` text,
	CONSTRAINT "user_role_ck" CHECK("user"."role" in ('user', 'admin')),
	CONSTRAINT "user_status_ck" CHECK("user"."status" in ('active', 'deactivated')),
	CONSTRAINT "user_unit_system_ck" CHECK("user"."unit_system" in ('imperial', 'metric')),
	CONSTRAINT "user_currency_code_ck" CHECK("user"."currency_code" glob '[A-Z][A-Z][A-Z]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_lower_uq` ON `user` (lower("email"));--> statement-breakpoint
CREATE INDEX `user_active_admin_ix` ON `user` (`role`,`status`) WHERE "user"."role" = 'admin' and "user"."status" = 'active';--> statement-breakpoint
CREATE TABLE `user_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_token_purpose_ck" CHECK("user_token"."purpose" in ('reset', 'verify', 'set_password'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_token_hash_uq` ON `user_token` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_token_one_unused_uq` ON `user_token` (`user_id`,`purpose`) WHERE "user_token"."used_at" is null;