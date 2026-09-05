CREATE TABLE "identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"subject" text NOT NULL,
	"email_at_link" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oidc_login" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text,
	"redirect_to" text,
	"link_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_provider" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"issuer_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_ref" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"allowed_email_domains" jsonb,
	"allowed_groups" jsonb,
	"auto_provision" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oidc_provider_key_ck" CHECK ("oidc_provider"."key" ~ '^[a-z0-9-]{1,40}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_provider_key_uq" ON "oidc_provider" USING btree ("key");--> statement-breakpoint
ALTER TABLE "identity" ADD CONSTRAINT "identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity" ADD CONSTRAINT "identity_provider_key_oidc_provider_key_fk" FOREIGN KEY ("provider_key") REFERENCES "public"."oidc_provider"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_login" ADD CONSTRAINT "oidc_login_provider_key_oidc_provider_key_fk" FOREIGN KEY ("provider_key") REFERENCES "public"."oidc_provider"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_login" ADD CONSTRAINT "oidc_login_link_user_id_user_id_fk" FOREIGN KEY ("link_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_provider_subject_uq" ON "identity" USING btree ("provider_key","subject");--> statement-breakpoint
CREATE INDEX "identity_user_ix" ON "identity" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_login_state_hash_uq" ON "oidc_login" USING btree ("state_hash");