-- Tabla que guarda qué usuarios han pagado Premium.
-- Ejecutar una vez en Supabase: SQL Editor → New query → pegar → Run.

create table if not exists public.premium (
  user_id uuid primary key references auth.users (id) on delete cascade,
  es_premium boolean not null default false,
  stripe_session_id text,
  pagado_en timestamptz
);

-- Activar seguridad a nivel de fila (RLS)
alter table public.premium enable row level security;

-- Cada usuario solo puede LEER su propia fila.
drop policy if exists "Cada usuario ve su estado premium" on public.premium;
create policy "Cada usuario ve su estado premium"
  on public.premium
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No hay políticas de insert/update/delete: desde el navegador nadie puede
-- marcarse como premium. Solo la Edge Function del webhook (con la clave
-- service_role, que vive en el servidor) puede escribir en esta tabla.
