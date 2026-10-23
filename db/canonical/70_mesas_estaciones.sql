-- =============================================================================
-- MESAS: ESTACIONES DE COCINA Y COMANDAS POR ESTACIÓN (pedido del dueño, 23-oct-2026).
--
-- Un restaurante con Plancha, Pizzería y Barra: cada pedido aceptado se divide en COMANDAS, una por
-- estación, y cada estación ve y marca SOLO su parte.
--
-- Tablas / columnas
--   · estaciones_cocina          nombre, color (#rrggbb), ícono (emoji), orden, activa. ABM en
--                                Configuración › Mesas y QR › Estaciones de cocina.
--   · categorias_productos.estacion_id   estación de la categoría (una subcategoría sin estación usa
--                                la de su categoría madre).
--   · productos.estacion_id      excepción por producto: gana sobre la categoría.
--   · usuarios.estacion_cocina_id  estación fija del usuario: entra directo a esa pantalla y solo
--                                puede marcar comandas de su estación (la caja puede todas).
--   · mesa_pedido_items.estacion_id  SNAPSHOT de la estación al aceptar (si después se cambia la
--                                categoría, el pedido ya repartido no se mueve). null = Cocina general.
--   · mesa_comandas              (pedido, estación): aceptado → en_preparacion → listo → entregado,
--                                con sus horas y impresa_at (ticket de 80 mm ya impreso).
--
-- Resolución de la estación de un producto (producto_estacion): la del producto → la de su categoría
-- → la de la categoría madre → null (Cocina general). Una estación inactiva no cuenta.
--
-- Estado del pedido = DERIVADO de sus comandas (mesa_pedido_derivar):
--   todas entregadas → entregado · todas listas (o entregadas) → listo · alguna empezada →
--   en_preparacion · si no → aceptado. El cliente en su celular ve solo ese estado general.
--
-- Acciones
--   · mesa_pedido_accion (68) redefinida: aceptar crea las comandas; rechazar (aceptado) las borra;
--     preparar / listo / entregar aplican a todas las partes; "entregar_listos" entrega solo lo listo.
--   · mesa_comanda_accion (nueva): preparar / listo / entregar / impresa sobre UNA comanda.
--   · mesa_cuenta_cobrar_caja (69) redefinida: al cobrar también da por entregadas las comandas.
--
-- Los pedidos vivos de antes de esta receta se migran: se resuelve la estación de cada ítem y se
-- crean sus comandas con el estado y las horas del pedido.
--
-- Semilla SOLO en erp_demo (la primera vez, si la empresa no tiene estaciones): Plancha, Pizzería,
-- Barra; Comidas y Postres → Plancha, Bebidas y Gaseosas → Barra, Pizza muzzarella (MENU-PIZZ) →
-- Pizzería como excepción de producto (no hay categoría Pizzas).
--
-- IDEMPOTENTE. Va después de 69 (redefine mesas_tablero, mesa_pedido_json, mesa_pedido_accion y
-- mesa_cuenta_cobrar_caja desde sus versiones vigentes). No toca el catálogo de permisos.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tablas y columnas
-- =============================================================================
create table if not exists :"schema".estaciones_cocina (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  color text,
  icono text,
  orden integer not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_estaciones_nombre check (length(btrim(nombre)) between 1 and 40),
  constraint chk_estaciones_color check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  constraint chk_estaciones_icono check (icono is null or length(icono) between 1 and 16)
);
create unique index if not exists uq_estaciones_cocina_nombre on :"schema".estaciones_cocina (empresa_id, lower(btrim(nombre)));
create index if not exists estaciones_cocina_emp_idx on :"schema".estaciones_cocina (empresa_id, orden, nombre);

alter table :"schema".categorias_productos add column if not exists estacion_id uuid
  references :"schema".estaciones_cocina(id) on delete set null;
alter table :"schema".productos add column if not exists estacion_id uuid
  references :"schema".estaciones_cocina(id) on delete set null;
alter table :"schema".usuarios add column if not exists estacion_cocina_id uuid
  references :"schema".estaciones_cocina(id) on delete set null;
-- Sin ON DELETE: una estación con comandas en el historial no se borra (se desactiva).
alter table :"schema".mesa_pedido_items add column if not exists estacion_id uuid
  references :"schema".estaciones_cocina(id);

create table if not exists :"schema".mesa_comandas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  pedido_id uuid not null references :"schema".mesa_pedidos(id) on delete cascade,
  estacion_id uuid references :"schema".estaciones_cocina(id),
  estacion_nombre text not null default 'Cocina general',
  estado text not null default 'aceptado',
  creado_at timestamptz not null default now(),
  preparando_at timestamptz,
  listo_at timestamptz,
  entregado_at timestamptz,
  impresa_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint chk_mesa_comandas_estado check (estado in ('aceptado', 'en_preparacion', 'listo', 'entregado'))
);
create unique index if not exists uq_mesa_comandas_pedido_estacion
  on :"schema".mesa_comandas (pedido_id, coalesce(estacion_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists mesa_comandas_estado_idx on :"schema".mesa_comandas (empresa_id, estado, creado_at);
create index if not exists mesa_comandas_estacion_idx on :"schema".mesa_comandas (estacion_id) where estacion_id is not null;

-- ── RLS: solo lectura para la sesión del usuario ────────────────────────────
alter table :"schema".estaciones_cocina enable row level security;
alter table :"schema".estaciones_cocina force row level security;
alter table :"schema".mesa_comandas enable row level security;
alter table :"schema".mesa_comandas force row level security;

drop policy if exists estaciones_cocina_propias on :"schema".estaciones_cocina;
create policy estaciones_cocina_propias on :"schema".estaciones_cocina for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists mesa_comandas_propias on :"schema".mesa_comandas;
create policy mesa_comandas_propias on :"schema".mesa_comandas for select to authenticated
  using (empresa_id = :"schema".empresa_actual());

revoke all on :"schema".estaciones_cocina, :"schema".mesa_comandas from anon, authenticated;
grant select on :"schema".estaciones_cocina, :"schema".mesa_comandas to authenticated;
grant all on :"schema".estaciones_cocina, :"schema".mesa_comandas to service_role;

-- La estación de una categoría / producto tiene que ser de la misma empresa (se editan por la API
-- con la sesión del usuario: sin esto se podría apuntar a una estación de otra empresa).
create or replace function :"schema".tg_estacion_misma_empresa()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.estacion_id is not null
     and not exists (select 1 from estaciones_cocina e where e.id = new.estacion_id and e.empresa_id = new.empresa_id) then
    raise exception 'La estación de cocina elegida no existe';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_categorias_estacion on :"schema".categorias_productos;
create trigger trg_categorias_estacion before insert or update of estacion_id on :"schema".categorias_productos
  for each row execute function :"schema".tg_estacion_misma_empresa();
drop trigger if exists trg_productos_estacion on :"schema".productos;
create trigger trg_productos_estacion before insert or update of estacion_id on :"schema".productos
  for each row execute function :"schema".tg_estacion_misma_empresa();

-- =============================================================================
-- 2. Semilla (solo erp_demo, la primera vez)
-- =============================================================================
select (:'schema' = 'erp_demo') as es_demo \gset
\if :es_demo
do $seed$
declare
  e record;
  v_plancha uuid;
  v_pizza uuid;
  v_barra uuid;
begin
  for e in select id from empresas loop
    if exists (select 1 from estaciones_cocina where empresa_id = e.id) then continue; end if;
    insert into estaciones_cocina (empresa_id, nombre, color, icono, orden) values (e.id, 'Plancha', '#ef4444', '🔥', 1) returning id into v_plancha;
    insert into estaciones_cocina (empresa_id, nombre, color, icono, orden) values (e.id, 'Pizzería', '#f97316', '🍕', 2) returning id into v_pizza;
    insert into estaciones_cocina (empresa_id, nombre, color, icono, orden) values (e.id, 'Barra', '#3b82f6', '🍺', 3) returning id into v_barra;
    update categorias_productos set estacion_id = v_plancha
     where empresa_id = e.id and estacion_id is null and lower(btrim(nombre)) in ('comidas', 'postres');
    update categorias_productos set estacion_id = v_barra
     where empresa_id = e.id and estacion_id is null and lower(btrim(nombre)) in ('bebidas', 'gaseosas');
    update categorias_productos set estacion_id = v_pizza
     where empresa_id = e.id and estacion_id is null and lower(btrim(nombre)) in ('pizzas', 'pizzería', 'pizzeria');
    if not found then
      -- No hay categoría Pizzas: la pizza va a Pizzería como excepción del producto.
      update productos set estacion_id = v_pizza
       where empresa_id = e.id and estacion_id is null and (sku = 'MENU-PIZZ' or nombre ilike 'pizz%muzzarella%');
    end if;
  end loop;
end;
$seed$;
\endif

-- =============================================================================
-- 3. Helpers internos (no se le dan a nadie)
-- =============================================================================

-- Estación de un producto: la del producto → su categoría → la categoría madre (solo activas).
create or replace function :"schema".producto_estacion(p_producto uuid)
returns uuid language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(ep.id, ec.id, em.id)
    from productos pr
    left join estaciones_cocina ep on ep.id = pr.estacion_id and ep.activa
    left join categorias_productos c on c.id = pr.categoria_principal_id
    left join estaciones_cocina ec on ec.id = c.estacion_id and ec.activa
    left join categorias_productos cm on cm.id = c.parent_id
    left join estaciones_cocina em on em.id = cm.estacion_id and em.activa
   where pr.id = p_producto
$$;

-- Al aceptar: snapshot de la estación de cada ítem y una comanda por estación.
create or replace function :"schema".mesa_pedido_comandas_crear(p_pedido uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  update mesa_pedido_items set estacion_id = producto_estacion(producto_id) where pedido_id = p_pedido;
  insert into mesa_comandas (empresa_id, pedido_id, estacion_id, estacion_nombre)
    select p.empresa_id, p.id, i.estacion_id, coalesce(max(e.nombre), 'Cocina general')
      from mesa_pedido_items i
      join mesa_pedidos p on p.id = i.pedido_id
      left join estaciones_cocina e on e.id = i.estacion_id
     where i.pedido_id = p_pedido
     group by p.empresa_id, p.id, i.estacion_id
  on conflict do nothing;
end;
$fn$;

-- Estado del pedido derivado de sus comandas (y sus horas). Devuelve el estado resultante.
create or replace function :"schema".mesa_pedido_derivar(p_pedido uuid)
returns text language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  p mesa_pedidos;
  n integer;
  n_ent integer;
  n_lis integer;
  n_prep integer;
  v text;
begin
  select * into p from mesa_pedidos where id = p_pedido;
  if not found then return null; end if;
  if p.estado not in ('aceptado', 'en_preparacion', 'listo', 'entregado') then return p.estado; end if;
  select count(*), count(*) filter (where estado = 'entregado'), count(*) filter (where estado = 'listo'),
         count(*) filter (where estado = 'en_preparacion')
    into n, n_ent, n_lis, n_prep
    from mesa_comandas where pedido_id = p_pedido;
  if n = 0 then return p.estado; end if;
  v := case when n_ent = n then 'entregado'
            when n_ent + n_lis = n then 'listo'
            when n_ent + n_lis + n_prep > 0 then 'en_preparacion'
            else 'aceptado' end;
  if v is distinct from p.estado then
    update mesa_pedidos set
        estado = v,
        preparando_at = case when v <> 'aceptado' then coalesce(preparando_at, now()) else preparando_at end,
        listo_at = case when v in ('listo', 'entregado') then coalesce(listo_at, now()) else listo_at end,
        entregado_at = case when v = 'entregado' then coalesce(entregado_at, now()) else entregado_at end,
        updated_at = now()
      where id = p_pedido;
  end if;
  return v;
end;
$fn$;

-- Un pedido como lo ven la caja y la cocina (68 + estación de cada ítem + comandas).
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
        'total', i.total, 'nota', i.nota, 'estacion_id', i.estacion_id) order by i.producto_nombre, i.id)
      from mesa_pedido_items i where i.pedido_id = p.id), '[]'::jsonb),
    'comandas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'estacion_id', k.estacion_id, 'estacion_nombre', coalesce(e.nombre, k.estacion_nombre),
        'color', e.color, 'icono', e.icono, 'estado', k.estado, 'creado_at', k.creado_at,
        'preparando_at', k.preparando_at, 'listo_at', k.listo_at, 'entregado_at', k.entregado_at,
        'impresa_at', k.impresa_at)
        order by (k.estacion_id is null), e.orden, coalesce(e.nombre, k.estacion_nombre))
      from mesa_comandas k left join estaciones_cocina e on e.id = k.estacion_id
      where k.pedido_id = p.id), '[]'::jsonb))
  from mesa_pedidos p
  join mesas m on m.id = p.mesa_id
  join sucursales s on s.id = m.sucursal_id
  where p.id = p_id
$$;

-- =============================================================================
-- 4. Tablero (69 + estaciones y la estación fija del usuario)
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
    'pedidos', coalesce((select jsonb_agg(mesa_pedido_json(p.id) order by p.creado_at, p.numero)
      from mesa_pedidos p join mesas m on m.id = p.mesa_id
      where p.empresa_id = s.s_empresa
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)
        and (p.estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')
             or coalesce(p.entregado_at, p.rechazado_at, p.updated_at) > now() - interval '1 hour')), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'abierta_at', c.abierta_at,
        'estado', case when c.en_caja_at is not null then 'en_caja' else 'abierta' end,
        'en_caja_at', c.en_caja_at, 'en_caja_por_nombre', c.en_caja_por_nombre,
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
    'estaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nombre', e.nombre, 'color', e.color, 'icono', e.icono, 'orden', e.orden, 'activa', e.activa)
        order by e.orden, e.nombre)
      from estaciones_cocina e where e.empresa_id = s.s_empresa), '[]'::jsonb),
    'mi_estacion_id', (select u.estacion_cocina_id from usuarios u where u.id = s.s_usuario),
    'puede_atender', tiene_permiso('pedidos_mesas'),
    'puede_cocina', tiene_permiso('cocina'));
end;
$fn$;

-- =============================================================================
-- 5. Acciones sobre el pedido (68 + comandas)
-- =============================================================================
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
  v_con_comandas boolean;
  n integer;
begin
  select * into s from mesa_sesion();
  select * into p from mesa_pedidos where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  select m.sucursal_id into v_suc from mesas m where m.id = p.mesa_id;
  if s.s_sucursal is not null and v_suc <> s.s_sucursal then raise exception 'Ese pedido es de otra sucursal'; end if;
  select estado into v_cuenta from mesa_cuentas where id = p.cuenta_id;
  if v_cuenta <> 'abierta' then raise exception 'La cuenta de esa mesa ya se cerró'; end if;
  v_con_comandas := exists (select 1 from mesa_comandas where pedido_id = p.id);

  if p_accion = 'aceptar' then
    if not v_caja then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado <> 'nuevo' then raise exception 'Ese pedido ya fue atendido'; end if;
    update mesa_pedidos set estado = 'aceptado', aceptado_at = now(), aceptado_por = s.s_usuario, aceptado_por_nombre = s.s_nombre,
           updated_at = now() where id = p.id;
    -- Se divide en comandas por estación (snapshot de la estación de cada ítem).
    perform mesa_pedido_comandas_crear(p.id);
  elsif p_accion = 'rechazar' then
    if not v_caja then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('nuevo', 'aceptado') then raise exception 'Ese pedido ya se está preparando: no se puede rechazar'; end if;
    if v_motivo is null then raise exception 'Escribí el motivo (lo ve el cliente en su celular)'; end if;
    delete from mesa_comandas where pedido_id = p.id;
    update mesa_pedidos set estado = 'rechazado', rechazado_at = now(), rechazado_por = s.s_usuario, motivo_rechazo = v_motivo,
           updated_at = now() where id = p.id;
  elsif p_accion = 'preparar' then
    if not (v_cocina or v_caja) then perform exigir_permiso('cocina'); end if;
    if p.estado <> 'aceptado' then raise exception 'Solo un pedido aceptado pasa a "en preparación"'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'en_preparacion', preparando_at = now(), updated_at = now()
       where pedido_id = p.id and estado = 'aceptado';
      perform mesa_pedido_derivar(p.id);
    else
      update mesa_pedidos set estado = 'en_preparacion', preparando_at = now(), updated_at = now() where id = p.id;
    end if;
  elsif p_accion = 'listo' then
    if not (v_cocina or v_caja) then perform exigir_permiso('cocina'); end if;
    if p.estado not in ('aceptado', 'en_preparacion') then raise exception 'Ese pedido no está en preparación'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'listo', preparando_at = coalesce(preparando_at, now()), listo_at = now(), updated_at = now()
       where pedido_id = p.id and estado in ('aceptado', 'en_preparacion');
      perform mesa_pedido_derivar(p.id);
    else
      update mesa_pedidos set estado = 'listo', preparando_at = coalesce(preparando_at, now()), listo_at = now(), updated_at = now()
        where id = p.id;
    end if;
  elsif p_accion = 'entregar' then
    if not (v_cocina or v_caja) then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('aceptado', 'en_preparacion', 'listo') then raise exception 'Ese pedido no se puede marcar como entregado'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'entregado', preparando_at = coalesce(preparando_at, now()), listo_at = coalesce(listo_at, now()),
             entregado_at = now(), updated_at = now()
       where pedido_id = p.id and estado <> 'entregado';
      perform mesa_pedido_derivar(p.id);
    else
      update mesa_pedidos set estado = 'entregado', listo_at = coalesce(listo_at, now()), entregado_at = now(), updated_at = now()
        where id = p.id;
    end if;
  elsif p_accion = 'entregar_listos' then
    -- "Entregar todo lo listo": las partes listas se entregan; las demás siguen en cocina.
    if not (v_cocina or v_caja) then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('aceptado', 'en_preparacion', 'listo') then raise exception 'Ese pedido no se puede marcar como entregado'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'entregado', entregado_at = now(), updated_at = now()
       where pedido_id = p.id and estado = 'listo';
      get diagnostics n = row_count;
      if n = 0 then raise exception 'Ese pedido no tiene partes listas para entregar'; end if;
      perform mesa_pedido_derivar(p.id);
    else
      if p.estado <> 'listo' then raise exception 'Ese pedido no tiene partes listas para entregar'; end if;
      update mesa_pedidos set estado = 'entregado', entregado_at = now(), updated_at = now() where id = p.id;
    end if;
  else
    raise exception 'Acción inválida';
  end if;
  return mesa_pedido_json(p.id);
end;
$fn$;

-- =============================================================================
-- 6. Acciones sobre UNA comanda (pantalla de la estación o la caja)
-- =============================================================================
create or replace function :"schema".mesa_comanda_accion(p_id uuid, p_accion text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  k mesa_comandas;
  p mesa_pedidos;
  v_suc uuid;
  v_cuenta text;
  v_caja boolean := tiene_permiso('pedidos_mesas');
  v_cocina boolean := tiene_permiso('cocina');
  v_fija uuid;
begin
  select * into s from mesa_sesion();
  if not (v_caja or v_cocina) then perform exigir_permiso('cocina'); end if;
  select * into k from mesa_comandas where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Comanda no encontrada'; end if;
  -- Mismo orden de bloqueo que mesa_pedido_accion: primero el pedido, después la comanda.
  select * into p from mesa_pedidos where id = k.pedido_id for update;
  select * into k from mesa_comandas where id = p_id for update;
  select m.sucursal_id into v_suc from mesas m where m.id = p.mesa_id;
  if s.s_sucursal is not null and v_suc <> s.s_sucursal then raise exception 'Esa comanda es de otra sucursal'; end if;

  if p_accion = 'impresa' then
    update mesa_comandas set impresa_at = coalesce(impresa_at, now()) where id = k.id;
    return jsonb_build_object('id', k.id, 'impresa', true);
  end if;

  select estado into v_cuenta from mesa_cuentas where id = p.cuenta_id;
  if v_cuenta <> 'abierta' then raise exception 'La cuenta de esa mesa ya se cerró'; end if;
  if p.estado not in ('aceptado', 'en_preparacion', 'listo') then raise exception 'Ese pedido ya no está en cocina'; end if;
  -- Usuario con estación fija (y sin la caja): solo su estación.
  if not v_caja then
    select u.estacion_cocina_id into v_fija from usuarios u where u.id = s.s_usuario;
    if v_fija is not null and k.estacion_id is distinct from v_fija then
      raise exception 'Esa comanda es de otra estación (%)', k.estacion_nombre;
    end if;
  end if;

  if p_accion = 'preparar' then
    if k.estado <> 'aceptado' then raise exception 'Solo una comanda para preparar pasa a "en preparación"'; end if;
    update mesa_comandas set estado = 'en_preparacion', preparando_at = now(), updated_at = now() where id = k.id;
  elsif p_accion = 'listo' then
    if k.estado not in ('aceptado', 'en_preparacion') then raise exception 'Esa comanda no está en preparación'; end if;
    update mesa_comandas set estado = 'listo', preparando_at = coalesce(preparando_at, now()), listo_at = now(), updated_at = now()
     where id = k.id;
  elsif p_accion = 'entregar' then
    if k.estado <> 'listo' then raise exception 'Esa parte todavía no está lista'; end if;
    update mesa_comandas set estado = 'entregado', entregado_at = now(), updated_at = now() where id = k.id;
  else
    raise exception 'Acción inválida';
  end if;
  perform mesa_pedido_derivar(p.id);
  return mesa_pedido_json(p.id);
end;
$fn$;

-- =============================================================================
-- 7. Cobrar en caja (69 + las comandas quedan entregadas)
-- =============================================================================
create or replace function :"schema".mesa_cuenta_cobrar_caja(
  p_cuenta_id uuid, p_version text,
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket', p_cliente_ocasional boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  m mesas;
  v_caja uuid;
  v_suc_caja uuid;
  v_previa uuid;
  v_venta jsonb;
  g record;
  v_en_carrito numeric;
  v_quien text;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  -- La fila de la cuenta serializa a los cajeros: el segundo espera y ve que ya se cobró.
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta de mesa no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;

  -- Reintento del mismo POS: la venta ya está hecha y la cuenta cerrada con ella.
  if nullif(p_idempotency_key, '') is not null then
    select id into v_previa from ventas where empresa_id = s.s_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_previa is not null and c.venta_id = v_previa then
      return jsonb_build_object('venta_id', v_previa, 'numero_control', (select numero_control from ventas where id = v_previa),
                                'reusada', true, 'mesa', m.nombre);
    end if;
  end if;

  if c.estado = 'cerrada' then
    select coalesce(u.nombre, 'otro usuario') into v_quien from usuarios u where u.id = c.cerrada_por;
    raise exception 'La cuenta de "%" ya se cobró (%): soltala del carrito', m.nombre, coalesce(v_quien, 'otro usuario');
  end if;
  if c.estado <> 'abierta' then raise exception 'La cuenta de "%" ya no está abierta: soltala del carrito', m.nombre; end if;
  if c.en_caja_at is null then raise exception 'La cuenta de "%" ya no está en caja (la volvieron a abrir): soltala del carrito', m.nombre; end if;
  if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado = 'nuevo') then
    raise exception 'La mesa "%" tiene un pedido nuevo sin atender: aceptalo o rechazalo en Pedidos de mesas antes de cobrar', m.nombre;
  end if;
  if p_version is null or p_version <> mesa_cuenta_version(c.id) then
    raise exception 'La cuenta de "%" cambió desde que la cargaste: recargala antes de cobrar', m.nombre;
  end if;

  -- Caja: abierta y de la sucursal de la mesa.
  v_caja := caja_abierta_para(null, null, p_caja_id);
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> m.sucursal_id then raise exception 'La mesa "%" es de otra sucursal: cobrala en una caja de su sucursal', m.nombre; end if;

  -- El carrito trae, por producto, al menos lo que pidió la mesa (no se quitan ítems de la cuenta).
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'La venta debe tener al menos un ítem'; end if;
  for g in
    select i.producto_id, max(i.producto_nombre) as nombre, sum(i.cantidad) as cantidad
      from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
     where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
     group by i.producto_id
  loop
    if g.producto_id is null then
      raise exception 'El producto "%" de la cuenta ya no existe en el catálogo: no se puede cobrar en caja', g.nombre;
    end if;
    select coalesce(sum((x->>'cantidad')::numeric), 0) into v_en_carrito
      from jsonb_array_elements(p_items) x where x->>'producto_id' = g.producto_id::text;
    if v_en_carrito < g.cantidad then
      raise exception 'No se pueden quitar productos de la cuenta de la mesa: "%" pidió %, en el carrito hay %',
        g.nombre, trim_scale(g.cantidad), trim_scale(v_en_carrito);
    end if;
  end loop;

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Cuenta de mesa: ' || m.nombre || coalesce(' · ' || m.zona, ''), 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);

  update mesa_cuentas set estado = 'cerrada', cerrada_at = now(), cerrada_por = s.s_usuario,
         venta_id = (v_venta->>'venta_id')::uuid, total = coalesce((v_venta->>'total')::numeric, 0)
   where id = c.id;
  -- Lo que quedó sin entregar se da por entregado al cobrar (las comandas de cada estación también).
  update mesa_comandas k set estado = 'entregado', preparando_at = coalesce(k.preparando_at, now()),
         listo_at = coalesce(k.listo_at, now()), entregado_at = now(), updated_at = now()
    from mesa_pedidos p
   where p.id = k.pedido_id and p.cuenta_id = c.id and k.estado <> 'entregado';
  update mesa_pedidos set estado = 'entregado', entregado_at = now(), listo_at = coalesce(listo_at, now()), updated_at = now()
   where cuenta_id = c.id and estado in ('aceptado', 'en_preparacion', 'listo');
  return v_venta || jsonb_build_object('mesa', m.nombre);
end;
$fn$;

-- =============================================================================
-- 8. Configuración › Mesas y QR › Estaciones de cocina (ADMIN + "Configuración del sistema")
-- =============================================================================
create or replace function :"schema".estaciones_cocina_listar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  return jsonb_build_object(
    'estaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nombre', e.nombre, 'color', e.color, 'icono', e.icono, 'orden', e.orden, 'activa', e.activa,
        'categorias', coalesce((select jsonb_agg(case when cm.id is null then c.nombre else cm.nombre || ' › ' || c.nombre end
                                  order by coalesce(cm.nombre, c.nombre), c.parent_id nulls first, c.nombre)
                                from categorias_productos c left join categorias_productos cm on cm.id = c.parent_id
                               where c.estacion_id = e.id), '[]'::jsonb),
        'productos', (select count(*) from productos pr where pr.estacion_id = e.id),
        'usada', exists (select 1 from mesa_comandas k where k.estacion_id = e.id)
                 or exists (select 1 from mesa_pedido_items i where i.estacion_id = e.id))
        order by e.orden, e.nombre)
      from estaciones_cocina e where e.empresa_id = s.s_empresa), '[]'::jsonb),
    -- Usuarios que ven la cocina (Administrador o perfil con "Pantalla de cocina").
    'usuarios', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre, 'perfil', pf.nombre, 'estacion_id', u.estacion_cocina_id)
        order by u.nombre)
      from usuarios u left join perfiles pf on pf.id = u.perfil_id
      where u.empresa_id = s.s_empresa and u.activo and not coalesce(u.es_tecnico, false)
        and (pf.codigo = 'ADMIN' or u.rol = 'ADMIN'
             or exists (select 1 from perfil_permisos pp where pp.perfil_id = u.perfil_id and pp.permiso = 'cocina'))), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".estacion_cocina_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_color text := nullif(btrim(coalesce(p->>'color', '')), '');
  v_icono text := nullif(btrim(coalesce(p->>'icono', '')), '');
  v_orden integer := coalesce(nullif(p->>'orden', '')::integer, 0);
  v_activa boolean := coalesce((p->>'activa')::boolean, true);
  r estaciones_cocina;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  if v_nombre is null then raise exception 'Escribí el nombre de la estación (ej. Plancha, Barra)'; end if;
  if length(v_nombre) > 40 then raise exception 'El nombre de la estación es muy largo (hasta 40 letras)'; end if;
  if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color inválido'; end if;
  if v_icono is not null and length(v_icono) > 16 then raise exception 'Ícono inválido'; end if;
  if v_orden < 0 or v_orden > 100000 then raise exception 'Orden inválido'; end if;
  if exists (select 1 from estaciones_cocina where empresa_id = s.s_empresa and lower(btrim(nombre)) = lower(v_nombre)
               and id is distinct from v_id) then
    raise exception 'Ya hay una estación "%"', v_nombre;
  end if;
  if v_id is null then
    insert into estaciones_cocina (empresa_id, nombre, color, icono, orden, activa)
      values (s.s_empresa, v_nombre, v_color, v_icono, v_orden, v_activa) returning * into r;
  else
    update estaciones_cocina set nombre = v_nombre, color = v_color, icono = v_icono, orden = v_orden, activa = v_activa,
           updated_at = now()
     where id = v_id and empresa_id = s.s_empresa returning * into r;
    if not found then raise exception 'Estación no encontrada'; end if;
  end if;
  return jsonb_build_object('id', r.id);
end;
$fn$;

create or replace function :"schema".estacion_cocina_eliminar(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  if not exists (select 1 from estaciones_cocina where id = p_id and empresa_id = s.s_empresa) then
    raise exception 'Estación no encontrada';
  end if;
  if exists (select 1 from mesa_comandas where estacion_id = p_id) or exists (select 1 from mesa_pedido_items where estacion_id = p_id) then
    raise exception 'La estación ya tiene comandas en el historial: desactivala en lugar de eliminarla';
  end if;
  -- Categorías, productos y usuarios que la tenían quedan sin estación (on delete set null).
  delete from estaciones_cocina where id = p_id and empresa_id = s.s_empresa;
end;
$fn$;

-- Estación fija de un usuario (null = elige en la pantalla).
create or replace function :"schema".usuario_estacion_cocina(p_usuario uuid, p_estacion uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('configuracion');
  if p_estacion is not null and not exists (select 1 from estaciones_cocina where id = p_estacion and empresa_id = s.s_empresa) then
    raise exception 'Estación no encontrada';
  end if;
  update usuarios set estacion_cocina_id = p_estacion where id = p_usuario and empresa_id = s.s_empresa;
  if not found then raise exception 'Usuario no encontrado'; end if;
  return jsonb_build_object('id', p_usuario, 'estacion_id', p_estacion);
end;
$fn$;

-- =============================================================================
-- 9. Migración: los pedidos vivos de antes pasan a comandas
-- =============================================================================
do $mig$
declare
  r record;
begin
  for r in
    select p.id, p.estado, p.aceptado_at, p.preparando_at, p.listo_at
      from mesa_pedidos p
     where p.estado in ('aceptado', 'en_preparacion', 'listo')
       and not exists (select 1 from mesa_comandas k where k.pedido_id = p.id)
  loop
    perform mesa_pedido_comandas_crear(r.id);
    update mesa_comandas
       set estado = r.estado, creado_at = coalesce(r.aceptado_at, creado_at),
           preparando_at = case when r.estado <> 'aceptado' then coalesce(r.preparando_at, r.aceptado_at, now()) end,
           listo_at = case when r.estado = 'listo' then coalesce(r.listo_at, now()) end,
           impresa_at = now() -- ya estaban en la cocina: no se reimprimen solas
     where pedido_id = r.id;
  end loop;
end;
$mig$;

-- =============================================================================
-- 10. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".tg_estacion_misma_empresa() from public;
revoke all on function :"schema".producto_estacion(uuid) from public;
revoke all on function :"schema".mesa_pedido_comandas_crear(uuid) from public;
revoke all on function :"schema".mesa_pedido_derivar(uuid) from public;
revoke all on function :"schema".mesa_pedido_json(uuid) from public;
revoke all on function :"schema".mesas_tablero() from public;
revoke all on function :"schema".mesa_pedido_accion(uuid, text, text) from public;
revoke all on function :"schema".mesa_comanda_accion(uuid, text) from public;
revoke all on function :"schema".mesa_cuenta_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean) from public;
revoke all on function :"schema".estaciones_cocina_listar() from public;
revoke all on function :"schema".estacion_cocina_guardar(jsonb) from public;
revoke all on function :"schema".estacion_cocina_eliminar(uuid) from public;
revoke all on function :"schema".usuario_estacion_cocina(uuid, uuid) from public;

grant execute on function
  :"schema".mesas_tablero(),
  :"schema".mesa_pedido_accion(uuid, text, text),
  :"schema".mesa_comanda_accion(uuid, text),
  :"schema".mesa_cuenta_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean),
  :"schema".estaciones_cocina_listar(),
  :"schema".estacion_cocina_guardar(jsonb),
  :"schema".estacion_cocina_eliminar(uuid),
  :"schema".usuario_estacion_cocina(uuid, uuid)
  to authenticated, service_role;

commit;
