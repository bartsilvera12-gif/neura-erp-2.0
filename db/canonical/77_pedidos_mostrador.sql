-- =============================================================================
-- PEDIDOS DE MOSTRADOR (pedido del dueño, 27-oct-2026).
--
-- Para negocios que no son gastronómicos (ferretería, almacén…): el VENDEDOR arma el pedido en
-- Caja › Pedidos (/caja/pedidos) y lo envía a caja; la CAJA lo cobra en Nueva venta.
--   1. "Enviar a caja" crea el pedido EN CAJA con número correlativo por empresa (P-0001…).
--      Comprobante opcional impreso (número grande + código de barras Code128 "P0042").
--   2. Caja › Nueva venta: bandeja "Pedidos por cobrar (N)" (los de HOY de la sucursal de la
--      caja) y búsqueda por número / escaneo ("P-0042", "P0042", "42" no: lleva la P).
--      Se carga en el carrito con los precios del pedido; el cajero puede agregar, quitar o bajar
--      (es mostrador, no mesa) y cobra normal (forma de pago, ticket/factura, cliente / ocasional).
--   3. pedido_mostrador_cobrar_caja crea la venta (crear_venta) y deja el pedido COBRADO con su
--      venta_id EN LA MISMA TRANSACCIÓN.
--
-- Decisiones
--   · Sin paso de entrega: cobrado = terminado.
--   · No reserva stock: el stock se descuenta al cobrar (como toda venta).
--   · Vencen al cierre del día (hora de Paraguay), sin cron: un pedido "en caja" de un día
--     anterior se muestra "vencido" (pm_estado) y no se puede cobrar ni editar.
--   · Editar / anular: solo mientras está en caja y es de hoy. Cada edición sube `version`: si la
--     caja lo tenía cargado ve "El pedido cambió, recargalo" (y la base no cobra otra versión).
--   · Doble cobro: FOR UPDATE sobre el pedido; el segundo cajero ve "ya se cobró".
--
-- Función de la empresa (Rubro y funciones, receta 75): columna nueva empresa_funciones.pedidos
--   "Pedidos de mostrador", independiente del rubro. Default: PRENDIDA (Comercio; sin fila =
--   Comercio = prendida); el preset Gastronomía la apaga (se puede volver a prender). En las
--   empresas que ya eran Gastronomía al agregar la columna queda apagada; en erp_demo, prendida.
--   Apagada: sin pantalla, sin bandeja y las funciones de abajo responden "no está activa".
--
-- Permiso nuevo: pedidos_mostrador "Armar pedidos de mostrador" (armar, editar, anular y enviar
--   a caja). Cobrar: cualquier nivel base menos VENDEDOR (el vendedor arma, la caja cobra).
--   Ver los pedidos de todos: nivel ADMIN / SUPERVISOR / CAJERO; el VENDEDOR ve los suyos.
--   Se da (una vez por empresa) a los perfiles de nivel Supervisor, Cajero y Vendedor, con la
--   pantalla /caja/pedidos.
--
-- Redefine (desde su última versión): permisos_catalogo (68), perfiles_sistema_asegurar (56),
-- funcion_activa / funciones_empresa / guardar_funciones_empresa (75).
-- IDEMPOTENTE. Va después de 76.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

select (:'schema' = 'erp_demo') as es_demo \gset
select not exists (
  select 1 from information_schema.columns
   where table_schema = :'schema' and table_name = 'empresa_funciones' and column_name = 'pedidos') as falta_col_pedidos \gset

-- =============================================================================
-- 1. Función "Pedidos de mostrador" en Rubro y funciones
-- =============================================================================
alter table :"schema".empresa_funciones add column if not exists pedidos boolean not null default true;
\if :falta_col_pedidos
\if :es_demo
-- erp_demo: prendida (además de las gastronómicas) para que el dueño la pruebe.
update :"schema".empresa_funciones set pedidos = true;
\else
-- Las que ya eran Gastronomía: apagada (es el preset del rubro).
update :"schema".empresa_funciones set pedidos = false where mesas and cocina and recetas;
\endif
\endif

create or replace function :"schema".funcion_activa(p_empresa uuid, p_funcion text)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select case
    -- 77: sin fila = Comercio = Pedidos de mostrador prendida.
    when p_funcion = 'pedidos' then coalesce((select f.pedidos from empresa_funciones f where f.empresa_id = p_empresa), true)
    else coalesce((
      select case p_funcion
               when 'mesas' then f.mesas
               when 'cocina' then f.cocina and f.mesas
               when 'recetas' then f.recetas
               else false end
        from empresa_funciones f where f.empresa_id = p_empresa), false)
  end
$$;

create or replace function :"schema".funciones_empresa()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  f empresa_funciones;
  v_mesas boolean;
  v_cocina boolean;
  v_recetas boolean;
  v_pedidos boolean;
  v_ocultas boolean;
  v_admin boolean;
  v_rubro text;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  select * into f from empresa_funciones where empresa_id = s.p_empresa;
  v_mesas := coalesce(f.mesas, false);
  v_cocina := coalesce(f.cocina, false) and v_mesas;
  v_recetas := coalesce(f.recetas, false);
  v_pedidos := coalesce(f.pedidos, true);  -- 77
  v_ocultas := coalesce(f.funciones_ocultas, false);
  v_admin := s.p_rol = 'ADMIN' and tiene_permiso('configuracion');
  -- El rubro sale de las tres gastronómicas (Pedidos de mostrador es independiente).
  v_rubro := case when not v_mesas and not v_cocina and not v_recetas then 'comercio'
                  when v_mesas and v_cocina and v_recetas then 'gastronomia'
                  else 'personalizado' end;
  return jsonb_build_object(
    'rubro', v_rubro,
    'mesas', v_mesas,
    'cocina', v_cocina,
    'recetas', v_recetas,
    'pedidos', v_pedidos,
    'ocultas', v_ocultas,
    'puede_editar', v_admin and not v_ocultas,
    'cuentas_abiertas', case when v_admin then (select count(*) from mesa_cuentas c where c.empresa_id = s.p_empresa and c.estado = 'abierta') end,
    'pedidos_sin_cerrar', case when v_admin then (
        select count(*) from mesa_pedidos p join mesa_cuentas c on c.id = p.cuenta_id
         where p.empresa_id = s.p_empresa and c.estado = 'abierta'
           and p.estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')) end,
    'productos_recetas', case when v_admin then (
        select count(*) from productos pr
         where pr.empresa_id = s.p_empresa and pr.activo and pr.tipo_producto in ('menu', 'materia_prima')) end);
end;
$fn$;

create or replace function :"schema".guardar_funciones_empresa(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  f empresa_funciones;
  v_mesas boolean;
  v_cocina boolean;
  v_recetas boolean;
  v_pedidos boolean;
  v_n integer;
  v_k text;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if s.p_rol <> 'ADMIN' then
    raise exception 'Solo el Administrador puede cambiar el rubro y las funciones' using errcode = '42501';
  end if;
  perform exigir_permiso('configuracion');
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos de las funciones'; end if;

  insert into empresa_funciones (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  select * into f from empresa_funciones where empresa_id = s.p_empresa for update;
  if f.funciones_ocultas then
    raise exception 'Esta sección no está disponible para tu empresa' using errcode = '42501';
  end if;

  v_mesas := f.mesas;
  v_cocina := f.cocina;
  v_recetas := f.recetas;
  v_pedidos := f.pedidos;

  if p ? 'rubro' then
    case p->>'rubro'
      -- 77: Comercio prende Pedidos de mostrador; Gastronomía la apaga (se puede volver a prender).
      when 'comercio' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := true;
      when 'gastronomia' then v_mesas := true; v_cocina := true; v_recetas := true; v_pedidos := false;
      else raise exception 'Rubro inválido (Comercio o Gastronomía)';
    end case;
  end if;
  foreach v_k in array array['mesas', 'cocina', 'recetas', 'pedidos', 'confirmar_recetas'] loop
    if p ? v_k and jsonb_typeof(p->v_k) <> 'boolean' then raise exception '"%" debe ser sí o no', v_k; end if;
  end loop;
  if p ? 'mesas' then v_mesas := (p->>'mesas')::boolean; end if;
  if p ? 'cocina' then v_cocina := (p->>'cocina')::boolean; end if;
  if p ? 'recetas' then v_recetas := (p->>'recetas')::boolean; end if;
  if p ? 'pedidos' then v_pedidos := (p->>'pedidos')::boolean; end if;
  if v_cocina and not v_mesas then
    if p ? 'cocina' and (p->>'cocina')::boolean then
      raise exception 'Cocina y estaciones necesita Mesas y QR: prendé Mesas y QR primero';
    end if;
    v_cocina := false; -- apagar Mesas apaga Cocina
  end if;

  -- Apagar Mesas: sin cuentas abiertas ni pedidos sin cerrar.
  if f.mesas and not v_mesas then
    select count(*) into v_n from mesa_cuentas where empresa_id = s.p_empresa and estado = 'abierta';
    if v_n > 0 then
      raise exception 'Cobrá o liberá las mesas abiertas primero: hay % cuenta% de mesa abierta%',
        v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then '' else 's' end;
    end if;
    select count(*) into v_n from mesa_pedidos where empresa_id = s.p_empresa and estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')
      and cuenta_id in (select id from mesa_cuentas where empresa_id = s.p_empresa and estado = 'abierta');
    if v_n > 0 then
      raise exception 'Cobrá o liberá las mesas abiertas primero: hay % pedido% sin cerrar', v_n, case when v_n = 1 then '' else 's' end;
    end if;
  end if;

  -- Apagar Recetas con productos Menú / Materia prima activos: pide confirmación (no bloquea).
  if f.recetas and not v_recetas and not coalesce((p->>'confirmar_recetas')::boolean, false) then
    select count(*) into v_n from productos where empresa_id = s.p_empresa and activo and tipo_producto in ('menu', 'materia_prima');
    if v_n > 0 then
      raise exception 'Hay % producto% activo% de tipo Menú o Materia prima. Siguen existiendo; confirmá para apagar Recetas',
        v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then '' else 's' end
        using hint = 'confirmar_recetas:' || v_n;
    end if;
  end if;

  update empresa_funciones
     set mesas = v_mesas, cocina = v_cocina, recetas = v_recetas, pedidos = v_pedidos, updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return funciones_empresa();
end;
$fn$;

-- =============================================================================
-- 2. Catálogo de permisos (68 + pedidos_mostrador)
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
    ('pedidos_mostrador',          'Armar pedidos de mostrador',                    'Ventas y caja'),
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

-- Siembra de perfiles en empresas nuevas (56 + pedidos_mostrador y /caja/pedidos).
create or replace function :"schema".perfiles_sistema_asegurar(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_id uuid;
  v_nombre text;
  v_nueva boolean := not exists (select 1 from perfiles where empresa_id = p_empresa);
  -- Pantallas que hoy ven todos los roles (los módulos sin `roles` + Caja + Presupuestos).
  v_comun text[] := array[
    '/clientes', '/crm', '/presupuestos', '/clientes/gestion', '/clientes/suscripciones', '/clientes/agenda', '/proyectos',
    '/caja/nueva', '/caja/turnos', '/caja', '/caja/credito', '/caja/pedidos', '/cobranzas', '/cobranzas/conciliacion', '/pagos',
    '/conversaciones', '/conversaciones/finalizadas', '/conversaciones/historial',
    '/soporte', '/soporte/tickets', '/soporte/mis-tickets'];
  v_inventario text[] := array['/inventario', '/inventario/movimientos', '/inventario/traslados', '/inventario/ajustes',
    '/inventario/vencimientos', '/inventario/categorias'];
  v_caja text[] := array['anular_ventas', 'descuentos_precio', 'vender_credito', 'abrir_cerrar_caja', 'movimientos_caja',
    'registrar_perdidas', 'recibir_traslados', 'exportar', 'pedidos_mostrador'];
begin
  for r in select * from (values
      ('ADMIN',      'Administrador', 'Acceso total: todas las pantallas y permisos. Administra usuarios y la configuración.', 'todas'),
      ('SUPERVISOR', 'Supervisor',    'Caja de su sucursal, anula ventas de turnos cerrados y ve los cierres de caja.',          'propia'),
      ('CAJERO',     'Cajero',        'Vende y cobra en la caja de su sucursal; carga pérdidas y recibe traslados.',             'propia'),
      ('VENDEDOR',   'Vendedor',      'Vende, cotiza y atiende clientes en su sucursal.',                                        'propia')
    ) x(codigo, nombre, descripcion, alcance) loop
    -- Los editables solo se siembran en una empresa sin perfiles (no resucitar los borrados).
    if r.codigo <> 'ADMIN' and not v_nueva then continue; end if;
    if exists (select 1 from perfiles where empresa_id = p_empresa and codigo = r.codigo) then continue; end if;
    v_nombre := r.nombre;
    if exists (select 1 from perfiles where empresa_id = p_empresa and lower(nombre) = lower(v_nombre)) then
      v_nombre := v_nombre || ' (sistema)';
    end if;
    insert into perfiles (empresa_id, nombre, descripcion, codigo, sistema, nivel_base, alcance_sucursal)
      values (p_empresa, v_nombre, r.descripcion, r.codigo, r.codigo = 'ADMIN', r.codigo, r.alcance)
      returning id into v_id;
    -- Administrador: todo de forma implícita (sin filas): ve las pantallas y permisos nuevos.
    if r.codigo = 'ADMIN' then continue; end if;
    insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
      select v_id, p_empresa, x from unnest(case r.codigo
        when 'SUPERVISOR' then v_comun || array['/reportes']
        else v_comun || v_inventario end) x
      on conflict do nothing;
    insert into perfil_permisos (perfil_id, empresa_id, permiso)
      select v_id, p_empresa, x from unnest(case r.codigo
        when 'SUPERVISOR' then v_caja || array['anular_ventas_cerradas', 'registrar_transferencias', 'ver_cierres_caja']
        when 'CAJERO'     then v_caja || array['registrar_cobros', 'registrar_transferencias']
        else                   v_caja || array['registrar_cobros'] end) x
      on conflict do nothing;
  end loop;
end;
$fn$;

-- Empresas existentes: UNA vez por empresa (si nadie tiene todavía el permiso), a los perfiles de
-- nivel Supervisor / Cajero / Vendedor: permiso + pantalla. Si después se lo sacan, no vuelve.
insert into :"schema".perfil_permisos (perfil_id, empresa_id, permiso)
  select pf.id, pf.empresa_id, 'pedidos_mostrador'
    from :"schema".perfiles pf
   where pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
     and not exists (select 1 from :"schema".perfil_permisos x where x.empresa_id = pf.empresa_id and x.permiso = 'pedidos_mostrador')
     and not exists (select 1 from :"schema".perfil_pantallas x where x.empresa_id = pf.empresa_id and x.pantalla = '/caja/pedidos')
on conflict do nothing;
insert into :"schema".perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, '/caja/pedidos'
    from :"schema".perfiles pf
   where pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
     and not exists (select 1 from :"schema".perfil_pantallas x where x.empresa_id = pf.empresa_id and x.pantalla = '/caja/pedidos')
     and exists (select 1 from :"schema".perfil_permisos x where x.perfil_id = pf.id and x.permiso = 'pedidos_mostrador')
on conflict do nothing;

-- =============================================================================
-- 3. Tablas
-- =============================================================================
create table if not exists :"schema".pedidos_mostrador (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sucursal_id uuid not null references :"schema".sucursales(id),
  numero integer not null,
  -- 'en_caja' | 'cobrado' | 'anulado'. "vencido" no se guarda: en_caja con fecha < hoy (PY).
  estado text not null default 'en_caja',
  -- Día (hora de Paraguay) en que se armó: vence al cerrar ese día.
  fecha date not null,
  version integer not null default 1,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  cliente_nombre text,
  nota text,
  total numeric not null default 0,
  creado_at timestamptz not null default now(),
  creado_por uuid references :"schema".usuarios(id) on delete set null,
  creado_por_nombre text,
  updated_at timestamptz not null default now(),
  editado_at timestamptz,
  venta_id uuid references :"schema".ventas(id) on delete set null,
  cobrado_at timestamptz,
  cobrado_por uuid references :"schema".usuarios(id) on delete set null,
  cobrado_por_nombre text,
  total_cobrado numeric,
  modificado_en_caja boolean not null default false,
  anulado_at timestamptz,
  anulado_por uuid references :"schema".usuarios(id) on delete set null,
  anulado_por_nombre text,
  motivo_anulacion text,
  constraint pedidos_mostrador_numero_uk unique (empresa_id, numero),
  constraint chk_pedidos_mostrador_estado check (estado in ('en_caja', 'cobrado', 'anulado')),
  constraint chk_pedidos_mostrador_cobrado check (estado <> 'cobrado' or venta_id is not null or cobrado_at is not null)
);
create index if not exists pedidos_mostrador_en_caja_idx on :"schema".pedidos_mostrador (empresa_id, sucursal_id, fecha) where estado = 'en_caja';
create index if not exists pedidos_mostrador_fecha_idx on :"schema".pedidos_mostrador (empresa_id, fecha desc);
create index if not exists pedidos_mostrador_venta_idx on :"schema".pedidos_mostrador (venta_id) where venta_id is not null;

create table if not exists :"schema".pedido_mostrador_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references :"schema".pedidos_mostrador(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid references :"schema".productos(id) on delete set null,
  producto_nombre text not null,
  sku text,
  cantidad numeric not null check (cantidad > 0),
  -- precio_unitario = precio_base (lista con el descuento del producto) + precio_mods.
  precio_base numeric not null default 0,
  precio_mods numeric not null default 0,
  precio_unitario numeric not null default 0,
  total numeric not null default 0,
  modificadores jsonb,
  modificadores_texto text,
  orden integer not null default 0
);
create index if not exists pedido_mostrador_items_pedido_idx on :"schema".pedido_mostrador_items (pedido_id, orden);

comment on table :"schema".pedidos_mostrador is
  'Pedidos de mostrador (receta 77): el vendedor arma, la caja cobra (venta_id). Vencen al cierre del día (PY).';

alter table :"schema".pedidos_mostrador enable row level security;
alter table :"schema".pedidos_mostrador force row level security;
alter table :"schema".pedido_mostrador_items enable row level security;
alter table :"schema".pedido_mostrador_items force row level security;
drop policy if exists pedidos_mostrador_propios on :"schema".pedidos_mostrador;
create policy pedidos_mostrador_propios on :"schema".pedidos_mostrador for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists pedido_mostrador_items_propios on :"schema".pedido_mostrador_items;
create policy pedido_mostrador_items_propios on :"schema".pedido_mostrador_items for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
revoke all on :"schema".pedidos_mostrador, :"schema".pedido_mostrador_items from anon, authenticated;
grant select on :"schema".pedidos_mostrador, :"schema".pedido_mostrador_items to authenticated;
grant all on :"schema".pedidos_mostrador, :"schema".pedido_mostrador_items to service_role;

-- =============================================================================
-- 4. Helpers internos
-- =============================================================================
create or replace function :"schema".pm_hoy()
returns date language sql stable as $$
  select (now() at time zone 'America/Asuncion')::date
$$;

create or replace function :"schema".pm_etiqueta(p_numero integer)
returns text language sql immutable as $$
  select 'P-' || lpad(p_numero::text, 4, '0')
$$;

-- Estado que se muestra: el "en caja" de un día anterior está vencido.
create or replace function :"schema".pm_estado(p_estado text, p_fecha date)
returns text language sql stable as $$
  select case when p_estado = 'en_caja' and p_fecha < pm_hoy() then 'vencido' else p_estado end
$$;

-- Sesión de pedidos: usuario + función prendida. s_ve_todos = nivel distinto de VENDEDOR.
create or replace function :"schema".pm_sesion(
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_rol text, out s_sucursal uuid,
  out s_todas boolean, out s_ve_todos boolean)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  if not funcion_activa(s.s_empresa, 'pedidos') then
    raise exception 'Esta función no está activa en tu empresa: Pedidos de mostrador está apagada en Configuración › Rubro y funciones'
      using errcode = '42501', hint = 'funcion:pedidos';
  end if;
  s_empresa := s.s_empresa;
  s_usuario := s.s_usuario;
  s_nombre := s.s_nombre;
  s_rol := s.s_rol;
  s_todas := alcance_todas();
  s_sucursal := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa));
  s_ve_todos := s.s_rol <> 'VENDEDOR';
end;
$fn$;

-- Un pedido como lo ven el vendedor y la caja.
create or replace function :"schema".pedido_mostrador_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'etiqueta', pm_etiqueta(p.numero),
    'estado', pm_estado(p.estado, p.fecha), 'fecha', p.fecha, 'version', p.version::text,
    'sucursal', jsonb_build_object('id', su.id, 'nombre', su.nombre),
    'cliente', case when p.cliente_id is not null or p.cliente_nombre is not null
                    then jsonb_build_object('id', p.cliente_id, 'nombre', coalesce(c.nombre, p.cliente_nombre)) end,
    'nota', p.nota, 'total', p.total,
    'creado_at', p.creado_at, 'creado_por', p.creado_por, 'vendedor', p.creado_por_nombre, 'editado_at', p.editado_at,
    'venta', case when p.venta_id is not null then jsonb_build_object('id', v.id, 'numero', v.numero_control, 'total', v.total, 'estado', v.estado) end,
    'cobrado_at', p.cobrado_at, 'cobrado_por_nombre', p.cobrado_por_nombre, 'total_cobrado', p.total_cobrado,
    'modificado_en_caja', p.modificado_en_caja,
    'anulado_at', p.anulado_at, 'anulado_por_nombre', p.anulado_por_nombre, 'motivo_anulacion', p.motivo_anulacion,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'producto_id', i.producto_id, 'nombre', i.producto_nombre, 'sku', i.sku, 'cantidad', i.cantidad,
        'precio_unitario', i.precio_unitario, 'precio_base', i.precio_base, 'precio_mods', i.precio_mods, 'total', i.total,
        'modificadores', i.modificadores, 'modificadores_texto', i.modificadores_texto,
        -- true = el precio base del pedido es el de hoy (lista con el descuento del producto)
        'precio_de_hoy', pr.id is not null and mesa_precio(pr.precio_venta, pr.descuento_pct) = i.precio_base)
        order by i.orden, i.producto_nombre)
      from pedido_mostrador_items i left join productos pr on pr.id = i.producto_id
      where i.pedido_id = p.id), '[]'::jsonb))
    from pedidos_mostrador p
    join sucursales su on su.id = p.sucursal_id
    left join clientes c on c.id = p.cliente_id
    left join ventas v on v.id = p.venta_id
   where p.id = p_id
$$;

-- =============================================================================
-- 5. Pantalla Caja › Pedidos: listar, guardar (crear / editar), anular
-- =============================================================================
create or replace function :"schema".pedidos_mostrador_listar(p_todos boolean default false)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := pm_hoy();
  v_todos boolean;
begin
  select * into s from pm_sesion();
  perform exigir_permiso('pedidos_mostrador');
  v_todos := coalesce(p_todos, false) and s.s_ve_todos;
  return jsonb_build_object(
    'ahora', now(),
    'hoy', v_hoy,
    'puede_ver_todos', s.s_ve_todos,
    'puede_cobrar', s.s_ve_todos,
    'todos', v_todos,
    'usuario_id', s.s_usuario,
    'sucursal', (select jsonb_build_object('id', su.id, 'nombre', su.nombre) from sucursales su where su.id = s.s_sucursal),
    'deposito_id', deposito_por_defecto(s.s_empresa, s.s_sucursal),
    -- Los de hoy y los "en caja" de los últimos días (se ven vencidos).
    'pedidos', coalesce((select jsonb_agg(pedido_mostrador_json(p.id) order by p.creado_at desc)
      from pedidos_mostrador p
     where p.empresa_id = s.s_empresa
       and (p.fecha = v_hoy or (p.estado = 'en_caja' and p.fecha >= v_hoy - 3))
       and (v_todos or p.creado_por = s.s_usuario)
       and (s.s_todas or p.sucursal_id = s.s_sucursal)), '[]'::jsonb));
end;
$fn$;

-- p = { id?, version? (al editar), cliente_id?, nota?, items: [{ producto_id, cantidad, mods? }] }
create or replace function :"schema".pedido_mostrador_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ped pedidos_mostrador;
  v_id uuid;
  v_nuevo boolean;
  v_cliente uuid;
  v_cliente_nombre text;
  v_nota text;
  it jsonb;
  prod record;
  v_cant numeric;
  v_mods jsonb;
  v_snap jsonb;
  v_base numeric;
  v_pmods numeric;
  v_total numeric := 0;
  v_orden integer := 0;
  v_numero integer;
begin
  select * into s from pm_sesion();
  perform exigir_permiso('pedidos_mostrador');
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos del pedido'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'El pedido no tiene productos';
  end if;
  if jsonb_array_length(p->'items') > 200 then raise exception 'Demasiados productos en un pedido (máximo 200)'; end if;

  v_nota := nullif(left(btrim(coalesce(p->>'nota', '')), 500), '');
  v_cliente := nullif(p->>'cliente_id', '')::uuid;
  if v_cliente is not null then
    select nombre into v_cliente_nombre from clientes where id = v_cliente and empresa_id = s.s_empresa and deleted_at is null;
    if not found then raise exception 'Cliente no encontrado'; end if;
  end if;

  v_id := nullif(p->>'id', '')::uuid;
  v_nuevo := v_id is null;
  if not v_nuevo then
    select * into ped from pedidos_mostrador where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Pedido no encontrado'; end if;
    if not s.s_ve_todos and ped.creado_por is distinct from s.s_usuario then
      raise exception 'Solo podés editar tus pedidos' using errcode = '42501';
    end if;
    if not s.s_todas and ped.sucursal_id <> s.s_sucursal then raise exception 'Ese pedido es de otra sucursal'; end if;
    if ped.estado = 'cobrado' then raise exception 'El pedido % ya se cobró: no se puede editar', pm_etiqueta(ped.numero); end if;
    if ped.estado = 'anulado' then raise exception 'El pedido % está anulado: no se puede editar', pm_etiqueta(ped.numero); end if;
    if pm_estado(ped.estado, ped.fecha) = 'vencido' then
      raise exception 'El pedido % venció (era de otro día): armá uno nuevo', pm_etiqueta(ped.numero);
    end if;
    if nullif(p->>'version', '') is not null and p->>'version' <> ped.version::text then
      raise exception 'El pedido % cambió mientras lo editabas: recargalo', pm_etiqueta(ped.numero);
    end if;
    delete from pedido_mostrador_items where pedido_id = ped.id;
    update pedidos_mostrador
       set cliente_id = v_cliente, cliente_nombre = v_cliente_nombre, nota = v_nota,
           version = version + 1, editado_at = now(), updated_at = now()
     where id = ped.id returning * into ped;
  else
    -- Numeración correlativa por empresa (varios vendedores a la vez → se serializa).
    perform pg_advisory_xact_lock(hashtext('pedidos_mostrador_numero_' || s.s_empresa::text));
    select coalesce(max(numero), 0) + 1 into v_numero from pedidos_mostrador where empresa_id = s.s_empresa;
    insert into pedidos_mostrador (empresa_id, sucursal_id, numero, estado, fecha, cliente_id, cliente_nombre, nota,
                                   creado_por, creado_por_nombre)
      values (s.s_empresa,
              -- Alcance "todas": puede elegir la sucursal; si no, la suya.
              case when s.s_todas and nullif(p->>'sucursal_id', '') is not null
                        and exists (select 1 from sucursales x where x.id = (p->>'sucursal_id')::uuid and x.empresa_id = s.s_empresa)
                   then (p->>'sucursal_id')::uuid else s.s_sucursal end,
              v_numero, 'en_caja', pm_hoy(), v_cliente, v_cliente_nombre, v_nota, s.s_usuario, s.s_nombre)
      returning * into ped;
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_cant := nullif(it->>'cantidad', '')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un producto'; end if;
    if v_cant > 99999 then raise exception 'Cantidad demasiado grande en un producto'; end if;
    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = s.s_empresa;
    if not found then raise exception 'Un producto del pedido ya no existe'; end if;
    if not prod.activo then raise exception '"%" está inactivo: no se puede pedir', prod.nombre; end if;
    if prod.tipo_producto = 'materia_prima' then
      raise exception '"%" es materia prima: no se vende', prod.nombre;
    end if;
    if prod.tipo_producto = 'menu' and not tiene_receta(prod.id) then
      raise exception '"%" no tiene receta: cargala en Inventario › Recetas para poder venderlo', prod.nombre;
    end if;
    -- Modificadores (platos): los valida y les pone precio el servidor (receta 73/74).
    v_mods := plato_mods_resolver(prod.id, it->'mods', true);
    v_snap := v_mods->'mods';
    if jsonb_typeof(v_snap) = 'null' then v_snap := null; end if;
    v_pmods := coalesce((v_mods->>'precio')::numeric, 0);
    v_base := mesa_precio(prod.precio_venta, prod.descuento_pct);
    v_orden := v_orden + 1;
    insert into pedido_mostrador_items (pedido_id, empresa_id, producto_id, producto_nombre, sku, cantidad,
                                        precio_base, precio_mods, precio_unitario, total, modificadores, modificadores_texto, orden)
      values (ped.id, s.s_empresa, prod.id, prod.nombre, prod.sku, v_cant,
              v_base, v_pmods, v_base + v_pmods, round(v_cant * (v_base + v_pmods)), v_snap, v_mods->>'texto', v_orden);
    v_total := v_total + round(v_cant * (v_base + v_pmods));
  end loop;

  update pedidos_mostrador set total = v_total where id = ped.id;
  return pedido_mostrador_json(ped.id);
end;
$fn$;

create or replace function :"schema".pedido_mostrador_anular(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ped pedidos_mostrador;
begin
  select * into s from pm_sesion();
  perform exigir_permiso('pedidos_mostrador');
  select * into ped from pedidos_mostrador where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if not s.s_ve_todos and ped.creado_por is distinct from s.s_usuario then
    raise exception 'Solo podés anular tus pedidos' using errcode = '42501';
  end if;
  if not s.s_todas and ped.sucursal_id <> s.s_sucursal then raise exception 'Ese pedido es de otra sucursal'; end if;
  if ped.estado = 'anulado' then return pedido_mostrador_json(ped.id); end if;
  if ped.estado = 'cobrado' then
    raise exception 'El pedido % ya se cobró: para deshacerlo, anulá la venta', pm_etiqueta(ped.numero);
  end if;
  update pedidos_mostrador
     set estado = 'anulado', anulado_at = now(), anulado_por = s.s_usuario, anulado_por_nombre = s.s_nombre,
         motivo_anulacion = nullif(left(btrim(coalesce(p_motivo, '')), 300), ''), version = version + 1, updated_at = now()
   where id = ped.id;
  return pedido_mostrador_json(ped.id);
end;
$fn$;

-- Un pedido (comprobante impreso): el vendedor, los suyos; los demás niveles, los de su alcance.
create or replace function :"schema".pedido_mostrador_ver(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ped pedidos_mostrador;
begin
  select * into s from pm_sesion();
  if not s.s_ve_todos then perform exigir_permiso('pedidos_mostrador'); end if;
  select * into ped from pedidos_mostrador where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if not s.s_ve_todos and ped.creado_por is distinct from s.s_usuario then
    raise exception 'Ese pedido es de otro vendedor' using errcode = '42501';
  end if;
  if not s.s_todas and ped.sucursal_id <> s.s_sucursal then raise exception 'Ese pedido es de otra sucursal'; end if;
  return pedido_mostrador_json(ped.id);
end;
$fn$;

-- =============================================================================
-- 6. Caja › Nueva venta: pedidos por cobrar, búsqueda por número y cobro
-- =============================================================================
create or replace function :"schema".pedidos_mostrador_por_cobrar(p_caja_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja uuid;
  v_suc uuid;
begin
  select * into s from pm_sesion();
  -- El vendedor arma; cobra la caja (no ve la bandeja).
  if not s.s_ve_todos then return jsonb_build_object('ahora', now(), 'pedidos', '[]'::jsonb); end if;
  begin
    v_caja := caja_abierta_para(null, null, p_caja_id);
  exception when others then
    v_caja := null;
  end;
  if v_caja is null then return jsonb_build_object('ahora', now(), 'pedidos', '[]'::jsonb); end if;
  select sucursal_id into v_suc from cajas where id = v_caja;
  return jsonb_build_object(
    'ahora', now(),
    'caja_id', v_caja,
    'pedidos', coalesce((select jsonb_agg(pedido_mostrador_json(p.id) order by p.creado_at)
      from pedidos_mostrador p
     where p.empresa_id = s.s_empresa and p.estado = 'en_caja' and p.fecha = pm_hoy()
       and p.sucursal_id = v_suc), '[]'::jsonb));
end;
$fn$;

-- Escaneo / número escrito en la caja: el pedido (si se puede cobrar) o un error claro.
create or replace function :"schema".pedido_mostrador_por_numero(p_numero integer, p_caja_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ped pedidos_mostrador;
  v_caja uuid;
  v_suc uuid;
  v_venta text;
begin
  select * into s from pm_sesion();
  if not s.s_ve_todos then raise exception 'Los pedidos se cobran en la caja: tu perfil arma pedidos pero no los cobra' using errcode = '42501'; end if;
  select * into ped from pedidos_mostrador where empresa_id = s.s_empresa and numero = p_numero;
  if not found then raise exception 'No hay ningún pedido %', pm_etiqueta(p_numero); end if;
  if ped.estado = 'cobrado' then
    select numero_control into v_venta from ventas where id = ped.venta_id;
    raise exception 'El pedido % ya se cobró%', pm_etiqueta(ped.numero), coalesce(' (venta ' || v_venta || ')', '');
  end if;
  if ped.estado = 'anulado' then raise exception 'El pedido % está anulado', pm_etiqueta(ped.numero); end if;
  if pm_estado(ped.estado, ped.fecha) = 'vencido' then
    raise exception 'El pedido % venció (era del %): pedile al vendedor que arme uno nuevo', pm_etiqueta(ped.numero), to_char(ped.fecha, 'DD/MM');
  end if;
  begin
    v_caja := caja_abierta_para(null, null, p_caja_id);
  exception when others then
    v_caja := null;
  end;
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc from cajas where id = v_caja;
  if v_suc <> ped.sucursal_id then
    raise exception 'El pedido % es de otra sucursal (%): cobralo en una caja de esa sucursal',
      pm_etiqueta(ped.numero), (select nombre from sucursales where id = ped.sucursal_id);
  end if;
  return pedido_mostrador_json(ped.id);
end;
$fn$;

create or replace function :"schema".pedido_mostrador_cobrar_caja(
  p_pedido_id uuid, p_version text,
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket', p_cliente_ocasional boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ped pedidos_mostrador;
  v_caja uuid;
  v_suc_caja uuid;
  v_previa uuid;
  v_venta jsonb;
  v_quien text;
  v_num text;
  v_modif boolean;
begin
  select * into s from pm_sesion();
  if not s.s_ve_todos then
    raise exception 'Los pedidos se cobran en la caja: tu perfil arma pedidos pero no los cobra' using errcode = '42501';
  end if;
  -- La fila del pedido serializa a los cajeros: el segundo espera y ve que ya se cobró.
  select * into ped from pedidos_mostrador where id = p_pedido_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  v_num := pm_etiqueta(ped.numero);

  -- Reintento del mismo POS: la venta ya está hecha y el pedido cobrado con ella.
  if nullif(p_idempotency_key, '') is not null then
    select id into v_previa from ventas where empresa_id = s.s_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_previa is not null and ped.venta_id = v_previa then
      return jsonb_build_object('venta_id', v_previa, 'numero_control', (select numero_control from ventas where id = v_previa),
                                'reusada', true, 'pedido', v_num);
    end if;
  end if;

  if ped.estado = 'cobrado' then
    select coalesce(ped.cobrado_por_nombre, u.nombre, 'otro usuario') into v_quien from usuarios u where u.id = ped.cobrado_por;
    raise exception 'El pedido % ya se cobró (%): soltalo del carrito', v_num, coalesce(v_quien, ped.cobrado_por_nombre, 'otro usuario');
  end if;
  if ped.estado = 'anulado' then raise exception 'El pedido % está anulado: soltalo del carrito', v_num; end if;
  if pm_estado(ped.estado, ped.fecha) = 'vencido' then
    raise exception 'El pedido % venció (era de otro día): soltalo del carrito', v_num;
  end if;
  if p_version is null or p_version <> ped.version::text then
    raise exception 'El pedido % cambió desde que lo cargaste: recargalo antes de cobrar', v_num;
  end if;

  -- Caja: abierta y de la sucursal del pedido.
  v_caja := caja_abierta_para(null, null, p_caja_id);
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> ped.sucursal_id then raise exception 'El pedido % es de otra sucursal: cobralo en una caja de su sucursal', v_num; end if;

  -- ¿El carrito difiere del pedido? (por producto y combinación de modificadores; es solo un aviso).
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'La venta debe tener al menos un ítem'; end if;
  select exists (
    select 1 from (
      select i.producto_id::text as prod, coalesce(mods_clave(i.modificadores), '') as clave, sum(i.cantidad) as cant
        from pedido_mostrador_items i where i.pedido_id = ped.id group by 1, 2) a
    full join (
      select x->>'producto_id' as prod, coalesce(mods_clave(x->'mods'), '') as clave, sum((x->>'cantidad')::numeric) as cant
        from jsonb_array_elements(p_items) x group by 1, 2) b
      on a.prod = b.prod and a.clave = b.clave
     where a.cant is distinct from b.cant) into v_modif;

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Pedido ' || v_num || coalesce(' · ' || ped.creado_por_nombre, '') || coalesce(' · ' || ped.nota, ''), 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);

  update pedidos_mostrador
     set estado = 'cobrado', venta_id = (v_venta->>'venta_id')::uuid, cobrado_at = now(), cobrado_por = s.s_usuario,
         cobrado_por_nombre = s.s_nombre, total_cobrado = (select total from ventas where id = (v_venta->>'venta_id')::uuid),
         modificado_en_caja = coalesce(v_modif, false), updated_at = now()
   where id = ped.id;
  return v_venta || jsonb_build_object('pedido', v_num);
end;
$fn$;

-- =============================================================================
-- 7. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".pm_hoy() from public, anon;
revoke all on function :"schema".pm_etiqueta(integer) from public, anon;
revoke all on function :"schema".pm_estado(text, date) from public, anon;
revoke all on function :"schema".pm_sesion() from public, anon, authenticated;
revoke all on function :"schema".pedido_mostrador_json(uuid) from public, anon, authenticated;
revoke all on function :"schema".pedidos_mostrador_listar(boolean) from public, anon;
revoke all on function :"schema".pedido_mostrador_guardar(jsonb) from public, anon;
revoke all on function :"schema".pedido_mostrador_anular(uuid, text) from public, anon;
revoke all on function :"schema".pedido_mostrador_ver(uuid) from public, anon;
revoke all on function :"schema".pedidos_mostrador_por_cobrar(uuid) from public, anon;
revoke all on function :"schema".pedido_mostrador_por_numero(integer, uuid) from public, anon;
revoke all on function :"schema".pedido_mostrador_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean) from public, anon;
grant execute on function :"schema".pm_hoy() to authenticated, service_role;
grant execute on function :"schema".pm_etiqueta(integer) to authenticated, service_role;
grant execute on function :"schema".pm_estado(text, date) to authenticated, service_role;
grant execute on function :"schema".pm_sesion() to service_role;
grant execute on function :"schema".pedido_mostrador_json(uuid) to service_role;
grant execute on function :"schema".pedidos_mostrador_listar(boolean) to authenticated, service_role;
grant execute on function :"schema".pedido_mostrador_guardar(jsonb) to authenticated, service_role;
grant execute on function :"schema".pedido_mostrador_anular(uuid, text) to authenticated, service_role;
grant execute on function :"schema".pedido_mostrador_ver(uuid) to authenticated, service_role;
grant execute on function :"schema".pedidos_mostrador_por_cobrar(uuid) to authenticated, service_role;
grant execute on function :"schema".pedido_mostrador_por_numero(integer, uuid) to authenticated, service_role;
grant execute on function :"schema".pedido_mostrador_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean) to authenticated, service_role;

commit;
