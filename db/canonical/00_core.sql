-- =============================================================================
-- Core canónico del tenant. Parametrizado por :schema (lo reemplaza provision.mjs).
-- IDEMPOTENTE: se puede correr muchas veces sin romper ni borrar datos.
-- NUNCA se copia de un schema vivo: cada cliente nace de ESTE archivo = clon limpio.
-- =============================================================================

create schema if not exists :"schema";

-- --- Empresas (una o varias dentro del schema del tenant) ---
create table if not exists :"schema".empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  creado_at   timestamptz not null default now()
);

-- --- Usuarios (vinculados a auth.users de Supabase) ---
create table if not exists :"schema".usuarios (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique,
  empresa_id    uuid not null references :"schema".empresas(id) on delete cascade,
  nombre        text not null,
  rol           text not null default 'VENDEDOR',
  activo        boolean not null default true,
  creado_at     timestamptz not null default now()
);
create index if not exists usuarios_empresa_idx on :"schema".usuarios(empresa_id);
create index if not exists usuarios_auth_idx    on :"schema".usuarios(auth_user_id);

-- --- Módulo de ejemplo: clientes ---
create table if not exists :"schema".clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references :"schema".empresas(id) on delete cascade,
  nombre      text not null,
  documento   text,
  creado_at   timestamptz not null default now()
);
create index if not exists clientes_empresa_idx on :"schema".clientes(empresa_id);

-- =============================================================================
-- RLS: DENY BY DEFAULT en todas las tablas. Sin política explícita, nadie entra.
-- El acceso real lo da withTenant (service-role scoped) + estas políticas para la
-- sesión del usuario (doble red). Las políticas keyean por empresa del usuario.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['empresas','usuarios','clientes'] loop
    execute format('alter table %I.%I enable row level security', :'schema', t);
    execute format('alter table %I.%I force row level security', :'schema', t);
  end loop;
end $$;

-- empresa_actual(): la empresa del usuario logueado, según el catálogo del schema.
create or replace function :"schema".empresa_actual()
returns uuid language sql stable security definer set search_path = :"schema", public as $$
  select u.empresa_id from usuarios u where u.auth_user_id = auth.uid() and u.activo limit 1
$$;

-- Políticas para el rol 'authenticated' (sesión del usuario): sólo su empresa.
drop policy if exists clientes_propios on :"schema".clientes;
create policy clientes_propios on :"schema".clientes to authenticated
  using (empresa_id = :"schema".empresa_actual())
  with check (empresa_id = :"schema".empresa_actual());

drop policy if exists usuarios_propios on :"schema".usuarios;
create policy usuarios_propios on :"schema".usuarios to authenticated
  using (empresa_id = :"schema".empresa_actual());

drop policy if exists empresas_propia on :"schema".empresas;
create policy empresas_propia on :"schema".empresas to authenticated
  using (id = :"schema".empresa_actual());

-- Permisos de tabla para los roles de Supabase (RLS filtra las filas).
grant usage on schema :"schema" to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema :"schema" to authenticated, service_role;
alter default privileges in schema :"schema"
  grant select, insert, update, delete on tables to authenticated, service_role;
