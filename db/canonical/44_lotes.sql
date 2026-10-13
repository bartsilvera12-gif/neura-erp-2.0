-- =============================================================================
-- LOTES CON VENCIMIENTO (perecibles: despensas, farmacias, veterinarias, alimentos).
-- OPCIONAL POR PRODUCTO: productos.controla_lotes (default false). Un producto sin la
-- marca funciona EXACTAMENTE como antes: ninguna función de venta/compra/movimiento
-- cambia para él (los ganchos de abajo salen en la primera línea).
--
--   · lotes               N° de lote + vencimiento + unidades que quedan, por producto.
--                         Mismo producto + número + vencimiento = el mismo lote (suma).
--   · lotes_movimientos   kardex de lotes Y tabla de CONSUMO de las ventas: cada línea
--                         de venta deja qué lotes consumió (venta_item_id) para que la
--                         anulación devuelva a los MISMOS lotes. lote_id NULL = unidades
--                         "sin lote" (stock que había antes de activar lotes, o el
--                         faltante de una venta que los lotes vigentes no cubrieron).
--
-- Entradas (piden vencimiento; lote vacío → L-YYMMDD, que la pantalla muestra prellenado):
--   · registrar_compra(p)            redefinida acá (misma firma; ítems con lote/vencimiento)
--     → también es la recepción de una orden de compra (orden_compra_id)
--   · registrar_movimiento_lotes()   envoltorio de registrar_movimiento_stock (que NO cambia)
-- Salidas: FEFO (vence primero sale primero; a igual vencimiento, el lote más viejo). Los
--   VENCIDOS no salen solos: se saltean. Lo que los lotes vigentes no cubren queda como
--   faltante sin lote (no bloquea: la venta ya valida stock_actual como siempre; el stock
--   negativo sigue sin estar permitido, ver 11_venta_fn.sql).
--   · venta      → trigger en ventas_items (crear_venta NO se redefine)
--   · anulación  → trigger en ventas cuando pasa a 'anulada' (anular_venta NO se redefine)
--   · anular_compra(id, motivo)      redefinida acá: saca las unidades de SU lote
--   · dar_baja_lote(lote, cant, motivo)  vencido/roto: SALIDA del lote + kardex
-- Consultas: lotes_producto(id) · reporte_vencimientos(dias, q, estado) ·
--   lotes_stock_vencido() (aviso de la caja) · verificar_lotes() (invariante).
-- INVARIANTE (productos con lotes): stock_actual = Σ lotes.cantidad + saldo sin lote
--   (saldo sin lote = Σ ENTRADA − Σ SALIDA de lotes_movimientos con lote_id NULL).
-- Pendiente conocido: la importación por Excel (aplicar_importacion_productos) pisa el
--   stock sin pasar por lotes; verificar_lotes() lo detecta.
-- SECURITY INVOKER + empresa_actual() (RLS). Hoy = America/Asuncion. IDEMPOTENTE.
-- =============================================================================

-- ── Marca por producto ───────────────────────────────────────────────────────
alter table :"schema".productos add column if not exists controla_lotes boolean not null default false;

-- ── Lotes ────────────────────────────────────────────────────────────────────
create table if not exists :"schema".lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id) on delete restrict,
  numero text not null,                      -- guardado en MAYÚSCULAS y sin espacios al borde
  vencimiento date not null,
  cantidad numeric not null default 0,       -- unidades que quedan
  cantidad_inicial numeric not null default 0,
  costo_unitario numeric not null default 0, -- costo de la entrada (Gs., IVA incluido)
  origen text not null default 'compra',
  compra_id uuid references :"schema".compras(id) on delete set null,
  created_by uuid default auth.uid(),        -- auth.users.id
  created_at timestamptz not null default now(),
  constraint chk_lotes_cantidad check (cantidad >= 0),
  constraint chk_lotes_numero check (btrim(numero) <> ''),
  constraint chk_lotes_origen check (origen in ('compra', 'ajuste_manual'))
);
create unique index if not exists uq_lotes_producto_numero
  on :"schema".lotes(empresa_id, producto_id, numero, vencimiento);
-- FEFO: lotes con unidades de un producto, por vencimiento y antigüedad.
create index if not exists lotes_fefo_idx
  on :"schema".lotes(producto_id, vencimiento, created_at) where cantidad > 0;
-- Pantalla Vencimientos y aviso de la caja.
create index if not exists lotes_empresa_venc_idx
  on :"schema".lotes(empresa_id, vencimiento) where cantidad > 0;

-- ── Movimientos de lotes / consumo de las ventas ─────────────────────────────
create table if not exists :"schema".lotes_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id) on delete restrict,
  lote_id uuid references :"schema".lotes(id) on delete restrict,   -- NULL = sin lote
  tipo text not null,
  cantidad numeric not null,
  origen text not null,
  venta_id uuid,
  venta_item_id uuid,
  compra_id uuid,
  revertido boolean not null default false,  -- consumo de venta ya devuelto por anulación
  motivo text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint chk_lotes_mov_tipo check (tipo in ('ENTRADA', 'SALIDA')),
  constraint chk_lotes_mov_cantidad check (cantidad > 0),
  constraint chk_lotes_mov_origen check (origen in (
    'compra', 'anulacion_compra', 'venta', 'anulacion_venta', 'ajuste_manual', 'baja_lote', 'sin_lote_inicial'))
);
create index if not exists lotes_mov_venta_idx on :"schema".lotes_movimientos(venta_id) where venta_id is not null;
create index if not exists lotes_mov_lote_idx on :"schema".lotes_movimientos(lote_id, created_at desc) where lote_id is not null;
create index if not exists lotes_mov_producto_idx on :"schema".lotes_movimientos(producto_id, created_at desc);

-- Compra ↔ lote (foto del número y vencimiento cargados en la factura).
alter table :"schema".compras_items add column if not exists lote_id uuid references :"schema".lotes(id) on delete set null;
alter table :"schema".compras_items add column if not exists lote_numero text;
alter table :"schema".compras_items add column if not exists lote_vencimiento date;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table :"schema".lotes             enable row level security;
alter table :"schema".lotes             force  row level security;
alter table :"schema".lotes_movimientos enable row level security;
alter table :"schema".lotes_movimientos force  row level security;
drop policy if exists lotes_propios on :"schema".lotes;
create policy lotes_propios on :"schema".lotes to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists lotes_mov_propios on :"schema".lotes_movimientos;
create policy lotes_mov_propios on :"schema".lotes_movimientos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".lotes, :"schema".lotes_movimientos to authenticated, service_role;

-- =============================================================================
-- Primitivas internas (las usan las funciones y triggers de abajo)
-- =============================================================================

-- Número de lote automático cuando no se carga: L-YYMMDD (fecha de hoy en Paraguay).
create or replace function :"schema".lote_numero_auto()
returns text language sql stable as $$
  select 'L-' || to_char(now() at time zone 'America/Asuncion', 'YYMMDD')
$$;

-- Entrada a un lote (lo crea o le suma). Devuelve el id del lote.
create or replace function :"schema".lote_entrada(
  p_producto uuid, p_numero text, p_vencimiento date, p_cantidad numeric, p_costo numeric,
  p_origen text, p_compra uuid, p_motivo text
) returns uuid
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_numero text := upper(btrim(coalesce(nullif(btrim(p_numero), ''), lote_numero_auto())));
  v_id uuid;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if p_vencimiento is null then raise exception 'Falta el vencimiento del lote'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad inválida para el lote'; end if;
  if length(v_numero) > 40 then raise exception 'El número de lote es muy largo (máximo 40)'; end if;

  insert into lotes (empresa_id, producto_id, numero, vencimiento, cantidad, cantidad_inicial, costo_unitario, origen, compra_id)
    values (v_empresa, p_producto, v_numero, p_vencimiento, p_cantidad, p_cantidad, coalesce(p_costo, 0),
            case when p_origen = 'compra' then 'compra' else 'ajuste_manual' end, p_compra)
  on conflict (empresa_id, producto_id, numero, vencimiento) do update
    set cantidad = lotes.cantidad + excluded.cantidad,
        cantidad_inicial = lotes.cantidad_inicial + excluded.cantidad
  returning id into v_id;

  insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, compra_id, motivo)
    values (v_empresa, p_producto, v_id, 'ENTRADA', p_cantidad, p_origen, p_compra, left(p_motivo, 300));
  return v_id;
end;
$fn$;

-- Salida FEFO: consume de los lotes VIGENTES (vencimiento >= hoy) del que vence primero
-- (a igual vencimiento, el más viejo). Los vencidos se saltean. Lo que no alcanza queda
-- como SALIDA sin lote (faltante). Devuelve [{lote_id, numero, vencimiento, cantidad}]
-- (lote_id null = faltante sin lote).
create or replace function :"schema".lotes_consumir(
  p_producto uuid, p_cantidad numeric, p_origen text, p_venta uuid, p_venta_item uuid, p_motivo text
) returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_resta numeric := p_cantidad;
  v_toma numeric;
  l record;
  v_out jsonb := '[]'::jsonb;
begin
  if p_cantidad is null or p_cantidad <= 0 then return v_out; end if;
  for l in
    select id, numero, vencimiento, cantidad from lotes
     where producto_id = p_producto and empresa_id = v_empresa and cantidad > 0 and vencimiento >= v_hoy
     order by vencimiento, created_at, id
     for update
  loop
    exit when v_resta <= 0;
    v_toma := least(l.cantidad, v_resta);
    update lotes set cantidad = cantidad - v_toma where id = l.id;
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, venta_id, venta_item_id, motivo)
      values (v_empresa, p_producto, l.id, 'SALIDA', v_toma, p_origen, p_venta, p_venta_item, left(p_motivo, 300));
    v_out := v_out || jsonb_build_object('lote_id', l.id, 'numero', l.numero, 'vencimiento', l.vencimiento, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;
  if v_resta > 0 then
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, venta_id, venta_item_id, motivo)
      values (v_empresa, p_producto, null, 'SALIDA', v_resta, p_origen, p_venta, p_venta_item,
              left(coalesce(p_motivo || ' · ', '') || 'Sin lote vigente que lo cubra', 300));
    v_out := v_out || jsonb_build_object('lote_id', null, 'numero', null, 'vencimiento', null, 'cantidad', v_resta);
  end if;
  return v_out;
end;
$fn$;

-- Saldo sin lote registrado de un producto (ENTRADA − SALIDA con lote_id NULL).
create or replace function :"schema".lotes_saldo_sin_lote(p_producto uuid)
returns numeric language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(sum(case when tipo = 'ENTRADA' then cantidad else -cantidad end), 0)
    from lotes_movimientos
   where producto_id = p_producto and empresa_id = empresa_actual() and lote_id is null
$$;

revoke execute on function :"schema".lote_entrada(uuid, text, date, numeric, numeric, text, uuid, text) from public, anon;
revoke execute on function :"schema".lotes_consumir(uuid, numeric, text, uuid, uuid, text) from public, anon;
grant execute on function :"schema".lote_numero_auto() to authenticated, service_role;
grant execute on function :"schema".lote_entrada(uuid, text, date, numeric, numeric, text, uuid, text) to authenticated, service_role;
grant execute on function :"schema".lotes_consumir(uuid, numeric, text, uuid, uuid, text) to authenticated, service_role;
grant execute on function :"schema".lotes_saldo_sin_lote(uuid) to authenticated, service_role;

-- =============================================================================
-- Al ACTIVAR lotes en un producto (alta o edición): el stock que ya tenía queda como
-- "sin lote" (visible en la ficha), así la invariante se cumple desde el primer día.
-- =============================================================================
create or replace function :"schema".tg_productos_lotes_activar()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_dif numeric;
begin
  if not new.controla_lotes or (tg_op = 'UPDATE' and old.controla_lotes) then return null; end if;
  v_dif := coalesce(new.stock_actual, 0)
         - coalesce((select sum(cantidad) from lotes where producto_id = new.id), 0)
         - coalesce((select sum(case when tipo = 'ENTRADA' then cantidad else -cantidad end)
                       from lotes_movimientos where producto_id = new.id and lote_id is null), 0);
  if v_dif <> 0 then
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, motivo)
      values (new.empresa_id, new.id, null, case when v_dif > 0 then 'ENTRADA' else 'SALIDA' end, abs(v_dif),
              'sin_lote_inicial', 'Stock que tenía al activar lotes');
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_productos_lotes_activar on :"schema".productos;
create trigger trg_productos_lotes_activar
  after insert or update of controla_lotes on :"schema".productos
  for each row when (new.controla_lotes) execute function :"schema".tg_productos_lotes_activar();

-- =============================================================================
-- VENTA: cada línea de un producto con lotes consume FEFO (trigger; crear_venta no
-- cambia). Para un producto sin lotes el costo es UNA lectura por PK de productos.
-- crear_venta ya bloqueó el producto (FOR UPDATE) y validó el stock antes del insert.
-- =============================================================================
create or replace function :"schema".tg_ventas_items_lotes()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_lotes boolean;
  v_stock boolean;
begin
  select controla_lotes, controla_stock into v_lotes, v_stock from productos where id = new.producto_id;
  if not coalesce(v_lotes and v_stock, false) then return null; end if;
  perform lotes_consumir(new.producto_id, new.cantidad, 'venta', new.venta_id, new.id, null);
  return null;
end;
$fn$;
drop trigger if exists trg_ventas_items_lotes on :"schema".ventas_items;
create trigger trg_ventas_items_lotes
  after insert on :"schema".ventas_items
  for each row when (new.producto_id is not null) execute function :"schema".tg_ventas_items_lotes();

-- ANULACIÓN: cuando la venta pasa a 'anulada', cada consumo vuelve a SU lote (o al
-- saldo sin lote si fue faltante). Solo productos que siguen controlando stock (lo
-- mismo que hace anular_venta con el stock). anular_venta no cambia.
create or replace function :"schema".tg_ventas_anular_lotes()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  r record;
begin
  for r in
    select lm.* from lotes_movimientos lm
      join productos p on p.id = lm.producto_id and p.controla_stock
     where lm.venta_id = new.id and lm.origen = 'venta' and lm.tipo = 'SALIDA' and not lm.revertido
     order by lm.created_at, lm.id
     for update of lm
  loop
    if r.lote_id is not null then
      update lotes set cantidad = cantidad + r.cantidad where id = r.lote_id;
    end if;
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, venta_id, venta_item_id, motivo)
      values (r.empresa_id, r.producto_id, r.lote_id, 'ENTRADA', r.cantidad, 'anulacion_venta', r.venta_id, r.venta_item_id,
              'Anulación ' || new.numero_control);
    update lotes_movimientos set revertido = true where id = r.id;
  end loop;
  return null;
end;
$fn$;
drop trigger if exists trg_ventas_anular_lotes on :"schema".ventas;
create trigger trg_ventas_anular_lotes
  after update of estado on :"schema".ventas
  for each row when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function :"schema".tg_ventas_anular_lotes();

-- =============================================================================
-- registrar_compra(p jsonb) — REDEFINIDA (la anterior está en 23_ordenes_compra.sql,
-- idéntica salvo el bloque de lotes). Misma firma y mismo comportamiento para productos
-- sin lotes. Ítems de productos con lotes: { ..., lote?, vencimiento (obligatorio) }.
-- =============================================================================
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
  v_item uuid;
  v_lote_num text;
  v_lote_venc date;
  v_lote uuid;
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

    -- Lotes: solo productos que controlan stock y lotes. Vencimiento obligatorio.
    v_lote_num := null; v_lote_venc := null;
    if prod.controla_stock and prod.controla_lotes then
      v_lote_venc := nullif(it->>'vencimiento', '')::date;
      if v_lote_venc is null then
        raise exception 'Producto %: "%" controla lotes, cargá el vencimiento', v_orden, prod.nombre;
      end if;
      v_lote_num := upper(btrim(coalesce(nullif(btrim(it->>'lote'), ''), lote_numero_auto())));
    end if;

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
                               precio_venta_nuevo, orden, oc_item_id, lote_numero, lote_vencimiento)
      values (v_empresa, v_compra, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva), iva_contenido(v_total_linea, prod.tipo_iva),
              v_total_linea, nullif((it->>'precio_venta_nuevo')::numeric, 0), v_orden, v_oc_item, v_lote_num, v_lote_venc)
      returning id into v_item;

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
                v_numero || case when v_lote_num is not null
                                 then ' · Lote ' || v_lote_num || ' vence ' || to_char(v_lote_venc, 'DD/MM/YYYY') else '' end,
                v_usuario, v_usuario_nombre, v_prov.nombre, v_factura, v_prov.id, v_compra);
    end if;

    if v_lote_num is not null then
      v_lote := lote_entrada(prod.id, v_lote_num, v_lote_venc, v_cant, v_costo, 'compra', v_compra, v_numero);
      update compras_items set lote_id = v_lote where id = v_item;
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

-- =============================================================================
-- anular_compra(id, motivo) — REDEFINIDA (la anterior está en 23_ordenes_compra.sql).
-- Igual que antes; si el ítem entró a un lote, las unidades salen de ESE lote (si ya
-- se vendió parte del lote, no se puede anular, como con el stock).
-- =============================================================================
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
  l record;
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
    if it.lote_id is not null then
      select id, numero, cantidad into l from lotes where id = it.lote_id for update;
      if found then
        if l.cantidad < it.cantidad then
          raise exception 'No se puede anular: del lote % de "%" quedan % y la compra trajo %. Ya se vendió o se dio de baja parte.',
            l.numero, prod.nombre, l.cantidad, it.cantidad;
        end if;
        update lotes set cantidad = cantidad - it.cantidad where id = l.id;
        insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, compra_id, motivo)
          values (v_empresa, prod.id, l.id, 'SALIDA', it.cantidad, 'anulacion_compra', c.id,
                  left('Anulación ' || c.numero_control || ': ' || btrim(p_motivo), 300));
      end if;
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

grant execute on function :"schema".registrar_compra(jsonb) to authenticated, service_role;
grant execute on function :"schema".anular_compra(uuid, text) to authenticated, service_role;

-- =============================================================================
-- registrar_movimiento_lotes: movimiento MANUAL (pantalla "Nuevo movimiento").
-- Envoltorio de registrar_movimiento_stock (21_proveedores.sql, que NO cambia): mismos
-- parámetros + p_lote / p_vencimiento. Producto sin lotes → llama a la original tal cual.
-- Con lotes: una entrada (o un ajuste que suma) pide vencimiento y entra a ese lote;
-- una salida (o un ajuste que resta) consume FEFO.
-- =============================================================================
create or replace function :"schema".registrar_movimiento_lotes(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_costo_unitario numeric,
  p_origen text,
  p_referencia text,
  p_proveedor text default null,
  p_numero_factura text default null,
  p_proveedor_id uuid default null,
  p_lote text default null,
  p_vencimiento date default null
) returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  prod record;
  r jsonb;
  v_cant numeric;
  v_motivo text;
  v_lote uuid;
  v_numero text;
  v_cons jsonb;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select id, nombre, controla_lotes, controla_stock, stock_actual into prod
    from productos where id = p_producto_id and empresa_id = v_empresa for update;
  if not found or not (prod.controla_lotes and prod.controla_stock) then
    return registrar_movimiento_stock(p_producto_id, p_tipo, p_cantidad, p_costo_unitario, p_origen, p_referencia,
                                      p_proveedor, p_numero_factura, p_proveedor_id);
  end if;

  -- ¿Suma stock? Entrada, o ajuste con un conteo mayor al stock actual.
  if (p_tipo = 'ENTRADA' or (p_tipo = 'AJUSTE' and p_cantidad > prod.stock_actual)) and p_vencimiento is null then
    raise exception '"%" controla lotes: cargá el vencimiento del lote', prod.nombre;
  end if;

  r := registrar_movimiento_stock(p_producto_id, p_tipo, p_cantidad, p_costo_unitario, p_origen, p_referencia,
                                  p_proveedor, p_numero_factura, p_proveedor_id);
  v_cant := (r->>'cantidad')::numeric;
  v_motivo := coalesce(nullif(btrim(p_referencia), ''), case when p_tipo = 'AJUSTE' then 'Ajuste por conteo físico' else 'Movimiento manual' end);

  if r->>'tipo' = 'ENTRADA' then
    v_numero := upper(btrim(coalesce(nullif(btrim(p_lote), ''), lote_numero_auto())));
    v_lote := lote_entrada(p_producto_id, v_numero, p_vencimiento, v_cant,
                           case when coalesce(p_costo_unitario, 0) > 0 then p_costo_unitario else (r->>'costo_promedio')::numeric end,
                           'ajuste_manual', null, v_motivo);
    return r || jsonb_build_object('lote_id', v_lote, 'lote', v_numero, 'vencimiento', p_vencimiento);
  end if;
  v_cons := lotes_consumir(p_producto_id, v_cant, 'ajuste_manual', null, null, v_motivo);
  return r || jsonb_build_object('lotes', v_cons);
end;
$fn$;
grant execute on function :"schema".registrar_movimiento_lotes(uuid, text, numeric, numeric, text, text, text, text, uuid, text, date) to authenticated, service_role;

-- =============================================================================
-- dar_baja_lote: lote vencido / roto / devuelto. SALIDA del lote ESPECÍFICO + kardex
-- (ajuste manual con el lote y el motivo en la referencia). p_cantidad NULL = todo.
-- Si el stock físico ya es menor que lo que dice el lote (se vendió sin lote), el
-- stock baja hasta 0 y el resto compensa el faltante sin lote (la invariante sigue).
-- =============================================================================
create or replace function :"schema".dar_baja_lote(p_lote_id uuid, p_cantidad numeric, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  l record;
  prod record;
  v_cant numeric;
  v_stock_sale numeric;
  v_ref text;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la baja'; end if;
  select * into l from lotes where id = p_lote_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Lote no encontrado'; end if;
  select id, nombre, stock_actual into prod from productos where id = l.producto_id and empresa_id = v_empresa for update;
  v_cant := coalesce(p_cantidad, l.cantidad);
  if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
  if v_cant > l.cantidad then
    raise exception 'Del lote % quedan %: no se pueden dar de baja %', l.numero, l.cantidad, v_cant;
  end if;

  v_ref := left('Baja lote ' || l.numero || ' (vence ' || to_char(l.vencimiento, 'DD/MM/YYYY') || '): ' || btrim(p_motivo), 150);
  v_stock_sale := least(v_cant, greatest(prod.stock_actual, 0));
  if v_stock_sale > 0 then
    perform registrar_movimiento_stock(prod.id, 'SALIDA', v_stock_sale, 0, 'ajuste_manual', v_ref, null, null, null);
  end if;

  update lotes set cantidad = cantidad - v_cant where id = l.id;
  insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, motivo)
    values (v_empresa, l.producto_id, l.id, 'SALIDA', v_cant, 'baja_lote', left(btrim(p_motivo), 300));
  if v_cant > v_stock_sale then
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, tipo, cantidad, origen, motivo)
      values (v_empresa, l.producto_id, null, 'ENTRADA', v_cant - v_stock_sale, 'baja_lote',
              left('Ya no estaba en stock (se vendió sin lote) · ' || btrim(p_motivo), 300));
  end if;
  return jsonb_build_object('lote_id', l.id, 'numero', l.numero, 'cantidad', v_cant,
                            'stock_descontado', v_stock_sale, 'quedan', l.cantidad - v_cant);
end;
$fn$;
grant execute on function :"schema".dar_baja_lote(uuid, numeric, text) to authenticated, service_role;

-- =============================================================================
-- Consultas
-- =============================================================================

-- Lotes de un producto (ficha): los que tienen unidades, el que vence primero arriba.
create or replace function :"schema".lotes_producto(p_producto_id uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with p as (
    select id, stock_actual, controla_lotes, costo_promedio from productos
     where id = p_producto_id and empresa_id = empresa_actual()
  ),
  l as (
    select l.id, l.numero, l.vencimiento, l.cantidad, l.cantidad_inicial, l.costo_unitario, l.origen, l.created_at,
           c.numero_control as compra_numero, c.proveedor_nombre
      from lotes l left join compras c on c.id = l.compra_id
     where l.producto_id = p_producto_id and l.empresa_id = empresa_actual() and l.cantidad > 0
  )
  select jsonb_build_object(
    'controla_lotes', coalesce((select controla_lotes from p), false),
    'stock_actual', coalesce((select stock_actual from p), 0),
    'en_lotes', coalesce((select sum(cantidad) from l), 0),
    'sin_lote', coalesce((select stock_actual from p), 0) - coalesce((select sum(cantidad) from l), 0),
    'hoy', (now() at time zone 'America/Asuncion')::date,
    'lotes', coalesce((select jsonb_agg(to_jsonb(l) order by l.vencimiento, l.created_at) from l), '[]'::jsonb)
  )
$$;
grant execute on function :"schema".lotes_producto(uuid) to authenticated, service_role;

-- Pantalla Vencimientos: lotes con unidades vencidos o que vencen en los próximos p_dias.
--   p_estado: 'vencido' | 'por_vencer' | NULL (ambos). p_q: producto, SKU o lote.
--   Valor al costo = unidades × costo del lote (si no tiene, el costo promedio).
create or replace function :"schema".reporte_vencimientos(p_dias integer default 30, p_q text default null, p_estado text default null)
returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_dias integer := greatest(0, least(coalesce(p_dias, 30), 3650));
  v_q text := nullif(btrim(norm(coalesce(p_q, ''))), '');
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with base as (
    select l.id, l.producto_id, p.nombre as producto, p.sku, p.unidad_medida, l.numero, l.vencimiento,
           (l.vencimiento - v_hoy) as dias, l.cantidad,
           case when l.costo_unitario > 0 then l.costo_unitario else coalesce(p.costo_promedio, 0) end as costo,
           case when l.vencimiento < v_hoy then 'vencido' else 'por_vencer' end as estado
      from lotes l join productos p on p.id = l.producto_id
     where l.empresa_id = empresa_actual() and l.cantidad > 0 and l.vencimiento <= v_hoy + v_dias
  ),
  filtrado as (
    select * from base b
     where (p_estado is null or p_estado = '' or b.estado = p_estado)
       and (v_q is null or norm(b.producto) like '%' || v_q || '%' or norm(b.sku) like '%' || v_q || '%'
            or norm(b.numero) like '%' || v_q || '%')
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'dias', v_dias,
    'hay_productos_con_lotes', exists (select 1 from productos where empresa_id = empresa_actual() and controla_lotes),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'lote_id', f.id, 'producto_id', f.producto_id, 'producto', f.producto, 'sku', f.sku, 'unidad_medida', f.unidad_medida,
        'numero', f.numero, 'vencimiento', f.vencimiento, 'dias', f.dias, 'cantidad', f.cantidad,
        'costo', f.costo, 'valor', round(f.cantidad * f.costo), 'estado', f.estado
      ) order by f.vencimiento, f.producto, f.numero) from filtrado f), '[]'::jsonb),
    -- La franja de cifras usa TODO el rango (sin el filtro de búsqueda ni de estado).
    'totales', (select jsonb_build_object(
        'vencidos_unidades', coalesce(sum(cantidad) filter (where estado = 'vencido'), 0),
        'vencidos_valor', coalesce(round(sum(cantidad * costo) filter (where estado = 'vencido')), 0),
        'vencidos_lotes', count(*) filter (where estado = 'vencido'),
        'por_vencer_unidades', coalesce(sum(cantidad) filter (where estado = 'por_vencer'), 0),
        'por_vencer_valor', coalesce(round(sum(cantidad * costo) filter (where estado = 'por_vencer')), 0),
        'por_vencer_lotes', count(*) filter (where estado = 'por_vencer')
      ) from base)
  ) into r;
  return r;
end;
$fn$;
grant execute on function :"schema".reporte_vencimientos(integer, text, text) to authenticated, service_role;

-- Aviso de la caja: por producto con lotes, unidades en lotes VENCIDOS (cantidad > 0).
-- La caja avisa (sin bloquear) cuando lo que se quiere vender supera lo no vencido.
create or replace function :"schema".lotes_stock_vencido()
returns table (producto_id uuid, vencido numeric)
language sql stable security invoker set search_path = :"schema", public as $$
  select l.producto_id, sum(l.cantidad)
    from lotes l
   where l.empresa_id = empresa_actual() and l.cantidad > 0
     and l.vencimiento < (now() at time zone 'America/Asuncion')::date
   group by l.producto_id
$$;
grant execute on function :"schema".lotes_stock_vencido() to authenticated, service_role;

-- INVARIANTE. Por producto con lotes: stock_actual = Σ lotes + saldo sin lote, y cada
-- lote = Σ de sus movimientos. Devuelve { ok, productos: [...], lotes_descuadrados: [...] }
-- (productos trae todos los que tienen lotes, con ok por fila; p_producto NULL = todos).
create or replace function :"schema".verificar_lotes(p_producto uuid default null)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with pr as (
    select p.id, p.nombre, p.stock_actual,
           coalesce((select sum(l.cantidad) from lotes l where l.producto_id = p.id), 0) as en_lotes,
           coalesce((select sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end)
                       from lotes_movimientos m where m.producto_id = p.id and m.lote_id is null), 0) as sin_lote
      from productos p
     where p.empresa_id = empresa_actual() and p.controla_lotes and p.controla_stock
       and (p_producto is null or p.id = p_producto)
  ),
  ld as (
    select l.id, l.numero, l.producto_id, l.cantidad,
           coalesce(sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end), 0) as segun_movimientos
      from lotes l left join lotes_movimientos m on m.lote_id = l.id
     where l.empresa_id = empresa_actual() and (p_producto is null or l.producto_id = p_producto)
     group by l.id
    having l.cantidad <> coalesce(sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end), 0)
  )
  select jsonb_build_object(
    'ok', not exists (select 1 from pr where stock_actual <> en_lotes + sin_lote) and not exists (select 1 from ld),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'producto_id', id, 'nombre', nombre, 'stock_actual', stock_actual, 'en_lotes', en_lotes,
        'sin_lote', sin_lote, 'diferencia', stock_actual - en_lotes - sin_lote,
        'ok', stock_actual = en_lotes + sin_lote) order by nombre) from pr), '[]'::jsonb),
    'lotes_descuadrados', coalesce((select jsonb_agg(to_jsonb(ld)) from ld), '[]'::jsonb)
  )
$$;
grant execute on function :"schema".verificar_lotes(uuid) to authenticated, service_role;
