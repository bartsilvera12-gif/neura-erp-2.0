-- =============================================================================
-- PROYECTOS — núcleo GENÉRICO del módulo del sistema actual (decisión 12-oct-2026:
-- sin la parte de fábrica de software: nada de briefs web/SaaS, QA, esqueleto,
-- credenciales ni cambios post-entrega).
--   · proyecto_estados configurables con tipo de SLA (interno | cliente | pausado | final),
--     objetivo en horas laborales, estado inicial / final y un ROL semántico (no se
--     resuelve nada por código fijo como en el actual)
--   · proyectos: responsables comercial / técnico / PM, prioridad, fechas ingreso /
--     prometida / entrega, monto, pausa y bloqueo con motivo, archivado
--   · historial por estado con duración (base del SLA) + bitácora de eventos
--   · tareas, comentarios por canal con menciones, archivos (bucket privado)
-- Optimizado (puntos lentos del actual):
--   · el tablero NO trae columnas pesadas: proyectos_tablero arma cada columna con su
--     cantidad y las primeras N tarjetas en UNA consulta; "cargar más" por cursor
--   · estado_desde guardado en el proyecto (el actual recorría TODO el historial para
--     saber desde cuándo está en el estado actual)
--   · cambiar de estado es UNA función (historial, pausa, entrega, bitácora)
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Horas laborales entre dos instantes (mismo reloj que Soporte) ───────────
create or replace function :"schema".horas_laborales_entre(p_desde timestamptz, p_hasta timestamptz)
returns numeric language plpgsql stable set search_path = :"schema", public as $fn$
declare
  cfg soporte_config; v_a timestamp; v_b timestamp; v_dia date; v_ini timestamp; v_fin timestamp; v_dow int;
  v_total numeric := 0; v_guard int := 0;
begin
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then return 0; end if;
  select * into cfg from soporte_config where empresa_id = empresa_actual();
  if not found then cfg.hora_inicio := 8; cfg.hora_fin := 17; cfg.sabado_hasta := 12; end if;
  v_a := p_desde at time zone 'America/Asuncion';
  v_b := p_hasta at time zone 'America/Asuncion';
  v_dia := v_a::date;
  while v_dia <= v_b::date loop
    v_guard := v_guard + 1; exit when v_guard > 3700;
    v_dow := extract(isodow from v_dia);
    v_ini := v_dia + make_interval(hours => cfg.hora_inicio);
    v_fin := v_dia + make_interval(hours => case when v_dow = 6 then cfg.sabado_hasta when v_dow = 7 then 0 else cfg.hora_fin end);
    if v_dow <> 7 and v_fin > v_ini then
      v_total := v_total + greatest(0, extract(epoch from (least(v_fin, v_b) - greatest(v_ini, v_a))));
    end if;
    v_dia := v_dia + 1;
  end loop;
  return round(v_total / 3600.0, 2);
end;
$fn$;

-- ── Estados ──────────────────────────────────────────────────────────────────
create table if not exists :"schema".proyecto_estados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  color text not null default '#64748b',
  orden integer not null default 0,
  tipo_sla text not null default 'interno' check (tipo_sla in ('interno', 'cliente', 'pausado', 'final')),
  sla_horas_objetivo numeric,           -- horas LABORALES esperadas en este estado (null = sin objetivo)
  rol text not null default 'en_curso' check (rol in ('nuevo', 'en_curso', 'revision', 'espera_cliente', 'pausado', 'entregado', 'cancelado')),
  es_inicial boolean not null default false,
  es_final boolean not null default false,
  activo boolean not null default true,
  unique (empresa_id, codigo)
);

insert into :"schema".proyecto_estados (empresa_id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final)
select e.id, x.* from :"schema".empresas e cross join (values
  ('nuevo', 'Nuevo', '#64748b', 1, 'interno', 8::numeric, 'nuevo', true, false),
  ('planificacion', 'Planificación', '#6366f1', 2, 'interno', 16::numeric, 'en_curso', false, false),
  ('en_curso', 'En curso', '#2563eb', 3, 'interno', null::numeric, 'en_curso', false, false),
  ('revision_interna', 'Revisión interna', '#0891b2', 4, 'interno', 8::numeric, 'revision', false, false),
  ('espera_cliente', 'Espera del cliente', '#f59e0b', 5, 'cliente', null::numeric, 'espera_cliente', false, false),
  ('pausado', 'Pausado', '#a855f7', 6, 'pausado', null::numeric, 'pausado', false, false),
  ('entregado', 'Entregado', '#16a34a', 7, 'final', null::numeric, 'entregado', false, true),
  ('cancelado', 'Cancelado', '#ef4444', 8, 'final', null::numeric, 'cancelado', false, true)
) as x(codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final)
where not exists (select 1 from :"schema".proyecto_estados s where s.empresa_id = e.id);

-- ── Proyectos ────────────────────────────────────────────────────────────────
create table if not exists :"schema".proyectos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null default '',
  titulo text not null,
  descripcion text,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  estado_id uuid not null references :"schema".proyecto_estados(id),
  prioridad text not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  responsable_comercial_id uuid references :"schema".usuarios(id) on delete set null,
  responsable_tecnico_id uuid references :"schema".usuarios(id) on delete set null,
  project_manager_id uuid references :"schema".usuarios(id) on delete set null,
  fecha_ingreso date not null default ((now() at time zone 'America/Asuncion')::date),
  fecha_prometida timestamptz,
  fecha_entrega timestamptz,
  monto_vendido numeric(18,2) not null default 0,
  moneda text not null default 'GS' check (moneda in ('GS', 'USD')),
  bloqueado boolean not null default false,
  bloqueo_tipo text check (bloqueo_tipo is null or bloqueo_tipo in ('cliente', 'interno', 'tercero')),
  bloqueo_motivo text,
  bloqueo_responsable text,
  bloqueo_proxima_accion text,
  pausado_at timestamptz,
  pausa_motivo text,
  pausa_horas_acumuladas numeric not null default 0,
  cancelacion_motivo text,
  archivado boolean not null default false,
  estado_desde timestamptz not null default now(),    -- desde cuándo está en el estado actual
  ultimo_movimiento_at timestamptz not null default now(),
  busqueda text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_proyectos_numero on :"schema".proyectos (empresa_id, numero);
create index if not exists proy_tablero_idx on :"schema".proyectos (empresa_id, archivado, estado_id, ultimo_movimiento_at desc, id desc);
create index if not exists proy_cliente_idx on :"schema".proyectos (cliente_id) where cliente_id is not null;
create index if not exists proy_tecnico_idx on :"schema".proyectos (empresa_id, responsable_tecnico_id) where not archivado;
create index if not exists proy_pm_idx on :"schema".proyectos (empresa_id, project_manager_id) where not archivado;
create index if not exists proy_comercial_idx on :"schema".proyectos (empresa_id, responsable_comercial_id) where not archivado;
create index if not exists proy_prometida_idx on :"schema".proyectos (empresa_id, fecha_prometida) where not archivado and fecha_prometida is not null;
create index if not exists proy_busqueda_trgm on :"schema".proyectos using gin (busqueda extensions.gin_trgm_ops) with (fastupdate = off);

create or replace function :"schema".tg_proyectos()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  if tg_op = 'INSERT' and coalesce(new.numero, '') = '' then
    perform pg_advisory_xact_lock(hashtext('proyecto_numero_' || new.empresa_id::text));
    select 'PRY-' || lpad((coalesce(max(substring(numero from '[0-9]+$')::bigint), 0) + 1)::text, 5, '0')
      into new.numero from proyectos where empresa_id = new.empresa_id;
  end if;
  new.updated_at := now();
  new.busqueda := concat_ws(' ', norm(new.titulo), norm(new.descripcion), lower(new.numero),
                            regexp_replace(lower(new.numero), '[^a-z0-9]', '', 'g'),
                            (select concat_ws(' ', norm(c.nombre), norm(c.razon_social)) from clientes c where c.id = new.cliente_id));
  return new;
end;
$fn$;
drop trigger if exists trg_proyectos on :"schema".proyectos;
create trigger trg_proyectos before insert or update of titulo, descripcion, cliente_id, numero on :"schema".proyectos
  for each row execute function :"schema".tg_proyectos();

-- ── Historial por estado (duración = base del SLA) ──────────────────────────
create table if not exists :"schema".proyecto_estado_historial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  proyecto_id uuid not null references :"schema".proyectos(id) on delete cascade,
  estado_id uuid not null references :"schema".proyecto_estados(id),
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  horas_totales numeric,
  horas_laborales numeric,
  tipo_sla_snapshot text,
  responsable_tecnico_id uuid,
  usuario_id uuid references :"schema".usuarios(id) on delete set null
);
create index if not exists proy_hist_proy_idx on :"schema".proyecto_estado_historial (proyecto_id, entered_at desc);
create index if not exists proy_hist_estado_idx on :"schema".proyecto_estado_historial (empresa_id, estado_id, entered_at desc);

-- Bitácora (lo que se ve en "Historial": creación, cambios de campos, pausa, bloqueo…).
create table if not exists :"schema".proyecto_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  proyecto_id uuid not null references :"schema".proyectos(id) on delete cascade,
  tipo text not null,
  detalle jsonb not null default '{}'::jsonb,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists proy_eventos_idx on :"schema".proyecto_eventos (proyecto_id, created_at desc);

-- ── Tareas, comentarios, archivos ───────────────────────────────────────────
create table if not exists :"schema".proyecto_tareas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  proyecto_id uuid not null references :"schema".proyectos(id) on delete cascade,
  titulo text not null,
  descripcion text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'completada', 'bloqueada')),
  asignado_id uuid references :"schema".usuarios(id) on delete set null,
  fecha_limite date,
  orden integer not null default 0,
  estado_cambiado_por uuid, estado_cambiado_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists proy_tareas_idx on :"schema".proyecto_tareas (proyecto_id, orden);
create index if not exists proy_tareas_asignado_idx on :"schema".proyecto_tareas (empresa_id, asignado_id, estado);

create table if not exists :"schema".proyecto_comentarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  proyecto_id uuid not null references :"schema".proyectos(id) on delete cascade,
  canal text not null default 'interno' check (canal in ('interno', 'cliente')),
  contenido text not null,
  menciones uuid[] not null default '{}',
  adjuntos jsonb not null default '[]'::jsonb,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  editado_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists proy_coment_idx on :"schema".proyecto_comentarios (proyecto_id, created_at);

create table if not exists :"schema".proyecto_archivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  proyecto_id uuid not null references :"schema".proyectos(id) on delete cascade,
  nombre text not null,
  storage_path text not null,
  mime text, size bigint,
  subido_por uuid references :"schema".usuarios(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists proy_archivos_idx on :"schema".proyecto_archivos (proyecto_id) where deleted_at is null;

insert into storage.buckets (id, name, public, file_size_limit) values ('proyectos', 'proyectos', false, 52428800)
on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['proyecto_estados', 'proyectos', 'proyecto_estado_historial', 'proyecto_eventos', 'proyecto_tareas',
                           'proyecto_comentarios', 'proyecto_archivos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())', t || '_propias', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;
revoke update, delete on :"schema".proyecto_eventos from authenticated;

-- Al crear un proyecto: abre su primer tramo de historial y deja el evento.
create or replace function :"schema".tg_proyectos_alta()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare v_nombre text;
begin
  select nombre into v_nombre from usuarios where id = new.created_by;
  insert into proyecto_estado_historial (empresa_id, proyecto_id, estado_id, entered_at, tipo_sla_snapshot, responsable_tecnico_id, usuario_id)
  select new.empresa_id, new.id, new.estado_id, new.created_at, e.tipo_sla, new.responsable_tecnico_id, new.created_by
    from proyecto_estados e where e.id = new.estado_id;
  insert into proyecto_eventos (empresa_id, proyecto_id, tipo, detalle, usuario_id, usuario_nombre)
  values (new.empresa_id, new.id, 'creado', jsonb_build_object('numero', new.numero), new.created_by, coalesce(v_nombre, 'Sistema'));
  return null;
end;
$fn$;
drop trigger if exists trg_proyectos_alta on :"schema".proyectos;
create trigger trg_proyectos_alta after insert on :"schema".proyectos
  for each row execute function :"schema".tg_proyectos_alta();

-- ── Cambiar de estado (una sola operación, como cambiar-estado del actual) ──
create or replace function :"schema".proyecto_cambiar_estado(p_proyecto uuid, p_estado uuid, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  p proyectos; e_old proyecto_estados; e_new proyecto_estados;
  v_usuario uuid; v_nombre text; v_ahora timestamptz := now(); v_pausa numeric := 0;
begin
  select * into p from proyectos where id = p_proyecto and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Proyecto no encontrado'; end if;
  select * into e_new from proyecto_estados where id = p_estado and empresa_id = p.empresa_id and activo;
  if not found then raise exception 'Estado inválido'; end if;
  if p.estado_id = p_estado then return jsonb_build_object('id', p.id, 'sin_cambios', true); end if;
  select * into e_old from proyecto_estados where id = p.estado_id;
  if e_new.tipo_sla = 'pausado' and coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la pausa'; end if;
  if e_new.rol = 'cancelado' and coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la cancelación'; end if;
  select id, nombre into v_usuario, v_nombre from usuarios where auth_user_id = auth.uid() limit 1;

  -- Cierra el tramo actual con su duración.
  update proyecto_estado_historial
     set exited_at = v_ahora,
         horas_totales = round(extract(epoch from (v_ahora - entered_at)) / 3600.0, 2),
         horas_laborales = horas_laborales_entre(entered_at, v_ahora)
   where proyecto_id = p.id and exited_at is null;
  -- Sale de una pausa: suma las horas laborales pausadas.
  if e_old.tipo_sla = 'pausado' and p.pausado_at is not null then
    v_pausa := horas_laborales_entre(p.pausado_at, v_ahora);
  end if;

  update proyectos set
    estado_id = e_new.id, estado_desde = v_ahora, ultimo_movimiento_at = v_ahora,
    pausado_at = case when e_new.tipo_sla = 'pausado' then v_ahora else null end,
    pausa_motivo = case when e_new.tipo_sla = 'pausado' then trim(p_motivo) else pausa_motivo end,
    pausa_horas_acumuladas = pausa_horas_acumuladas + v_pausa,
    bloqueado = case when e_old.tipo_sla = 'pausado' then false else bloqueado end,
    fecha_entrega = case when e_new.rol = 'entregado' then coalesce(fecha_entrega, v_ahora)
                         when e_old.rol = 'entregado' then null else fecha_entrega end,
    cancelacion_motivo = case when e_new.rol = 'cancelado' then trim(p_motivo) else cancelacion_motivo end
  where id = p.id;

  insert into proyecto_estado_historial (empresa_id, proyecto_id, estado_id, entered_at, tipo_sla_snapshot, responsable_tecnico_id, usuario_id)
  values (p.empresa_id, p.id, e_new.id, v_ahora, e_new.tipo_sla, p.responsable_tecnico_id, v_usuario);
  insert into proyecto_eventos (empresa_id, proyecto_id, tipo, detalle, usuario_id, usuario_nombre)
  values (p.empresa_id, p.id, 'cambio_estado',
          jsonb_build_object('de', e_old.nombre, 'a', e_new.nombre, 'motivo', nullif(trim(p_motivo), '')), v_usuario, v_nombre);
  return jsonb_build_object('id', p.id, 'estado_id', e_new.id, 'estado_desde', v_ahora);
end;
$fn$;

-- ── Tablero: columnas con cantidad y primeras N tarjetas (columnas LIVIANAS) ─
create or replace function :"schema".proyectos_candidatos(p_q text)
returns setof uuid language plpgsql stable set search_path = :"schema", public, extensions as $fn$
declare v_cond text;
begin
  if coalesce(trim(p_q), '') = '' then return; end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.39', true);
  select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                         then format('(busqueda like %L or %L <%% busqueda)', '%' || t || '%', t)
                         else format('busqueda like %L', '%' || t || '%') end, ' and ')
    into v_cond from unnest(tokens_busqueda(p_q)) t;
  if v_cond is null then return; end if;
  return query execute format('select id from proyectos where empresa_id = %L and %s', empresa_actual(), v_cond);
end;
$fn$;

create or replace function :"schema".proyectos_tarjetas(
  p_estado uuid, p_q text, p_responsable uuid, p_cliente uuid, p_prioridad text, p_archivados boolean,
  p_cursor_at timestamptz, p_cursor_id uuid, p_limite integer
) returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(t order by t.ultimo_movimiento_at desc, t.id desc), '[]'::jsonb) from (
    select p.id, p.numero, p.titulo, p.prioridad, p.estado_id, p.estado_desde, p.ultimo_movimiento_at,
           p.fecha_prometida, p.fecha_entrega, p.monto_vendido, p.moneda, p.bloqueado, p.bloqueo_tipo, p.bloqueo_motivo,
           p.pausa_motivo, p.cliente_id, c.nombre as cliente_nombre,
           p.responsable_comercial_id, uc.nombre as comercial_nombre,
           p.responsable_tecnico_id, ut.nombre as tecnico_nombre,
           p.project_manager_id, up.nombre as pm_nombre,
           (select count(*) from proyecto_tareas x where x.proyecto_id = p.id) as tareas_total,
           (select count(*) from proyecto_tareas x where x.proyecto_id = p.id and x.estado = 'completada') as tareas_hechas
      from proyectos p
      left join clientes c on c.id = p.cliente_id
      left join usuarios uc on uc.id = p.responsable_comercial_id
      left join usuarios ut on ut.id = p.responsable_tecnico_id
      left join usuarios up on up.id = p.project_manager_id
     where p.empresa_id = empresa_actual() and p.estado_id = p_estado
       and p.archivado = coalesce(p_archivados, false)
       and (p_responsable is null or p_responsable in (p.responsable_tecnico_id, p.responsable_comercial_id, p.project_manager_id))
       and (p_cliente is null or p.cliente_id = p_cliente)
       and (p_prioridad is null or p.prioridad = p_prioridad)
       and (p_cursor_at is null or (p.ultimo_movimiento_at, p.id) < (p_cursor_at, p_cursor_id))
       and (coalesce(trim(p_q), '') = '' or p.id in (select proyectos_candidatos(p_q)))
     order by p.ultimo_movimiento_at desc, p.id desc
     limit least(greatest(coalesce(p_limite, 30), 1), 100)) t
$$;

create or replace function :"schema".proyectos_tablero(
  p_q text default null, p_responsable uuid default null, p_cliente uuid default null,
  p_prioridad text default null, p_archivados boolean default false, p_por_columna integer default 30
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
declare v_hoy timestamptz := now();
begin
  return (
  with base as (
    select p.id, p.estado_id, p.fecha_prometida, p.bloqueado, p.ultimo_movimiento_at, p.monto_vendido, p.moneda, p.prioridad
      from proyectos p
     where p.empresa_id = empresa_actual() and p.archivado = coalesce(p_archivados, false)
       and (p_responsable is null or p_responsable in (p.responsable_tecnico_id, p.responsable_comercial_id, p.project_manager_id))
       and (p_cliente is null or p.cliente_id = p_cliente)
       and (p_prioridad is null or p.prioridad = p_prioridad)
       and (coalesce(trim(p_q), '') = '' or p.id in (select proyectos_candidatos(p_q)))
  ),
  abiertos as (select b.* from base b join proyecto_estados e on e.id = b.estado_id where not e.es_final)
  select jsonb_build_object(
    'columnas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'codigo', e.codigo, 'nombre', e.nombre, 'color', e.color, 'orden', e.orden, 'tipo_sla', e.tipo_sla,
        'sla_horas_objetivo', e.sla_horas_objetivo, 'rol', e.rol, 'es_final', e.es_final,
        'cantidad', (select count(*) from base b where b.estado_id = e.id),
        'tarjetas', proyectos_tarjetas(e.id, p_q, p_responsable, p_cliente, p_prioridad, p_archivados, null, null, p_por_columna)
      ) order by e.orden) from proyecto_estados e where e.empresa_id = empresa_actual() and e.activo), '[]'::jsonb),
    'kpis', jsonb_build_object(
        'activos', (select count(*) from abiertos),
        'vencidos', (select count(*) from abiertos where fecha_prometida < v_hoy),
        'vencen_3_dias', (select count(*) from abiertos where fecha_prometida >= v_hoy and fecha_prometida < v_hoy + interval '3 days'),
        'sin_fecha', (select count(*) from abiertos where fecha_prometida is null),
        'bloqueados', (select count(*) from abiertos where bloqueado),
        'sin_movimiento', (select count(*) from abiertos where ultimo_movimiento_at < v_hoy - interval '3 days'),
        'urgentes', (select count(*) from abiertos where prioridad = 'urgente'),
        'entregados_mes', (select count(*) from proyectos x join proyecto_estados e on e.id = x.estado_id
                            where x.empresa_id = empresa_actual() and e.rol = 'entregado'
                              and x.fecha_entrega >= date_trunc('month', now() at time zone 'America/Asuncion') at time zone 'America/Asuncion'))
  ));
end;
$$;

grant execute on function :"schema".horas_laborales_entre(timestamptz, timestamptz),
  :"schema".proyecto_cambiar_estado(uuid, uuid, text),
  :"schema".proyectos_tarjetas(uuid, text, uuid, uuid, text, boolean, timestamptz, uuid, integer),
  :"schema".proyectos_tablero(text, uuid, uuid, text, boolean, integer),
  :"schema".proyectos_candidatos(text) to authenticated, service_role;
revoke execute on function :"schema".proyectos_candidatos(text) from public, anon;
