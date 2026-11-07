-- =============================================================================
-- COMEDOR — Fase 2: menú semanal y reservas (sigue a la receta 161).
--
--   · Menú de la semana (comedor_menu_semana): 2 opciones por día, lunes a viernes. Cada opción
--     (comedor_menu_opciones) es un plato con nombre y precio; puede linkear a un producto tipo
--     'menu' (para costear/descontar stock en la Fase 3) o quedar como texto libre. Se puede marcar
--     una opción como «especial» (precio habitual + precio especial; la diferencia la paga la empresa).
--   · El comedor publica la semana → genera un enlace por token (como las mesas QR) y un horario de
--     cierre. El funcionario abre el link, se identifica por CI y elige UNA opción por día o
--     «traigo mi almuerzo» (reserva null), antes del cierre.
--   · Reservar NO genera consumo ni cargo (R01): el cargo nace con el retiro (Fase 3). Único
--     (funcionario, fecha): una reserva por día. El conteo por opción sirve para preparar.
--
-- Identificación por CI (sin PIN), como el formulario actual. IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
create table if not exists :"schema".comedor_menu_semana (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  semana_inicio date not null,                 -- lunes de la semana
  publicado boolean not null default false,
  cierre_at timestamptz,                        -- hasta cuándo se puede reservar
  token text,                                   -- enlace público (64 hex); se genera al publicar
  creado_by uuid references :"schema".usuarios(id) on delete set null,
  creado_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists comedor_menu_semana_unica on :"schema".comedor_menu_semana (empresa_id, semana_inicio);
create unique index if not exists comedor_menu_semana_token on :"schema".comedor_menu_semana (token) where token is not null;

create table if not exists :"schema".comedor_menu_opciones (
  id uuid primary key default gen_random_uuid(),
  semana_id uuid not null references :"schema".comedor_menu_semana(id) on delete cascade,
  dia smallint not null check (dia between 1 and 5),      -- 1=lunes … 5=viernes (isodow)
  opcion smallint not null check (opcion between 1 and 2),
  producto_id uuid references :"schema".productos(id) on delete set null,
  nombre text not null check (length(trim(nombre)) between 1 and 160),
  especial boolean not null default false,
  precio_habitual numeric(16,0) not null default 0 check (precio_habitual >= 0),
  precio_especial numeric(16,0) check (precio_especial is null or precio_especial >= 0),
  activa boolean not null default true
);
create unique index if not exists comedor_menu_opciones_unica on :"schema".comedor_menu_opciones (semana_id, dia, opcion);

create table if not exists :"schema".comedor_reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  funcionario_id uuid not null references :"schema".clientes(id) on delete cascade,
  fecha date not null,
  opcion_id uuid references :"schema".comedor_menu_opciones(id) on delete set null, -- null = "traigo mi almuerzo"
  origen text not null default 'link' check (origen in ('link', 'operador')),
  creado_por uuid references :"schema".usuarios(id) on delete set null,
  creado_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists comedor_reservas_una_por_dia on :"schema".comedor_reservas (funcionario_id, fecha);
create index if not exists comedor_reservas_fecha_idx on :"schema".comedor_reservas (empresa_id, fecha);
create index if not exists comedor_reservas_opcion_idx on :"schema".comedor_reservas (opcion_id) where opcion_id is not null;

do $do$
declare
  t text;
begin
  foreach t in array array['comedor_menu_semana', 'comedor_menu_opciones', 'comedor_reservas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
  -- Política por empresa en las que tienen empresa_id directa.
  foreach t in array array['comedor_menu_semana', 'comedor_reservas'] loop
    execute format($p$drop policy if exists %1$s_empresa on %1$I$p$, t);
    execute format($p$create policy %1$s_empresa on %1$I using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())$p$, t);
  end loop;
  -- Opciones: por la empresa de su semana.
  drop policy if exists comedor_menu_opciones_empresa on comedor_menu_opciones;
  create policy comedor_menu_opciones_empresa on comedor_menu_opciones
    using (exists (select 1 from comedor_menu_semana s where s.id = semana_id and s.empresa_id = empresa_actual()))
    with check (exists (select 1 from comedor_menu_semana s where s.id = semana_id and s.empresa_id = empresa_actual()));
end;
$do$;

-- =============================================================================
-- 2. Helpers
-- =============================================================================
-- El lunes de la semana de una fecha.
create or replace function :"schema".comedor_lunes(p_fecha date) returns date
language sql immutable set search_path = :"schema", public as $fn$
  select p_fecha - ((extract(isodow from p_fecha)::int - 1))
$fn$;

-- Arma el jsonb de una semana (con sus opciones y el conteo de reservas por opción).
create or replace function :"schema".comedor_menu_json(p_semana uuid) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'id', s.id, 'semana_inicio', s.semana_inicio, 'publicado', s.publicado,
    'cierre_at', s.cierre_at, 'token', s.token,
    'opciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'dia', o.dia, 'opcion', o.opcion, 'producto_id', o.producto_id,
        'nombre', o.nombre, 'especial', o.especial, 'precio_habitual', o.precio_habitual,
        'precio_especial', o.precio_especial, 'activa', o.activa,
        'reservas', (select count(*) from comedor_reservas r where r.opcion_id = o.id)
      ) order by o.dia, o.opcion)
      from comedor_menu_opciones o where o.semana_id = s.id and o.activa
    ), '[]'::jsonb),
    'propio', (select count(*) from comedor_reservas r
                where r.empresa_id = s.empresa_id and r.opcion_id is null
                  and r.fecha >= s.semana_inicio and r.fecha < s.semana_inicio + 7)
  ) into v
  from comedor_menu_semana s where s.id = p_semana;
  return v;
end;
$fn$;

-- =============================================================================
-- 3. Gestión del menú (comedor)
-- =============================================================================
-- Trae (o arma en memoria) la semana que contiene a p_fecha.
create or replace function :"schema".comedor_menu_cargar(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_lunes date := comedor_lunes(coalesce(p_fecha, comedor_hoy()));
  v_id uuid;
begin
  select * into s from comedor_sesion('comedor_administrar');
  select id into v_id from comedor_menu_semana where empresa_id = s.s_empresa and semana_inicio = v_lunes;
  if v_id is null then
    return jsonb_build_object('id', null, 'semana_inicio', v_lunes, 'publicado', false,
                              'cierre_at', null, 'token', null, 'opciones', '[]'::jsonb, 'propio', 0);
  end if;
  return comedor_menu_json(v_id);
end;
$fn$;

-- Guarda las opciones de una semana (upsert por día+opción; no borra, para no perder reservas).
create or replace function :"schema".comedor_menu_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_lunes date := comedor_lunes((p->>'semana_inicio')::date);
  v_id uuid;
  it jsonb;
begin
  select * into s from comedor_sesion('comedor_administrar');
  if p->>'semana_inicio' is null then raise exception 'Falta la semana'; end if;

  insert into comedor_menu_semana (empresa_id, semana_inicio, creado_by)
  values (s.s_empresa, v_lunes, s.s_usuario)
  on conflict (empresa_id, semana_inicio) do update set updated_at = now()
  returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p->'opciones', '[]'::jsonb)) loop
    if trim(coalesce(it->>'nombre', '')) = '' then
      -- Slot vaciado por el usuario: desactiva la opción si existía (no la borra, para no perder
      -- reservas ni historial). Así "borrar un plato" del grid efectivamente lo quita del menú.
      update comedor_menu_opciones set activa = false
       where semana_id = v_id and dia = (it->>'dia')::smallint and opcion = (it->>'opcion')::smallint;
      continue;
    end if;
    insert into comedor_menu_opciones (semana_id, dia, opcion, producto_id, nombre, especial, precio_habitual, precio_especial, activa)
    values (v_id, (it->>'dia')::smallint, (it->>'opcion')::smallint,
            nullif(it->>'producto_id', '')::uuid, trim(it->>'nombre'),
            coalesce((it->>'especial')::boolean, false),
            coalesce((it->>'precio_habitual')::numeric, 0),
            nullif(it->>'precio_especial', '')::numeric,
            true)
    on conflict (semana_id, dia, opcion) do update
      set producto_id = excluded.producto_id, nombre = excluded.nombre, especial = excluded.especial,
          precio_habitual = excluded.precio_habitual, precio_especial = excluded.precio_especial,
          activa = true;
  end loop;

  update comedor_menu_semana set updated_at = now() where id = v_id;
  return comedor_menu_json(v_id);
end;
$fn$;

-- Publica (o re-publica) la semana: genera token si no tiene y fija el cierre.
create or replace function :"schema".comedor_menu_publicar(p_semana uuid, p_cierre_at timestamptz default null, p_publicar boolean default true)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_token text;
begin
  select * into s from comedor_sesion('comedor_administrar');
  select token into v_token from comedor_menu_semana where id = p_semana and empresa_id = s.s_empresa;
  if not found then raise exception 'Semana no encontrada'; end if;
  if v_token is null and p_publicar then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  update comedor_menu_semana
     set publicado = p_publicar, cierre_at = p_cierre_at, token = v_token, updated_at = now()
   where id = p_semana and empresa_id = s.s_empresa;
  return comedor_menu_json(p_semana);
end;
$fn$;

-- =============================================================================
-- 4. Reserva pública (sin login, por CI)
-- =============================================================================
-- Resuelve el funcionario de un token + CI (sólo activos de la empresa del token).
create or replace function :"schema".comedor_publico_funcionario(p_token text, p_documento text,
  out o_empresa uuid, out o_semana uuid, out o_funcionario uuid, out o_nombre text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
begin
  if p_token !~ '^[0-9a-f]{64}$' then raise exception 'Enlace inválido' using errcode = '42501'; end if;
  select s.empresa_id, s.id into o_empresa, o_semana from comedor_menu_semana s where s.token = p_token and s.publicado;
  if o_empresa is null then raise exception 'Este enlace no está disponible' using errcode = '42501'; end if;
  if length(v_doc) < 3 then raise exception 'Cargá tu cédula' using errcode = '22023'; end if;
  select c.id, c.nombre into o_funcionario, o_nombre
    from clientes c
   where c.empresa_id = o_empresa and c.es_funcionario and c.activo
     and regexp_replace(coalesce(c.documento, ''), '\D', '', 'g') = v_doc
   limit 1;
  if o_funcionario is null then raise exception 'No encontramos tu cédula en el padrón. Avisá a RR. HH.' using errcode = '22023'; end if;
end;
$fn$;

-- El menú de la semana para la página pública (sin exigir CI: muestra los platos).
create or replace function :"schema".comedor_publico_menu(p_token text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_cerrado boolean;
begin
  if p_token !~ '^[0-9a-f]{64}$' then raise exception 'Enlace inválido' using errcode = '42501'; end if;
  select * into s from comedor_menu_semana where token = p_token and publicado;
  if not found then raise exception 'Este enlace no está disponible' using errcode = '42501'; end if;
  v_cerrado := s.cierre_at is not null and now() > s.cierre_at;
  return jsonb_build_object(
    'empresa_nombre', (select e.nombre from empresas e where e.id = s.empresa_id),
    'semana_inicio', s.semana_inicio, 'cierre_at', s.cierre_at, 'cerrado', v_cerrado,
    'dias', coalesce((
      select jsonb_agg(d) from (
        select jsonb_build_object(
          'dia', g.dia, 'fecha', s.semana_inicio + (g.dia - 1),
          'opciones', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'especial', o.especial) order by o.opcion)
              from comedor_menu_opciones o where o.semana_id = s.id and o.dia = g.dia and o.activa
          ), '[]'::jsonb)
        ) as d
        from generate_series(1, 5) as g(dia)
      ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

-- Identificar por CI (devuelve el nombre y las reservas que ya tenga).
create or replace function :"schema".comedor_publico_mis_reservas(p_token text, p_documento text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_lunes date;
begin
  select * into r from comedor_publico_funcionario(p_token, p_documento);
  select semana_inicio into v_lunes from comedor_menu_semana where id = r.o_semana;
  return jsonb_build_object(
    'ok', true, 'funcionario', jsonb_build_object('nombre', r.o_nombre),
    'reservas', coalesce((
      select jsonb_object_agg(res.fecha::text, coalesce(res.opcion_id::text, 'propio'))
        from comedor_reservas res
       where res.funcionario_id = r.o_funcionario and res.fecha >= v_lunes and res.fecha < v_lunes + 7
    ), '{}'::jsonb)
  );
end;
$fn$;

-- Guardar/cambiar la reserva de un día (opcion null = "traigo mi almuerzo").
create or replace function :"schema".comedor_publico_reservar(p_token text, p_documento text, p_fecha date, p_opcion uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  s record;
begin
  select * into r from comedor_publico_funcionario(p_token, p_documento);
  select * into s from comedor_menu_semana where id = r.o_semana;
  if s.cierre_at is not null and now() > s.cierre_at then raise exception 'Las reservas de esta semana ya cerraron' using errcode = '22023'; end if;
  if p_fecha < s.semana_inicio or p_fecha >= s.semana_inicio + 7 then raise exception 'Esa fecha no es de esta semana' using errcode = '22023'; end if;
  if extract(isodow from p_fecha) > 5 then raise exception 'El comedor es de lunes a viernes' using errcode = '22023'; end if;
  if p_opcion is not null and not exists (
      select 1 from comedor_menu_opciones o
       where o.id = p_opcion and o.semana_id = s.id and o.dia = extract(isodow from p_fecha)::smallint and o.activa) then
    raise exception 'Esa opción no es válida para ese día' using errcode = '22023';
  end if;
  insert into comedor_reservas (empresa_id, funcionario_id, fecha, opcion_id, origen)
  values (r.o_empresa, r.o_funcionario, p_fecha, p_opcion, 'link')
  on conflict (funcionario_id, fecha) do update set opcion_id = excluded.opcion_id, origen = 'link', updated_at = now();
  return comedor_publico_mis_reservas(p_token, p_documento);
end;
$fn$;

-- =============================================================================
-- 5. Permisos
-- =============================================================================
do $do$
declare
  f text;
begin
  -- Internas.
  foreach f in array array['comedor_lunes(date)', 'comedor_menu_json(uuid)', 'comedor_publico_funcionario(text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Con sesión (comedor_administrar).
  foreach f in array array['comedor_menu_cargar(date)', 'comedor_menu_guardar(jsonb)', 'comedor_menu_publicar(uuid,timestamptz,boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Públicas por token (sin login).
  foreach f in array array['comedor_publico_menu(text)', 'comedor_publico_mis_reservas(text,text)', 'comedor_publico_reservar(text,text,date,uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
