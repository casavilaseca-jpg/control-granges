-- ============================================================
-- Afegeix la columna de PES a les baixes (kg totals de la baixa).
-- Executar a Supabase: Dashboard > SQL Editor > New query > Run.
-- No afecta les baixes existents (queden amb pes buit fins que s'editin).
-- ============================================================

alter table public.baixes add column if not exists pes_kg numeric;
