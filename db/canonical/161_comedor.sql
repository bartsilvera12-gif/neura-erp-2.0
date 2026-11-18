-- =============================================================================
-- COMEDOR EMPRESARIAL (proyecto Kingspan, 6-nov-2026). Comedor tercerizado dentro de una
-- empresa: el comedor (usuario del ERP) planifica menús, el funcionario reserva y retira, y a
-- fin de mes se liquida a la empresa contratante. El funcionario no paga en caja: cada consumo
-- queda en su cuenta, con un subsidio mensual no acumulable.
--
--   · Rubro y funciones: función nueva `comedor` (empresa_funciones.comedor). Es un interruptor
--     INDEPENDIENTE del rubro (como `pedidos`): no cambia el rubro mostrado y NO se siembra en
--     ningún rubro. Se enciende por datos solo donde se la necesita (hoy, erp_kingspan):
--         update empresa_funciones set comedor = true;   -- corrido contra ese schema
--   · Funcionario = cliente (ficha única, como pide el instructivo): clientes.es_funcionario +
--     clientes.comedor_empresa_id. CI = clientes.documento (ya es único por empresa), estado =
--     clientes.activo. El padrón se importa de Excel y se escribe por el camino normal de clientes.
--   · Empresa contratante (comedor_empresas): hoy una (Kingspan MV Aceros), modelo listo para más.
--     Define el subsidio mensual (default Gs 350.000) y el horario de cierre de reservas.
--   · Consumos (comedor_consumos): ledger económico de almuerzos (retiro) y cantina. Guarda el
--     reparto subsidio / excedente / diferencia de menú especial. Único (funcionario, fecha) para
--     almuerzo → no dos almuerzos el mismo día. El saldo del subsidio se calcula de acá por período
--     mensual (no se arrastra). El subsidio cubre almuerzo + cantina (decisión del dueño).
--
-- Esta receta (161) = base + padrón (Fase 1): función, tablas, config de empresa y listados.
-- Menú semanal/reserva, retiro y liquidación vienen en recetas siguientes (162+). IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Función "comedor" en Rubro y funciones (interruptor independiente, como pedidos)
-- =============================================================================
alter table :"schema".empresa_funciones add column if not exists comedor boolean not null default false;

do $do$
declare
  v_def text;
begin
  -- funcion_activa: rama comedor (antes de la de pedidos).
  v_def := pg_get_functiondef('funcion_activa(uuid,text)'::regprocedure);
  if position('-- 161: comedor' in v_def) = 0 then
    if position($a$when p_funcion = 'pedidos' then$a$ in v_def) = 0 then raise exception 'Receta 161: funcion_activa no tiene el patrón esperado'; end if;
    execute replace(v_def, $a$when p_funcion = 'pedidos' then$a$,
      $b$when p_funcion = 'comedor' then coalesce((select f.comedor from empresa_funciones f where f.empresa_id = p_empresa), false) -- 161: comedor
    when p_funcion = 'pedidos' then$b$);
  end if;

  -- funciones_empresa: agrega 'comedor' al jsonb (NO toca el rubro: es independiente).
  v_def := pg_get_functiondef('funciones_empresa()'::regprocedure);
  if position('-- 161: comedor' in v_def) = 0 then
    if position($a$'gimnasio', coalesce(f.gimnasio, false),$a$ in v_def) = 0 then raise exception 'Receta 161: funciones_empresa no tiene el patrón esperado'; end if;
    v_def := replace(v_def, $a$'gimnasio', coalesce(f.gimnasio, false),$a$,
      $b$'gimnasio', coalesce(f.gimnasio, false),
    'comedor', coalesce(f.comedor, false), -- 161: comedor$b$);
    execute v_def;
  end if;
  -- guardar_funciones_empresa NO se parchea: su UPDATE no toca `comedor`, así que sobrevive a
  -- cualquier cambio de rubro desde la pantalla. Se enciende solo por SQL (Neura).
end;
$do$;

-- =============================================================================
-- 2. Tablas
-- =============================================================================

-- Empresa(s) contratante(s). Hoy una (Kingspan MV Aceros); el modelo soporta varias.
create table if not exists :"schema".comedor_empresas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 160),
  ruc text,
  subsidio_mensual numeric(16,0) not null default 350000 check (subsidio_mensual >= 0),
  cierre_dia smallint check (cierre_dia is null or cierre_dia between 0 and 6), -- 0=domingo … 6=sábado
  cierre_hora time,
  activa boolean not null default true,
  creado_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);
create index if not exists comedor_empresas_empresa_idx on :"schema".comedor_empresas (empresa_id);

-- Funcionario = cliente. CI = documento (único por empresa), estado = activo.
alter table :"schema".clientes add column if not exists es_funcionario boolean not null default false;
alter table :"schema".clientes add column if not exists comedor_empresa_id uuid;
do $do$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'clientes_comedor_empresa_fk' and conrelid = 'clientes'::regclass
  ) then
    alter table clientes
      add constraint clientes_comedor_empresa_fk
      foreign key (comedor_empresa_id) references comedor_empresas(id) on delete set null;
  end if;
end;
$do$;
create index if not exists clientes_funcionario_idx on :"schema".clientes (empresa_id) where es_funcionario;

-- Ledger de consumos (almuerzo retiro + cantina). El saldo del subsidio se calcula de acá por período.
create table if not exists :"schema".comedor_consumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  funcionario_id uuid not null references :"schema".clientes(id) on delete restrict,
  comedor_empresa_id uuid references :"schema".comedor_empresas(id) on delete set null,
  fecha date not null,
  periodo date not null, -- primer día del mes (date_trunc('month', fecha))
  concepto text not null check (concepto in ('almuerzo', 'cantina', 'ajuste')),
  producto_id uuid references :"schema".productos(id) on delete set null,
  cantidad numeric(16,3) not null default 1 check (cantidad > 0),
  es_especial boolean not null default false,
  precio_habitual numeric(16,0) not null default 0 check (precio_habitual >= 0),
  precio_especial numeric(16,0) not null default 0 check (precio_especial >= 0),
  subsidio_aplicado numeric(16,0) not null default 0 check (subsidio_aplicado >= 0),
  excedente numeric(16,0) not null default 0 check (excedente >= 0),
  diferencia_especial numeric(16,0) not null default 0 check (diferencia_especial >= 0),
  costo numeric(16,0) not null default 0,
  operador_usuario_id uuid references :"schema".usuarios(id) on delete set null,
  hora timestamptz not null default now(),
  medio_identificacion text,
  anulado_at timestamptz,
  anulado_por uuid references :"schema".usuarios(id) on delete set null,
  motivo text,
  creado_at timestamptz not null default now()
);
-- No dos almuerzos del mismo funcionario el mismo día (R03).
create unique index if not exists comedor_consumos_almuerzo_unico
  on :"schema".comedor_consumos (funcionario_id, fecha)
  where concepto = 'almuerzo' and anulado_at is null;
create index if not exists comedor_consumos_periodo_idx
  on :"schema".comedor_consumos (empresa_id, funcionario_id, periodo) where anulado_at is null;
create index if not exists comedor_consumos_fecha_idx on :"schema".comedor_consumos (empresa_id, fecha);

-- RLS: tablas de comedor solo las escriben funciones security definer (dueño erp_funciones).
do $do$
declare
  t text;
begin
  foreach t in array array['comedor_empresas', 'comedor_consumos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- RLS por empresa (las funciones corren como definer, pero igual dejamos la política por prolijidad).
do $do$
declare
  t text;
begin
  foreach t in array array['comedor_empresas', 'comedor_consumos'] loop
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
  v_ultimo text := $a$('gimnasio_administrar',       'Administrar clases, precios y comisiones',      'Asistencia')$a$;
begin
  if position('comedor_administrar' in v_def) = 0 then
    if position(v_ultimo in v_def) = 0 then raise exception 'Receta 161: permisos_catalogo no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ultimo, v_ultimo || $b$,
    ('comedor_recepcion',          'Comedor: confirmar retiros y cargar cantina',   'Comedor'),
    ('comedor_administrar',        'Comedor: funcionarios, menús, empresas y liquidación', 'Comedor')$b$);
  end if;
end;
$do$;

-- Al prender Comedor: Supervisor, Cajero y Vendedor atienden el retiro/cantina.
create or replace function :"schema".rubro_dar_comedor(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(array['/comedor/funcionarios']) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso)
  select pf.id, pf.empresa_id, 'comedor_recepcion'
    from perfiles pf
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
end;
$fn$;

-- =============================================================================
-- 4. Ayudantes y gate de sesión
-- =============================================================================
create or replace function :"schema".comedor_sesion(p_permiso text,
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_rol text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  perform exigir_permiso(p_permiso);
  if not funcion_activa(s.s_empresa, 'comedor') then
    raise exception 'El comedor no está activo en tu empresa' using errcode = '42501';
  end if;
  s_empresa := s.s_empresa; s_usuario := s.s_usuario; s_nombre := s.s_nombre; s_rol := s.s_rol;
end;
$fn$;

create or replace function :"schema".comedor_hoy() returns date
language sql stable set search_path = :"schema", public as $fn$
  select (now() at time zone 'America/Asuncion')::date
$fn$;

create or replace function :"schema".comedor_periodo(p_fecha date) returns date
language sql immutable set search_path = :"schema", public as $fn$
  select date_trunc('month', p_fecha)::date
$fn$;

-- Saldo del subsidio del período (no acumulable).
create or replace function :"schema".comedor_saldo(p_funcionario uuid, p_periodo date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid;
  v_subsidio numeric;
  v_consumido numeric;
  v_excedente numeric;
  v_periodo date := comedor_periodo(coalesce(p_periodo, comedor_hoy()));
begin
  select s_empresa into v_emp from inv_sesion();
  select coalesce(ce.subsidio_mensual, 350000) into v_subsidio
    from clientes c
    left join comedor_empresas ce on ce.id = c.comedor_empresa_id
   where c.id = p_funcionario and c.empresa_id = v_emp;
  v_subsidio := coalesce(v_subsidio, 350000);
  select coalesce(sum(subsidio_aplicado), 0), coalesce(sum(excedente), 0)
    into v_consumido, v_excedente
    from comedor_consumos
   where funcionario_id = p_funcionario and empresa_id = v_emp and periodo = v_periodo and anulado_at is null;
  return jsonb_build_object(
    'periodo', v_periodo,
    'subsidio', v_subsidio,
    'consumido', v_consumido,
    'disponible', greatest(v_subsidio - v_consumido, 0),
    'excedente', v_excedente
  );
end;
$fn$;

-- =============================================================================
-- 5. Empresas contratantes (config)
-- =============================================================================
create or replace function :"schema".comedor_empresas_listar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from comedor_sesion('comedor_administrar');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nombre', e.nombre, 'ruc', e.ruc, 'subsidio_mensual', e.subsidio_mensual,
      'cierre_dia', e.cierre_dia, 'cierre_hora', to_char(e.cierre_hora, 'HH24:MI'), 'activa', e.activa,
      'funcionarios', (select count(*) from clientes c where c.comedor_empresa_id = e.id and c.es_funcionario and c.activo)
    ) order by e.nombre)
    from comedor_empresas e where e.empresa_id = s.s_empresa
  ), '[]'::jsonb);
end;
$fn$;

create or replace function :"schema".comedor_empresa_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := trim(coalesce(p->>'nombre', ''));
  v_ruc text := nullif(trim(coalesce(p->>'ruc', '')), '');
  v_subsidio numeric := coalesce((p->>'subsidio_mensual')::numeric, 350000);
  v_dia smallint := nullif(p->>'cierre_dia', '')::smallint;
  v_hora time := nullif(p->>'cierre_hora', '')::time;
  v_activa boolean := coalesce((p->>'activa')::boolean, true);
begin
  select * into s from comedor_sesion('comedor_administrar');
  if length(v_nombre) < 1 then raise exception 'Falta el nombre de la empresa'; end if;
  if v_subsidio < 0 then raise exception 'El subsidio no puede ser negativo'; end if;
  if v_id is null then
    insert into comedor_empresas (empresa_id, nombre, ruc, subsidio_mensual, cierre_dia, cierre_hora, activa, updated_by)
    values (s.s_empresa, v_nombre, v_ruc, v_subsidio, v_dia, v_hora, v_activa, s.s_usuario)
    returning id into v_id;
  else
    update comedor_empresas
       set nombre = v_nombre, ruc = v_ruc, subsidio_mensual = v_subsidio, cierre_dia = v_dia,
           cierre_hora = v_hora, activa = v_activa, updated_at = now(), updated_by = s.s_usuario
     where id = v_id and empresa_id = s.s_empresa;
    if not found then raise exception 'Empresa no encontrada'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- =============================================================================
-- 6. Funcionarios (listado con empresa y saldo del mes; el alta/edición va por el camino de clientes)
-- =============================================================================
create or replace function :"schema".comedor_funcionarios_listar(
  p_busqueda text default null, p_empresa uuid default null, p_estado text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_periodo date := comedor_periodo(comedor_hoy());
  v_total integer;
  v_rows jsonb;
begin
  select * into s from comedor_sesion('comedor_administrar');

  -- Una sola pasada: `base` (los funcionarios que filtran) se computa una vez (materialized) y se
  -- usa para el total y para la página. El consumido del mes se calcula SOLO en las filas visibles.
  with base as materialized (
    select c.id, c.nombre, c.documento, c.activo, c.comedor_empresa_id, ce.nombre as empresa_nombre,
           coalesce(ce.subsidio_mensual, 350000) as subsidio
      from clientes c
      left join comedor_empresas ce on ce.id = c.comedor_empresa_id
     where c.empresa_id = s.s_empresa and c.es_funcionario
       and (p_empresa is null or c.comedor_empresa_id = p_empresa)
       and (p_estado is null or (p_estado = 'activos' and c.activo) or (p_estado = 'inactivos' and not c.activo))
       and (p_busqueda is null or p_busqueda = '' or c.nombre ilike '%' || p_busqueda || '%'
            or regexp_replace(coalesce(c.documento, ''), '\D', '', 'g') like '%' || regexp_replace(p_busqueda, '\D', '', 'g') || '%')
  ), pagina as (
    select q.*,
           coalesce((select sum(cc.subsidio_aplicado) from comedor_consumos cc
                      where cc.funcionario_id = q.id and cc.periodo = v_periodo and cc.anulado_at is null), 0) as consumido
      from (select * from base order by nombre limit greatest(p_limit, 0) offset greatest(p_offset, 0)) q
  )
  select
    (select count(*) from base),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'documento', documento, 'activo', activo,
        'empresa_id', comedor_empresa_id, 'empresa_nombre', empresa_nombre,
        'subsidio', subsidio, 'consumido', consumido, 'disponible', greatest(subsidio - consumido, 0)
      ) order by nombre)
      from pagina
    ), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'periodo', v_periodo);
end;
$fn$;

-- =============================================================================
-- 7. Seguridad: permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  -- Internas (solo el servidor / otras funciones).
  foreach f in array array['rubro_dar_comedor(uuid)', 'comedor_periodo(date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Con sesión (cada una exige la función Comedor prendida y su permiso).
  foreach f in array array['comedor_sesion(text)', 'comedor_hoy()', 'comedor_saldo(uuid,date)',
                           'comedor_empresas_listar()', 'comedor_empresa_guardar(jsonb)',
                           'comedor_funcionarios_listar(text,uuid,text,integer,integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

-- Empresas que ya tengan Comedor prendido (re-aplicación): pantallas/permisos a los perfiles.
do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where comedor loop
    perform rubro_dar_comedor(r.empresa_id);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
