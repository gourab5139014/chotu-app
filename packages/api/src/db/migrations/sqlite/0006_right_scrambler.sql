CREATE TABLE `fuel_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`odometer_mi_e3` integer NOT NULL,
	`volume_gal_e3` integer NOT NULL,
	`total_cost_usd_cents` integer NOT NULL,
	`currency_code` text NOT NULL,
	`is_full_tank` integer DEFAULT true NOT NULL,
	`notes` text,
	`source_unit_system` text NOT NULL,
	`source_payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "fuel_entry_odometer_ck" CHECK("fuel_entry"."odometer_mi_e3" >= 0),
	CONSTRAINT "fuel_entry_volume_ck" CHECK("fuel_entry"."volume_gal_e3" > 0),
	CONSTRAINT "fuel_entry_cost_ck" CHECK("fuel_entry"."total_cost_usd_cents" >= 0),
	CONSTRAINT "fuel_entry_currency_ck" CHECK("fuel_entry"."currency_code" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "fuel_entry_source_unit_ck" CHECK("fuel_entry"."source_unit_system" in ('imperial', 'metric'))
);
--> statement-breakpoint
CREATE INDEX `fuel_entry_history_ix` ON `fuel_entry` (`vehicle_id`,"entry_date" desc,"created_at" desc);