-- =============================================================================
-- Compras (Fase 2, portado de Ferretería República y re-diseñado cabecera + ítems).
--   · compras         cabecera: proveedor, factura (Nº + timbrado + fecha), condición
--                     (contado / crédito + plazo → vencimiento), moneda (GS/USD +
--                     cotización), totales en Gs., estado registrada | anulada
--   · compras_items   cada producto: cantidad, costo c/u (IVA incluido, en la moneda
--                     de la factura y en Gs.), IVA, total, precio de venta nuevo (opcional)
--   · registrar_compra(jsonb)  una transacción: cabecera + ítems + por cada ítem stock,
--                              costo promedio ponderado, precio de venta (si viene),
--                              kardex ENTRADA 'compra' ligado a la compra y al proveedor
--   · anular_compra(id, motivo) revierte el stock (kardex SALIDA 'anulacion_compra') y
--                              el costo promedio; no deja el stock negativo
-- Costo con IVA incluido (como los precios de venta): el IVA se desglosa contenido.
-- Una misma factura (proveedor + timbrado + número) no se puede cargar dos veces.
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create table if not exists :"schema".compras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero_control text not null,
  proveedor_id uuid not null references :"schema".proveedores(id),
  proveedor_nombre text not null,
  fecha timestamptz not null default now(),
  fecha_factura date,
  nro_timbrado text,
  numero_factura text not null,
  tipo_pago text not null default 'contado',
  plazo_dias integer,
  vencimiento date,
  moneda text not null default 'GS',
  tipo_cambio numeric not null default 1,
  subtotal numeric not null default 0,
  monto_iva numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'registrada',
  observacion text,
  created_by uuid,
  usuario_nombre text,
  anulada_at timestamptz,
  anulada_por text,
  anulada_motivo text,
  busqueda text,
  created_at timestamptz not null default now(),
  constraint chk_compra_tipo_pago check (tipo_pago in ('contado', 'credito')),
  constraint chk_compra_moneda check (moneda in ('GS', 'USD')),
  constraint chk_compra_estado check (estado in ('registrada', 'anulada')),
  constraint chk_compra_cambio check (tipo_cambio > 0)
);
create unique index if not exists uq_compras_numero on :"schema".compras(empresa_id, numero_control);
create unique index if not exists uq_compras_factura
  on :"schema".compras(empresa_id, proveedor_id, coalesce(nro_timbrado, ''), regexp_replace(lower(numero_factura), '[^a-z0-9]+', '', 'g'))
  where estado <> 'anulada';
create index if not exists compras_empresa_fecha_idx on :"schema".compras(empresa_id, fecha desc);
create index if not exists compras_proveedor_idx on :"schema".compras(proveedor_id);

create table if not exists :"schema".compras_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  compra_id uuid not null references :"schema".compras(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id),
  producto_nombre text not null,
  producto_sku text,
  cantidad numeric not null check (cantidad > 0),
  costo_unitario_original numeric not null check (costo_unitario_original > 0),
  costo_unitario numeric not null check (costo_unitario > 0),   -- en Gs., IVA incluido
  tipo_iva text not null default '10%',
  subtotal numeric not null default 0,
  monto_iva numeric not null default 0,
  total numeric not null default 0,
  precio_venta_nuevo numeric,
  orden integer not null default 0
);
create index if not exists compras_items_compra_idx on :"schema".compras_items(compra_id);
create index if not exists compras_items_producto_idx on :"schema".compras_items(producto_id);

-- Kardex: la entrada queda ligada a la compra; nuevo origen 'anulacion_compra'.
alter table :"schema".movimientos_inventario add column if not exists compra_id uuid
  references :"schema".compras(id) on delete set null;
alter table :"schema".movimientos_inventario drop constraint if exists movinv_origen_check;
alter table :"schema".movimientos_inventario add constraint movinv_origen_check
  check (origen = any (array['inventario_inicial','ajuste_manual','venta','anulacion_venta','compra','anulacion_compra']));

-- --- RLS ---
alter table :"schema".compras enable row level security;
alter table :"schema".compras force row level security;
alter table :"schema".compras_items enable row level security;
alter table :"schema".compras_items force row level security;
drop policy if exists compras_propias on :"schema".compras;
create policy compras_propias on :"schema".compras to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists compras_items_propios on :"schema".compras_items;
create policy compras_items_propios on :"schema".compras_items to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".compras, :"schema".compras_items to authenticated, service_role;

-- IVA contenido en un importe con IVA incluido.
create or replace function :"schema".iva_contenido(p_importe numeric, p_tipo text)
returns numeric language sql immutable as $$
  select case p_tipo when '10%' then round(p_importe / 11) when '5%' then round(p_importe / 21) else 0 end
$$;

-- =============================================================================
-- registrar_compra(p jsonb)
--   { proveedor_id, fecha_factura?, nro_timbrado?, numero_factura, tipo_pago, plazo_dias?,
--     moneda, tipo_cambio?, observacion?,
--     items: [{ producto_id, cantidad, costo_unitario (en la moneda), precio_venta_nuevo? }] }
-- → { id, numero_control, total }
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
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre, activo into v_prov
    from proveedores where id = (p->>'proveedor_id')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el proveedor'; end if;
  if v_factura is null then raise exception 'Falta el número de factura'; end if;
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
                       created_by, usuario_nombre)
    values (v_empresa, v_numero, v_prov.id, v_prov.nombre, v_fecha_fact, v_timbrado, v_factura, v_tipo_pago,
            case when v_tipo_pago = 'credito' then v_plazo end,
            case when v_tipo_pago = 'credito' and v_plazo is not null
                 then coalesce(v_fecha_fact, (now() at time zone 'America/Asuncion')::date) + v_plazo end,
            v_moneda, v_cambio, nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre)
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

    insert into compras_items (empresa_id, compra_id, producto_id, producto_nombre, producto_sku, cantidad,
                               costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total,
                               precio_venta_nuevo, orden)
      values (v_empresa, v_compra, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva), iva_contenido(v_total_linea, prod.tipo_iva),
              v_total_linea, nullif((it->>'precio_venta_nuevo')::numeric, 0), v_orden);

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

  return jsonb_build_object('id', v_compra, 'numero_control', v_numero, 'total', v_total);
end;
$fn$;

-- =============================================================================
-- anular_compra(p_id, p_motivo): revierte stock y costo promedio de cada ítem.
-- Si ya se vendió parte y el stock no alcanza para devolver, no deja anular.
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
  return jsonb_build_object('id', c.id, 'numero_control', c.numero_control);
end;
$fn$;

grant execute on function :"schema".iva_contenido(numeric, text) to authenticated, service_role;
grant execute on function :"schema".registrar_compra(jsonb) to authenticated, service_role;
grant execute on function :"schema".anular_compra(uuid, text) to authenticated, service_role;

-- Historial de costos: sin las compras anuladas (redefine la de 20_historial_costos.sql).
create or replace function :"schema".historial_costos_producto(p_producto_id uuid, p_limit integer default 100)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with c as (
    select m.id, m.fecha, m.cantidad, m.costo_unitario as costo, m.proveedor, m.proveedor_id, m.numero_factura, m.origen,
           m.referencia, m.usuario_nombre, m.compra_id,
           lag(m.costo_unitario) over (order by m.fecha, m.id) as anterior
      from movimientos_inventario m
     where m.empresa_id = empresa_actual() and m.producto_id = p_producto_id
       and m.tipo = 'ENTRADA' and m.origen in ('compra', 'inventario_inicial')
       and coalesce(m.costo_unitario, 0) > 0
       and not exists (select 1 from compras k where k.id = m.compra_id and k.estado = 'anulada')
  )
  select jsonb_build_object(
    'costo_promedio', (select costo_promedio from productos where id = p_producto_id and empresa_id = empresa_actual()),
    'total_compras', (select count(*) from c),
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'fecha', x.fecha, 'cantidad', x.cantidad, 'costo', x.costo,
               'proveedor', x.proveedor, 'proveedor_id', x.proveedor_id, 'factura', x.numero_factura, 'origen', x.origen,
               'referencia', x.referencia, 'usuario', x.usuario_nombre, 'compra_id', x.compra_id,
               'variacion_pct', case when x.anterior > 0 then round((x.costo - x.anterior) / x.anterior * 100, 1) end
             ) order by x.fecha desc, x.id desc)
        from (select * from c order by fecha desc, id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x
    ), '[]'::jsonb)
  )
$$;

-- Compras por proveedor: facturas de compra (no anuladas) + compras manuales sueltas.
create or replace function :"schema".compras_por_proveedor()
returns table (proveedor_id uuid, compras bigint, ultima timestamptz)
language sql stable security invoker set search_path = :"schema", public as $$
  select proveedor_id, count(*), max(fecha) from (
    select c.proveedor_id, c.fecha from compras c
     where c.empresa_id = empresa_actual() and c.estado <> 'anulada'
    union all
    select m.proveedor_id, m.fecha from movimientos_inventario m
     where m.empresa_id = empresa_actual() and m.proveedor_id is not null and m.compra_id is null
       and m.origen = 'compra'
  ) x group by proveedor_id
$$;
