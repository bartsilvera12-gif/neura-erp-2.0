-- =============================================================================
-- ENVÍOS (kanban de entregas, rubro Comercio) — pedido del dueño (24-nov-2026).
-- Tablero por estados para seguir la entrega de cada pedido y asignar choferes.
--
--   · Rubro y funciones: función nueva `envios` (empresa_funciones.envios). Interruptor
--     INDEPENDIENTE del rubro (como `pedidos`/`comedor`): no cambia el rubro ni se siembra en
--     ninguno; se enciende por datos donde se la quiera (Comercio):
--         update empresa_funciones set envios = true;   -- contra el schema del cliente
--         select rubro_dar_envios((select id from empresas limit 1));  -- pantallas/permisos a perfiles
--   · Estados CONFIGURABLES (envios_estados): el cliente crea/renombra/reordena. Se siembran 5 por
--     defecto la primera vez (Pendiente → Preparando → En camino → Entregado → Cancelado).
--   · Choferes propios (envios_choferes): lista simple (nombre + teléfono/CI), sin cuenta.
--   · Un envío (envios) nace desde una venta: el cajero marca "Envío a domicilio" en Nueva venta y,
--     tras cobrarla, la caja llama envio_crear(venta_id, dirección…). "Entrega en local" = no crea
--     envío. La dirección vive en el envío (la venta no la guarda; se prellena de clientes).
--
-- Esta receta (170) = Fase 1: función, tablas, ABM de estados/choferes y tablero (seguimiento).
-- El pago contra entrega (cobro al entregar) viene en la receta siguiente. IDEMPOTENTE.
-- create or replace preserva grants. Va después de 169.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Función "envios" en Rubro y funciones (interruptor independiente, como pedidos)
-- =============================================================================
alter table :"schema".empresa_funciones add column if not exists envios boolean not null default false;

do $do$
declare
  v_def text;
begin
  -- funcion_activa: rama envios (antes de la de pedidos).
  v_def := pg_get_functiondef('funcion_activa(uuid,text)'::regprocedure);
  if position('-- 170: envios' in v_def) = 0 then
    if position($a$when p_funcion = 'pedidos' then$a$ in v_def) = 0 then raise exception 'Receta 170: funcion_activa no tiene el patrón esperado'; end if;
    execute replace(v_def, $a$when p_funcion = 'pedidos' then$a$,
      $b$when p_funcion = 'envios' then coalesce((select f.envios from empresa_funciones f where f.empresa_id = p_empresa), false) -- 170: envios
    when p_funcion = 'pedidos' then$b$);
  end if;

  -- funciones_empresa: agrega 'envios' al jsonb (NO toca el rubro: es independiente).
  v_def := pg_get_functiondef('funciones_empresa()'::regprocedure);
  if position('-- 170: envios' in v_def) = 0 then
    if position($a$'comedor', coalesce(f.comedor, false),$a$ in v_def) = 0 then raise exception 'Receta 170: funciones_empresa no tiene el patrón esperado'; end if;
    v_def := replace(v_def, $a$'comedor', coalesce(f.comedor, false),$a$,
      $b$'comedor', coalesce(f.comedor, false),
    'envios', coalesce(f.envios, false), -- 170: envios$b$);
    execute v_def;
  end if;
  -- guardar_funciones_empresa NO se parchea: se enciende solo por SQL (Neura).
end;
$do$;

-- =============================================================================
-- 2. Tablas
-- =============================================================================

-- Estados del kanban (columnas), configurables por el cliente. Exactamente uno es_inicial.
create table if not exists :"schema".envios_estados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 40),
  color text,
  orden integer not null default 0,
  es_inicial boolean not null default false,
  es_final boolean not null default false,
  activo boolean not null default true,
  creado_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists envios_estados_nombre_unico on :"schema".envios_estados (empresa_id, lower(btrim(nombre)));
create index if not exists envios_estados_orden_idx on :"schema".envios_estados (empresa_id, orden, nombre);

-- Choferes (lista propia simple).
create table if not exists :"schema".envios_choferes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  telefono text,
  documento text,
  activo boolean not null default true,
  creado_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists envios_choferes_empresa_idx on :"schema".envios_choferes (empresa_id) where activo;

-- Un envío por venta (o manual). La dirección vive acá (la venta no la guarda).
create table if not exists :"schema".envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  venta_id uuid references :"schema".ventas(id) on delete set null,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  cliente_nombre text,
  numero text,                      -- numero_control de la venta (snapshot)
  direccion text,
  referencia text,
  telefono text,
  estado_id uuid not null references :"schema".envios_estados(id) on delete restrict,
  chofer_id uuid references :"schema".envios_choferes(id) on delete set null,
  total numeric(16,0) not null default 0,
  cobro_estado text not null default 'na' check (cobro_estado in ('na', 'pendiente', 'cobrado')),
  notas text,
  creado_at timestamptz not null default now(),
  creado_por uuid references :"schema".usuarios(id) on delete set null,
  entregado_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists envios_venta_unico on :"schema".envios (venta_id) where venta_id is not null;
create index if not exists envios_empresa_estado_idx on :"schema".envios (empresa_id, estado_id);
create index if not exists envios_chofer_idx on :"schema".envios (empresa_id, chofer_id) where chofer_id is not null;

-- RLS: tablas de envíos solo las escriben funciones security definer (dueño erp_funciones).
do $do$
declare
  t text;
begin
  foreach t in array array['envios_estados', 'envios_choferes', 'envios'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

do $do$
declare
  t text;
begin
  foreach t in array array['envios_estados', 'envios_choferes', 'envios'] loop
    execute format($p$drop policy if exists %1$s_empresa on %1$I$p$, t);
    execute format($p$create policy %1$s_empresa on %1$I using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())$p$, t);
  end loop;
end;
$do$;

-- =============================================================================
-- 3. Permisos y pantallas
-- =============================================================================
do $do$
declare
  v_def text := pg_get_functiondef('permisos_catalogo()'::regprocedure);
  v_ultimo text := $a$('comedor_administrar',        'Comedor: funcionarios, menús, empresas y liquidación', 'Comedor')$a$;
begin
  if position('envios_operar' in v_def) = 0 then
    if position(v_ultimo in v_def) = 0 then raise exception 'Receta 170: permisos_catalogo no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ultimo, v_ultimo || $b$,
    ('envios_operar',              'Envíos: crear, mover y asignar chofer',         'Envíos'),
    ('envios_administrar',         'Envíos: configurar estados y choferes',         'Envíos')$b$);
  end if;
end;
$do$;

-- Siembra los 5 estados por defecto la primera vez (idempotente: solo si la empresa no tiene ninguno).
create or replace function :"schema".envios_estados_seed(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if exists (select 1 from envios_estados where empresa_id = p_empresa) then return; end if;
  insert into envios_estados (empresa_id, nombre, color, orden, es_inicial, es_final) values
    (p_empresa, 'Pendiente',  '#64748b', 1, true,  false),
    (p_empresa, 'Preparando', '#f59e0b', 2, false, false),
    (p_empresa, 'En camino',  '#3b82f6', 3, false, false),
    (p_empresa, 'Entregado',  '#10b981', 4, false, true),
    (p_empresa, 'Cancelado',  '#ef4444', 5, false, true);
end;
$fn$;

-- Al prender Envíos: Supervisor, Cajero y Vendedor operan el tablero.
create or replace function :"schema".rubro_dar_envios(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(array['/caja/envios']) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso)
  select pf.id, pf.empresa_id, 'envios_operar'
    from perfiles pf
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
  perform envios_estados_seed(p_empresa);
end;
$fn$;

-- =============================================================================
-- 4. Gate de sesión y siembra de estados por defecto
-- =============================================================================
create or replace function :"schema".envios_sesion(p_permiso text,
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_rol text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  perform exigir_permiso(p_permiso);
  if not funcion_activa(s.s_empresa, 'envios') then
    raise exception 'Los envíos no están activos en tu empresa' using errcode = '42501';
  end if;
  s_empresa := s.s_empresa; s_usuario := s.s_usuario; s_nombre := s.s_nombre; s_rol := s.s_rol;
end;
$fn$;

-- =============================================================================
-- 5. ABM de estados (configuración) — permiso envios_administrar
-- =============================================================================
create or replace function :"schema".envios_estados_listar()
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_administrar');
  perform envios_estados_seed(s.s_empresa);
  return jsonb_build_object('estados', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nombre', e.nombre, 'color', e.color, 'orden', e.orden,
      'es_inicial', e.es_inicial, 'es_final', e.es_final, 'activo', e.activo,
      'usado', exists (select 1 from envios x where x.estado_id = e.id))
      order by e.orden, e.nombre)
    from envios_estados e where e.empresa_id = s.s_empresa), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".envio_estado_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_color text := nullif(btrim(coalesce(p->>'color', '')), '');
  v_orden integer := coalesce(nullif(p->>'orden', '')::integer, 0);
  v_inicial boolean := coalesce((p->>'es_inicial')::boolean, false);
  v_final boolean := coalesce((p->>'es_final')::boolean, false);
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
  r envios_estados;
begin
  select * into s from envios_sesion('envios_administrar');
  if v_nombre is null then raise exception 'Escribí el nombre del estado (ej. Pendiente, En camino)'; end if;
  if length(v_nombre) > 40 then raise exception 'El nombre del estado es muy largo (hasta 40 letras)'; end if;
  if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color inválido'; end if;
  if v_orden < 0 or v_orden > 100000 then raise exception 'Orden inválido'; end if;
  if v_inicial and v_final then raise exception 'Un estado no puede ser inicial y final a la vez'; end if;
  if exists (select 1 from envios_estados where empresa_id = s.s_empresa and lower(btrim(nombre)) = lower(v_nombre)
               and id is distinct from v_id) then
    raise exception 'Ya hay un estado "%"', v_nombre;
  end if;
  -- Un estado inicial no puede quedar inactivo (es la columna donde cae todo).
  if v_inicial and not v_activo then raise exception 'El estado inicial tiene que estar activo'; end if;

  if v_id is null then
    insert into envios_estados (empresa_id, nombre, color, orden, es_inicial, es_final, activo)
      values (s.s_empresa, v_nombre, v_color, v_orden, v_inicial, v_final, v_activo) returning * into r;
  else
    update envios_estados set nombre = v_nombre, color = v_color, orden = v_orden,
           es_inicial = v_inicial, es_final = v_final, activo = v_activo, updated_at = now()
     where id = v_id and empresa_id = s.s_empresa returning * into r;
    if not found then raise exception 'Estado no encontrado'; end if;
  end if;
  -- Exactamente un inicial: si este quedó inicial, los demás dejan de serlo.
  if v_inicial then
    update envios_estados set es_inicial = false, updated_at = now()
     where empresa_id = s.s_empresa and id <> r.id and es_inicial;
  end if;
  -- Siempre tiene que quedar al menos un inicial activo.
  if not exists (select 1 from envios_estados where empresa_id = s.s_empresa and es_inicial and activo) then
    raise exception 'Tiene que haber un estado inicial activo (marcá uno como "inicial")';
  end if;
  return jsonb_build_object('id', r.id);
end;
$fn$;

create or replace function :"schema".envio_estado_eliminar(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r envios_estados;
begin
  select * into s from envios_sesion('envios_administrar');
  select * into r from envios_estados where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Estado no encontrado'; end if;
  if exists (select 1 from envios x where x.estado_id = p_id) then
    raise exception 'El estado ya tiene envíos: desactivalo en lugar de eliminarlo';
  end if;
  if r.es_inicial then raise exception 'No se puede eliminar el estado inicial'; end if;
  if (select count(*) from envios_estados where empresa_id = s.s_empresa) <= 1 then
    raise exception 'Tiene que quedar al menos un estado';
  end if;
  delete from envios_estados where id = p_id and empresa_id = s.s_empresa;
end;
$fn$;

-- =============================================================================
-- 6. ABM de choferes — permiso envios_administrar
-- =============================================================================
create or replace function :"schema".envios_choferes_listar()
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_administrar');
  return jsonb_build_object('choferes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'telefono', c.telefono, 'documento', c.documento, 'activo', c.activo,
      'usado', exists (select 1 from envios x where x.chofer_id = c.id))
      order by c.activo desc, c.nombre)
    from envios_choferes c where c.empresa_id = s.s_empresa), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".envio_chofer_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_tel text := nullif(btrim(coalesce(p->>'telefono', '')), '');
  v_doc text := nullif(btrim(coalesce(p->>'documento', '')), '');
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
  r envios_choferes;
begin
  select * into s from envios_sesion('envios_administrar');
  if v_nombre is null then raise exception 'Escribí el nombre del chofer'; end if;
  if length(v_nombre) > 120 then raise exception 'El nombre del chofer es muy largo'; end if;
  if v_tel is not null and length(v_tel) > 40 then raise exception 'Teléfono inválido'; end if;
  if v_doc is not null and length(v_doc) > 40 then raise exception 'Documento inválido'; end if;
  if v_id is null then
    insert into envios_choferes (empresa_id, nombre, telefono, documento, activo)
      values (s.s_empresa, v_nombre, v_tel, v_doc, v_activo) returning * into r;
  else
    update envios_choferes set nombre = v_nombre, telefono = v_tel, documento = v_doc, activo = v_activo, updated_at = now()
     where id = v_id and empresa_id = s.s_empresa returning * into r;
    if not found then raise exception 'Chofer no encontrado'; end if;
  end if;
  return jsonb_build_object('id', r.id);
end;
$fn$;

create or replace function :"schema".envio_chofer_eliminar(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_administrar');
  if not exists (select 1 from envios_choferes where id = p_id and empresa_id = s.s_empresa) then
    raise exception 'Chofer no encontrado';
  end if;
  if exists (select 1 from envios x where x.chofer_id = p_id) then
    raise exception 'El chofer ya tiene envíos asignados: desactivalo en lugar de eliminarlo';
  end if;
  delete from envios_choferes where id = p_id and empresa_id = s.s_empresa;
end;
$fn$;

-- =============================================================================
-- 7. Tablero y operación — permiso envios_operar
-- =============================================================================
-- Devuelve estados activos (columnas), choferes activos y los envíos del tablero (no finales, más
-- los finales de las últimas 24 h para ver lo recién entregado).
-- Volatile (no stable): siembra estados por defecto la 1ª vez y luego los lee en la misma llamada.
create or replace function :"schema".envios_tablero()
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_operar');
  perform envios_estados_seed(s.s_empresa);
  return jsonb_build_object(
    'estados', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nombre', e.nombre, 'color', e.color, 'orden', e.orden, 'es_inicial', e.es_inicial, 'es_final', e.es_final)
        order by e.orden, e.nombre)
      from envios_estados e where e.empresa_id = s.s_empresa and e.activo), '[]'::jsonb),
    'choferes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono)
        order by c.nombre)
      from envios_choferes c where c.empresa_id = s.s_empresa and c.activo), '[]'::jsonb),
    'envios', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'numero', v.numero, 'cliente_nombre', v.cliente_nombre, 'direccion', v.direccion,
        'referencia', v.referencia, 'telefono', v.telefono, 'estado_id', v.estado_id, 'chofer_id', v.chofer_id,
        'total', v.total, 'cobro_estado', v.cobro_estado, 'notas', v.notas,
        'creado_at', v.creado_at, 'entregado_at', v.entregado_at)
        order by v.creado_at)
      from envios v join envios_estados e on e.id = v.estado_id
     where v.empresa_id = s.s_empresa
       and (not e.es_final or v.entregado_at >= now() - interval '24 hours')), '[]'::jsonb));
end;
$fn$;

-- Crea un envío desde una venta (lo llama la caja tras cobrar, si es "envío a domicilio").
-- Idempotente por venta. Prellena nombre/dirección/teléfono del cliente si no vienen.
create or replace function :"schema".envio_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_venta uuid := nullif(p->>'venta_id', '')::uuid;
  v_chofer uuid := nullif(p->>'chofer_id', '')::uuid;
  vta record;
  cli record;
  v_estado uuid;
  v_id uuid;
begin
  select * into s from envios_sesion('envios_operar');
  perform envios_estados_seed(s.s_empresa);
  if v_venta is null then raise exception 'Falta la venta del envío'; end if;
  select id, cliente_id, numero_control, total into vta
    from ventas where id = v_venta and empresa_id = s.s_empresa;
  if not found then raise exception 'Venta no encontrada'; end if;
  -- Idempotente: si la venta ya tiene envío, lo devuelve.
  select id into v_id from envios where venta_id = v_venta;
  if found then return jsonb_build_object('id', v_id, 'reusado', true); end if;

  select id into v_estado from envios_estados
   where empresa_id = s.s_empresa and es_inicial and activo order by orden limit 1;
  if v_estado is null then raise exception 'No hay un estado inicial configurado'; end if;
  if v_chofer is not null and not exists (select 1 from envios_choferes where id = v_chofer and empresa_id = s.s_empresa) then
    raise exception 'Chofer no encontrado';
  end if;

  select nombre, direccion, telefono into cli from clientes where id = vta.cliente_id and empresa_id = s.s_empresa;

  insert into envios (empresa_id, venta_id, cliente_id, cliente_nombre, numero, direccion, referencia, telefono,
                      estado_id, chofer_id, total, cobro_estado, creado_por)
    values (s.s_empresa, vta.id, vta.cliente_id, coalesce(cli.nombre, 'Consumidor final'), vta.numero_control,
            coalesce(nullif(btrim(coalesce(p->>'direccion', '')), ''), cli.direccion),
            nullif(btrim(coalesce(p->>'referencia', '')), ''),
            coalesce(nullif(btrim(coalesce(p->>'telefono', '')), ''), cli.telefono),
            v_estado, v_chofer, coalesce(vta.total, 0), 'na', s.s_usuario)
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- Mueve un envío de estado (al entrar a un estado final se marca la hora de entrega).
create or replace function :"schema".envio_mover(p_id uuid, p_estado_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_final boolean;
begin
  select * into s from envios_sesion('envios_operar');
  select es_final into v_final from envios_estados where id = p_estado_id and empresa_id = s.s_empresa and activo;
  if not found then raise exception 'Estado no encontrado'; end if;
  update envios set estado_id = p_estado_id,
         entregado_at = case when v_final then coalesce(entregado_at, now()) else null end,
         updated_at = now()
   where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Envío no encontrado'; end if;
  return jsonb_build_object('id', p_id, 'estado_id', p_estado_id);
end;
$fn$;

-- Asigna (o quita) el chofer de un envío.
create or replace function :"schema".envio_asignar_chofer(p_id uuid, p_chofer_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_operar');
  if p_chofer_id is not null and not exists (select 1 from envios_choferes where id = p_chofer_id and empresa_id = s.s_empresa) then
    raise exception 'Chofer no encontrado';
  end if;
  update envios set chofer_id = p_chofer_id, updated_at = now() where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Envío no encontrado'; end if;
  return jsonb_build_object('id', p_id, 'chofer_id', p_chofer_id);
end;
$fn$;

-- Edita datos del envío (dirección, referencia, teléfono, notas).
create or replace function :"schema".envio_editar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  select * into s from envios_sesion('envios_operar');
  if v_id is null then raise exception 'Falta el envío'; end if;
  update envios set
      direccion = nullif(btrim(coalesce(p->>'direccion', '')), ''),
      referencia = nullif(btrim(coalesce(p->>'referencia', '')), ''),
      telefono = nullif(btrim(coalesce(p->>'telefono', '')), ''),
      notas = left(nullif(btrim(coalesce(p->>'notas', '')), ''), 500),
      updated_at = now()
   where id = v_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Envío no encontrado'; end if;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- =============================================================================
-- 8. Seguridad: permisos de ejecución (receta 112)
-- =============================================================================
do $do$
declare
  f text;
begin
  -- Internas (solo el servidor / otras funciones).
  foreach f in array array['rubro_dar_envios(uuid)', 'envios_estados_seed(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Con sesión (cada una exige la función Envíos prendida y su permiso).
  foreach f in array array['envios_sesion(text)', 'envios_estados_listar()', 'envio_estado_guardar(jsonb)',
                           'envio_estado_eliminar(uuid)', 'envios_choferes_listar()', 'envio_chofer_guardar(jsonb)',
                           'envio_chofer_eliminar(uuid)', 'envios_tablero()', 'envio_crear(jsonb)',
                           'envio_mover(uuid,uuid)', 'envio_asignar_chofer(uuid,uuid)', 'envio_editar(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

-- Empresas que ya tengan Envíos prendido (re-aplicación): pantallas/permisos + estados por defecto.
do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where envios loop
    perform rubro_dar_envios(r.empresa_id);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
