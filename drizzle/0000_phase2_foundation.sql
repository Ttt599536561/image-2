-- 手工补：gen_random_uuid() 依赖（02 §3.5 顺序 pgcrypto → 业务表）。PG13+ 已内置，IF NOT EXISTS 幂等。
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance_mp" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_balance_chk" CHECK ("credit_accounts"."balance_mp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount_mp" bigint NOT NULL,
	"balance_after_mp" bigint NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_entry_type_chk" CHECK ("credit_ledger"."entry_type" IN ('grant','credit','debit','refund','expire','adjust')),
	CONSTRAINT "credit_ledger_amount_chk" CHECK ("credit_ledger"."amount_mp" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"code_id" uuid,
	"granted_mp" bigint NOT NULL,
	"remaining_mp" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_lots_source_chk" CHECK ("credit_lots"."source" IN ('signup','code','adjust')),
	CONSTRAINT "credit_lots_granted_chk" CHECK ("credit_lots"."granted_mp" > 0),
	CONSTRAINT "credit_lots_remaining_chk" CHECK ("credit_lots"."remaining_mp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"model" text DEFAULT 'gpt-image-2' NOT NULL,
	"size" text NOT NULL,
	"quality" text,
	"background" text,
	"moderation" text DEFAULT 'low' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"error_code" text,
	"error" text,
	"http_status" integer,
	"credits_charged_mp" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generations_status_chk" CHECK ("generations"."status" IN ('queued','claimed','running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text NOT NULL,
	"content_type" text,
	"width" integer,
	"height" integer,
	"size_bytes" bigint,
	"is_public" boolean DEFAULT false NOT NULL,
	"saved_to_library" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_generation_id_unique" UNIQUE("generation_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_cash" bigint NOT NULL,
	"credits_mp" bigint NOT NULL,
	"valid_days" integer,
	"redirect_url" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_price_chk" CHECK ("packages"."price_cash" > 0),
	CONSTRAINT "packages_credits_chk" CHECK ("packages"."credits_mp" > 0)
);
--> statement-breakpoint
CREATE TABLE "redeem_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"package_id" uuid,
	"credits_value_mp" bigint NOT NULL,
	"cash_value" bigint NOT NULL,
	"valid_days" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"batch_id" uuid,
	"redeemed_by" uuid,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redeem_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "redeem_codes_credits_chk" CHECK ("redeem_codes"."credits_value_mp" > 0),
	CONSTRAINT "redeem_codes_cash_chk" CHECK ("redeem_codes"."cash_value" >= 0),
	CONSTRAINT "redeem_codes_status_chk" CHECK ("redeem_codes"."status" IN ('active','redeemed','disabled'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text DEFAULT 'user' NOT NULL,
	"max_concurrency" integer DEFAULT 2 NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"has_paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_chk" CHECK ("users"."role" IN ('user','admin')),
	CONSTRAINT "users_max_concurrency_chk" CHECK ("users"."max_concurrency" >= 1)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_conv_user_upd" ON "conversations" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_debit" ON "credit_ledger" USING btree ("ref_id") WHERE entry_type = 'debit';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refund" ON "credit_ledger" USING btree ("ref_id") WHERE entry_type = 'refund';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grant_signup" ON "credit_ledger" USING btree ("ref_id") WHERE entry_type = 'grant' AND ref_type = 'signup';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_code" ON "credit_ledger" USING btree ("ref_id") WHERE entry_type = 'credit';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_expire_lot" ON "credit_ledger" USING btree ("ref_id") WHERE entry_type = 'expire';--> statement-breakpoint
CREATE INDEX "ix_ledger_user_time" ON "credit_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_lots_user_exp" ON "credit_lots" USING btree ("user_id","expires_at","created_at");--> statement-breakpoint
CREATE INDEX "ix_events_type_time" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "ix_gen_conv" ON "generations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ix_gen_user_time" ON "generations" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_gen_status_time" ON "generations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_img_user_time" ON "images" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_img_expires" ON "images" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_dedupe" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "ix_notif_user" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE read_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_codes_batch" ON "redeem_codes" USING btree ("batch_id");