CREATE TABLE "category_translations" (
	"category_id" integer NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "category_translations_category_id_locale_pk" PRIMARY KEY("category_id","locale")
);
--> statement-breakpoint
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- English titles for the built-in categories seeded in 0002. Spanish is the
-- app default locale, so it lives in categories.title and English is the
-- translation. Keyed by the Spanish base title so admin-created categories are
-- untouched, and ON CONFLICT DO NOTHING so an existing custom translation is
-- never overwritten. Re-running is a no-op.
INSERT INTO "category_translations" ("category_id", "locale", "title")
SELECT c.id, 'en', v.title
FROM "categories" c
JOIN (VALUES
  ('General',       'General'),
  ('Comida',        'Food'),
  ('Supermercado',  'Groceries'),
  ('Transporte',    'Transport'),
  ('Vivienda',      'Housing'),
  ('Suministros',   'Utilities'),
  ('Ocio',          'Entertainment'),
  ('Viajes',        'Travel'),
  ('Compras',       'Shopping')
) AS v(base_title, title) ON v.base_title = c.title
ON CONFLICT ("category_id", "locale") DO NOTHING;