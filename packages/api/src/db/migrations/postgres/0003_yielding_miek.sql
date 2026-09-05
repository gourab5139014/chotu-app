CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_role" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invitation_role_ck" CHECK ("invitation"."invited_role" in ('user', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_user_id_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_uq" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_email_uq" ON "invitation" USING btree (lower("email")) WHERE "invitation"."accepted_at" is null;