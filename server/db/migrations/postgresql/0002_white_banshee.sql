CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"icon" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE NO ACTION;
--> statement-breakpoint
-- Seed the built-in categories (idempotent).
-- Spanish is the app's default locale (nuxt.config defaultLocale: "es"), so
-- Spanish is the base title and English is stored as a translation.
INSERT INTO "categories" ("title", "icon", "position") VALUES
  ('General', '🧾', 0),
  ('Comida', '🍜', 1),
  ('Supermercado', '🛒', 2),
  ('Transporte', '🚕', 3),
  ('Vivienda', '🏠', 4),
  ('Suministros', '💡', 5),
  ('Ocio', '🎬', 6),
  ('Viajes', '✈️', 7),
  ('Compras', '🛍️', 8)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bootstrap: the oldest registered user becomes the first admin.
UPDATE "users" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);