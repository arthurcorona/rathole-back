-- Liga RLS nas tabelas que ficaram de fora (estavam abertas para a chave anon na Data API do Supabase).
-- Sem policies: anon/authenticated não leem nem escrevem nada por lá.
-- O back conecta como `postgres` (BYPASSRLS), então o app não é afetado.
-- Aplicar com: npm run db:sql -- drizzle/0002_enable_rls.sql
--
-- Atenção: no Supabase, toda tabela nova criada por SQL no schema public nasce com GRANT ALL para anon.
-- Ao criar tabela nova, inclua o `enable row level security` no mesmo arquivo.

ALTER TABLE public.radar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_votes  ENABLE ROW LEVEL SECURITY;
