-- =============================================================================
-- RUBRO GIMNASIO / ACADEMIA (idea del socio, 5-nov-2026): gimnasios, natación, artes marciales,
-- academias de baile o deportes.
--
--   · Rubro y funciones: función nueva `gimnasio` (empresa_funciones.gimnasio). Rubro "Gimnasio" =
--     gimnasio prendida, lo demás apagado y el módulo "Planes de cuotas y mora" apagado (receta 138).
--   · Clases (gim_clases): grupales con cupo y horario semanal (días + hora), con su profesor. Cada
--     día de clase es una cita de la Agenda (agenda_citas.gim_clase_id), que se crea sola al mirarla.
--     Los turnos individuales son citas de la Agenda con un alumno (tipo 'clase').
--   · Asistencias (gim_asistencias): un alumno en una clase o turno, o una entrada libre (sala, sin
--     clase). Estados: pendiente → confirmada / cancelada / reagendada → en_espera (llegó) →
--     culminada; o no_asistio.
--   · Membresías = Planes (suscripciones) con planes.gim_clases_mes: null = ilimitado, N = N clases
--     por mes. Al culminar: si la membresía la cubre, descuenta una; si no, se cobra como clase
--     suelta (venta a crédito con el precio de la clase o el de Configuración del gimnasio, que se
--     cobra en la caja con Cobrar).
--   · Moroso (deuda vencida): no puede entrar (en_espera ni culminada) si la empresa lo bloquea; con
--     el permiso gimnasio_forzar_entrada se fuerza con motivo (queda registrado).
--   · Comisión del profesor: la decide la empresa (ninguna, monto por alumno, monto por clase dada o
--     % del valor de la clase). Se calcula al consultar el período, como las comisiones de ventas.
--
-- IDEMPOTENTE. Va después de 138 (las 139-149 quedan para otras sesiones).
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Función "Gimnasio" en Rubro y funciones
-- =============================================================================
alter table :"schema".empresa_funciones add column if not exists gimnasio boolean not null default false;

do $do$
declare
  v_def text;
  v_falta text;
  a text;
begin
  -- funcion_activa
  v_def := pg_get_functiondef('funcion_activa(uuid,text)'::regprocedure);
  if position('-- 150: gimnasio' in v_def) = 0 then
    if position($a$when p_funcion = 'pedidos' then$a$ in v_def) = 0 then raise exception 'Receta 150: funcion_activa no tiene el patrón esperado'; end if;
    execute replace(v_def, $a$when p_funcion = 'pedidos' then$a$,
      $b$when p_funcion = 'gimnasio' then coalesce((select f.gimnasio from empresa_funciones f where f.empresa_id = p_empresa), false) -- 150: gimnasio
    when p_funcion = 'pedidos' then$b$);
  end if;

  -- funciones_empresa: devuelve 'gimnasio' y el rubro "gimnasio".
  v_def := pg_get_functiondef('funciones_empresa()'::regprocedure);
  if position('-- 150: gimnasio' in v_def) = 0 then
    foreach a in array array[$a$then 'neura' -- 139$a$, $a$'inmobiliaria', coalesce(f.inmobiliaria, false),$a$] loop
      if position(a in v_def) = 0 then raise exception 'Receta 150: funciones_empresa no tiene el patrón esperado (%)', a; end if;
    end loop;
    -- Neura (139) = todo prendido, también Gimnasio; Gimnasio solo = rubro Gimnasio; mezclado = Personalizado.
    v_def := replace(v_def, $a$and v_pedidos then 'neura' -- 139$a$, $a$and v_pedidos and coalesce(f.gimnasio, false) then 'neura' -- 139$a$);
    v_def := replace(v_def, $a$then 'neura' -- 139$a$,
      $b$then 'neura' -- 139
                  when coalesce(f.gimnasio, false) and not coalesce(f.inmobiliaria, false) and not coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'gimnasio' -- 150: gimnasio
                  when coalesce(f.gimnasio, false) then 'personalizado'$b$);
    v_def := replace(v_def, $a$'inmobiliaria', coalesce(f.inmobiliaria, false),$a$, $b$'inmobiliaria', coalesce(f.inmobiliaria, false),
    'gimnasio', coalesce(f.gimnasio, false),$b$);
    execute v_def;
  end if;

  -- guardar_funciones_empresa: preset "gimnasio", interruptor `gimnasio` y perfiles al prenderla.
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('-- 150: gimnasio' in v_def) = 0 then
    foreach a in array array[
      $a$  v_inmobiliaria boolean; -- 130: inmobiliaria$a$,
      $a$  v_inmobiliaria := f.inmobiliaria;$a$,
      $a$v_inmobiliaria := false;$a$,
      $a$v_sorteos := false; v_inmobiliaria := true;$a$,
      $a$v_inmobiliaria := true; -- 139$a$,
      $a$'Rubro inválido (Comercio, Gastronomía, Sorteos, Inmobiliaria o Neura)'$a$,
      $a$'inmobiliaria', 'confirmar_recetas']$a$,
      $a$  if p ? 'inmobiliaria' then v_inmobiliaria := (p->>'inmobiliaria')::boolean; end if;$a$,
      $a$  if v_inmobiliaria and not f.inmobiliaria then perform rubro_dar_inmobiliaria(s.p_empresa); end if;$a$,
      $a$inmobiliaria = v_inmobiliaria, updated_at = now()$a$,
      $a$when 'neura' then '{}'::text[]$a$] loop
      if position(a in v_def) = 0 then raise exception 'Receta 150: guardar_funciones_empresa no tiene el patrón esperado (%)', a; end if;
    end loop;
    v_def := replace(v_def, $a$  v_inmobiliaria boolean; -- 130: inmobiliaria$a$, $b$  v_inmobiliaria boolean; -- 130: inmobiliaria
  v_gimnasio boolean; -- 150: gimnasio$b$);
    v_def := replace(v_def, $a$  v_inmobiliaria := f.inmobiliaria;$a$, $b$  v_inmobiliaria := f.inmobiliaria;
  v_gimnasio := f.gimnasio;$b$);
    -- Los rubros de antes apagan Gimnasio; el nuevo prende solo Gimnasio.
    v_def := replace(v_def, $a$v_inmobiliaria := false;$a$, $b$v_inmobiliaria := false; v_gimnasio := false;$b$);
    v_def := replace(v_def, $a$v_sorteos := false; v_inmobiliaria := true;$a$, $b$v_sorteos := false; v_inmobiliaria := true; v_gimnasio := false;
      when 'gimnasio' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := false; v_sorteos := false; v_inmobiliaria := false; v_gimnasio := true;$b$);
    v_def := replace(v_def, $a$v_inmobiliaria := true; -- 139$a$, $b$v_inmobiliaria := true; v_gimnasio := true; -- 139$b$);
    v_def := replace(v_def, $a$'Rubro inválido (Comercio, Gastronomía, Sorteos, Inmobiliaria o Neura)'$a$, $b$'Rubro inválido (Comercio, Gastronomía, Sorteos, Inmobiliaria, Gimnasio o Neura)'$b$);
    v_def := replace(v_def, $a$'inmobiliaria', 'confirmar_recetas']$a$, $b$'inmobiliaria', 'gimnasio', 'confirmar_recetas']$b$);
    v_def := replace(v_def, $a$  if p ? 'inmobiliaria' then v_inmobiliaria := (p->>'inmobiliaria')::boolean; end if;$a$,
      $b$  if p ? 'inmobiliaria' then v_inmobiliaria := (p->>'inmobiliaria')::boolean; end if;
  if p ? 'gimnasio' then v_gimnasio := (p->>'gimnasio')::boolean; end if;$b$);
    v_def := replace(v_def, $a$  if v_inmobiliaria and not f.inmobiliaria then perform rubro_dar_inmobiliaria(s.p_empresa); end if;$a$,
      $b$  if v_inmobiliaria and not f.inmobiliaria then perform rubro_dar_inmobiliaria(s.p_empresa); end if;
  -- 150: gimnasio: perfiles de recepción al prenderla
  if v_gimnasio and not f.gimnasio then perform rubro_dar_gimnasio(s.p_empresa); end if;$b$);
    v_def := replace(v_def, $a$inmobiliaria = v_inmobiliaria, updated_at = now()$a$, $b$inmobiliaria = v_inmobiliaria, gimnasio = v_gimnasio, updated_at = now()$b$);
    v_def := replace(v_def, $a$when 'neura' then '{}'::text[]$a$, $b$when 'gimnasio' then '{cuotas,soporte}'::text[] when 'neura' then '{}'::text[]$b$);
    execute v_def;
  end if;
end;
$do$;

-- =============================================================================
-- 2. Tablas
-- =============================================================================
create table if not exists :"schema".gim_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  precio_clase_suelta numeric(16,0) not null default 0 check (precio_clase_suelta >= 0),
  tipo_iva text not null default '10%' check (tipo_iva in ('10%', '5%', 'exenta')),
  bloquear_morosos boolean not null default true,
  comision_modo text not null default 'ninguna' check (comision_modo in ('ninguna', 'por_alumno', 'por_clase', 'porcentaje')),
  comision_monto numeric(16,0) not null default 0 check (comision_monto >= 0),
  comision_pct numeric(5,2) not null default 0 check (comision_pct between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);

create table if not exists :"schema".gim_clases (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  profesor_id uuid references :"schema".usuarios(id) on delete set null,
  dias smallint[] not null check (cardinality(dias) between 1 and 7 and dias <@ array[1,2,3,4,5,6,7]::smallint[]),
  hora time not null,
  duracion_min integer not null default 60 check (duracion_min between 5 and 600),
  cupo integer check (cupo is null or cupo between 1 and 1000),
  precio_suelta numeric(16,0) check (precio_suelta is null or precio_suelta >= 0),
  ubicacion text,
  desde date not null default (now() at time zone 'America/Asuncion')::date,
  hasta date,
  activa boolean not null default true,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gim_clases_rango check (hasta is null or hasta >= desde)
);
create index if not exists gim_clases_empresa_idx on :"schema".gim_clases (empresa_id, activa);

alter table :"schema".agenda_citas add column if not exists gim_clase_id uuid references :"schema".gim_clases(id) on delete set null;
create unique index if not exists agenda_citas_gim_clase_uq on :"schema".agenda_citas (gim_clase_id, inicio_at) where gim_clase_id is not null;

-- El estado "en espera" (llegó) también en la Agenda, para los turnos individuales.
do $do$
declare
  r record;
begin
  for r in select conname, pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'agenda_citas'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%estado%' loop
    if position('en_espera' in r.def) = 0 then
      execute format('alter table agenda_citas drop constraint %I', r.conname);
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'agenda_citas'::regclass and conname = 'agenda_citas_estado_check2') then
    alter table agenda_citas add constraint agenda_citas_estado_check2
      check (estado in ('pendiente', 'confirmada', 'en_espera', 'completada', 'no_asistio', 'cancelada', 'reprogramada'));
  end if;
end;
$do$;

-- Membresías: clases por mes del plan (null = ilimitado).
alter table :"schema".planes add column if not exists gim_clases_mes integer check (gim_clases_mes is null or gim_clases_mes between 1 and 100);

create table if not exists :"schema".gim_asistencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cita_id uuid references :"schema".agenda_citas(id) on delete cascade,  -- null = entrada libre (sala)
  cliente_id uuid not null references :"schema".clientes(id) on delete restrict,
  fecha date not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'cancelada', 'reagendada', 'en_espera', 'culminada', 'no_asistio')),
  suscripcion_id uuid references :"schema".suscripciones(id) on delete set null,  -- la membresía que la cubrió
  venta_id uuid references :"schema".ventas(id) on delete set null,                -- clase suelta cobrada aparte
  valor numeric(16,0),        -- valor de la clase (clase suelta o parte de la membresía), para la comisión en %
  profesor_id uuid references :"schema".usuarios(id) on delete set null,
  forzada boolean not null default false,
  forzada_por uuid references :"schema".usuarios(id) on delete set null,
  forzada_motivo text,
  llegada_at timestamptz,
  culminada_at timestamptz,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);
create unique index if not exists gim_asistencias_cita_cliente_uq on :"schema".gim_asistencias (cita_id, cliente_id) where cita_id is not null;
create index if not exists gim_asistencias_cliente_idx on :"schema".gim_asistencias (empresa_id, cliente_id, fecha desc);
create index if not exists gim_asistencias_fecha_idx on :"schema".gim_asistencias (empresa_id, fecha);
create index if not exists gim_asistencias_suscripcion_idx on :"schema".gim_asistencias (suscripcion_id, fecha) where suscripcion_id is not null;

do $do$
declare
  t text;
begin
  foreach t in array array['gim_config', 'gim_clases', 'gim_asistencias'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- =============================================================================
-- 3. Permisos y pantallas
-- =============================================================================
do $do$
declare
  v_def text := pg_get_functiondef('permisos_catalogo()'::regprocedure);
  v_ultimo text := $a$('sorteos_administrar',        'Administrar sorteos, premios y vendedores',     'Sorteos')$a$;
begin
  if position('gimnasio_recepcion' in v_def) = 0 then
    if position(v_ultimo in v_def) = 0 then raise exception 'Receta 150: permisos_catalogo no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ultimo, v_ultimo || $b$,
    ('gimnasio_recepcion',         'Recepción del gimnasio: anotar y marcar asistencia', 'Gimnasio'),
    ('gimnasio_forzar_entrada',    'Dejar entrar a un alumno con deuda vencida',    'Gimnasio'),
    ('gimnasio_administrar',       'Administrar clases, precios y comisiones',      'Gimnasio')$b$);
  end if;
end;
$do$;

-- Al prender Gimnasio: Supervisor, Cajero y Vendedor atienden la recepción; Supervisor además fuerza la entrada.
create or replace function :"schema".rubro_dar_gimnasio(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(array['/gimnasio', '/gimnasio/clases']) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(case when pf.nivel_base = 'SUPERVISOR'
                                  then array['gimnasio_recepcion', 'gimnasio_forzar_entrada'] else array['gimnasio_recepcion'] end) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
end;
$fn$;

-- =============================================================================
-- 4. Ayudantes
-- =============================================================================
create or replace function :"schema".gim_sesion(p_permiso text,
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_rol text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  perform exigir_permiso(p_permiso);
  if not funcion_activa(s.s_empresa, 'gimnasio') then
    raise exception 'El gimnasio no está activo en tu empresa' using errcode = '42501';
  end if;
  s_empresa := s.s_empresa; s_usuario := s.s_usuario; s_nombre := s.s_nombre; s_rol := s.s_rol;
end;
$fn$;

create or replace function :"schema".gim_hoy() returns date
language sql stable set search_path = :"schema", public as $fn$
  select (now() at time zone 'America/Asuncion')::date
$fn$;

create or replace function :"schema".gim_config_de(p_empresa uuid) returns gim_config
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c gim_config;
begin
  select * into c from gim_config where empresa_id = p_empresa;
  if c.empresa_id is null then
    insert into gim_config (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
    select * into c from gim_config where empresa_id = p_empresa;
  end if;
  return c;
end;
$fn$;

-- Deuda vencida del cliente (cuotas o clases sin pagar con vencimiento antes de hoy).
create or replace function :"schema".gim_deuda_vencida(p_empresa uuid, p_cliente uuid) returns numeric
language sql stable security definer set search_path = :"schema", public as $fn$
  select coalesce(sum(c.saldo), 0) from cuentas_por_cobrar c
   where c.empresa_id = p_empresa and c.cliente_id = p_cliente and c.saldo > 0
     and coalesce(c.estado, '') <> 'anulada' and c.vencimiento < gim_hoy()
$fn$;

-- La membresía vigente del cliente (la suscripción activa más nueva que ya empezó y no terminó).
create or replace function :"schema".gim_membresia(p_empresa uuid, p_cliente uuid, p_fecha date)
returns table (suscripcion_id uuid, plan_nombre text, precio numeric, clases_mes integer, usadas integer)
language sql stable security definer set search_path = :"schema", public as $fn$
  select s.id, s.plan_nombre, s.precio, pl.gim_clases_mes,
         (select count(*)::int from gim_asistencias a
           where a.suscripcion_id = s.id and a.estado = 'culminada'
             and a.fecha >= date_trunc('month', p_fecha)::date and a.fecha < (date_trunc('month', p_fecha) + interval '1 month')::date)
    from suscripciones s
    left join planes pl on pl.id = s.plan_id
   where s.empresa_id = p_empresa and s.cliente_id = p_cliente and s.estado = 'activa'
     and s.fecha_inicio <= p_fecha
     and (s.duracion_meses is null or p_fecha < (date_trunc('month', s.fecha_inicio) + make_interval(months => s.duracion_meses))::date)
   order by s.fecha_inicio desc, s.created_at desc
   limit 1
$fn$;

-- Crea los días de clase (citas de la Agenda) entre dos fechas. Sin duplicar.
create or replace function :"schema".gim_generar(p_empresa uuid, p_desde date, p_hasta date)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c gim_clases;
  d date;
  v_inicio timestamptz;
  v_id uuid;
begin
  if p_hasta < p_desde or p_hasta - p_desde > 62 then raise exception 'Rango de fechas inválido'; end if;
  for c in select * from gim_clases where empresa_id = p_empresa and activa loop
    d := greatest(p_desde, c.desde);
    while d <= least(p_hasta, coalesce(c.hasta, p_hasta)) loop
      if extract(isodow from d)::smallint = any(c.dias) then
        v_inicio := (d + c.hora) at time zone 'America/Asuncion';
        insert into agenda_citas (empresa_id, responsable_id, titulo, tipo, estado, inicio_at, fin_at, ubicacion, gim_clase_id, metadata)
        values (p_empresa, c.profesor_id, c.nombre, 'clase', 'confirmada', v_inicio, v_inicio + make_interval(mins => c.duracion_min),
                c.ubicacion, c.id, jsonb_build_object('gim_cupo', c.cupo))
        on conflict (gim_clase_id, inicio_at) where gim_clase_id is not null do nothing
        returning id into v_id;
        if v_id is not null and c.profesor_id is not null then
          insert into agenda_cita_responsables (cita_id, usuario_id, empresa_id) values (v_id, c.profesor_id, p_empresa) on conflict do nothing;
        end if;
        v_id := null;
      end if;
      d := d + 1;
    end loop;
  end loop;
end;
$fn$;

create or replace function :"schema".gim_asistencia_json(a gim_asistencias) returns jsonb
language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'id', a.id, 'cita_id', a.cita_id, 'cliente_id', a.cliente_id, 'cliente', cl.nombre, 'documento', cl.documento,
    'fecha', a.fecha, 'estado', a.estado, 'cubierta', a.suscripcion_id is not null, 'venta_id', a.venta_id,
    'valor', a.valor, 'forzada', a.forzada, 'llegada_at', a.llegada_at, 'culminada_at', a.culminada_at,
    'clase', coalesce(ci.titulo, 'Entrada libre'), 'inicio_at', ci.inicio_at, 'fin_at', ci.fin_at,
    'profesor', (select u.nombre from usuarios u where u.id = coalesce(a.profesor_id, ci.responsable_id)))
    from clientes cl
    left join agenda_citas ci on ci.id = a.cita_id
   where cl.id = a.cliente_id
$fn$;

-- =============================================================================
-- 5. Configuración y clases
-- =============================================================================
create or replace function :"schema".gim_config_leer() returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c gim_config;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  c := gim_config_de(s.s_empresa);
  return jsonb_build_object('precio_clase_suelta', c.precio_clase_suelta, 'tipo_iva', c.tipo_iva, 'bloquear_morosos', c.bloquear_morosos,
    'comision_modo', c.comision_modo, 'comision_monto', c.comision_monto, 'comision_pct', c.comision_pct,
    'puede_administrar', tiene_permiso('gimnasio_administrar'), 'puede_forzar', tiene_permiso('gimnasio_forzar_entrada'));
end;
$fn$;

create or replace function :"schema".gim_config_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from gim_sesion('gimnasio_administrar');
  perform gim_config_de(s.s_empresa);
  update gim_config set
    precio_clase_suelta = coalesce(round((p->>'precio_clase_suelta')::numeric), precio_clase_suelta),
    tipo_iva = coalesce(p->>'tipo_iva', tipo_iva),
    bloquear_morosos = coalesce((p->>'bloquear_morosos')::boolean, bloquear_morosos),
    comision_modo = coalesce(p->>'comision_modo', comision_modo),
    comision_monto = coalesce(round((p->>'comision_monto')::numeric), comision_monto),
    comision_pct = coalesce((p->>'comision_pct')::numeric, comision_pct),
    updated_at = now(), updated_by = s.s_usuario
   where empresa_id = s.s_empresa;
  return gim_config_leer();
end;
$fn$;

create or replace function :"schema".gim_clases_lista() returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'profesor_id', c.profesor_id, 'profesor', u.nombre, 'dias', c.dias,
      'hora', to_char(c.hora, 'HH24:MI'), 'duracion_min', c.duracion_min, 'cupo', c.cupo, 'precio_suelta', c.precio_suelta,
      'ubicacion', c.ubicacion, 'desde', c.desde, 'hasta', c.hasta, 'activa', c.activa) order by c.activa desc, c.hora, c.nombre)
      from gim_clases c left join usuarios u on u.id = c.profesor_id
     where c.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

create or replace function :"schema".gim_clase_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_prof uuid := nullif(p->>'profesor_id', '')::uuid;
  v_dias smallint[];
begin
  select * into s from gim_sesion('gimnasio_administrar');
  if coalesce(trim(p->>'nombre'), '') = '' then raise exception 'Poné el nombre de la clase'; end if;
  select array_agg(distinct x::smallint order by x::smallint) into v_dias from jsonb_array_elements_text(coalesce(p->'dias', '[]')) x;
  if v_dias is null then raise exception 'Elegí al menos un día'; end if;
  if nullif(p->>'hora', '') is null then raise exception 'Poné la hora de la clase'; end if;
  if v_prof is not null and not exists (select 1 from usuarios where id = v_prof and empresa_id = s.s_empresa) then
    raise exception 'Ese profesor no es de tu empresa';
  end if;
  if v_id is null then
    insert into gim_clases (empresa_id, nombre, profesor_id, dias, hora, duracion_min, cupo, precio_suelta, ubicacion, desde, hasta, activa, created_by)
    values (s.s_empresa, trim(p->>'nombre'), v_prof, v_dias, (p->>'hora')::time, coalesce((p->>'duracion_min')::int, 60),
            nullif(p->>'cupo', '')::int, round(nullif(p->>'precio_suelta', '')::numeric), nullif(trim(p->>'ubicacion'), ''),
            coalesce(nullif(p->>'desde', '')::date, gim_hoy()), nullif(p->>'hasta', '')::date, coalesce((p->>'activa')::boolean, true), s.s_usuario)
    returning id into v_id;
  else
    update gim_clases set nombre = trim(p->>'nombre'), profesor_id = v_prof, dias = v_dias, hora = (p->>'hora')::time,
           duracion_min = coalesce((p->>'duracion_min')::int, 60), cupo = nullif(p->>'cupo', '')::int,
           precio_suelta = round(nullif(p->>'precio_suelta', '')::numeric), ubicacion = nullif(trim(p->>'ubicacion'), ''),
           desde = coalesce(nullif(p->>'desde', '')::date, desde), hasta = nullif(p->>'hasta', '')::date,
           activa = coalesce((p->>'activa')::boolean, activa), updated_at = now()
     where id = v_id and empresa_id = s.s_empresa;
    if not found then raise exception 'No existe esa clase'; end if;
    -- Los días que vienen y todavía no tienen alumnos se vuelven a crear con el horario nuevo.
    delete from agenda_citas ci
     where ci.gim_clase_id = v_id and ci.inicio_at > now()
       and not exists (select 1 from gim_asistencias a where a.cita_id = ci.id);
    update agenda_citas set titulo = trim(p->>'nombre'), responsable_id = v_prof, updated_at = now()
     where gim_clase_id = v_id and inicio_at > now();
  end if;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- =============================================================================
-- 6. Recepción: el día, el alumno, anotar y marcar
-- =============================================================================
create or replace function :"schema".gim_dia(p_fecha date default null) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c gim_config;
  v_fecha date;
  v_desde timestamptz;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  c := gim_config_de(s.s_empresa);
  v_fecha := coalesce(p_fecha, gim_hoy());
  perform gim_generar(s.s_empresa, v_fecha, v_fecha);
  v_desde := v_fecha::timestamp at time zone 'America/Asuncion';
  return jsonb_build_object(
    'fecha', v_fecha,
    'clases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cita_id', ci.id, 'clase_id', ci.gim_clase_id, 'titulo', ci.titulo, 'inicio_at', ci.inicio_at, 'fin_at', ci.fin_at,
        'estado', ci.estado, 'profesor', u.nombre, 'ubicacion', ci.ubicacion, 'individual', ci.gim_clase_id is null,
        'cupo', (ci.metadata->>'gim_cupo')::int,
        'ocupados', (select count(*) from gim_asistencias a where a.cita_id = ci.id and a.estado not in ('cancelada', 'reagendada')),
        'alumnos', coalesce((select jsonb_agg(gim_asistencia_json(a) || jsonb_build_object(
                     'bloqueado', c.bloquear_morosos and gim_deuda_vencida(s.s_empresa, a.cliente_id) > 0) order by cl.nombre)
                     from gim_asistencias a join clientes cl on cl.id = a.cliente_id where a.cita_id = ci.id), '[]'::jsonb)
      ) order by ci.inicio_at, ci.titulo)
        from agenda_citas ci left join usuarios u on u.id = ci.responsable_id
       where ci.empresa_id = s.s_empresa and ci.inicio_at >= v_desde and ci.inicio_at < v_desde + interval '1 day'
         and ci.estado <> 'cancelada'
         and (ci.gim_clase_id is not null or exists (select 1 from gim_asistencias a where a.cita_id = ci.id))), '[]'::jsonb),
    'libres', coalesce((select jsonb_agg(gim_asistencia_json(a) order by a.llegada_at desc)
                          from gim_asistencias a where a.empresa_id = s.s_empresa and a.cita_id is null and a.fecha = v_fecha), '[]'::jsonb));
end;
$fn$;

-- Ficha de asistencia del alumno: deuda, membresía, próximas y últimas.
create or replace function :"schema".gim_cliente(p_cliente uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c gim_config;
  cl record;
  m record;
  v_vencida numeric;
  v_total numeric;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  c := gim_config_de(s.s_empresa);
  select id, nombre, documento, telefono into cl from clientes where id = p_cliente and empresa_id = s.s_empresa;
  if cl.id is null then raise exception 'No existe ese cliente'; end if;
  v_vencida := gim_deuda_vencida(s.s_empresa, p_cliente);
  select coalesce(sum(saldo), 0) into v_total from cuentas_por_cobrar
   where empresa_id = s.s_empresa and cliente_id = p_cliente and saldo > 0 and coalesce(estado, '') <> 'anulada';
  select * into m from gim_membresia(s.s_empresa, p_cliente, gim_hoy());
  return jsonb_build_object(
    'cliente', jsonb_build_object('id', cl.id, 'nombre', cl.nombre, 'documento', cl.documento, 'telefono', cl.telefono),
    'deuda_vencida', v_vencida, 'deuda_total', v_total,
    'bloqueado', c.bloquear_morosos and v_vencida > 0,
    'membresia', case when m.suscripcion_id is null then null else jsonb_build_object(
      'suscripcion_id', m.suscripcion_id, 'plan', m.plan_nombre, 'precio', m.precio, 'clases_mes', m.clases_mes, 'usadas', m.usadas,
      'restantes', case when m.clases_mes is null then null else greatest(m.clases_mes - m.usadas, 0) end) end,
    'proximas', coalesce((select jsonb_agg(gim_asistencia_json(a) order by ci.inicio_at)
                            from gim_asistencias a join agenda_citas ci on ci.id = a.cita_id
                           where a.empresa_id = s.s_empresa and a.cliente_id = p_cliente
                             and a.estado in ('pendiente', 'confirmada', 'en_espera') and ci.fin_at >= now() - interval '12 hours'), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(x.j order by x.f desc) from (
                            select gim_asistencia_json(a) as j, coalesce(a.culminada_at, a.updated_at) as f
                              from gim_asistencias a
                             where a.empresa_id = s.s_empresa and a.cliente_id = p_cliente
                               and a.estado in ('culminada', 'no_asistio', 'cancelada', 'reagendada')
                             order by coalesce(a.culminada_at, a.updated_at) desc limit 40) x), '[]'::jsonb),
    'mes', jsonb_build_object(
      'culminadas', (select count(*) from gim_asistencias a where a.empresa_id = s.s_empresa and a.cliente_id = p_cliente
                       and a.estado = 'culminada' and a.fecha >= date_trunc('month', gim_hoy())::date),
      'faltas', (select count(*) from gim_asistencias a where a.empresa_id = s.s_empresa and a.cliente_id = p_cliente
                   and a.estado = 'no_asistio' and a.fecha >= date_trunc('month', gim_hoy())::date)));
end;
$fn$;

-- Anotar a un alumno en un día de clase (con cupo).
create or replace function :"schema".gim_anotar(p_cita uuid, p_cliente uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ci agenda_citas;
  v_cupo int;
  v_ocup int;
  a gim_asistencias;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  select * into ci from agenda_citas where id = p_cita and empresa_id = s.s_empresa for update;
  if ci.id is null then raise exception 'No existe esa clase'; end if;
  if ci.estado = 'cancelada' then raise exception 'Esa clase está cancelada'; end if;
  if ci.fin_at < now() - interval '12 hours' then raise exception 'Esa clase ya pasó'; end if;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = s.s_empresa) then raise exception 'No existe ese cliente'; end if;
  select * into a from gim_asistencias where cita_id = p_cita and cliente_id = p_cliente;
  if a.id is not null then
    if a.estado not in ('cancelada', 'reagendada') then raise exception 'Ya está anotado en esa clase'; end if;
  end if;
  v_cupo := (ci.metadata->>'gim_cupo')::int;
  if v_cupo is not null then
    select count(*) into v_ocup from gim_asistencias where cita_id = p_cita and estado not in ('cancelada', 'reagendada');
    if v_ocup >= v_cupo then raise exception 'La clase está llena (% de % lugares)', v_ocup, v_cupo; end if;
  end if;
  if a.id is not null then
    update gim_asistencias set estado = 'pendiente', updated_at = now(), updated_by = s.s_usuario where id = a.id returning * into a;
  else
    insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado, profesor_id, created_by)
    values (s.s_empresa, p_cita, p_cliente, (ci.inicio_at at time zone 'America/Asuncion')::date, 'pendiente', ci.responsable_id, s.s_usuario)
    returning * into a;
  end if;
  return gim_asistencia_json(a);
end;
$fn$;

-- Turno individual: una cita de la Agenda con el alumno y su profesor.
create or replace function :"schema".gim_turno_crear(p jsonb) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_cli uuid := nullif(p->>'cliente_id', '')::uuid;
  v_prof uuid := nullif(p->>'profesor_id', '')::uuid;
  v_inicio timestamptz := nullif(p->>'inicio_at', '')::timestamptz;
  v_dur int := coalesce(nullif(p->>'duracion_min', '')::int, 60);
  v_cita uuid;
  a gim_asistencias;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  if v_cli is null or not exists (select 1 from clientes where id = v_cli and empresa_id = s.s_empresa) then raise exception 'Elegí el alumno'; end if;
  if v_prof is null or not exists (select 1 from usuarios where id = v_prof and empresa_id = s.s_empresa and activo) then raise exception 'Elegí el profesor'; end if;
  if v_inicio is null then raise exception 'Poné el día y la hora'; end if;
  if v_dur not between 5 and 600 then raise exception 'La duración va de 5 a 600 minutos'; end if;
  if exists (select 1 from agenda_citas ci
              where ci.empresa_id = s.s_empresa and ci.estado not in ('cancelada', 'reprogramada')
                and (ci.responsable_id = v_prof or exists (select 1 from agenda_cita_responsables r where r.cita_id = ci.id and r.usuario_id = v_prof))
                and ci.inicio_at < v_inicio + make_interval(mins => v_dur) and ci.fin_at > v_inicio) then
    raise exception 'El profesor ya tiene algo en ese horario';
  end if;
  insert into agenda_citas (empresa_id, cliente_id, responsable_id, titulo, tipo, estado, inicio_at, fin_at, observaciones, created_by)
  values (s.s_empresa, v_cli, v_prof, coalesce(nullif(trim(p->>'titulo'), ''), 'Turno'), 'clase', 'pendiente', v_inicio,
          v_inicio + make_interval(mins => v_dur), nullif(trim(p->>'observaciones'), ''), s.s_usuario)
  returning id into v_cita;
  insert into agenda_cita_responsables (cita_id, usuario_id, empresa_id) values (v_cita, v_prof, s.s_empresa) on conflict do nothing;
  insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado, profesor_id, created_by)
  values (s.s_empresa, v_cita, v_cli, (v_inicio at time zone 'America/Asuncion')::date, 'pendiente', v_prof, s.s_usuario)
  returning * into a;
  return gim_asistencia_json(a);
end;
$fn$;

-- Cobra una clase que la membresía no cubre: venta a crédito que vence hoy (se cobra en la caja).
create or replace function :"schema".gim_cobrar_suelta(p_empresa uuid, p_cliente uuid, p_detalle text, p_precio numeric, p_iva text)
returns uuid language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_venta uuid;
  v_numero text;
  v_hoy date := gim_hoy();
  v_usuario_nombre text;
  v_tasa numeric;
  v_iva numeric;
  v_doc text;
  cl record;
begin
  select nombre, ruc, documento into cl from clientes where id = p_cliente;
  v_doc := case when ruc_receptor(cl.ruc, cl.documento) is null then 'ticket' else 'factura' end;  -- 66: sin RUC, ticket
  v_tasa := case p_iva when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0 else round(p_precio * v_tasa / (100 + v_tasa)) end;
  select nombre into v_usuario_nombre from usuarios where auth_user_id = auth.uid() and empresa_id = p_empresa limit 1;
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || p_empresa::text));
  v_numero := siguiente_numero_venta(p_empresa);
  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones, tipo_documento, comisionable)
  values (p_empresa, p_cliente, v_numero, 'GS', 1, 0, 0, 0, 'completada', 'CREDITO', 0, null, null, auth.uid(), v_usuario_nombre, now(),
          p_detalle, v_doc, false)
  returning id into v_venta;
  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (p_empresa, v_venta, null, p_detalle, null, 1, p_precio, p_precio, 'minorista', p_iva, p_precio - v_iva, v_iva, p_precio, true, 0);
  update ventas set subtotal = p_precio - v_iva, monto_iva = v_iva, total = p_precio, updated_at = now() where id = v_venta;
  update cuentas_por_cobrar set vencimiento = v_hoy, updated_at = now() where venta_id = v_venta;
  return v_venta;
end;
$fn$;

-- Cambia el estado de una asistencia. Al entrar (en espera / culminada) controla la deuda; al culminar
-- descuenta la membresía o cobra la clase suelta.
create or replace function :"schema".gim_asistencia_estado(p_id uuid, p_estado text, p_forzar boolean default false, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c gim_config;
  a gim_asistencias;
  ci agenda_citas;
  m record;
  v_vencida numeric;
  v_precio numeric;
  v_detalle text;
  v_venta uuid;
  v_valor numeric;
  v_cubre boolean;
  v_usadas int;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  c := gim_config_de(s.s_empresa);
  if p_estado not in ('pendiente', 'confirmada', 'cancelada', 'reagendada', 'en_espera', 'culminada', 'no_asistio') then
    raise exception 'Estado inválido';
  end if;
  select * into a from gim_asistencias where id = p_id and empresa_id = s.s_empresa for update;
  if a.id is null then raise exception 'No existe esa asistencia'; end if;
  if a.estado = p_estado then return gim_asistencia_json(a); end if;
  if a.estado in ('culminada', 'no_asistio', 'cancelada', 'reagendada') then
    raise exception 'Esa asistencia ya está cerrada (%)', replace(a.estado, '_', ' ');
  end if;
  if a.estado = 'en_espera' and p_estado in ('pendiente', 'confirmada') then raise exception 'Ya llegó: marcala culminada o no asistió'; end if;
  if a.cita_id is not null then select * into ci from agenda_citas where id = a.cita_id; end if;

  -- Entrada: deuda vencida.
  if p_estado in ('en_espera', 'culminada') and a.llegada_at is null then
    v_vencida := gim_deuda_vencida(s.s_empresa, a.cliente_id);
    if c.bloquear_morosos and v_vencida > 0 then
      if not p_forzar then
        raise exception 'Tiene una deuda vencida de Gs. %: que pase por caja antes de entrar', replace(to_char(v_vencida, 'FM999,999,999,999'), ',', '.')
          using hint = 'moroso:' || v_vencida;
      end if;
      if not tiene_permiso('gimnasio_forzar_entrada') then
        raise exception 'Tiene deuda vencida y no tenés permiso para dejarlo entrar' using errcode = '42501';
      end if;
      if coalesce(trim(p_motivo), '') = '' then raise exception 'Poné el motivo para dejarlo entrar con deuda'; end if;
      a.forzada := true;
      update gim_asistencias set forzada = true, forzada_por = s.s_usuario, forzada_motivo = trim(p_motivo) where id = a.id;
    end if;
    update gim_asistencias set llegada_at = now() where id = a.id;
  end if;

  if p_estado = 'culminada' then
    select * into m from gim_membresia(s.s_empresa, a.cliente_id, a.fecha);
    v_cubre := m.suscripcion_id is not null and (m.clases_mes is null or m.usadas < m.clases_mes);
    if v_cubre then
      if m.clases_mes is not null then v_valor := round(m.precio / m.clases_mes); end if;  -- ilimitado: se reparte al calcular la comisión
      update gim_asistencias set suscripcion_id = m.suscripcion_id, valor = v_valor where id = a.id;
    else
      v_precio := coalesce((select g.precio_suelta from gim_clases g where g.id = ci.gim_clase_id), c.precio_clase_suelta);
      if v_precio > 0 then
        v_detalle := 'Clase suelta: ' || coalesce(ci.titulo, 'Entrada libre') || ' — ' || to_char(a.fecha, 'DD/MM/YYYY');
        v_venta := gim_cobrar_suelta(s.s_empresa, a.cliente_id, v_detalle, v_precio, c.tipo_iva);
      end if;
      update gim_asistencias set venta_id = v_venta, valor = v_precio where id = a.id;
    end if;
    update gim_asistencias set culminada_at = now(), profesor_id = coalesce(ci.responsable_id, profesor_id) where id = a.id;
  end if;

  update gim_asistencias set estado = p_estado, updated_at = now(), updated_by = s.s_usuario where id = a.id returning * into a;

  -- Turno individual: la cita de la Agenda sigue al alumno.
  if ci.id is not null and ci.gim_clase_id is null then
    update agenda_citas set estado = case p_estado when 'reagendada' then 'reprogramada' when 'culminada' then 'completada' else p_estado end,
           updated_at = now()
     where id = ci.id;
  end if;
  return gim_asistencia_json(a);
end;
$fn$;

-- Entrada libre (sala, sin clase): se registra culminada en el momento.
create or replace function :"schema".gim_entrada(p_cliente uuid, p_forzar boolean default false, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a gim_asistencias;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = s.s_empresa) then raise exception 'No existe ese cliente'; end if;
  if exists (select 1 from gim_asistencias where empresa_id = s.s_empresa and cliente_id = p_cliente and cita_id is null and fecha = gim_hoy()
               and estado = 'culminada') then
    raise exception 'Ya tiene la entrada de hoy';
  end if;
  insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado, created_by)
  values (s.s_empresa, null, p_cliente, gim_hoy(), 'pendiente', s.s_usuario)
  returning * into a;
  return gim_asistencia_estado(a.id, 'culminada', p_forzar, p_motivo);
end;
$fn$;

-- =============================================================================
-- 7. Comisiones de profesores (se calculan al consultar)
-- =============================================================================
create or replace function :"schema".gim_comisiones(p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c gim_config;
begin
  select * into s from gim_sesion('gimnasio_administrar');
  if p_hasta < p_desde or p_hasta - p_desde > 370 then raise exception 'Rango de fechas inválido'; end if;
  c := gim_config_de(s.s_empresa);
  return jsonb_build_object(
    'modo', c.comision_modo, 'monto', c.comision_monto, 'pct', c.comision_pct,
    'profesores', coalesce((
      with base as (
        select a.*,
               -- Membresía ilimitada: el valor de la clase es la cuota del mes repartida entre las clases que tomó ese mes.
               coalesce(a.valor, case when a.suscripcion_id is not null then round(
                 (select su.precio from suscripciones su where su.id = a.suscripcion_id) /
                 nullif((select count(*) from gim_asistencias b where b.suscripcion_id = a.suscripcion_id and b.estado = 'culminada'
                           and date_trunc('month', b.fecha) = date_trunc('month', a.fecha)), 0)) end, 0) as valor_calc
          from gim_asistencias a
         where a.empresa_id = s.s_empresa and a.estado = 'culminada' and a.profesor_id is not null
           and a.fecha between p_desde and p_hasta),
      por_prof as (
        select b.profesor_id, count(*) as alumnos, count(distinct b.cita_id) as clases, sum(b.valor_calc) as valor
          from base b group by b.profesor_id)
      select jsonb_agg(jsonb_build_object(
        'profesor_id', pp.profesor_id, 'profesor', u.nombre, 'clases', pp.clases, 'alumnos', pp.alumnos, 'valor', pp.valor,
        'comision', case c.comision_modo
                      when 'por_alumno' then pp.alumnos * c.comision_monto
                      when 'por_clase' then pp.clases * c.comision_monto
                      when 'porcentaje' then round(pp.valor * c.comision_pct / 100)
                      else 0 end) order by u.nombre)
        from por_prof pp join usuarios u on u.id = pp.profesor_id), '[]'::jsonb));
end;
$fn$;

-- =============================================================================
-- 8. Permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  -- Internas.
  foreach f in array array['rubro_dar_gimnasio(uuid)', 'gim_config_de(uuid)', 'gim_deuda_vencida(uuid,uuid)', 'gim_membresia(uuid,uuid,date)',
                           'gim_generar(uuid,date,date)', 'gim_asistencia_json(gim_asistencias)', 'gim_cobrar_suelta(uuid,uuid,text,numeric,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Con sesión (cada una exige la función Gimnasio prendida y su permiso).
  foreach f in array array['gim_sesion(text)', 'gim_hoy()', 'gim_config_leer()', 'gim_config_guardar(jsonb)', 'gim_clases_lista()',
                           'gim_clase_guardar(jsonb)', 'gim_dia(date)', 'gim_cliente(uuid)', 'gim_anotar(uuid,uuid)', 'gim_turno_crear(jsonb)',
                           'gim_asistencia_estado(uuid,text,boolean,text)', 'gim_entrada(uuid,boolean,text)', 'gim_comisiones(date,date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

-- Las empresas que ya tengan Gimnasio prendido (re-aplicación): pantallas.
do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where gimnasio loop
    perform rubro_dar_gimnasio(r.empresa_id);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
