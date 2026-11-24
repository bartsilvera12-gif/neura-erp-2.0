-- =============================================================================
-- ENVÍOS — HISTORIAL DE ESTADOS (Fase 3). Receta 174, va después de 170.
-- Cada cambio de estado de un envío (y su estado inicial al crearse) queda registrado con quién y
-- cuándo, para ver la línea de tiempo de la entrega en la ficha del envío.
-- IDEMPOTENTE.
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

create table if not exists :"schema".envios_historial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  envio_id uuid not null references :"schema".envios(id) on delete cascade,
  estado_id uuid references :"schema".envios_estados(id) on delete set null,
  estado_nombre text,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  usuario_nombre text,
  at timestamptz not null default now()
);
create index if not exists envios_historial_envio_idx on :"schema".envios_historial (envio_id, at);

do $do$
begin
  execute 'alter table envios_historial enable row level security';
  execute 'alter table envios_historial force row level security';
  execute 'revoke all on envios_historial from public, anon, authenticated';
  execute 'grant all on envios_historial to service_role';
  execute 'drop policy if exists envios_historial_empresa on envios_historial';
  execute 'create policy envios_historial_empresa on envios_historial using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())';
end;
$do$;

-- Registra el estado al crear el envío y en cada cambio de estado.
create or replace function :"schema".tg_envios_historial()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if tg_op = 'INSERT' or new.estado_id is distinct from old.estado_id then
    insert into envios_historial (empresa_id, envio_id, estado_id, estado_nombre, usuario_id, usuario_nombre)
    select new.empresa_id, new.id, new.estado_id, e.nombre, u.id, u.nombre
      from envios_estados e
      left join usuarios u on u.auth_user_id = auth.uid() and u.empresa_id = new.empresa_id
     where e.id = new.estado_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_envios_historial on :"schema".envios;
create trigger trg_envios_historial after insert or update of estado_id on :"schema".envios
  for each row execute function :"schema".tg_envios_historial();

-- Línea de tiempo de un envío (lo más nuevo primero).
create or replace function :"schema".envio_historial(p_envio uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_operar');
  if not exists (select 1 from envios where id = p_envio and empresa_id = s.s_empresa) then
    raise exception 'Envío no encontrado';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'estado_nombre', h.estado_nombre, 'usuario_nombre', h.usuario_nombre, 'at', h.at)
      order by h.at desc)
    from envios_historial h where h.envio_id = p_envio and h.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

do $do$
begin
  execute 'revoke all on function envio_historial(uuid) from public, anon';
  execute 'grant execute on function envio_historial(uuid) to authenticated, service_role';
  execute 'revoke all on function tg_envios_historial() from public, anon, authenticated';
  execute 'grant execute on function tg_envios_historial() to service_role';
end;
$do$;

commit;

notify pgrst, 'reload schema';
