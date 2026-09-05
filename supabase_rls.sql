-- ============================================================
-- Seguretat Control de Granges — activar Row Level Security (RLS)
-- Executar a Supabase: Dashboard > SQL Editor > New query > Run
--
-- Que fa: bloqueja tot acces anonim (clau publica) a les dades i
-- nomes permet l'acces als usuaris autenticats (login de l'app).
-- L'app seguira funcionant igual perque envia el token de sessio.
-- ============================================================

-- Activa RLS a totes les taules
alter table public.granges     enable row level security;
alter table public.lots        enable row level security;
alter table public.entrades    enable row level security;
alter table public.sortides    enable row level security;
alter table public.baixes      enable row level security;
alter table public.tractaments enable row level security;
alter table public.desmamats   enable row level security;
alter table public.tasques     enable row level security;

-- Politica: nomes usuaris autenticats poden llegir/escriure
-- (model d'una sola organitzacio: tots els usuaris logats hi tenen acces)
create policy "auth_all_granges"     on public.granges     for all to authenticated using (true) with check (true);
create policy "auth_all_lots"        on public.lots        for all to authenticated using (true) with check (true);
create policy "auth_all_entrades"    on public.entrades    for all to authenticated using (true) with check (true);
create policy "auth_all_sortides"    on public.sortides    for all to authenticated using (true) with check (true);
create policy "auth_all_baixes"      on public.baixes      for all to authenticated using (true) with check (true);
create policy "auth_all_tractaments" on public.tractaments for all to authenticated using (true) with check (true);
create policy "auth_all_desmamats"   on public.desmamats   for all to authenticated using (true) with check (true);
create policy "auth_all_tasques"     on public.tasques     for all to authenticated using (true) with check (true);
