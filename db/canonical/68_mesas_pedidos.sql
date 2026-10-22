-- =============================================================================
-- MESAS CON QR Y PEDIDOS (pedido del dueño, 22-oct-2026).
--
-- Cada mesa tiene un QR que abre el menú (/m/<token>). El cliente arma una solicitud de pedido
-- desde el celular; llega a la caja, que la acepta o la rechaza (con motivo). Los aceptados se
-- suman a la CUENTA ABIERTA de la mesa; cocina los ve y los marca "en preparación" / "listo";
-- al final la caja cobra todo junto como una venta normal (crear_venta, receta 67).
--
-- Tablas
--   · mesas              sucursal, nombre, zona (opcional), token (64 hex, único, regenerable),
--                        activa, orden.
--   · mesa_cuentas       cuenta de una mesa: abierta → cerrada (con venta_id) o anulada (se
--                        liberó sin nada que cobrar). Una sola abierta por mesa.
--   · mesa_pedidos       solicitud del cliente: nuevo → aceptado → en_preparacion → listo →
--                        entregado; o rechazado (con motivo). `seguimiento` (32 hex) es lo único
--                        que el celular conoce para consultar el estado (no hay ids expuestos).
--   · mesa_pedido_items  producto, cantidad y precio_unitario tomado del producto EN EL SERVIDOR
--                        (precio de lista con el descuento del producto, igual que la caja).
--   · productos.en_menu_qr  el producto sale en el menú QR (Inventario › producto).
--
-- Permisos (catálogo de 55 + 2 nuevos, también en src/modules/usuarios/permisos.ts):
--   · pedidos_mesas  "Atender pedidos de mesas": aceptar / rechazar pedidos y cobrar cuentas.
--   · cocina         "Pantalla de cocina": ver los pedidos aceptados y marcarlos en preparación / listos.
--   · ABM de mesas: nivel ADMIN + "Configuración del sistema" (como el resto de Configuración).
--   El Administrador los tiene siempre; a los demás perfiles se les dan en Configuración › Usuarios.
--
-- Seguridad
--   · RLS por empresa_actual(); a `authenticated` solo SELECT. Toda escritura va por funciones
--     SECURITY DEFINER con search_path fijo que validan empresa, permiso y alcance de sucursal.
--   · Público (anon): mesa_menu_publico, mesa_pedido_publico_crear y mesa_pedidos_publico_estado.
--     Solo por token de mesa; devuelven únicamente lo que el cliente debe ver. Precios y totales
--     salen siempre de la base. Límites: 30 líneas, 1–50 unidades por línea, 4 pedidos por mesa por
--     minuto y 6 pedidos sin atender por mesa a la vez.
--
-- IDEMPOTENTE. Va después de 67 (usa crear_venta de 14 parámetros). Redefine permisos_catalogo()
-- de 55: si se vuelve a correr 55 o 56, correr 68 después.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
alter table :"schema".productos add column if not exists en_menu_qr boolean not null default false;
create index if not exists productos_menu_qr_idx on :"schema".productos (empresa_id) where en_menu_qr;

create table if not exists :"schema".mesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sucursal_id uuid not null references :"schema".sucursales(id) on delete restrict,
  nombre text not null,
  zona text,
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  activa boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_mesas_nombre check (length(btrim(nombre)) between 1 and 60),
  constraint chk_mesas_zona check (zona is null or length(btrim(zona)) between 1 and 60),
  constraint chk_mesas_token check (token ~ '^[0-9a-f]{64}$')
);
create unique index if not exists uq_mesas_token on :"schema".mesas (token);
create unique index if not exists uq_mesas_nombre on :"schema".mesas (empresa_id, sucursal_id, lower(btrim(nombre)));
create index if not exists mesas_emp_idx on :"schema".mesas (empresa_id, sucursal_id, orden, nombre);

create table if not exists :"schema".mesa_cuentas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  mesa_id uuid not null references :"schema".mesas(id) on delete cascade,
  estado text not null default 'abierta',
  abierta_at timestamptz not null default now(),
  cerrada_at timestamptz,
  cerrada_por uuid references :"schema".usuarios(id) on delete set null,
  venta_id uuid references :"schema".ventas(id) on delete set null,
  total numeric not null default 0,
  constraint chk_mesa_cuentas_estado check (estado in ('abierta', 'cerrada', 'anulada'))
);
create unique index if not exists uq_mesa_cuenta_abierta on :"schema".mesa_cuentas (mesa_id) where estado = 'abierta';
create index if not exists mesa_cuentas_emp_idx on :"schema".mesa_cuentas (empresa_id, estado, abierta_at);

create table if not exists :"schema".mesa_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cuenta_id uuid not null references :"schema".mesa_cuentas(id) on delete cascade,
  mesa_id uuid not null references :"schema".mesas(id) on delete cascade,
  numero bigint not null,
  estado text not null default 'nuevo',
  seguimiento text not null default replace(gen_random_uuid()::text, '-', ''),
  nombre_cliente text,
  nota text,
  total numeric not null default 0,
  creado_at timestamptz not null default now(),
  aceptado_at timestamptz,
  aceptado_por uuid references :"schema".usuarios(id) on delete set null,
  aceptado_por_nombre text,
  rechazado_at timestamptz,
  rechazado_por uuid references :"schema".usuarios(id) on delete set null,
  motivo_rechazo text,
  preparando_at timestamptz,
  listo_at timestamptz,
  entregado_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint chk_mesa_pedidos_estado check (estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo', 'entregado', 'rechazado')),
  constraint chk_mesa_pedidos_seg check (seguimiento ~ '^[0-9a-f]{32}$'),
  constraint chk_mesa_pedidos_nombre check (nombre_cliente is null or length(nombre_cliente) <= 60),
  constraint chk_mesa_pedidos_nota check (nota is null or length(nota) <= 500)
);
create unique index if not exists uq_mesa_pedidos_seg on :"schema".mesa_pedidos (seguimiento);
create index if not exists mesa_pedidos_estado_idx on :"schema".mesa_pedidos (empresa_id, estado, creado_at);
create index if not exists mesa_pedidos_cuenta_idx on :"schema".mesa_pedidos (cuenta_id);
create index if not exists mesa_pedidos_mesa_idx on :"schema".mesa_pedidos (mesa_id, creado_at desc);

create table if not exists :"schema".mesa_pedido_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  pedido_id uuid not null references :"schema".mesa_pedidos(id) on delete cascade,
  producto_id uuid references :"schema".productos(id) on delete set null,
  producto_nombre text not null,
  cantidad numeric not null,
  precio_unitario numeric not null,
  total numeric not null,
  nota text,
  constraint chk_mesa_item_cant check (cantidad > 0 and cantidad <= 50),
  constraint chk_mesa_item_precio check (precio_unitario > 0),
  constraint chk_mesa_item_nota check (nota is null or length(nota) <= 200)
);
create index if not exists mesa_pedido_items_ped_idx on :"schema".mesa_pedido_items (pedido_id);

-- ── RLS: solo lectura para la sesión del usuario ────────────────────────────
alter table :"schema".mesas enable row level security;
alter table :"schema".mesas force row level security;
alter table :"schema".mesa_cuentas enable row level security;
alter table :"schema".mesa_cuentas force row level security;
alter table :"schema".mesa_pedidos enable row level security;
alter table :"schema".mesa_pedidos force row level security;
alter table :"schema".mesa_pedido_items enable row level security;
alter table :"schema".mesa_pedido_items force row level security;

drop policy if exists mesas_propias on :"schema".mesas;
create policy mesas_propias on :"schema".mesas for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists mesa_cuentas_propias on :"schema".mesa_cuentas;
create policy mesa_cuentas_propias on :"schema".mesa_cuentas for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists mesa_pedidos_propios on :"schema".mesa_pedidos;
create policy mesa_pedidos_propios on :"schema".mesa_pedidos for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists mesa_pedido_items_propios on :"schema".mesa_pedido_items;
create policy mesa_pedido_items_propios on :"schema".mesa_pedido_items for select to authenticated
  using (empresa_id = :"schema".empresa_actual());

revoke all on :"schema".mesas, :"schema".mesa_cuentas, :"schema".mesa_pedidos, :"schema".mesa_pedido_items from anon, authenticated;
grant select on :"schema".mesas, :"schema".mesa_cuentas, :"schema".mesa_pedidos, :"schema".mesa_pedido_items to authenticated;
grant all on :"schema".mesas, :"schema".mesa_cuentas, :"schema".mesa_pedidos, :"schema".mesa_pedido_items to service_role;

-- =============================================================================
-- 2. Catálogo de permisos (55 + pedidos_mesas + cocina)
-- =============================================================================
create or replace function :"schema".permisos_catalogo()
returns table (codigo text, nombre text, grupo text)
language sql immutable set search_path = :"schema", public as $$
  values
    ('ver_costos',                 'Ver costos y márgenes',                         'Ventas y caja'),
    ('anular_ventas',              'Anular ventas',                                 'Ventas y caja'),
    ('anular_ventas_cerradas',     'Anular ventas de turnos cerrados',              'Ventas y caja'),
    ('descuentos_precio',          'Dar descuentos y cambiar precios en caja',      'Ventas y caja'),
    ('vender_credito',             'Vender a crédito',                              'Ventas y caja'),
    ('abrir_cerrar_caja',          'Abrir y cerrar caja',                           'Ventas y caja'),
    ('movimientos_caja',           'Retiros e ingresos de efectivo',                'Ventas y caja'),
    ('ver_cajas_otras_sucursales', 'Ver cajas de otras sucursales',                 'Ventas y caja'),
    ('pedidos_mesas',              'Atender pedidos de mesas',                      'Ventas y caja'),
    ('cocina',                     'Pantalla de cocina',                            'Ventas y caja'),
    ('registrar_cobros',           'Registrar cobros',                              'Cobranzas'),
    ('registrar_transferencias',   'Cargar transferencias para conciliar',          'Cobranzas'),
    ('aprobar_transferencias',     'Aprobar y rechazar transferencias',             'Cobranzas'),
    ('anular_cobros',              'Anular cobros',                                 'Cobranzas'),
    ('registrar_compras',          'Registrar compras',                             'Compras y gastos'),
    ('anular_compras',             'Anular compras',                                'Compras y gastos'),
    ('registrar_gastos',           'Registrar gastos',                              'Compras y gastos'),
    ('anular_gastos',              'Anular gastos',                                 'Compras y gastos'),
    ('pagar_proveedores',          'Pagar a proveedores',                           'Compras y gastos'),
    ('editar_productos',           'Crear y editar productos y precios',            'Inventario'),
    ('ajustes_inventario',         'Ajustes de inventario',                         'Inventario'),
    ('registrar_perdidas',         'Cargar pérdidas',                               'Inventario'),
    ('aprobar_perdidas',           'Aprobar ajustes y pérdidas',                    'Inventario'),
    ('crear_traslados',            'Crear y anular traslados',                      'Inventario'),
    ('recibir_traslados',          'Recibir traslados',                             'Inventario'),
    ('ver_cierres_caja',           'Ver cierres de caja',                           'Reportes'),
    ('ver_reportes_financieros',   'Ver reportes financieros',                      'Reportes'),
    ('exportar',                   'Exportar a Excel y PDF',                        'Reportes'),
    ('administrar_usuarios',       'Administrar usuarios y perfiles',               'Administración'),
    ('configuracion',              'Configuración del sistema',                     'Administración')
$$;

-- =============================================================================
-- 3. Helpers internos (no se le dan a nadie)
-- =============================================================================

-- Precio de un producto en el menú: el de lista con el descuento del producto (igual que la caja).
create or replace function :"schema".mesa_precio(p_precio numeric, p_desc numeric)
returns numeric language sql immutable as $$
  select round(coalesce(p_precio, 0) * (1 - greatest(0, least(coalesce(p_desc, 0), 100)) / 100.0))
$$;

-- Sesión que opera mesas: empresa, usuario, nombre y sucursal (null = todas).
create or replace function :"schema".mesa_sesion(
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_sucursal uuid, out s_todas boolean)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(null);
  s_empresa := s.s_empresa;
  s_usuario := s.s_usuario;
  s_nombre := s.s_nombre;
  s_todas := alcance_todas();
  s_sucursal := case when s_todas then null else coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) end;
end;
$fn$;

-- Un pedido como lo ven la caja y la cocina.
create or replace function :"schema".mesa_pedido_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'estado', p.estado, 'cuenta_id', p.cuenta_id,
    'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
    'sucursal', jsonb_build_object('id', s.id, 'nombre', s.nombre),
    'nombre_cliente', p.nombre_cliente, 'nota', p.nota, 'total', p.total,
    'creado_at', p.creado_at, 'aceptado_at', p.aceptado_at, 'aceptado_por_nombre', p.aceptado_por_nombre,
    'rechazado_at', p.rechazado_at, 'motivo_rechazo', p.motivo_rechazo,
    'preparando_at', p.preparando_at, 'listo_at', p.listo_at, 'entregado_at', p.entregado_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'nombre', i.producto_nombre, 'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
        'total', i.total, 'nota', i.nota) order by i.producto_nombre, i.id)
      from mesa_pedido_items i where i.pedido_id = p.id), '[]'::jsonb))
  from mesa_pedidos p
  join mesas m on m.id = p.mesa_id
  join sucursales s on s.id = m.sucursal_id
  where p.id = p_id
$$;

-- =============================================================================
-- 4. Configuración › Mesas (ADMIN + "Configuración del sistema")
-- =============================================================================
create or replace function :"schema".mesas_listar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  return jsonb_build_object(
    'mesas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'sucursal_id', m.sucursal_id, 'sucursal_nombre', su.nombre, 'nombre', m.nombre, 'zona', m.zona,
        'token', m.token, 'activa', m.activa, 'orden', m.orden,
        'cuenta_abierta', exists (select 1 from mesa_cuentas c where c.mesa_id = m.id and c.estado = 'abierta'))
        order by su.es_principal desc, su.nombre, m.orden, m.nombre)
      from mesas m join sucursales su on su.id = m.sucursal_id
      where m.empresa_id = s.s_empresa), '[]'::jsonb),
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre) order by su.es_principal desc, su.nombre)
      from sucursales su where su.empresa_id = s.s_empresa and su.activa), '[]'::jsonb),
    'empresa', (select coalesce(nullif(btrim(e.nombre_fantasia), ''), e.nombre) from empresas e where e.id = s.s_empresa));
end;
$fn$;

create or replace function :"schema".mesa_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_zona text := nullif(btrim(coalesce(p->>'zona', '')), '');
  v_activa boolean := coalesce((p->>'activa')::boolean, true);
  v_orden integer := coalesce(nullif(p->>'orden', '')::integer, 0);
  r mesas;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  if v_nombre is null then raise exception 'Escribí el nombre de la mesa (ej. Mesa 1, Barra)'; end if;
  if length(v_nombre) > 60 then raise exception 'El nombre de la mesa es muy largo (hasta 60 letras)'; end if;
  if v_zona is not null and length(v_zona) > 60 then raise exception 'La zona es muy larga (hasta 60 letras)'; end if;
  if v_orden < 0 or v_orden > 100000 then raise exception 'Orden inválido'; end if;
  if v_suc is null or not exists (select 1 from sucursales where id = v_suc and empresa_id = s.s_empresa) then
    raise exception 'Elegí la sucursal de la mesa';
  end if;
  if exists (select 1 from mesas where empresa_id = s.s_empresa and sucursal_id = v_suc
               and lower(btrim(nombre)) = lower(v_nombre) and id is distinct from v_id) then
    raise exception 'Ya hay una mesa "%" en esa sucursal', v_nombre;
  end if;

  if v_id is null then
    insert into mesas (empresa_id, sucursal_id, nombre, zona, activa, orden)
      values (s.s_empresa, v_suc, v_nombre, v_zona, v_activa, v_orden)
      returning * into r;
  else
    select * into r from mesas where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Mesa no encontrada'; end if;
    if r.sucursal_id <> v_suc and exists (select 1 from mesa_cuentas where mesa_id = r.id and estado = 'abierta') then
      raise exception 'La mesa tiene una cuenta abierta: cobrala antes de cambiarla de sucursal';
    end if;
    update mesas set sucursal_id = v_suc, nombre = v_nombre, zona = v_zona, activa = v_activa, orden = v_orden, updated_at = now()
      where id = r.id returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'token', r.token);
end;
$fn$;

create or replace function :"schema".mesa_regenerar_token(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_token text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  update mesas set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), updated_at = now()
    where id = p_id and empresa_id = s.s_empresa returning token into v_token;
  if v_token is null then raise exception 'Mesa no encontrada'; end if;
  return jsonb_build_object('id', p_id, 'token', v_token);
end;
$fn$;

create or replace function :"schema".mesa_eliminar(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  if not exists (select 1 from mesas where id = p_id and empresa_id = s.s_empresa) then raise exception 'Mesa no encontrada'; end if;
  if exists (select 1 from mesa_cuentas where mesa_id = p_id) then
    raise exception 'La mesa ya tiene pedidos en su historial: desactivala en lugar de eliminarla';
  end if;
  delete from mesas where id = p_id and empresa_id = s.s_empresa;
end;
$fn$;

-- =============================================================================
-- 5. Caja y cocina: tablero (pedidos activos + cuentas abiertas)
-- =============================================================================
create or replace function :"schema".mesas_tablero()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from mesa_sesion();
  if not (tiene_permiso('pedidos_mesas') or tiene_permiso('cocina')) then
    raise exception 'Tu perfil no tiene permiso para: atender pedidos de mesas' using errcode = '42501', hint = 'permiso:pedidos_mesas';
  end if;
  return jsonb_build_object(
    'ahora', now(),
    -- Activos + los cerrados de la última hora (para que la caja vea "entregado" / "rechazado").
    'pedidos', coalesce((select jsonb_agg(mesa_pedido_json(p.id) order by p.creado_at, p.numero)
      from mesa_pedidos p join mesas m on m.id = p.mesa_id
      where p.empresa_id = s.s_empresa
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)
        and (p.estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')
             or coalesce(p.entregado_at, p.rechazado_at, p.updated_at) > now() - interval '1 hour')), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'abierta_at', c.abierta_at,
        'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
        'sucursal', jsonb_build_object('id', su.id, 'nombre', su.nombre),
        'total', coalesce((select sum(p.total) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), 0),
        'pedidos', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')),
        'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
        'items', coalesce((select jsonb_agg(x order by x->>'nombre') from (
            select jsonb_build_object('nombre', i.producto_nombre, 'cantidad', sum(i.cantidad), 'precio_unitario', i.precio_unitario,
                                      'total', sum(i.total)) as x
              from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
             where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
             group by i.producto_nombre, i.precio_unitario) t), '[]'::jsonb))
        order by m.orden, m.nombre)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id join sucursales su on su.id = m.sucursal_id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta'
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)), '[]'::jsonb),
    'puede_atender', tiene_permiso('pedidos_mesas'),
    'puede_cocina', tiene_permiso('cocina'));
end;
$fn$;

-- Aceptar / rechazar (caja) · preparar / listo (cocina o caja) · entregar (caja o cocina).
create or replace function :"schema".mesa_pedido_accion(p_id uuid, p_accion text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  p mesa_pedidos;
  v_suc uuid;
  v_cuenta text;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
  v_caja boolean := tiene_permiso('pedidos_mesas');
  v_cocina boolean := tiene_permiso('cocina');
begin
  select * into s from mesa_sesion();
  select * into p from mesa_pedidos where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  select m.sucursal_id into v_suc from mesas m where m.id = p.mesa_id;
  if s.s_sucursal is not null and v_suc <> s.s_sucursal then raise exception 'Ese pedido es de otra sucursal'; end if;
  select estado into v_cuenta from mesa_cuentas where id = p.cuenta_id;
  if v_cuenta <> 'abierta' then raise exception 'La cuenta de esa mesa ya se cerró'; end if;

  if p_accion = 'aceptar' then
    if not v_caja then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado <> 'nuevo' then raise exception 'Ese pedido ya fue atendido'; end if;
    update mesa_pedidos set estado = 'aceptado', aceptado_at = now(), aceptado_por = s.s_usuario, aceptado_por_nombre = s.s_nombre,
           updated_at = now() where id = p.id;
  elsif p_accion = 'rechazar' then
    if not v_caja then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('nuevo', 'aceptado') then raise exception 'Ese pedido ya se está preparando: no se puede rechazar'; end if;
    if v_motivo is null then raise exception 'Escribí el motivo (lo ve el cliente en su celular)'; end if;
    update mesa_pedidos set estado = 'rechazado', rechazado_at = now(), rechazado_por = s.s_usuario, motivo_rechazo = v_motivo,
           updated_at = now() where id = p.id;
  elsif p_accion = 'preparar' then
    if not (v_cocina or v_caja) then perform exigir_permiso('cocina'); end if;
    if p.estado <> 'aceptado' then raise exception 'Solo un pedido aceptado pasa a "en preparación"'; end if;
    update mesa_pedidos set estado = 'en_preparacion', preparando_at = now(), updated_at = now() where id = p.id;
  elsif p_accion = 'listo' then
    if not (v_cocina or v_caja) then perform exigir_permiso('cocina'); end if;
    if p.estado not in ('aceptado', 'en_preparacion') then raise exception 'Ese pedido no está en preparación'; end if;
    update mesa_pedidos set estado = 'listo', preparando_at = coalesce(preparando_at, now()), listo_at = now(), updated_at = now()
      where id = p.id;
  elsif p_accion = 'entregar' then
    if not (v_cocina or v_caja) then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('aceptado', 'en_preparacion', 'listo') then raise exception 'Ese pedido no se puede marcar como entregado'; end if;
    update mesa_pedidos set estado = 'entregado', listo_at = coalesce(listo_at, now()), entregado_at = now(), updated_at = now()
      where id = p.id;
  else
    raise exception 'Acción inválida';
  end if;
  return mesa_pedido_json(p.id);
end;
$fn$;

-- Cobrar la cuenta de una mesa: arma la venta con crear_venta (contado, caja abierta de la
-- sucursal de la mesa) y cierra la cuenta. Todo en una transacción.
create or replace function :"schema".mesa_cuenta_cobrar(
  p_cuenta_id uuid, p_cliente_id uuid default null, p_cliente_ocasional boolean default false,
  p_tipo_documento text default 'ticket', p_pagos jsonb default null, p_caja_id uuid default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  m mesas;
  v_caja uuid;
  v_suc_caja uuid;
  v_items jsonb := '[]'::jsonb;
  g record;
  v_venta jsonb;
  v_total numeric;
begin
  select * into s from mesa_sesion();
  perform exigir_permiso('pedidos_mesas');
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;
  if s.s_sucursal is not null and m.sucursal_id <> s.s_sucursal then raise exception 'Esa mesa es de otra sucursal'; end if;
  if c.estado <> 'abierta' then raise exception 'Esa cuenta ya se cerró'; end if;
  if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado = 'nuevo') then
    raise exception 'La mesa "%" tiene pedidos sin atender: aceptalos o rechazalos antes de cobrar', m.nombre;
  end if;

  -- Caja: la abierta de la sucursal de la mesa (la elegida o la que le toca al cajero).
  v_caja := caja_abierta_para(null, m.sucursal_id, p_caja_id);
  if v_caja is null then raise exception 'No hay una caja abierta en la sucursal de la mesa: abrila para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> m.sucursal_id then raise exception 'Elegí una caja de la sucursal de la mesa'; end if;

  -- Líneas: se agrupan por producto y precio. Si el precio del pedido es el de hoy, va con el
  -- descuento del producto (como la caja); si cambió desde que se pidió, se respeta el del pedido
  -- (precio manual: crear_venta exige el permiso de precios).
  for g in
    select i.producto_id, i.precio_unitario, sum(i.cantidad) as cantidad, pr.precio_venta, pr.descuento_pct, i.producto_nombre
      from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
      left join productos pr on pr.id = i.producto_id
     where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
     group by i.producto_id, i.precio_unitario, pr.precio_venta, pr.descuento_pct, i.producto_nombre
  loop
    if g.producto_id is null or g.precio_venta is null then
      raise exception 'El producto "%" ya no existe en el catálogo: no se puede cobrar desde la mesa', g.producto_nombre;
    end if;
    if mesa_precio(g.precio_venta, g.descuento_pct) = g.precio_unitario then
      v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', g.producto_id, 'cantidad', g.cantidad,
                   'descuento_pct', coalesce(g.descuento_pct, 0)));
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', g.producto_id, 'cantidad', g.cantidad,
                   'precio_unitario', g.precio_unitario));
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'La cuenta no tiene pedidos aceptados para cobrar: usá "Liberar mesa"';
  end if;

  v_venta := crear_venta(
    p_cliente_id, 'CONTADO', null, 'GS', left('Pedido de mesa: ' || m.nombre || coalesce(' · ' || m.zona, ''), 500),
    v_items, p_pagos, 'mesa_cuenta_' || c.id::text, 0, null, null, v_caja,
    coalesce(nullif(p_tipo_documento, ''), 'ticket'), coalesce(p_cliente_ocasional, false));
  v_total := (v_venta->>'total')::numeric;

  update mesa_cuentas set estado = 'cerrada', cerrada_at = now(), cerrada_por = s.s_usuario,
         venta_id = (v_venta->>'venta_id')::uuid, total = coalesce(v_total, 0)
   where id = c.id;
  -- Lo que quedó sin entregar se da por entregado al cobrar.
  update mesa_pedidos set estado = 'entregado', entregado_at = now(), listo_at = coalesce(listo_at, now()), updated_at = now()
   where cuenta_id = c.id and estado in ('aceptado', 'en_preparacion', 'listo');
  return v_venta || jsonb_build_object('mesa', m.nombre);
end;
$fn$;

-- Liberar una mesa sin nada que cobrar (todo rechazado): la cuenta queda anulada.
create or replace function :"schema".mesa_cuenta_liberar(p_cuenta_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  v_suc uuid;
begin
  select * into s from mesa_sesion();
  perform exigir_permiso('pedidos_mesas');
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta no encontrada'; end if;
  select sucursal_id into v_suc from mesas where id = c.mesa_id;
  if s.s_sucursal is not null and v_suc <> s.s_sucursal then raise exception 'Esa mesa es de otra sucursal'; end if;
  if c.estado <> 'abierta' then raise exception 'Esa cuenta ya se cerró'; end if;
  if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado not in ('rechazado')) then
    raise exception 'La mesa tiene pedidos para cobrar o sin atender: cobrala o rechazá los pedidos';
  end if;
  update mesa_cuentas set estado = 'anulada', cerrada_at = now(), cerrada_por = s.s_usuario where id = c.id;
end;
$fn$;

-- =============================================================================
-- 6. Público (anon): menú, crear pedido y estado — SOLO por token de mesa
-- =============================================================================
create or replace function :"schema".mesa_menu_publico(p_token text)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
  v_emp record;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into m from mesas where token = p_token;
  if not found then return null; end if;
  select coalesce(nullif(btrim(e.nombre_fantasia), ''), e.nombre) as nombre, e.logo_url into v_emp from empresas e where e.id = m.empresa_id;
  if not m.activa then
    return jsonb_build_object('activa', false, 'mesa', m.nombre, 'empresa', v_emp.nombre, 'logo_url', v_emp.logo_url);
  end if;
  return jsonb_build_object(
    'activa', true,
    'mesa', m.nombre,
    'zona', m.zona,
    'sucursal', (select su.nombre from sucursales su where su.id = m.sucursal_id),
    'empresa', v_emp.nombre,
    'logo_url', v_emp.logo_url,
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'descripcion', left(p.descripcion, 300), 'imagen_url', p.imagen_url,
        'precio', mesa_precio(p.precio_venta, p.descuento_pct),
        'precio_lista', case when coalesce(p.descuento_pct, 0) > 0 then p.precio_venta end,
        'categoria', coalesce(cp.nombre, 'Otros'))
        order by coalesce(cp.nombre, 'zzz'), p.nombre)
      from productos p left join categorias_productos cp on cp.id = p.categoria_principal_id
      where p.empresa_id = m.empresa_id and p.en_menu_qr and p.activo and coalesce(p.es_vendible, true)
        and coalesce(p.precio_venta, 0) > 0
        and not (coalesce(p.controla_stock, false) and coalesce(p.stock_actual, 0) <= 0)), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".mesa_pedido_publico_crear(p_token text, p_items jsonb, p_nota text default null, p_nombre text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
  c mesa_cuentas;
  it jsonb;
  prod record;
  v_cant numeric;
  v_precio numeric;
  v_total numeric := 0;
  v_ped mesa_pedidos;
  v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 500);
  v_nombre text := left(nullif(btrim(coalesce(p_nombre, '')), ''), 60);
  v_item_nota text;
  v_ids uuid[] := '{}';
  v_pid uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Mesa no encontrada'; end if;
  -- La fila de la mesa serializa los pedidos de esa mesa (y el límite por minuto).
  select * into m from mesas where token = p_token for update;
  if not found then raise exception 'Mesa no encontrada'; end if;
  if not m.activa then raise exception 'Esta mesa no está recibiendo pedidos por QR. Pedile a quien te atiende.'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Son demasiados productos en un solo pedido (hasta 30)'; end if;

  if (select count(*) from mesa_pedidos where mesa_id = m.id and creado_at > now() - interval '1 minute') >= 4 then
    raise exception 'Mandaste varios pedidos seguidos: esperá un minuto y probá de nuevo';
  end if;
  if (select count(*) from mesa_pedidos where mesa_id = m.id and estado = 'nuevo') >= 6 then
    raise exception 'Hay varios pedidos de esta mesa esperando: en un momento los atienden';
  end if;

  -- Cuenta abierta de la mesa (o una nueva).
  select * into c from mesa_cuentas where mesa_id = m.id and estado = 'abierta' for update;
  if not found then
    insert into mesa_cuentas (empresa_id, mesa_id) values (m.empresa_id, m.id) returning * into c;
  end if;

  insert into mesa_pedidos (empresa_id, cuenta_id, mesa_id, numero, nombre_cliente, nota)
    values (m.empresa_id, c.id, m.id,
            inv_numero(m.empresa_id, 'mesa_pedido', (select coalesce(max(numero), 0) from mesa_pedidos where empresa_id = m.empresa_id)),
            v_nombre, v_nota)
    returning * into v_ped;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid := (it->>'producto_id')::uuid;
    exception when others then
      raise exception 'Hay un producto inválido en el pedido';
    end;
    if v_pid = any (v_ids) then raise exception 'Hay un producto repetido en el pedido'; end if;
    v_ids := v_ids || v_pid;
    begin
      v_cant := (it->>'cantidad')::numeric;
    exception when others then
      raise exception 'Cantidad inválida';
    end;
    if v_cant is null or v_cant <> trunc(v_cant) or v_cant < 1 or v_cant > 50 then
      raise exception 'La cantidad de cada producto va de 1 a 50';
    end if;
    select p.id, p.nombre, p.precio_venta, p.descuento_pct into prod
      from productos p
     where p.id = v_pid and p.empresa_id = m.empresa_id and p.en_menu_qr and p.activo and coalesce(p.es_vendible, true)
       and coalesce(p.precio_venta, 0) > 0
       and not (coalesce(p.controla_stock, false) and coalesce(p.stock_actual, 0) <= 0);
    if not found then raise exception 'Un producto del pedido ya no está disponible: actualizá el menú'; end if;
    v_precio := mesa_precio(prod.precio_venta, prod.descuento_pct);
    v_item_nota := left(nullif(btrim(coalesce(it->>'nota', '')), ''), 200);
    insert into mesa_pedido_items (empresa_id, pedido_id, producto_id, producto_nombre, cantidad, precio_unitario, total, nota)
      values (m.empresa_id, v_ped.id, prod.id, prod.nombre, v_cant, v_precio, round(v_cant * v_precio), v_item_nota);
    v_total := v_total + round(v_cant * v_precio);
  end loop;

  update mesa_pedidos set total = v_total where id = v_ped.id;
  return jsonb_build_object('seguimiento', v_ped.seguimiento, 'numero', v_ped.numero, 'estado', 'nuevo', 'total', v_total);
end;
$fn$;

-- Estado de los pedidos de este celular (por sus códigos de seguimiento) en esta mesa.
create or replace function :"schema".mesa_pedidos_publico_estado(p_token text, p_seguimientos text[])
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_mesa uuid;
  v_segs text[];
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return '[]'::jsonb; end if;
  select id into v_mesa from mesas where token = p_token;
  if v_mesa is null then return '[]'::jsonb; end if;
  select coalesce(array_agg(x), '{}') into v_segs
    from (select distinct x from unnest(coalesce(p_seguimientos, '{}')) x where x ~ '^[0-9a-f]{32}$' limit 20) t;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'seguimiento', p.seguimiento, 'numero', p.numero, 'estado', p.estado, 'motivo_rechazo', p.motivo_rechazo,
      'total', p.total, 'creado_at', p.creado_at, 'cuenta_cerrada', c.estado <> 'abierta',
      'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', i.producto_nombre, 'cantidad', i.cantidad, 'total', i.total)
                          order by i.producto_nombre) from mesa_pedido_items i where i.pedido_id = p.id), '[]'::jsonb))
      order by p.creado_at desc)
    from mesa_pedidos p join mesa_cuentas c on c.id = p.cuenta_id
    where p.mesa_id = v_mesa and p.seguimiento = any (v_segs) and p.creado_at > now() - interval '12 hours'), '[]'::jsonb);
end;
$fn$;

-- =============================================================================
-- 7. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".mesa_precio(numeric, numeric) from public;
revoke all on function :"schema".mesa_sesion() from public;
revoke all on function :"schema".mesa_pedido_json(uuid) from public;
revoke all on function :"schema".mesas_listar() from public;
revoke all on function :"schema".mesa_guardar(jsonb) from public;
revoke all on function :"schema".mesa_regenerar_token(uuid) from public;
revoke all on function :"schema".mesa_eliminar(uuid) from public;
revoke all on function :"schema".mesas_tablero() from public;
revoke all on function :"schema".mesa_pedido_accion(uuid, text, text) from public;
revoke all on function :"schema".mesa_cuenta_cobrar(uuid, uuid, boolean, text, jsonb, uuid) from public;
revoke all on function :"schema".mesa_cuenta_liberar(uuid) from public;
revoke all on function :"schema".mesa_menu_publico(text) from public;
revoke all on function :"schema".mesa_pedido_publico_crear(text, jsonb, text, text) from public;
revoke all on function :"schema".mesa_pedidos_publico_estado(text, text[]) from public;

grant execute on function
  :"schema".mesas_listar(),
  :"schema".mesa_guardar(jsonb),
  :"schema".mesa_regenerar_token(uuid),
  :"schema".mesa_eliminar(uuid),
  :"schema".mesas_tablero(),
  :"schema".mesa_pedido_accion(uuid, text, text),
  :"schema".mesa_cuenta_cobrar(uuid, uuid, boolean, text, jsonb, uuid),
  :"schema".mesa_cuenta_liberar(uuid)
  to authenticated, service_role;
grant execute on function
  :"schema".mesa_menu_publico(text),
  :"schema".mesa_pedido_publico_crear(text, jsonb, text, text),
  :"schema".mesa_pedidos_publico_estado(text, text[])
  to anon, authenticated, service_role;

commit;
