CREATE TABLE "fuel_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"odometer_mi_e3" bigint NOT NULL,
	"volume_gal_e3" bigint NOT NULL,
	"total_cost_usd_cents" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"is_full_tank" boolean DEFAULT true NOT NULL,
	"notes" text,
	"source_unit_system" text NOT NULL,
	"source_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fuel_entry_odometer_ck" CHECK ("fuel_entry"."odometer_mi_e3" >= 0),
	CONSTRAINT "fuel_entry_volume_ck" CHECK ("fuel_entry"."volume_gal_e3" > 0),
	CONSTRAINT "fuel_entry_cost_ck" CHECK ("fuel_entry"."total_cost_usd_cents" >= 0),
	CONSTRAINT "fuel_entry_currency_ck" CHECK ("fuel_entry"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fuel_entry_source_unit_ck" CHECK ("fuel_entry"."source_unit_system" in ('imperial', 'metric'))
);
--> statement-breakpoint
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_entry_history_ix" ON "fuel_entry" USING btree ("vehicle_id","entry_date" desc,"created_at" desc);