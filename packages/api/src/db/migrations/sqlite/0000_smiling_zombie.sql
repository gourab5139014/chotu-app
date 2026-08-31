CREATE TABLE `deployment_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_name` text NOT NULL,
	`registration_policy` text NOT NULL,
	`allowed_auth_methods` text NOT NULL,
	`default_unit_system` text NOT NULL,
	`default_currency_code` text NOT NULL,
	`default_time_zone` text NOT NULL,
	`fuel_volume_precision` integer NOT NULL,
	`session_ttl_seconds` integer NOT NULL,
	`api_token_ttl_seconds` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "deployment_settings_registration_policy_ck" CHECK("deployment_settings"."registration_policy" in ('invite_only', 'open', 'sso_auto')),
	CONSTRAINT "deployment_settings_default_unit_system_ck" CHECK("deployment_settings"."default_unit_system" in ('imperial', 'metric')),
	CONSTRAINT "deployment_settings_fuel_volume_precision_ck" CHECK("deployment_settings"."fuel_volume_precision" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE `schema_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`applied_at` text NOT NULL,
	`chotu_build` text NOT NULL
);
