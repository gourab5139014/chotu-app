CREATE TABLE "vehicle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"fuel_type" text,
	"initial_odometer_mi_e3" bigint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vehicle_initial_odometer_ck" CHECK ("vehicle"."initial_odometer_mi_e3" >= 0),
	CONSTRAINT "vehicle_year_ck" CHECK ("vehicle"."year" is null or "vehicle"."year" between 1900 and 2100),
	CONSTRAINT "vehicle_fuel_type_ck" CHECK ("vehicle"."fuel_type" is null or "vehicle"."fuel_type" in ('gasoline', 'diesel', 'ev', 'hybrid', 'other'))
);
--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_user_name_active_uq" ON "vehicle" USING btree ("user_id","name") WHERE "vehicle"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "vehicle_user_archived_ix" ON "vehicle" USING btree ("user_id","archived_at");