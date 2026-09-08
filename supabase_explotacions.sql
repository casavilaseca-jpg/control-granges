-- ============================================================
-- Taula d'EXPLOTACIONS (granges reals amb les fases que tenen)
-- Executar a Supabase: Dashboard > SQL Editor > New query > Run
--
-- Es fa servir per a la Configuracio de l'app: definir amb quines
-- granges treballes i quines fases te cada una, per proposar-les
-- automaticament en anotar dades. NO afecta cap dada existent.
-- ============================================================

create table if not exists public.explotacions (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  te_mares boolean default false,
  te_transicio boolean default false,
  te_preengreix boolean default false,
  te_engreix boolean default false,
  created_at timestamptz default now()
);

alter table public.explotacions enable row level security;

-- Nomes usuaris autenticats (igual que la resta de taules)
create policy "auth_all_explotacions" on public.explotacions
  for all to authenticated using (true) with check (true);
