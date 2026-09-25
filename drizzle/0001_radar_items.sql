-- Radar de notícias: itens enviados pelo serviço externo e curados pelo admin.
-- Aplicar com: npm run db:sql -- drizzle/0001_radar_items.sql
-- (não usar `drizzle-kit push`: ele derrubaria posts.search_vector, que não está no schema.ts)

CREATE TABLE IF NOT EXISTS "radar_items" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"        text NOT NULL,
  "link"         text NOT NULL,
  "source"       text NOT NULL,
  "summary"      text,
  "score"        integer NOT NULL DEFAULT 0,
  "hits"         jsonb,
  "published_at" timestamptz,
  "run_type"     text NOT NULL,
  "tier"         text NOT NULL,
  "status"       text NOT NULL DEFAULT 'pending',
  "rank"         integer,
  "approved_at"  timestamptz,
  "created_at"   timestamptz DEFAULT now(),
  CONSTRAINT "radar_items_link_unique"  UNIQUE ("link"),
  CONSTRAINT "radar_items_run_type_chk" CHECK ("run_type" IN ('daily', 'weekly')),
  CONSTRAINT "radar_items_tier_chk"     CHECK ("tier" IN ('members', 'public')),
  CONSTRAINT "radar_items_status_chk"   CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "radar_items_rank_chk"     CHECK ("rank" IS NULL OR "rank" >= 1)
);

CREATE INDEX IF NOT EXISTS "radar_items_status_tier_approved_idx" ON "radar_items" ("status", "tier", "approved_at");
CREATE INDEX IF NOT EXISTS "radar_items_status_created_idx"       ON "radar_items" ("status", "created_at");
