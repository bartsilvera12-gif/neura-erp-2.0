-- =============================================================================
-- SOPORTE + TIPIFICACIÓN + AGENDA (capacitaciones) + NOTIFICACIONES
-- Copia fiel del módulo del sistema actual (sistemas-propio), con lo propio de Neura
-- vuelto genérico (decisiones 9-oct-2026):
--   · proyecto: no existe en el 2.0 → el ticket va contra el CLIENTE
--   · revisión QA: activable en soporte_config.qa_activo (apagada: en_proceso → resuelto)
--   · sin guardias: responsable por defecto configurable (soporte_config.responsable_defecto_id)
-- Tablas: soporte_config, soporte_estados, soporte_tipos, soporte_clasificaciones,
-- soporte_prioridades, soporte_tickets, soporte_ticket_comentarios, soporte_ticket_archivos,
-- soporte_ticket_historial (solo inserta), soporte_ticket_relaciones, soporte_subtareas (QA),
-- tipificacion_familias, tipificacion_estados, tipificaciones, agenda_citas,
-- usuario_notificaciones. Bucket privado "soporte" para adjuntos.
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

-- ── Usuarios: equipo de soporte ─────────────────────────────────────────────
alter table :"schema".usuarios add column if not exists es_tecnico boolean not null default false;
alter table :"schema".usuarios add column if not exists es_qa boolean not null default false;
alter table :"schema".usuarios add column if not exists usa_soporte boolean not null default false;
alter table :"schema".usuarios add column if not exists email text;

-- Helper: política estándar "solo mi empresa".
create or replace function :"schema".soporte_politica(p_tabla text)
returns void language plpgsql as $fn$
begin
  execute format('alter table %I enable row level security', p_tabla);
  execute format('alter table %I force row level security', p_tabla);
  execute format('drop policy if exists %I on %I', p_tabla || '_propias', p_tabla);
  execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())',
                 p_tabla || '_propias', p_tabla);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', p_tabla);
end;
$fn$;

-- ── Configuración por empresa ───────────────────────────────────────────────
create table if not exists :"schema".soporte_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  qa_activo boolean not null default false,
  responsable_defecto_id uuid references :"schema".usuarios(id) on delete set null,
  -- Horario laboral para el SLA (horas hábiles): lun-vie y sábado.
  hora_inicio smallint not null default 8,
  hora_fin smallint not null default 17,
  sabado_hasta smallint not null default 12,      -- 0 = sábado no se trabaja
  updated_at timestamptz not null default now()
);
select :"schema".soporte_politica('soporte_config');

-- ── Catálogos ────────────────────────────────────────────────────────────────
create table if not exists :"schema".soporte_estados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  codigo text not null, nombre text not null,
  tipo text not null default 'abierto' check (tipo in ('abierto', 'cerrado')),
  color text, area text, detiene_sla boolean not null default false, es_inicial boolean not null default false,
  sort_order integer not null default 0, activo boolean not null default true,
  unique (empresa_id, codigo)
);
create table if not exists :"schema".soporte_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  codigo text not null, nombre text not null, sla_horas numeric, sort_order integer not null default 0,
  activo boolean not null default true, unique (empresa_id, codigo)
);
create table if not exists :"schema".soporte_clasificaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  codigo text not null, tipo_codigo text not null, nombre text not null, sla_horas numeric,
  prioridad_sugerida text, sort_order integer not null default 0, activo boolean not null default true,
  unique (empresa_id, codigo)
);
create table if not exists :"schema".soporte_prioridades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  codigo text not null, nombre text not null, color text, sort_order integer not null default 0,
  activo boolean not null default true, unique (empresa_id, codigo)
);
select :"schema".soporte_politica('soporte_estados');
select :"schema".soporte_politica('soporte_tipos');
select :"schema".soporte_politica('soporte_clasificaciones');
select :"schema".soporte_politica('soporte_prioridades');

-- ── Tickets ──────────────────────────────────────────────────────────────────
create table if not exists :"schema".soporte_tickets (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero integer not null,
  asunto text not null,
  descripcion text,
  resultado_esperado text,
  impacto_operativo text,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  tipo_codigo text not null,
  clasificacion_codigo text,
  prioridad_codigo text not null default 'normal',
  estado_codigo text not null,
  responsable_id uuid references :"schema".usuarios(id) on delete set null,
  proxima_accion text,
  sla_horas numeric,
  fecha_objetivo timestamptz,
  fase integer not null default 1,
  origen text not null default 'manual' check (origen in ('manual', 'tipificacion_cliente')),
  tipificacion_id uuid,
  resuelto_at timestamptz,
  cerrado_at timestamptz,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  updated_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists sop_tickets_estado_idx on :"schema".soporte_tickets (empresa_id, estado_codigo);
create index if not exists sop_tickets_cliente_idx on :"schema".soporte_tickets (cliente_id);
create index if not exists sop_tickets_responsable_idx on :"schema".soporte_tickets (responsable_id);
create unique index if not exists uq_sop_ticket_tipificacion on :"schema".soporte_tickets (tipificacion_id) where tipificacion_id is not null;
select :"schema".soporte_politica('soporte_tickets');

-- Número correlativo por empresa (#0001), con candado para que dos altas a la vez no choquen.
create or replace function :"schema".tg_soporte_tickets_numero()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  if new.numero is null or new.numero = 0 then
    perform pg_advisory_xact_lock(hashtext('soporte_ticket_numero_' || new.empresa_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from soporte_tickets where empresa_id = new.empresa_id;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_soporte_tickets_numero on :"schema".soporte_tickets;
create trigger trg_soporte_tickets_numero before insert on :"schema".soporte_tickets
  for each row execute function :"schema".tg_soporte_tickets_numero();
alter table :"schema".soporte_tickets alter column numero set default 0;

create table if not exists :"schema".soporte_subtareas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ticket_id uuid not null references :"schema".soporte_tickets(id) on delete cascade,
  numero integer not null,
  tipo text not null default 'revision_qa',
  titulo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'cambios_solicitados', 'finalizado')),
  asignado_id uuid references :"schema".usuarios(id) on delete set null,
  finalizado_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, numero)
);
select :"schema".soporte_politica('soporte_subtareas');

create table if not exists :"schema".soporte_ticket_comentarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ticket_id uuid not null references :"schema".soporte_tickets(id) on delete cascade,
  subtarea_id uuid references :"schema".soporte_subtareas(id) on delete set null,
  contenido text not null,
  es_rechazo_qa boolean not null default false,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sop_coment_ticket_idx on :"schema".soporte_ticket_comentarios (ticket_id, created_at);
select :"schema".soporte_politica('soporte_ticket_comentarios');

create table if not exists :"schema".soporte_ticket_archivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ticket_id uuid not null references :"schema".soporte_tickets(id) on delete cascade,
  comentario_id uuid references :"schema".soporte_ticket_comentarios(id) on delete set null,
  nombre text not null,
  storage_bucket text not null default 'soporte',
  storage_path text not null,
  mime text, size bigint,
  subido_por uuid references :"schema".usuarios(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sop_archivos_ticket_idx on :"schema".soporte_ticket_archivos (ticket_id);
select :"schema".soporte_politica('soporte_ticket_archivos');

create table if not exists :"schema".soporte_ticket_historial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ticket_id uuid not null references :"schema".soporte_tickets(id) on delete cascade,
  tipo_evento text not null,
  valor_anterior text, valor_nuevo text,
  metadata jsonb not null default '{}'::jsonb,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sop_hist_ticket_idx on :"schema".soporte_ticket_historial (ticket_id, created_at);
select :"schema".soporte_politica('soporte_ticket_historial');
-- El historial no se edita ni se borra (igual que el actual).
revoke update, delete on :"schema".soporte_ticket_historial from authenticated;

create table if not exists :"schema".soporte_ticket_relaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ticket_id uuid not null references :"schema".soporte_tickets(id) on delete cascade,
  relacionado_id uuid not null references :"schema".soporte_tickets(id) on delete cascade,
  tipo text not null check (tipo in ('relacionado', 'duplicado_de', 'bloquea', 'bloqueado_por', 'deriva_de')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ticket_id <> relacionado_id),
  unique (ticket_id, relacionado_id, tipo)
);
select :"schema".soporte_politica('soporte_ticket_relaciones');

-- ── Tipificación (estado → sub-estado con acción) ───────────────────────────
create table if not exists :"schema".tipificacion_familias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null, sort_order integer not null default 0, activo boolean not null default true
);
create table if not exists :"schema".tipificacion_estados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  familia_id uuid not null references :"schema".tipificacion_familias(id) on delete cascade,
  nombre text not null,
  comportamiento text check (comportamiento is null or comportamiento in ('ticket_error', 'ticket_cambio', 'capacitacion')),
  sort_order integer not null default 0, activo boolean not null default true
);
create table if not exists :"schema".tipificaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  fecha timestamptz not null default now(),
  usuario text not null,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  tipo_gestion text not null,
  resultado text not null default 'Resuelto',
  observacion text not null,
  familia_id uuid references :"schema".tipificacion_familias(id) on delete set null,
  estado_id uuid references :"schema".tipificacion_estados(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tipif_cliente_idx on :"schema".tipificaciones (cliente_id, fecha desc);
select :"schema".soporte_politica('tipificacion_familias');
select :"schema".soporte_politica('tipificacion_estados');
select :"schema".soporte_politica('tipificaciones');
do $$ begin
  alter table soporte_tickets add constraint soporte_tickets_tipificacion_fk foreign key (tipificacion_id) references tipificaciones(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ── Agenda (capacitaciones) ──────────────────────────────────────────────────
create table if not exists :"schema".agenda_citas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  responsable_id uuid references :"schema".usuarios(id) on delete set null,
  contacto_nombre text, contacto_telefono text,
  titulo text not null,
  tipo text not null default 'capacitacion',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'completada', 'no_asistio', 'cancelada', 'reprogramada')),
  inicio_at timestamptz not null,
  fin_at timestamptz not null,
  ubicacion text, observaciones text,
  reprogramada_de_id uuid references :"schema".agenda_citas(id) on delete set null,
  cancelada_motivo text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fin_at > inicio_at)
);
create index if not exists agenda_resp_idx on :"schema".agenda_citas (responsable_id, inicio_at);
create index if not exists agenda_cliente_idx on :"schema".agenda_citas (cliente_id);
select :"schema".soporte_politica('agenda_citas');

-- ── Notificaciones (campanita) ───────────────────────────────────────────────
create table if not exists :"schema".usuario_notificaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  tipo text not null,                 -- soporte_revision | soporte_asignado | ...
  bandeja text not null default 'general',   -- general | soporte
  titulo text not null,
  cuerpo text,
  url text,
  leida_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists unotif_usuario_idx on :"schema".usuario_notificaciones (usuario_id, created_at desc);
alter table :"schema".usuario_notificaciones enable row level security;
alter table :"schema".usuario_notificaciones force row level security;
drop policy if exists unotif_propias on :"schema".usuario_notificaciones;
create policy unotif_propias on :"schema".usuario_notificaciones to authenticated
  using (usuario_id = (select u.id from :"schema".usuarios u where u.auth_user_id = auth.uid() limit 1))
  with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".usuario_notificaciones to authenticated, service_role;

-- ── Bucket privado para adjuntos ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('soporte', 'soporte', false, 52428800)
on conflict (id) do nothing;

-- ── Catálogos iniciales (los mismos del sistema actual) ─────────────────────
insert into :"schema".soporte_config (empresa_id) select id from :"schema".empresas on conflict do nothing;

insert into :"schema".soporte_estados (empresa_id, codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order)
select e.id, x.* from :"schema".empresas e cross join (values
  ('pendiente', 'Pendiente', 'abierto', '#f59e0b', 'Atención', false, true, 1),
  ('en_proceso', 'En proceso', 'abierto', '#2563eb', 'Técnico', false, false, 2),
  ('falta_informacion', 'Falta información', 'abierto', '#a855f7', 'Atención', true, false, 3),
  ('listo_revision', 'Listo para revisión', 'abierto', '#0891b2', 'QA', false, false, 4),
  ('reabierto', 'Reabierto', 'abierto', '#ea580c', 'Técnico', false, false, 5),
  ('resuelto', 'Resuelto', 'cerrado', '#16a34a', 'Atención', true, false, 6),
  ('cancelado', 'Cancelado', 'cerrado', '#64748b', null, true, false, 7),
  ('cerrado', 'Cerrado', 'cerrado', '#334155', null, true, false, 8)
) as x(codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order)
on conflict (empresa_id, codigo) do nothing;

insert into :"schema".soporte_tipos (empresa_id, codigo, nombre, sla_horas, sort_order)
select e.id, x.* from :"schema".empresas e cross join (values
  ('error', 'Error', 8, 1), ('cambio', 'Cambio', 48, 2), ('consulta', 'Consulta', 8, 3),
  ('capacitacion', 'Capacitación', null, 4), ('otro', 'Otro', null, 5)
) as x(codigo, nombre, sla_horas, sort_order)
on conflict (empresa_id, codigo) do nothing;

insert into :"schema".soporte_clasificaciones (empresa_id, codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida, sort_order)
select e.id, x.* from :"schema".empresas e cross join (values
  ('error_bajo', 'error', 'Error bajo', 8, 'normal', 1),
  ('error_medio', 'error', 'Error medio', 5, 'alta', 2),
  ('error_alto', 'error', 'Error alto', 2, 'urgente', 3),
  ('cambio_estetico', 'cambio', 'Cambio estético', 5, 'normal', 4),
  ('cambio_funcional', 'cambio', 'Cambio funcional', 48, 'normal', 5)
) as x(codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida, sort_order)
on conflict (empresa_id, codigo) do nothing;

insert into :"schema".soporte_prioridades (empresa_id, codigo, nombre, color, sort_order)
select e.id, x.* from :"schema".empresas e cross join (values
  ('baja', 'Baja', '#64748b', 1), ('normal', 'Normal', '#2563eb', 2), ('alta', 'Alta', '#f59e0b', 3), ('urgente', 'Urgente', '#dc2626', 4)
) as x(codigo, nombre, color, sort_order)
on conflict (empresa_id, codigo) do nothing;

-- Tipificación: misma estructura que el actual, con un catálogo genérico de ejemplo.
do $$
declare
  e record; f_sol uuid; f_rec uuid; f_con uuid;
begin
  for e in select id from empresas loop
    if exists (select 1 from tipificacion_familias where empresa_id = e.id) then continue; end if;
    insert into tipificacion_familias (empresa_id, nombre, sort_order) values (e.id, 'SOLICITUD', 1) returning id into f_sol;
    insert into tipificacion_familias (empresa_id, nombre, sort_order) values (e.id, 'RECLAMOS', 2) returning id into f_rec;
    insert into tipificacion_familias (empresa_id, nombre, sort_order) values (e.id, 'CONSULTAS', 3) returning id into f_con;
    insert into tipificacion_estados (empresa_id, familia_id, nombre, comportamiento, sort_order) values
      (e.id, f_sol, 'TICKET-CLIENTE SOLICITA UN CAMBIO O MEJORA', 'ticket_cambio', 1),
      (e.id, f_sol, 'CLIENTE SOLICITA CAPACITACIÓN', 'capacitacion', 2),
      (e.id, f_sol, 'CLIENTE SOLICITA PRESUPUESTO', null, 3),
      (e.id, f_rec, 'TICKET-CLIENTE INDICA UN PROBLEMA CON EL PRODUCTO O SERVICIO', 'ticket_error', 1),
      (e.id, f_rec, 'TICKET-CLIENTE INDICA UN ERROR EN SU FACTURA O COBRO', 'ticket_error', 2),
      (e.id, f_rec, 'CLIENTE RECLAMA DEMORA EN LA ENTREGA', null, 3),
      (e.id, f_con, 'CLIENTE CONSULTA POR FECHA DE PAGO', null, 1),
      (e.id, f_con, 'CLIENTE CONSULTA PRECIOS O DISPONIBILIDAD', null, 2),
      (e.id, f_con, 'CLIENTE CONSULTA FECHA DE CAPACITACIÓN', null, 3);
  end loop;
end $$;

-- ── Tipificación + ticket en UNA transacción (nunca queda una sin la otra) ──
create or replace function :"schema".soporte_crear_ticket_desde_tipificacion(p_tipificacion jsonb, p_ticket jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  v_empresa uuid := empresa_actual();
  v_usuario uuid; v_usuario_nombre text;
  v_tip uuid; v_ticket uuid; v_numero integer;
  v_cliente uuid := (p_tipificacion->>'cliente_id')::uuid;
  v_inicial text;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if not exists (select 1 from clientes where id = v_cliente and empresa_id = v_empresa) then
    raise exception 'Cliente no encontrado';
  end if;
  select id, nombre into v_usuario, v_usuario_nombre from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;
  select codigo into v_inicial from soporte_estados where empresa_id = v_empresa and es_inicial and activo order by sort_order limit 1;

  insert into tipificaciones (empresa_id, cliente_id, usuario, usuario_id, tipo_gestion, resultado, observacion, familia_id, estado_id)
  values (v_empresa, v_cliente, coalesce(v_usuario_nombre, 'Sistema'), v_usuario,
          coalesce(p_tipificacion->>'tipo_gestion', 'Error'), coalesce(p_tipificacion->>'resultado', 'Escalar'),
          p_tipificacion->>'observacion', nullif(p_tipificacion->>'familia_id', '')::uuid, nullif(p_tipificacion->>'estado_id', '')::uuid)
  returning id into v_tip;

  insert into soporte_tickets (empresa_id, asunto, descripcion, resultado_esperado, impacto_operativo, cliente_id, tipo_codigo,
                               clasificacion_codigo, prioridad_codigo, estado_codigo, responsable_id, sla_horas, fecha_objetivo,
                               origen, tipificacion_id, created_by, updated_by)
  values (v_empresa, p_ticket->>'asunto', p_ticket->>'descripcion', p_ticket->>'resultado_esperado', p_ticket->>'impacto_operativo',
          v_cliente, p_ticket->>'tipo_codigo', nullif(p_ticket->>'clasificacion_codigo', ''),
          coalesce(nullif(p_ticket->>'prioridad_codigo', ''), 'normal'), coalesce(v_inicial, 'pendiente'),
          nullif(p_ticket->>'responsable_id', '')::uuid, nullif(p_ticket->>'sla_horas', '')::numeric,
          nullif(p_ticket->>'fecha_objetivo', '')::timestamptz, 'tipificacion_cliente', v_tip, v_usuario, v_usuario)
  returning id, numero into v_ticket, v_numero;

  insert into soporte_ticket_historial (empresa_id, ticket_id, tipo_evento, valor_nuevo, metadata, usuario_id)
  values (v_empresa, v_ticket, 'creacion', coalesce(v_inicial, 'pendiente'), jsonb_build_object('origen', 'tipificacion_cliente', 'tipificacion_id', v_tip), v_usuario);

  perform registrar_historial_cliente(v_cliente, 'tipificacion',
    jsonb_build_object('tipo_gestion', p_tipificacion->>'tipo_gestion', 'ticket', v_numero, 'observacion', left(p_tipificacion->>'observacion', 200)));
  return jsonb_build_object('tipificacion_id', v_tip, 'ticket_id', v_ticket, 'numero', v_numero);
end;
$$;
grant execute on function :"schema".soporte_crear_ticket_desde_tipificacion(jsonb, jsonb) to authenticated, service_role;

drop function if exists :"schema".soporte_politica(text);
