-- =============================================================================
-- RR HH (pedido del dueño, 2-nov-2026). Un legajo por cada usuario del sistema.
--
--   rrhh_legajos        datos personales, contacto de emergencia, salario, IPS, comisiona, área, horario.
--                       Nombre, CI, teléfono, correo, perfil y sucursal siguen en `usuarios`.
--   rrhh_ausencias      fecha y días; `descuenta` decide si baja del salario.
--   rrhh_vacaciones     días tomados.
--   rrhh_liquidaciones  extracto del mes para el asesor: abierta (se recalcula) o cerrada (queda la foto).
--   rrhh_historial      línea de tiempo de la persona: aumentos, cambios, ausencias, hitos.
--
--   · No mueve plata: no genera gastos ni pagos. El extracto lo revisa y lo procesa el asesor.
--   · La cuenta está en src/modules/rrhh/calculo.ts; acá se guardan los datos y la foto del cierre.
--   · Salarios: tablas sin acceso directo; todo por funciones con ADMIN + permiso administrar_rrhh.
--   · Mes cerrado: no se cargan ni anulan ausencias de ese mes hasta reabrirlo (con motivo).
--   · Comisiona = no: esa persona sale de Comisiones (comisiones_datos devuelve no_comisionan). Sin
--     legajo sigue comisionando como hasta ahora.
--
-- IDEMPOTENTE. Va después de 117.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create table if not exists :"schema".rrhh_legajos (
  usuario_id uuid primary key references :"schema".usuarios(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  fecha_nacimiento date,
  direccion text,
  barrio text,
  ciudad text,
  emergencia_nombre text,
  emergencia_telefono text,
  fecha_ingreso date not null,
  fecha_egreso date,
  tipo_salario text not null default 'mensualero' check (tipo_salario in ('mensualero', 'jornalero')),
  salario numeric(18, 2) not null default 0 check (salario >= 0),
  aporta_ips boolean not null default true,
  comisiona boolean not null default true,
  area text,
  horario_dias integer[] not null default '{}',
  horario_entrada time,
  horario_salida time,
  horario_nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fecha_egreso is null or fecha_egreso >= fecha_ingreso)
);
create index if not exists rrhh_legajos_empresa_idx on :"schema".rrhh_legajos (empresa_id);

create table if not exists :"schema".rrhh_ausencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  fecha date not null,
  dias numeric(5, 2) not null check (dias > 0 and dias <= 31),
  tipo text not null check (tipo in ('injustificada', 'permiso_sin_goce', 'permiso_con_goce', 'reposo')),
  descuenta boolean not null,
  motivo text,
  anulada_at timestamptz,
  anulada_motivo text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rrhh_ausencias_usuario_idx on :"schema".rrhh_ausencias (usuario_id, fecha desc);

create table if not exists :"schema".rrhh_vacaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  desde date not null,
  hasta date not null,
  dias numeric(5, 2) not null check (dias > 0 and dias <= 60),
  nota text,
  anulada_at timestamptz,
  anulada_motivo text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  check (hasta >= desde)
);
create index if not exists rrhh_vacaciones_usuario_idx on :"schema".rrhh_vacaciones (usuario_id, desde desc);

create table if not exists :"schema".rrhh_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  periodo text not null check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  dias_trabajados numeric(5, 2) check (dias_trabajados is null or dias_trabajados between 0 and 31),
  ajustes jsonb not null default '[]'::jsonb,
  resultado jsonb,
  imponible numeric(18, 2),
  neto numeric(18, 2),
  cerrada_por text,
  cerrada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, periodo)
);
create index if not exists rrhh_liquidaciones_periodo_idx on :"schema".rrhh_liquidaciones (empresa_id, periodo);

create table if not exists :"schema".rrhh_historial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  actor_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists rrhh_historial_usuario_idx on :"schema".rrhh_historial (usuario_id, created_at desc);

-- Solo por funciones: ni lectura ni escritura directa.
do $do$
declare
  t text;
begin
  foreach t in array array['rrhh_legajos', 'rrhh_ausencias', 'rrhh_vacaciones', 'rrhh_liquidaciones', 'rrhh_historial'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- Permiso nuevo. El catálogo se parchea sobre lo que hay, como las recetas anteriores.
do $do$
declare
  v_def text := pg_get_functiondef('permisos_catalogo()'::regprocedure);
  v_ultimo text := $a$('configuracion',              'Configuración del sistema',                     'Administración')$a$;
begin
  if position('administrar_rrhh' in v_def) = 0 then
    if position(v_ultimo in v_def) = 0 then raise exception 'Receta 118: permisos_catalogo no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ultimo, v_ultimo || $b$,
    ('administrar_rrhh',           'Administrar RR HH y salarios',                  'Administración')$b$);
  end if;
end;
$do$;

-- Sesión de RR HH: nivel Administrador y el permiso.
create or replace function :"schema".rrhh_sesion(
  out s_empresa uuid, out s_usuario uuid, out s_nombre text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('administrar_rrhh');
  s_empresa := s.s_empresa; s_usuario := s.s_usuario; s_nombre := s.s_nombre;
end;
$fn$;

create or replace function :"schema".rrhh_mes_cerrado(p_usuario uuid, p_fecha date)
returns boolean language sql stable security definer set search_path = :"schema", public as $fn$
  select exists (select 1 from rrhh_liquidaciones l
                  where l.usuario_id = p_usuario and l.periodo = to_char(p_fecha, 'YYYY-MM') and l.estado = 'cerrada');
$fn$;

create or replace function :"schema".rrhh_listado()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from rrhh_sesion();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'nombre', u.nombre, 'ci', u.ci, 'telefono', u.telefono, 'email', u.email, 'activo', u.activo,
      'perfil', pf.nombre, 'sucursal', su.nombre, 'tiene_legajo', l.usuario_id is not null,
      'area', l.area, 'tipo_salario', l.tipo_salario, 'salario', l.salario, 'fecha_ingreso', l.fecha_ingreso, 'fecha_egreso', l.fecha_egreso,
      'aporta_ips', l.aporta_ips, 'comisiona', l.comisiona
    ) order by u.activo desc, u.nombre)
    from usuarios u
    left join perfiles pf on pf.id = u.perfil_id
    left join sucursales su on su.id = u.sucursal_id
    left join rrhh_legajos l on l.usuario_id = u.id
   where u.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

create or replace function :"schema".rrhh_ficha(p_usuario uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v jsonb;
begin
  select * into s from rrhh_sesion();
  select jsonb_build_object(
      'id', u.id, 'nombre', u.nombre, 'nombres', coalesce(u.nombres, u.nombre), 'apellidos', u.apellidos, 'ci', u.ci, 'telefono', u.telefono,
      'email', u.email, 'activo', u.activo, 'perfil', pf.nombre, 'sucursal', su.nombre)
    into v
    from usuarios u
    left join perfiles pf on pf.id = u.perfil_id
    left join sucursales su on su.id = u.sucursal_id
   where u.id = p_usuario and u.empresa_id = s.s_empresa;
  if v is null then raise exception 'Usuario no encontrado'; end if;

  return jsonb_build_object(
    'usuario', v,
    'legajo', (select to_jsonb(l) from rrhh_legajos l where l.usuario_id = p_usuario),
    'ausencias', coalesce((select jsonb_agg(to_jsonb(a) order by a.fecha desc, a.created_at desc) from rrhh_ausencias a where a.usuario_id = p_usuario), '[]'::jsonb),
    'vacaciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.desde desc, x.created_at desc) from rrhh_vacaciones x where x.usuario_id = p_usuario), '[]'::jsonb),
    'liquidaciones', coalesce((select jsonb_agg(jsonb_build_object('periodo', q.periodo, 'estado', q.estado, 'imponible', q.imponible, 'neto', q.neto, 'cerrada_at', q.cerrada_at, 'resultado', q.resultado) order by q.periodo desc)
                                 from rrhh_liquidaciones q where q.usuario_id = p_usuario), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(e.j order by e.f desc) from (
        select jsonb_build_object('id', h.id, 'accion', h.accion, 'detalle', h.detalle, 'actor', h.actor_nombre, 'created_at', h.created_at) as j, h.created_at as f
          from rrhh_historial h where h.usuario_id = p_usuario
        union all
        -- Lo que cambió desde Configuración › Usuarios (perfil, sucursal, alta, baja) también es su historia.
        select jsonb_build_object('id', o.id, 'accion', 'usuario_' || o.accion, 'detalle', o.detalle, 'actor', o.actor_nombre, 'created_at', o.created_at), o.created_at
          from usuarios_historial o
         where o.usuario_id = p_usuario and o.objeto = 'usuario' and o.accion in ('creado', 'vinculado', 'editado', 'activado', 'desactivado')
      ) e), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".rrhh_guardar_legajo(p_usuario uuid, p jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  u usuarios;
  o rrhh_legajos;
  n rrhh_legajos;
  v_nombres text := nullif(btrim(coalesce(p->>'nombres', '')), '');
  v_apellidos text := nullif(btrim(coalesce(p->>'apellidos', '')), '');
  v_ci text := nullif(left(btrim(coalesce(p->>'ci', '')), 20), '');
  v_tel text := nullif(left(btrim(coalesce(p->>'telefono', '')), 40), '');
  v_nombre text;
  v_motivo text := nullif(btrim(coalesce(p->>'motivo_salario', '')), '');
  v_cambios jsonb := '[]'::jsonb;
  c record;
begin
  select * into s from rrhh_sesion();
  select * into u from usuarios where id = p_usuario and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if v_nombres is null then raise exception 'Escribí el nombre'; end if;
  if nullif(p->>'fecha_ingreso', '') is null then raise exception 'Poné la fecha de ingreso: de ahí salen la antigüedad, las vacaciones y el aguinaldo'; end if;
  if coalesce((p->>'salario')::numeric, -1) < 0 then raise exception 'Revisá el salario'; end if;
  if coalesce(p->>'tipo_salario', '') not in ('mensualero', 'jornalero') then raise exception 'Elegí si es mensualero o jornalero'; end if;
  if (p->>'fecha_egreso') is not null and (p->>'fecha_egreso') <> '' and (p->>'fecha_egreso')::date < (p->>'fecha_ingreso')::date then
    raise exception 'La fecha de salida no puede ser anterior al ingreso';
  end if;

  select * into o from rrhh_legajos where usuario_id = p_usuario for update;
  if o.usuario_id is not null and o.salario <> (p->>'salario')::numeric and v_motivo is null then
    raise exception 'Contá el motivo del cambio de salario: queda en el historial';
  end if;

  v_nombre := btrim(v_nombres || coalesce(' ' || v_apellidos, ''));
  update usuarios set nombres = v_nombres, apellidos = v_apellidos, nombre = v_nombre, ci = v_ci, telefono = v_tel, updated_at = now() where id = p_usuario;

  insert into rrhh_legajos as l (usuario_id, empresa_id, fecha_nacimiento, direccion, barrio, ciudad, emergencia_nombre, emergencia_telefono, fecha_ingreso, fecha_egreso,
                                 tipo_salario, salario, aporta_ips, comisiona, area, horario_dias, horario_entrada, horario_salida, horario_nota)
  values (p_usuario, s.s_empresa, nullif(p->>'fecha_nacimiento', '')::date, nullif(btrim(p->>'direccion'), ''), nullif(btrim(p->>'barrio'), ''), nullif(btrim(p->>'ciudad'), ''),
          nullif(btrim(p->>'emergencia_nombre'), ''), nullif(btrim(p->>'emergencia_telefono'), ''), (p->>'fecha_ingreso')::date, nullif(p->>'fecha_egreso', '')::date,
          p->>'tipo_salario', (p->>'salario')::numeric, coalesce((p->>'aporta_ips')::boolean, true), coalesce((p->>'comisiona')::boolean, true), nullif(btrim(p->>'area'), ''),
          coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(p->'horario_dias', '[]'::jsonb)) x), '{}'),
          nullif(p->>'horario_entrada', '')::time, nullif(p->>'horario_salida', '')::time, nullif(btrim(p->>'horario_nota'), ''))
  on conflict (usuario_id) do update set
    fecha_nacimiento = excluded.fecha_nacimiento, direccion = excluded.direccion, barrio = excluded.barrio, ciudad = excluded.ciudad,
    emergencia_nombre = excluded.emergencia_nombre, emergencia_telefono = excluded.emergencia_telefono, fecha_ingreso = excluded.fecha_ingreso, fecha_egreso = excluded.fecha_egreso,
    tipo_salario = excluded.tipo_salario, salario = excluded.salario, aporta_ips = excluded.aporta_ips, comisiona = excluded.comisiona, area = excluded.area,
    horario_dias = excluded.horario_dias, horario_entrada = excluded.horario_entrada, horario_salida = excluded.horario_salida, horario_nota = excluded.horario_nota, updated_at = now()
  returning * into n;

  if o.usuario_id is null then
    insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
    values (s.s_empresa, p_usuario, 'legajo_creado', jsonb_build_object('salario', n.salario, 'tipo_salario', n.tipo_salario, 'fecha_ingreso', n.fecha_ingreso, 'area', n.area), s.s_nombre);
    return;
  end if;

  if o.salario <> n.salario or o.tipo_salario <> n.tipo_salario then
    insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
    values (s.s_empresa, p_usuario, 'salario', jsonb_build_object('antes', o.salario, 'despues', n.salario, 'tipo_antes', o.tipo_salario, 'tipo_despues', n.tipo_salario, 'motivo', v_motivo), s.s_nombre);
  end if;

  for c in
    select * from (values
      ('Nombre', u.nombre, v_nombre), ('CI', u.ci, v_ci), ('Teléfono', u.telefono, v_tel),
      ('Fecha de nacimiento', o.fecha_nacimiento::text, n.fecha_nacimiento::text), ('Dirección', o.direccion, n.direccion), ('Barrio', o.barrio, n.barrio), ('Ciudad', o.ciudad, n.ciudad),
      ('Contacto de emergencia', o.emergencia_nombre, n.emergencia_nombre), ('Teléfono de emergencia', o.emergencia_telefono, n.emergencia_telefono),
      ('Fecha de ingreso', o.fecha_ingreso::text, n.fecha_ingreso::text), ('Fecha de salida', o.fecha_egreso::text, n.fecha_egreso::text),
      ('Aporta IPS', o.aporta_ips::text, n.aporta_ips::text), ('Comisiona', o.comisiona::text, n.comisiona::text), ('Área de trabajo', o.area, n.area),
      ('Días de trabajo', o.horario_dias::text, n.horario_dias::text), ('Entrada', left(o.horario_entrada::text, 5), left(n.horario_entrada::text, 5)),
      ('Salida', left(o.horario_salida::text, 5), left(n.horario_salida::text, 5)), ('Nota del horario', o.horario_nota, n.horario_nota)
    ) as t(campo, antes, despues) where antes is distinct from despues
  loop
    v_cambios := v_cambios || jsonb_build_object('campo', c.campo, 'antes', c.antes, 'despues', c.despues);
  end loop;
  if jsonb_array_length(v_cambios) > 0 then
    insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
    values (s.s_empresa, p_usuario, 'actualizado', jsonb_build_object('cambios', v_cambios), s.s_nombre);
  end if;
end;
$fn$;

create or replace function :"schema".rrhh_ausencia_guardar(p_usuario uuid, p jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_fecha date := (p->>'fecha')::date;
  v_dias numeric := (p->>'dias')::numeric;
  v_tipo text := p->>'tipo';
  v_desc boolean := (p->>'descuenta')::boolean;
  v_motivo text := nullif(btrim(coalesce(p->>'motivo', '')), '');
begin
  select * into s from rrhh_sesion();
  if not exists (select 1 from rrhh_legajos where usuario_id = p_usuario and empresa_id = s.s_empresa) then raise exception 'Primero cargá los datos de la persona'; end if;
  if rrhh_mes_cerrado(p_usuario, v_fecha) then raise exception 'La liquidación de ese mes está cerrada: reabrila para cargar la ausencia'; end if;
  insert into rrhh_ausencias (empresa_id, usuario_id, fecha, dias, tipo, descuenta, motivo, created_by)
  values (s.s_empresa, p_usuario, v_fecha, v_dias, v_tipo, v_desc, v_motivo, s.s_usuario);
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, p_usuario, 'ausencia', jsonb_build_object('fecha', v_fecha, 'dias', v_dias, 'tipo', v_tipo, 'descuenta', v_desc, 'motivo', v_motivo), s.s_nombre);
end;
$fn$;

create or replace function :"schema".rrhh_ausencia_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a rrhh_ausencias;
begin
  select * into s from rrhh_sesion();
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into a from rrhh_ausencias where id = p_id and empresa_id = s.s_empresa and anulada_at is null for update;
  if not found then raise exception 'Ausencia no encontrada'; end if;
  if rrhh_mes_cerrado(a.usuario_id, a.fecha) then raise exception 'La liquidación de ese mes está cerrada: reabrila para anular la ausencia'; end if;
  update rrhh_ausencias set anulada_at = now(), anulada_motivo = btrim(p_motivo) where id = p_id;
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, a.usuario_id, 'ausencia_anulada', jsonb_build_object('fecha', a.fecha, 'dias', a.dias, 'motivo', btrim(p_motivo)), s.s_nombre);
end;
$fn$;

create or replace function :"schema".rrhh_vacacion_guardar(p_usuario uuid, p jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_desde date := (p->>'desde')::date;
  v_hasta date := (p->>'hasta')::date;
  v_dias numeric := (p->>'dias')::numeric;
  v_nota text := nullif(btrim(coalesce(p->>'nota', '')), '');
begin
  select * into s from rrhh_sesion();
  if not exists (select 1 from rrhh_legajos where usuario_id = p_usuario and empresa_id = s.s_empresa) then raise exception 'Primero cargá los datos de la persona'; end if;
  if v_hasta < v_desde then raise exception 'La fecha de regreso no puede ser anterior a la de inicio'; end if;
  if exists (select 1 from rrhh_vacaciones x where x.usuario_id = p_usuario and x.anulada_at is null and daterange(x.desde, x.hasta, '[]') && daterange(v_desde, v_hasta, '[]')) then
    raise exception 'Ya tiene vacaciones cargadas en esas fechas';
  end if;
  insert into rrhh_vacaciones (empresa_id, usuario_id, desde, hasta, dias, nota, created_by)
  values (s.s_empresa, p_usuario, v_desde, v_hasta, v_dias, v_nota, s.s_usuario);
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, p_usuario, 'vacaciones', jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'dias', v_dias, 'nota', v_nota), s.s_nombre);
end;
$fn$;

create or replace function :"schema".rrhh_vacacion_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  x rrhh_vacaciones;
begin
  select * into s from rrhh_sesion();
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into x from rrhh_vacaciones where id = p_id and empresa_id = s.s_empresa and anulada_at is null for update;
  if not found then raise exception 'Vacaciones no encontradas'; end if;
  update rrhh_vacaciones set anulada_at = now(), anulada_motivo = btrim(p_motivo) where id = p_id;
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, x.usuario_id, 'vacaciones_anuladas', jsonb_build_object('desde', x.desde, 'hasta', x.hasta, 'dias', x.dias, 'motivo', btrim(p_motivo)), s.s_nombre);
end;
$fn$;

-- Hitos que no salen solos: ascenso, felicitación, capacitación, llamada de atención…
create or replace function :"schema".rrhh_nota_agregar(p_usuario uuid, p_tipo text, p_texto text)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from rrhh_sesion();
  if p_tipo not in ('ascenso', 'felicitacion', 'capacitacion', 'llamada_atencion', 'otro') then raise exception 'Elegí el tipo'; end if;
  if btrim(coalesce(p_texto, '')) = '' then raise exception 'Escribí qué pasó'; end if;
  if not exists (select 1 from usuarios where id = p_usuario and empresa_id = s.s_empresa) then raise exception 'Usuario no encontrado'; end if;
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, p_usuario, 'nota', jsonb_build_object('tipo', p_tipo, 'texto', btrim(p_texto)), s.s_nombre);
end;
$fn$;

-- Datos del mes para armar los extractos.
create or replace function :"schema".rrhh_liquidacion_datos(p_periodo text)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_desde date := (p_periodo || '-01')::date;
  v_hasta date := ((p_periodo || '-01')::date + interval '1 month - 1 day')::date;
begin
  select * into s from rrhh_sesion();
  return jsonb_build_object(
    'personas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'usuario_id', u.id, 'nombre', u.nombre, 'ci', u.ci, 'perfil', pf.nombre, 'sucursal', su.nombre, 'area', l.area,
        'tipo_salario', l.tipo_salario, 'salario', l.salario, 'aporta_ips', l.aporta_ips, 'comisiona', l.comisiona,
        'fecha_ingreso', l.fecha_ingreso, 'fecha_egreso', l.fecha_egreso,
        'ausencias', coalesce((select jsonb_agg(jsonb_build_object('fecha', a.fecha, 'dias', a.dias, 'tipo', a.tipo, 'descuenta', a.descuenta) order by a.fecha)
                                 from rrhh_ausencias a where a.usuario_id = u.id and a.anulada_at is null and a.fecha between v_desde and v_hasta), '[]'::jsonb),
        'vacaciones_tomadas', coalesce((select sum(x.dias) from rrhh_vacaciones x where x.usuario_id = u.id and x.anulada_at is null), 0),
        'cerradas_anio', coalesce((select jsonb_agg(jsonb_build_object('periodo', q.periodo, 'imponible', q.imponible))
                                     from rrhh_liquidaciones q where q.usuario_id = u.id and q.estado = 'cerrada' and left(q.periodo, 4) = left(p_periodo, 4)), '[]'::jsonb),
        'liquidacion', (select jsonb_build_object('estado', q.estado, 'dias_trabajados', q.dias_trabajados, 'ajustes', q.ajustes, 'resultado', q.resultado, 'cerrada_por', q.cerrada_por, 'cerrada_at', q.cerrada_at)
                          from rrhh_liquidaciones q where q.usuario_id = u.id and q.periodo = p_periodo)
      ) order by u.nombre)
      from rrhh_legajos l
      join usuarios u on u.id = l.usuario_id
      left join perfiles pf on pf.id = u.perfil_id
      left join sucursales su on su.id = u.sucursal_id
     where l.empresa_id = s.s_empresa and l.fecha_ingreso <= v_hasta and (l.fecha_egreso is null or l.fecha_egreso >= v_desde)
       -- Con liquidación del mes siempre sale, aunque hoy esté desactivado.
       and (u.activo or exists (select 1 from rrhh_liquidaciones q where q.usuario_id = u.id and q.periodo = p_periodo))), '[]'::jsonb),
    'sin_legajo', (select count(*) from usuarios u where u.empresa_id = s.s_empresa and u.activo and not exists (select 1 from rrhh_legajos l where l.usuario_id = u.id)));
end;
$fn$;

create or replace function :"schema".rrhh_liquidacion_ajustar(p_usuario uuid, p_periodo text, p_dias numeric, p_ajustes jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from rrhh_sesion();
  if not exists (select 1 from rrhh_legajos where usuario_id = p_usuario and empresa_id = s.s_empresa) then raise exception 'Primero cargá los datos de la persona'; end if;
  if exists (select 1 from rrhh_liquidaciones where usuario_id = p_usuario and periodo = p_periodo and estado = 'cerrada') then raise exception 'La liquidación está cerrada: reabrila para cambiarla'; end if;
  insert into rrhh_liquidaciones (empresa_id, usuario_id, periodo, dias_trabajados, ajustes)
  values (s.s_empresa, p_usuario, p_periodo, p_dias, coalesce(p_ajustes, '[]'::jsonb))
  on conflict (usuario_id, periodo) do update set dias_trabajados = excluded.dias_trabajados, ajustes = excluded.ajustes, updated_at = now();
end;
$fn$;

create or replace function :"schema".rrhh_liquidacion_cerrar(p_usuario uuid, p_periodo text, p_resultado jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from rrhh_sesion();
  if not exists (select 1 from rrhh_legajos where usuario_id = p_usuario and empresa_id = s.s_empresa) then raise exception 'Primero cargá los datos de la persona'; end if;
  if exists (select 1 from rrhh_liquidaciones where usuario_id = p_usuario and periodo = p_periodo and estado = 'cerrada') then raise exception 'Esa liquidación ya está cerrada'; end if;
  insert into rrhh_liquidaciones (empresa_id, usuario_id, periodo, estado, dias_trabajados, resultado, imponible, neto, cerrada_por, cerrada_at)
  values (s.s_empresa, p_usuario, p_periodo, 'cerrada', (p_resultado->>'dias_trabajados')::numeric, p_resultado,
          (p_resultado->>'imponible')::numeric, (p_resultado->>'neto')::numeric, s.s_nombre, now())
  on conflict (usuario_id, periodo) do update set estado = 'cerrada', resultado = excluded.resultado, imponible = excluded.imponible,
    neto = excluded.neto, cerrada_por = excluded.cerrada_por, cerrada_at = excluded.cerrada_at, updated_at = now();
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, p_usuario, 'liquidacion_cerrada', jsonb_build_object('periodo', p_periodo, 'neto', (p_resultado->>'neto')::numeric), s.s_nombre);
end;
$fn$;

create or replace function :"schema".rrhh_liquidacion_reabrir(p_usuario uuid, p_periodo text, p_motivo text)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from rrhh_sesion();
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  update rrhh_liquidaciones set estado = 'abierta', resultado = null, imponible = null, neto = null, cerrada_por = null, cerrada_at = null, updated_at = now()
   where usuario_id = p_usuario and periodo = p_periodo and empresa_id = s.s_empresa and estado = 'cerrada';
  if not found then raise exception 'Esa liquidación no está cerrada'; end if;
  insert into rrhh_historial (empresa_id, usuario_id, accion, detalle, actor_nombre)
  values (s.s_empresa, p_usuario, 'liquidacion_reabierta', jsonb_build_object('periodo', p_periodo, 'motivo', btrim(p_motivo)), s.s_nombre);
end;
$fn$;

-- Comisiona = no: comisiones_datos avisa quiénes quedan afuera.
do $do$
declare
  v_def text := pg_get_functiondef('comisiones_datos(date,date)'::regprocedure);
  v_marca text := $a$'lineas', v_lineas,$a$;
begin
  if position('no_comisionan' in v_def) = 0 then
    if position(v_marca in v_def) = 0 then raise exception 'Receta 118: comisiones_datos no tiene el patrón esperado'; end if;
    execute replace(v_def, v_marca, $b$'no_comisionan', coalesce((select jsonb_agg(l.usuario_id) from rrhh_legajos l where l.empresa_id = s.s_empresa and not l.comisiona), '[]'::jsonb),
    'lineas', v_lineas,$b$);
  end if;
end;
$do$;

do $do$
declare
  f text;
begin
  foreach f in array array['rrhh_sesion()', 'rrhh_mes_cerrado(uuid,date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['rrhh_listado()', 'rrhh_ficha(uuid)', 'rrhh_guardar_legajo(uuid,jsonb)', 'rrhh_ausencia_guardar(uuid,jsonb)', 'rrhh_ausencia_anular(uuid,text)',
    'rrhh_vacacion_guardar(uuid,jsonb)', 'rrhh_vacacion_anular(uuid,text)', 'rrhh_nota_agregar(uuid,text,text)', 'rrhh_liquidacion_datos(text)',
    'rrhh_liquidacion_ajustar(uuid,text,numeric,jsonb)', 'rrhh_liquidacion_cerrar(uuid,text,jsonb)', 'rrhh_liquidacion_reabrir(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
