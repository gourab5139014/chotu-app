CREATE TABLE `identity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_key` text NOT NULL,
	`subject` text NOT NULL,
	`email_at_link` text,
	`created_at` text NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_key`) REFERENCES `oidc_provider`(`key`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_provider_subject_uq` ON `identity` (`provider_key`,`subject`);--> statement-breakpoint
CREATE INDEX `identity_user_ix` ON `identity` (`user_id`);--> statement-breakpoint
CREATE TABLE `oidc_login` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_key` text NOT NULL,
	`state_hash` text NOT NULL,
	`code_verifier` text NOT NULL,
	`nonce` text,
	`redirect_to` text,
	`link_user_id` text,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`provider_key`) REFERENCES `oidc_provider`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`link_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_login_state_hash_uq` ON `oidc_login` (`state_hash`);--> statement-breakpoint
CREATE TABLE `oidc_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`issuer_url` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_ref` text NOT NULL,
	`scopes` text NOT NULL,
	`allowed_email_domains` text,
	`allowed_groups` text,
	`auto_provision` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "oidc_provider_key_ck" CHECK(length("oidc_provider"."key") between 1 and 40 and "oidc_provider"."key" not glob '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_provider_key_uq` ON `oidc_provider` (`key`);