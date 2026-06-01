CREATE TABLE "health_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"source" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"metric_name" text NOT NULL,
	"units" text,
	"date" timestamp with time zone NOT NULL,
	"qty" numeric,
	"min" numeric,
	"avg" numeric,
	"max" numeric,
	"systolic" numeric,
	"diastolic" numeric,
	"source" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" timestamp with time zone,
	"end" timestamp with time zone,
	"duration_s" numeric,
	"active_energy" numeric,
	"active_energy_units" text,
	"distance" numeric,
	"distance_units" text,
	"avg_hr" numeric,
	"max_hr" numeric,
	"step_count" numeric,
	"route" jsonb,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "health_events_type_date_idx" ON "health_events" USING btree ("event_type","date");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_samples_uq" ON "metric_samples" USING btree ("metric_name","date","source");--> statement-breakpoint
CREATE INDEX "metric_samples_name_date_idx" ON "metric_samples" USING btree ("metric_name","date");