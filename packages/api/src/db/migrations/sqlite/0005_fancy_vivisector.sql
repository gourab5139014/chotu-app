CREATE TABLE `vehicle` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`make` text,
	`model` text,
	`year` integer,
	`fuel_type` text,
	`initial_odometer_mi_e3` integer NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "vehicle_initial_odometer_ck" CHECK("vehicle"."initial_odometer_mi_e3" >= 0),
	CONSTRAINT "vehicle_year_ck" CHECK("vehicle"."year" is null or "vehicle"."year" between 1900 and 2100),
	CONSTRAINT "vehicle_fuel_type_ck" CHECK("vehicle"."fuel_type" is null or "vehicle"."fuel_type" in ('gasoline', 'diesel', 'ev', 'hybrid', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_user_name_active_uq` ON `vehicle` (`user_id`,`name`) WHERE "vehicle"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `vehicle_user_archived_ix` ON `vehicle` (`user_id`,`archived_at`);