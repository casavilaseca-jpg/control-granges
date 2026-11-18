-- ============================================================
-- Taula d'ADMINS: correus autoritzats a crear usuaris des de l'app.
-- Executar a Supabase: Dashboard > SQL Editor > New query > Run.
--
-- IMPORTANT: substitueix 'EL-TEU-CORREU@exemple.com' pel teu correu real
-- (el mateix amb què entres a l'app) abans de prémer Run.
-- No afecta cap dada existent.
-- ============================================================

create table if not exists public.admins (
  email text primary key,
  created_at timestamptz default now()
);

alter table public.admins enable row level security;

-- Qualsevol usuari autenticat pot LLEGIR la llista (per saber si ell és admin),
-- però ningú la pot modificar des de l'app: els admins es gestionen aquí, a Supabase.
create policy "auth_read_admins" on public.admins
  for select to authenticated using (true);

-- Afegeix-te com a administrador (posa el TEU correu):
insert into public.admins (email) values ('EL-TEU-CORREU@exemple.com')
  on conflict (email) do nothing;
