CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_role` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitation_role_ck" CHECK("invitation"."invited_role" in ('user', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_uq` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_pending_email_uq` ON `invitation` (lower("email")) WHERE "invitation"."accepted_at" is null;