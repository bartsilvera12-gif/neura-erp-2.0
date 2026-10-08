-- =============================================================================
-- Órdenes de compra (Fase 3, portado de Ferretería República).
-- La orden es el PEDIDO al proveedor: no mueve stock ni pide factura. La mercadería
-- se "recibe" cargando una compra desde la orden (puede ser en varias veces): la
-- compra suma lo recibido a cada línea y la orden pasa sola de pendiente a
-- recibida_parcial y recibida_total. Anular esa compra devuelve lo recibido.
--   · ordenes_compra / ordenes_compra_items
--   · guardar_orden_compra(p jsonb)        crea o edita (editar solo sin recepciones)
--   · cancelar_orden_compra(id, motivo)
--   · recalcular_orden_compra(id)          estado según lo recibido
--   · registrar_compra / anular_compra     redefinidas para recibir órdenes
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create table if not exists :"schema".ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero_oc text not null,
  proveedor_id uuid not null references :"schema".proveedores(id),
  proveedor_nombre text not null,
  fecha timestamptz not null default now(),
  fecha_entrega date,
  tipo_pago text not null default 'contado',
  plazo_dias integer,
  moneda text not null default 'GS',
  tipo_cambio numeric not null default 1,
  total numeric not null default 0,
  estado text not null default 'pendiente',
  observacion text,
  created_by uuid,
  usuario_nombre text,
  cancelada_at timestamptz,
  cancelada_por text,
  cancelada_motivo text,
  busqueda text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_oc_tipo_pago check (tipo_pago in ('contado', 'credito')),
  constraint chk_oc_moneda check (moneda in ('GS', 'USD')),
  constraint chk_oc_estado check (estado in ('pendiente', 'recibida_parcial', 'recibida_total', 'cancelada')),
  constraint chk_oc_cambio check (tipo_cambio > 0)
);
create unique index if not exists uq_oc_numero on :"schema".ordenes_compra(empresa_id, numero_oc);
create index if not exists oc_empresa_fecha_idx on :"schema".ordenes_compra(empresa_id, fecha desc);

create table if not exists :"schema".ordenes_compra_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  orden_compra_id uuid not null references :"schema".ordenes_compra(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id),
  producto_nombre text not null,
  producto_sku text,
  cantidad numeric not null check (cantidad > 0),
  cantidad_recibida numeric not null default 0 check (cantidad_recibida >= 0),
  costo_unitario_original numeric not null default 0,
  costo_unitario numeric not null default 0,      -- en Gs., IVA incluido (estimado)
  tipo_iva text not null default '10%',
  total numeric not null default 0,
  orden integer not null default 0
);
create index if not exists oc_items_oc_idx on :"schema".ordenes_compra_items(orden_compra_id);

-- Trazabilidad compra ↔ orden.
alter table :"schema".compras add column if not exists orden_compra_id uuid references :"schema".ordenes_compra(id) on delete set null;
alter table :"schema".compras_items add column if not exists oc_item_id uuid references :"schema".ordenes_compra_items(id) on delete set null;
create index if not exists compras_oc_idx on :"schema".compras(orden_compra_id) where orden_compra_id is not null;

-- --- RLS ---
alter table :"schema".ordenes_compra enable row level security;
alter table :"schema".ordenes_compra force row level security;
alter table :"schema".ordenes_compra_items enable row level security;
alter table :"schema".ordenes_compra_items force row level security;
drop policy if exists oc_propias on :"schema".ordenes_compra;
create policy oc_propias on :"schema".ordenes_compra to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists oc_items_propios on :"schema".ordenes_compra_items;
create policy oc_items_propios on :"schema".ordenes_compra_items to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".ordenes_compra, :"schema".ordenes_compra_items to authenticated, service_role;

-- Estado según lo recibido (una cancelada queda cancelada).
create or replace function :"schema".recalcular_orden_compra(p_id uuid)
returns text
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_estado text;
begin
  select case
           when o.estado = 'cancelada' then 'cancelada'
           when coalesce(sum(i.cantidad_recibida), 0) = 0 then 'pendiente'
           when bool_and(i.cantidad_recibida >= i.cantidad) then 'recibida_total'
           else 'recibida_parcial' end
    into v_estado
    from ordenes_compra o left join ordenes_compra_items i on i.orden_compra_id = o.id
   where o.id = p_id and o.empresa_id = empresa_actual()
   group by o.estado;
  update ordenes_compra set estado = v_estado, updated_at = now() where id = p_id and estado <> v_estado;
  return v_estado;
end;
$fn$;

-- =============================================================================
-- guardar_orden_compra(p jsonb)
--   { id? (para editar), proveedor_id, fecha_entrega?, tipo_pago, plazo_dias?, moneda,
--     tipo_cambio?, observacion?, items: [{ producto_id, cantidad, costo_unitario }] }
-- Editar solo mientras no se recibió nada. → { id, numero_oc, total }
-- =============================================================================
create or replace function :"schema".guardar_orden_compra(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_prov record;
  v_numero text;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then (p->>'tipo_cambio')::numeric else 1 end;
  v_tipo_pago text := coalesce(nullif(p->>'tipo_pago', ''), 'contado');
  it jsonb;
  prod record;
  v_cant numeric;
  v_costo_orig numeric;
  v_costo numeric;
  v_total numeric := 0;
  v_usuario_nombre text;
  v_orden integer := 0;
  v_actual record;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre into v_prov
    from proveedores where id = (p->>'proveedor_id')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el proveedor'; end if;
  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición de pago inválida'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'La orden no tiene productos';
  end if;

  select u.nombre into v_usuario_nombre from usuarios u
   where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;

  if v_id is null then
    v_numero := 'OC-' || lpad(reservar_secuencia('orden_compra', coalesce((
                  select max(substring(numero_oc from '[0-9]+$')::bigint) from ordenes_compra where empresa_id = v_empresa), 0))::text, 6, '0');
    insert into ordenes_compra (empresa_id, numero_oc, proveedor_id, proveedor_nombre, fecha_entrega, tipo_pago,
                                plazo_dias, moneda, tipo_cambio, observacion, created_by, usuario_nombre)
      values (v_empresa, v_numero, v_prov.id, v_prov.nombre, nullif(p->>'fecha_entrega', '')::date, v_tipo_pago,
              case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
              v_moneda, v_cambio, nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre)
      returning id into v_id;
  else
    select * into v_actual from ordenes_compra where id = v_id and empresa_id = v_empresa for update;
    if not found then raise exception 'Orden de compra no encontrada'; end if;
    if v_actual.estado <> 'pendiente' or exists (select 1 from ordenes_compra_items where orden_compra_id = v_id and cantidad_recibida > 0) then
      raise exception 'La orden ya tiene mercadería recibida o está cancelada: no se puede editar';
    end if;
    v_numero := v_actual.numero_oc;
    update ordenes_compra set proveedor_id = v_prov.id, proveedor_nombre = v_prov.nombre,
           fecha_entrega = nullif(p->>'fecha_entrega', '')::date, tipo_pago = v_tipo_pago,
           plazo_dias = case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
           moneda = v_moneda, tipo_cambio = v_cambio, observacion = nullif(btrim(p->>'observacion'), ''), updated_at = now()
     where id = v_id;
    delete from ordenes_compra_items where orden_compra_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    v_cant := (it->>'cantidad')::numeric;
    v_costo_orig := coalesce(nullif(it->>'costo_unitario', '')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_costo_orig < 0 then raise exception 'Producto %: el costo no puede ser negativo', v_orden; end if;
    v_costo := round(v_costo_orig * v_cambio, 2);
    select * into prod from productos where id = (it->>'producto_id')::uuid and empresa_id = v_empresa;
    if not found then raise exception 'Producto % no encontrado', v_orden; end if;
    insert into ordenes_compra_items (empresa_id, orden_compra_id, producto_id, producto_nombre, producto_sku, cantidad,
                                      costo_unitario_original, costo_unitario, tipo_iva, total, orden)
      values (v_empresa, v_id, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              round(v_cant * v_costo), v_orden);
    v_total := v_total + round(v_cant * v_costo);
  end loop;

  update ordenes_compra set total = v_total,
         busqueda = concat_ws(' ', norm(v_numero), compacto(v_numero), norm(v_prov.nombre),
                              (select string_agg(norm(i.producto_nombre) || ' ' || norm(i.producto_sku) || ' ' || compacto(i.producto_sku), ' ')
                                 from ordenes_compra_items i where i.orden_compra_id = v_id))
   where id = v_id;
  return jsonb_build_object('id', v_id, 'numero_oc', v_numero, 'total', v_total);
end;
$fn$;

-- Cancelar: si ya se recibió una parte, lo recibido queda (sus compras siguen vigentes)
-- y lo pendiente deja de esperarse.
create or replace function :"schema".cancelar_orden_compra(p_id uuid, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  o record;
  v_usuario_nombre text;
begin
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo'; end if;
  select * into o from ordenes_compra where id = p_id and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Orden de compra no encontrada'; end if;
  if o.estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;
  if o.estado = 'recibida_total' then raise exception 'La orden ya se recibió completa'; end if;
  select u.nombre into v_usuario_nombre from usuarios u
   where u.auth_user_id = auth.uid() and u.empresa_id = empresa_actual() limit 1;
  update ordenes_compra set estado = 'cancelada', cancelada_at = now(), cancelada_por = v_usuario_nombre,
         cancelada_motivo = left(btrim(p_motivo), 500), updated_at = now()
   where id = o.id;
  return jsonb_build_object('id', o.id, 'numero_oc', o.numero_oc);
end;
$fn$;

-- La compra sabe recibir una orden (orden_compra_id + oc_item_id por línea).
drop function if exists :"schema".registrar_compra(jsonb);
create or replace function :"schema".registrar_compra(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_prov record;
  v_compra uuid;
  v_numero text;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then (p->>'tipo_cambio')::numeric else 1 end;
  v_tipo_pago text := coalesce(nullif(p->>'tipo_pago', ''), 'contado');
  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_fecha_fact date := nullif(p->>'fecha_factura', '')::date;
  v_factura text := nullif(btrim(p->>'numero_factura'), '');
  v_timbrado text := nullif(btrim(p->>'nro_timbrado'), '');
  it jsonb;
  prod record;
  v_cant numeric;
  v_costo_orig numeric;
  v_costo numeric;
  v_total_linea numeric;
  v_cpp numeric;
  v_pv numeric;
  v_subtotal numeric := 0;
  v_iva numeric := 0;
  v_total numeric := 0;
  v_usuario uuid;
  v_usuario_nombre text;
  v_orden integer := 0;
  v_oc uuid := nullif(p->>'orden_compra_id', '')::uuid;
  v_oc_estado text;
  v_oc_item uuid;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre, activo into v_prov
    from proveedores where id = (p->>'proveedor_id')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el proveedor'; end if;
  if v_factura is null then raise exception 'Falta el número de factura'; end if;
  -- Recepción de una orden de compra: tiene que ser del mismo proveedor y no estar cancelada.
  if v_oc is not null then
    select estado into v_oc_estado from ordenes_compra
     where id = v_oc and empresa_id = v_empresa and proveedor_id = v_prov.id for update;
    if not found then raise exception 'La orden de compra no es de este proveedor'; end if;
    if v_oc_estado = 'cancelada' then raise exception 'La orden de compra está cancelada'; end if;
  end if;
  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición de pago inválida'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'La compra no tiene productos';
  end if;

  -- Misma factura ya cargada (no anulada).
  if exists (select 1 from compras c
              where c.empresa_id = v_empresa and c.proveedor_id = v_prov.id and c.estado <> 'anulada'
                and coalesce(c.nro_timbrado, '') = coalesce(v_timbrado, '')
                and regexp_replace(lower(c.numero_factura), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(v_factura), '[^a-z0-9]+', '', 'g')) then
    raise exception 'La factura % de % ya está cargada', v_factura, v_prov.nombre;
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;

  v_numero := 'COMP-' || lpad(reservar_secuencia('compra', coalesce((
                select max(substring(numero_control from '[0-9]+$')::bigint) from compras where empresa_id = v_empresa), 0))::text, 6, '0');

  insert into compras (empresa_id, numero_control, proveedor_id, proveedor_nombre, fecha_factura, nro_timbrado,
                       numero_factura, tipo_pago, plazo_dias, vencimiento, moneda, tipo_cambio, observacion,
                       created_by, usuario_nombre, orden_compra_id)
    values (v_empresa, v_numero, v_prov.id, v_prov.nombre, v_fecha_fact, v_timbrado, v_factura, v_tipo_pago,
            case when v_tipo_pago = 'credito' then v_plazo end,
            case when v_tipo_pago = 'credito' and v_plazo is not null
                 then coalesce(v_fecha_fact, (now() at time zone 'America/Asuncion')::date) + v_plazo end,
            v_moneda, v_cambio, nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre, v_oc)
    returning id into v_compra;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    v_cant := (it->>'cantidad')::numeric;
    v_costo_orig := (it->>'costo_unitario')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_costo_orig is null or v_costo_orig <= 0 then raise exception 'Producto %: falta el costo', v_orden; end if;
    v_costo := round(v_costo_orig * v_cambio, 2);

    select * into prod from productos where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no encontrado', v_orden; end if;

    v_total_linea := round(v_cant * v_costo);
    v_subtotal := v_subtotal + v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva);
    v_iva := v_iva + iva_contenido(v_total_linea, prod.tipo_iva);
    v_total := v_total + v_total_linea;

    -- Línea de la orden que se está recibiendo (si viene): suma lo recibido.
    v_oc_item := null;
    if v_oc is not null and nullif(it->>'oc_item_id', '') is not null then
      update ordenes_compra_items set cantidad_recibida = cantidad_recibida + v_cant
       where id = (it->>'oc_item_id')::uuid and orden_compra_id = v_oc and producto_id = prod.id
       returning id into v_oc_item;
    end if;

    insert into compras_items (empresa_id, compra_id, producto_id, producto_nombre, producto_sku, cantidad,
                               costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total,
                               precio_venta_nuevo, orden, oc_item_id)
      values (v_empresa, v_compra, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva), iva_contenido(v_total_linea, prod.tipo_iva),
              v_total_linea, nullif((it->>'precio_venta_nuevo')::numeric, 0), v_orden, v_oc_item);

    -- Stock (solo si controla stock) + costo promedio ponderado + precio de venta nuevo.
    v_cpp := case when prod.controla_stock and greatest(prod.stock_actual, 0) + v_cant > 0
                  then round((greatest(prod.stock_actual, 0) * coalesce(prod.costo_promedio, 0) + v_cant * v_costo)
                             / (greatest(prod.stock_actual, 0) + v_cant), 2)
                  else v_costo end;
    v_pv := nullif((it->>'precio_venta_nuevo')::numeric, 0);
    update productos
       set stock_actual = case when prod.controla_stock then stock_actual + v_cant else stock_actual end,
           costo_promedio = v_cpp,
           precio_venta = coalesce(v_pv, precio_venta),
           proveedor_principal_id = coalesce(proveedor_principal_id, v_prov.id),
           updated_at = now()
     where id = prod.id;

    if prod.controla_stock then
      insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
                                          costo_unitario, origen, referencia, created_by, usuario_nombre,
                                          proveedor, numero_factura, proveedor_id, compra_id)
        values (v_empresa, prod.id, prod.nombre, prod.sku, 'ENTRADA', v_cant, v_costo, 'compra',
                v_numero, v_usuario, v_usuario_nombre, v_prov.nombre, v_factura, v_prov.id, v_compra);
    end if;
  end loop;

  update compras set subtotal = v_subtotal, monto_iva = v_iva, total = v_total,
         busqueda = concat_ws(' ', norm(v_numero), compacto(v_numero), norm(v_prov.nombre), norm(v_factura), compacto(v_factura),
                              norm(v_timbrado), (select string_agg(norm(i.producto_nombre) || ' ' || norm(i.producto_sku) || ' ' || compacto(i.producto_sku), ' ')
                                                  from compras_items i where i.compra_id = v_compra))
   where id = v_compra;

  if v_oc is not null then perform recalcular_orden_compra(v_oc); end if;
  return jsonb_build_object('id', v_compra, 'numero_control', v_numero, 'total', v_total);
end;
$fn$;

create or replace function :"schema".anular_compra(p_id uuid, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  c record;
  it record;
  prod record;
  v_cpp numeric;
  v_usuario uuid;
  v_usuario_nombre text;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into c from compras where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada'; end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;

  for it in select * from compras_items where compra_id = c.id order by orden loop
    select * into prod from productos where id = it.producto_id and empresa_id = v_empresa for update;
    if not found or not prod.controla_stock then continue; end if;
    if prod.stock_actual < it.cantidad then
      raise exception 'No se puede anular: de "%" quedan % y la compra trajo %. Ya se vendió parte.',
        prod.nombre, prod.stock_actual, it.cantidad;
    end if;
    -- Saca la compra del promedio: (stock·cpp − cant·costo) / (stock − cant).
    v_cpp := case when prod.stock_actual - it.cantidad > 0
                  then greatest(round((prod.stock_actual * coalesce(prod.costo_promedio, 0) - it.cantidad * it.costo_unitario)
                                      / (prod.stock_actual - it.cantidad), 2), 0)
                  else prod.costo_promedio end;
    update productos set stock_actual = stock_actual - it.cantidad, costo_promedio = v_cpp, updated_at = now()
     where id = prod.id;
    insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
                                        costo_unitario, origen, referencia, created_by, usuario_nombre,
                                        proveedor, numero_factura, proveedor_id, compra_id)
      values (v_empresa, prod.id, prod.nombre, prod.sku, 'SALIDA', it.cantidad, it.costo_unitario, 'anulacion_compra',
              left('Anulación ' || c.numero_control || ': ' || btrim(p_motivo), 200), v_usuario, v_usuario_nombre,
              c.proveedor_nombre, c.numero_factura, c.proveedor_id, c.id);
  end loop;

  update compras set estado = 'anulada', anulada_at = now(), anulada_por = v_usuario_nombre,
         anulada_motivo = left(btrim(p_motivo), 500)
   where id = c.id;
  -- Si vino de una orden de compra, lo recibido vuelve a quedar pendiente.
  if c.orden_compra_id is not null then
    update ordenes_compra_items oi set cantidad_recibida = greatest(oi.cantidad_recibida - ci.cantidad, 0)
      from compras_items ci
     where ci.compra_id = c.id and ci.oc_item_id = oi.id;
    perform recalcular_orden_compra(c.orden_compra_id);
  end if;
  return jsonb_build_object('id', c.id, 'numero_control', c.numero_control);
end;
$fn$;

grant execute on function :"schema".recalcular_orden_compra(uuid) to authenticated, service_role;
grant execute on function :"schema".guardar_orden_compra(jsonb) to authenticated, service_role;
grant execute on function :"schema".cancelar_orden_compra(uuid, text) to authenticated, service_role;
grant execute on function :"schema".registrar_compra(jsonb) to authenticated, service_role;
grant execute on function :"schema".anular_compra(uuid, text) to authenticated, service_role;
