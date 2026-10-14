-- =============================================================================
-- COMPRAS — flujo de punta a punta (auditoría): OC → recepción/compra → cuenta a pagar
-- → pago. Corrige huecos de 23/42/44 sin cambiar firmas:
--
--   · registrar_compra(p)   (REDEFINE la de 44, conserva lotes con vencimiento)
--       - Idempotencia: p.idempotency_key (uuid). Un doble clic / reintento devuelve la
--         compra ya registrada ({..., repetido: true}) en vez de "factura ya cargada".
--       - Orden de compra: una orden RECIBIDA COMPLETA no se vuelve a recibir; cada línea
--         con oc_item_id tiene que existir en ESA orden y ser del mismo producto (antes
--         se ignoraba en silencio y la compra quedaba "colgada" de la orden sin sumar);
--         no se recibe más de lo pendiente salvo p.permitir_excedente = true (la pantalla
--         lo pide con una confirmación explícita).
--       - Contado: p.medio_pago (efectivo | transferencia | cheque | tarjeta | otro) y
--         p.referencia_pago. En EFECTIVO sale de la caja abierta (egreso, como los gastos
--         y los pagos a proveedores); sin caja abierta no deja. Efectivo solo en Gs.
--         Sin medio_pago (clientes viejos de la API) queda como antes: no toca la caja.
--       - Fecha de factura futura: no.
--       - Factura repetida en carrera (dos pestañas): mensaje claro, no el error crudo
--         del índice único.
--   · anular_compra(id, motivo)  (REDEFINE la de 44, conserva lotes)
--       - Con pagos al proveedor: lo dice ANTES de tocar el stock, nombrando las OP.
--       - Contado en efectivo: anula el egreso de caja (si la caja ya se cerró, no deja,
--         igual que gastos y pagos).
--       - Bloquea la orden de compra antes que los productos (mismo orden de locks que
--         registrar_compra: sin deadlocks entre una recepción y una anulación).
--   · tg_compras_cxp: la deuda en USD es la suma exacta de la factura en dólares
--     (Σ cantidad × costo US$), no total Gs ÷ cotización (diferencias de centavos).
--   · guardar_orden_compra(p): idempotencia (p.idempotency_key) al crear.
--   · registrar_pago_proveedor(p): bloquea las cuentas del proveedor ANTES de medir la
--     deuda (dos pagos simultáneos podían pasar el control y dejar plata sin aplicar);
--     idempotencia (p.idempotency_key); si algo quedara sin aplicar, no registra.
-- SECURITY INVOKER + empresa_actual(). Hoy = America/Asuncion. IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

-- ── Columnas nuevas ──────────────────────────────────────────────────────────
alter table :"schema".compras add column if not exists idempotency_key uuid;
alter table :"schema".compras add column if not exists medio_pago text;
alter table :"schema".compras add column if not exists referencia_pago text;
alter table :"schema".compras add column if not exists caja_id uuid references :"schema".cajas(id);
alter table :"schema".compras drop constraint if exists chk_compra_medio_pago;
alter table :"schema".compras add constraint chk_compra_medio_pago
  check (medio_pago is null or medio_pago in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro'));
create unique index if not exists uq_compras_idem on :"schema".compras (empresa_id, idempotency_key) where idempotency_key is not null;

alter table :"schema".ordenes_compra add column if not exists idempotency_key uuid;
create unique index if not exists uq_oc_idem on :"schema".ordenes_compra (empresa_id, idempotency_key) where idempotency_key is not null;

alter table :"schema".pagos_proveedores add column if not exists idempotency_key uuid;
create unique index if not exists uq_pagos_prov_idem on :"schema".pagos_proveedores (empresa_id, idempotency_key) where idempotency_key is not null;

-- Egreso de caja de una compra al contado en efectivo.
alter table :"schema".caja_movimientos add column if not exists compra_id uuid references :"schema".compras(id) on delete set null;
create index if not exists caja_mov_compra_idx on :"schema".caja_movimientos (compra_id) where compra_id is not null;

-- =============================================================================
-- registrar_compra(p jsonb)
--   { idempotency_key?, proveedor_id, fecha_factura?, nro_timbrado?, numero_factura,
--     tipo_pago, plazo_dias?, medio_pago?, referencia_pago?, moneda, tipo_cambio?,
--     observacion?, orden_compra_id?, permitir_excedente?,
--     items: [{ producto_id, cantidad, costo_unitario (en la moneda), precio_venta_nuevo?,
--               oc_item_id?, lote?, vencimiento? }] }
-- → { id, numero_control, total, repetido? }
-- =============================================================================
create or replace function :"schema".registrar_compra(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_prov record;
  v_compra uuid;
  v_numero text;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then nullif(p->>'tipo_cambio', '')::numeric else 1 end;
  v_tipo_pago text := coalesce(nullif(p->>'tipo_pago', ''), 'contado');
  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_fecha_fact date := nullif(p->>'fecha_factura', '')::date;
  v_factura text := nullif(btrim(p->>'numero_factura'), '');
  v_timbrado text := nullif(btrim(p->>'nro_timbrado'), '');
  v_medio text := nullif(btrim(coalesce(p->>'medio_pago', '')), '');
  v_ref text := left(nullif(btrim(coalesce(p->>'referencia_pago', '')), ''), 120);
  v_excedente boolean := coalesce(nullif(p->>'permitir_excedente', '')::boolean, false);
  v_caja uuid;
  it jsonb;
  prod record;
  oci record;
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
  v_oc_row record;
  v_oc_item uuid;
  v_item uuid;
  v_lote_num text;
  v_lote_venc date;
  v_lote uuid;
  v_cons text;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;

  -- Idempotencia: el mismo envío (doble clic, reintento) espera al primero y lo devuelve.
  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('compra:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero_control, total into v_rep from compras where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero_control', v_rep.numero_control, 'total', v_rep.total, 'repetido', true);
    end if;
  end if;

  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre, activo into v_prov
    from proveedores where id = nullif(p->>'proveedor_id', '')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el proveedor'; end if;
  if v_factura is null then raise exception 'Falta el número de factura'; end if;
  if v_fecha_fact > v_hoy then raise exception 'La fecha de la factura no puede ser futura'; end if;
  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición de pago inválida'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  if v_plazo is not null and (v_plazo < 0 or v_plazo > 3650) then raise exception 'El plazo tiene que estar entre 0 y 3650 días'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'La compra no tiene productos';
  end if;

  -- Contado: cómo se pagó. El efectivo sale de la caja abierta (solo Gs.).
  if v_tipo_pago = 'contado' then
    if v_medio is not null and v_medio not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then
      raise exception 'Medio de pago inválido';
    end if;
    if v_medio = 'efectivo' then
      if v_moneda <> 'GS' then
        raise exception 'El efectivo de la caja es en guaraníes: una factura en dólares al contado va por transferencia, cheque u otro medio';
      end if;
      select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta' order by fecha_apertura desc limit 1;
      if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
    end if;
    if v_medio = 'efectivo' then v_ref := null; end if;
  else
    v_medio := null;
    v_ref := null;
  end if;

  -- Recepción de una orden de compra: del mismo proveedor, ni cancelada ni ya recibida completa.
  if v_oc is not null then
    select id, numero_oc, estado into v_oc_row from ordenes_compra
     where id = v_oc and empresa_id = v_empresa and proveedor_id = v_prov.id for update;
    if not found then raise exception 'La orden de compra no es de este proveedor'; end if;
    if v_oc_row.estado = 'cancelada' then raise exception 'La orden % está cancelada: no se puede recibir', v_oc_row.numero_oc; end if;
    if v_oc_row.estado = 'recibida_total' then
      raise exception 'La orden % ya se recibió completa. Si llegó algo más, cargalo como una compra sin orden', v_oc_row.numero_oc;
    end if;
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

  begin
    insert into compras (empresa_id, numero_control, proveedor_id, proveedor_nombre, fecha_factura, nro_timbrado,
                         numero_factura, tipo_pago, plazo_dias, vencimiento, moneda, tipo_cambio, observacion,
                         created_by, usuario_nombre, orden_compra_id, idempotency_key, medio_pago, referencia_pago, caja_id)
      values (v_empresa, v_numero, v_prov.id, v_prov.nombre, v_fecha_fact, v_timbrado, v_factura, v_tipo_pago,
              case when v_tipo_pago = 'credito' then v_plazo end,
              case when v_tipo_pago = 'credito' and v_plazo is not null
                   then coalesce(v_fecha_fact, v_hoy) + v_plazo end,
              v_moneda, v_cambio, nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre, v_oc,
              v_idem, v_medio, v_ref, v_caja)
      returning id into v_compra;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_compras_factura' then
      raise exception 'La factura % de % ya está cargada', v_factura, v_prov.nombre;
    end if;
    raise;
  end;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    v_cant := nullif(it->>'cantidad', '')::numeric;
    v_costo_orig := nullif(it->>'costo_unitario', '')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_costo_orig is null or v_costo_orig <= 0 then raise exception 'Producto %: falta el costo', v_orden; end if;
    v_costo := round(v_costo_orig * v_cambio, 2);

    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = v_empresa for update;
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

    -- Línea de la orden que se está recibiendo: tiene que existir en ESTA orden, ser del
    -- mismo producto y no pasarse de lo pendiente (salvo excedente confirmado).
    v_oc_item := null;
    if nullif(it->>'oc_item_id', '') is not null then
      if v_oc is null then raise exception 'Producto %: viene de una orden de compra pero falta la orden', v_orden; end if;
      select id, producto_id, cantidad, cantidad_recibida into oci from ordenes_compra_items
       where id = (it->>'oc_item_id')::uuid and orden_compra_id = v_oc for update;
      if not found then
        raise exception 'Producto % ("%"): esa línea ya no está en la orden % (¿la editaron?). Volvé a abrir la recepción', v_orden, prod.nombre, v_oc_row.numero_oc;
      end if;
      if oci.producto_id <> prod.id then
        raise exception 'Producto % ("%"): no corresponde a esa línea de la orden %', v_orden, prod.nombre, v_oc_row.numero_oc;
      end if;
      if oci.cantidad_recibida + v_cant > oci.cantidad and not v_excedente then
        raise exception '"%": pediste %, ya llegaron % y estás recibiendo %. Si de verdad llegó de más, confirmá la recepción excedente',
          prod.nombre, trim_scale(oci.cantidad), trim_scale(oci.cantidad_recibida), trim_scale(v_cant);
      end if;
      update ordenes_compra_items set cantidad_recibida = cantidad_recibida + v_cant
       where id = oci.id
       returning id into v_oc_item;
    end if;

    insert into compras_items (empresa_id, compra_id, producto_id, producto_nombre, producto_sku, cantidad,
                               costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total,
                               precio_venta_nuevo, orden, oc_item_id, lote_numero, lote_vencimiento)
      values (v_empresa, v_compra, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva), iva_contenido(v_total_linea, prod.tipo_iva),
              v_total_linea, nullif(nullif(it->>'precio_venta_nuevo', '')::numeric, 0), v_orden, v_oc_item, v_lote_num, v_lote_venc)
      returning id into v_item;

    -- Stock (solo si controla stock) + costo promedio ponderado + precio de venta nuevo.
    v_cpp := case when prod.controla_stock and greatest(prod.stock_actual, 0) + v_cant > 0
                  then round((greatest(prod.stock_actual, 0) * coalesce(prod.costo_promedio, 0) + v_cant * v_costo)
                             / (greatest(prod.stock_actual, 0) + v_cant), 2)
                  else v_costo end;
    v_pv := nullif(nullif(it->>'precio_venta_nuevo', '')::numeric, 0);
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

  -- Contado en efectivo: sale de la caja abierta.
  if v_caja is not null then
    insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, compra_id, observacion)
    values (v_empresa, v_caja, 'egreso', left('Compra ' || v_numero || ' · ' || v_prov.nombre, 200), round(v_total), 'efectivo', 'compra',
            v_usuario, v_hoy, v_compra, left('Factura ' || v_factura, 200));
  end if;

  if v_oc is not null then perform recalcular_orden_compra(v_oc); end if;
  return jsonb_build_object('id', v_compra, 'numero_control', v_numero, 'total', v_total);
end;
$fn$;

-- =============================================================================
-- anular_compra(id, motivo) — REDEFINIDA (conserva la lógica de lotes de 44).
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
  v_pagado numeric;
  v_ops text;
  v_caja record;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into c from compras where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada'; end if;

  -- Mismo orden de locks que registrar_compra: primero la orden, después los productos.
  if c.orden_compra_id is not null then
    perform 1 from ordenes_compra where id = c.orden_compra_id for update;
  end if;

  -- Pagos al proveedor: primero hay que anularlos (lo dice antes de tocar el stock).
  select x.pagado into v_pagado from cuentas_por_pagar x where x.compra_id = c.id for update;
  if coalesce(v_pagado, 0) > 0 then
    select string_agg(distinct k.numero, ', ' order by k.numero) into v_ops
      from pagos_proveedores_aplicaciones a
      join pagos_proveedores k on k.id = a.pago_id
      join cuentas_por_pagar x on x.id = a.cxp_id
     where x.compra_id = c.id and k.anulado_at is null;
    raise exception 'La compra % ya tiene pagos al proveedor (%): anulá primero esos pagos', c.numero_control, coalesce(v_ops, 'órdenes de pago');
  end if;

  -- Contado en efectivo: el egreso se anula; si la caja ya se cerró, no se puede.
  select m.id, cj.estado, cj.numero_caja into v_caja
    from caja_movimientos m join cajas cj on cj.id = m.caja_id
   where m.compra_id = c.id and m.anulado_at is null limit 1;
  if found and v_caja.estado <> 'abierta' then
    raise exception 'El efectivo de esta compra salió de la caja N° %, que ya se cerró: no se puede anular', v_caja.numero_caja;
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;

  for it in select * from compras_items where compra_id = c.id order by orden loop
    select * into prod from productos where id = it.producto_id and empresa_id = v_empresa for update;
    if not found or not prod.controla_stock then continue; end if;
    if prod.stock_actual < it.cantidad then
      raise exception 'No se puede anular: de "%" quedan % y la compra trajo %. Ya se vendió parte.',
        prod.nombre, trim_scale(prod.stock_actual), trim_scale(it.cantidad);
    end if;
    if it.lote_id is not null then
      select id, numero, cantidad into l from lotes where id = it.lote_id for update;
      if found then
        if l.cantidad < it.cantidad then
          raise exception 'No se puede anular: del lote % de "%" quedan % y la compra trajo %. Ya se vendió o se dio de baja parte.',
            l.numero, prod.nombre, trim_scale(l.cantidad), trim_scale(it.cantidad);
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

  update caja_movimientos set anulado_at = now(), anulado_por = v_usuario,
         anulado_motivo = left('Compra anulada: ' || btrim(p_motivo), 200)
   where compra_id = c.id and anulado_at is null;

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

-- =============================================================================
-- tg_compras_cxp — igual que 42, pero la deuda en USD es la suma exacta en dólares.
-- =============================================================================
create or replace function :"schema".tg_compras_cxp()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_pagado numeric;
  v_monto numeric;
begin
  if new.tipo_pago <> 'credito' then return null; end if;
  if new.estado = 'anulada' then
    select pagado into v_pagado from cuentas_por_pagar where compra_id = new.id;
    if coalesce(v_pagado, 0) > 0 then
      raise exception 'La compra % ya tiene pagos al proveedor: anulá primero esos pagos', new.numero_control;
    end if;
    update cuentas_por_pagar set estado = 'anulada', updated_at = now() where compra_id = new.id;
    return null;
  end if;
  -- compras.total está en Gs.; la deuda en USD va en dólares: Σ cantidad × costo US$.
  v_monto := case when new.moneda = 'USD'
                  then coalesce((select round(sum(i.cantidad * i.costo_unitario_original), 2) from compras_items i where i.compra_id = new.id),
                                round(new.total / nullif(new.tipo_cambio, 0), 2))
                  else new.total end;
  insert into cuentas_por_pagar (empresa_id, compra_id, proveedor_id, numero, fecha_emision, vencimiento, moneda, monto)
  values (new.empresa_id, new.id, new.proveedor_id, new.numero_factura,
          coalesce(new.fecha_factura, (new.fecha at time zone 'America/Asuncion')::date),
          coalesce(new.vencimiento, coalesce(new.fecha_factura, (new.fecha at time zone 'America/Asuncion')::date) + coalesce(new.plazo_dias, 30)),
          new.moneda, v_monto)
  on conflict (compra_id) do update
     set monto = excluded.monto, proveedor_id = excluded.proveedor_id, numero = excluded.numero,
         vencimiento = excluded.vencimiento, moneda = excluded.moneda,
         estado = case when cuentas_por_pagar.pagado >= excluded.monto then 'pagada'
                       when cuentas_por_pagar.pagado > 0 then 'parcial' else 'pendiente' end,
         updated_at = now();
  return null;
end;
$fn$;

-- =============================================================================
-- guardar_orden_compra(p jsonb) — igual que 23 + idempotencia al crear.
-- =============================================================================
create or replace function :"schema".guardar_orden_compra(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_prov record;
  v_numero text;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then nullif(p->>'tipo_cambio', '')::numeric else 1 end;
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
  if v_id is null and v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('oc:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero_oc, total into v_rep from ordenes_compra where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero_oc', v_rep.numero_oc, 'total', v_rep.total, 'repetido', true);
    end if;
  end if;
  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre into v_prov
    from proveedores where id = nullif(p->>'proveedor_id', '')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el proveedor'; end if;
  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición de pago inválida'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'La orden no tiene productos';
  end if;

  select u.nombre into v_usuario_nombre from usuarios u
   where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;

  if v_id is null then
    v_numero := 'OC-' || lpad(reservar_secuencia('orden_compra', coalesce((
                  select max(substring(numero_oc from '[0-9]+$')::bigint) from ordenes_compra where empresa_id = v_empresa), 0))::text, 6, '0');
    insert into ordenes_compra (empresa_id, numero_oc, proveedor_id, proveedor_nombre, fecha_entrega, tipo_pago,
                                plazo_dias, moneda, tipo_cambio, observacion, created_by, usuario_nombre, idempotency_key)
      values (v_empresa, v_numero, v_prov.id, v_prov.nombre, nullif(p->>'fecha_entrega', '')::date, v_tipo_pago,
              case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
              v_moneda, v_cambio, nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre, v_idem)
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
    v_cant := nullif(it->>'cantidad', '')::numeric;
    v_costo_orig := coalesce(nullif(it->>'costo_unitario', '')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_costo_orig < 0 then raise exception 'Producto %: el costo no puede ser negativo', v_orden; end if;
    v_costo := round(v_costo_orig * v_cambio, 2);
    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = v_empresa;
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

-- =============================================================================
-- registrar_pago_proveedor(p jsonb) — igual que 42 + lock de las cuentas antes de medir
-- la deuda + idempotencia + nada sin aplicar.
-- p = { idempotency_key?, proveedor_id, moneda?, medios: [{metodo, monto, referencia?}],
--       aplicaciones?: [{cxp_id, monto}], observacion? }
-- =============================================================================
create or replace function :"schema".registrar_pago_proveedor(p jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_prov record; v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_total numeric := 0; v_deuda numeric; v_caja uuid; v_pago uuid; v_numero text;
  v_restante numeric; v_aplicar numeric; v_usuario uuid; v_usuario_nombre text;
  md jsonb; ap jsonb; cx record; v_hay_efectivo boolean := false;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('pago_prov:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero, total, moneda into v_rep from pagos_proveedores where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero', v_rep.numero, 'total', v_rep.total, 'moneda', v_rep.moneda, 'repetido', true);
    end if;
  end if;
  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre into v_prov
    from proveedores where id = nullif(p->>'proveedor_id', '')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  if jsonb_typeof(p->'medios') is distinct from 'array' or jsonb_array_length(p->'medios') = 0 then
    raise exception 'Cargá cómo le pagás';
  end if;
  for md in select * from jsonb_array_elements(p->'medios') loop
    if coalesce(nullif(md->>'monto', '')::numeric, 0) <= 0 then raise exception 'Hay un monto en cero'; end if;
    if coalesce(md->>'metodo', '') not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then raise exception 'Medio de pago inválido'; end if;
    v_total := v_total + case when v_moneda = 'USD' then round((md->>'monto')::numeric, 2) else round((md->>'monto')::numeric) end;
    if md->>'metodo' = 'efectivo' then v_hay_efectivo := true; end if;
  end loop;

  -- Bloquea las cuentas abiertas del proveedor en esa moneda ANTES de medir la deuda:
  -- dos pagos a la vez se esperan y el segundo ve lo que dejó el primero.
  perform 1 from cuentas_por_pagar
   where proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda and estado in ('pendiente', 'parcial')
   order by id for update;
  select coalesce(sum(saldo), 0) into v_deuda from cuentas_por_pagar
   where proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda and estado in ('pendiente', 'parcial');
  if v_deuda <= 0 then raise exception 'No le debés nada a este proveedor en %', v_moneda; end if;
  if v_total > v_deuda then
    raise exception 'El pago (% %) es mayor que la deuda (% %)', v_moneda,
      case when v_moneda = 'USD' then to_char(v_total, 'FM999999990.00') else replace(to_char(v_total, 'FM999,999,999,990'), ',', '.') end, v_moneda,
      case when v_moneda = 'USD' then to_char(v_deuda, 'FM999999990.00') else replace(to_char(v_deuda, 'FM999,999,999,990'), ',', '.') end;
  end if;

  if v_hay_efectivo then
    if v_moneda <> 'GS' then raise exception 'El efectivo de la caja es en guaraníes: un pago en USD va por transferencia u otro medio'; end if;
    select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta' order by fecha_apertura desc limit 1;
    if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;
  v_numero := 'OP-' || lpad(reservar_secuencia('orden_pago', coalesce((
                select max(substring(numero from '[0-9]+$')::bigint) from pagos_proveedores where empresa_id = v_empresa), 0))::text, 6, '0');

  insert into pagos_proveedores (empresa_id, numero, proveedor_id, proveedor_nombre, moneda, total, caja_id, observacion,
                                 created_by, usuario_nombre, idempotency_key)
  values (v_empresa, v_numero, v_prov.id, v_prov.nombre, v_moneda, v_total, v_caja,
          nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre, v_idem)
  returning id into v_pago;

  for md in select * from jsonb_array_elements(p->'medios') loop
    insert into pagos_proveedores_medios (empresa_id, pago_id, metodo, monto, referencia)
    values (v_empresa, v_pago, md->>'metodo',
            case when v_moneda = 'USD' then round((md->>'monto')::numeric, 2) else round((md->>'monto')::numeric) end,
            left(nullif(btrim(md->>'referencia'), ''), 120));
    if md->>'metodo' = 'efectivo' then
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, pago_proveedor_id)
      values (v_empresa, v_caja, 'egreso', left('Pago ' || v_numero || ' · ' || v_prov.nombre, 200), round((md->>'monto')::numeric),
              'efectivo', 'pago_proveedor', v_usuario, (now() at time zone 'America/Asuncion')::date, v_pago);
    end if;
  end loop;

  -- Aplicación: las facturas elegidas, o lo que vence primero.
  v_restante := v_total;
  if jsonb_typeof(p->'aplicaciones') = 'array' and jsonb_array_length(p->'aplicaciones') > 0 then
    for ap in select * from jsonb_array_elements(p->'aplicaciones') loop
      select * into cx from cuentas_por_pagar
       where id = nullif(ap->>'cxp_id', '')::uuid and proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda
         and estado in ('pendiente', 'parcial') for update;
      if not found then raise exception 'Una de las facturas elegidas no es de este proveedor o ya está pagada'; end if;
      v_aplicar := least(coalesce(nullif(ap->>'monto', '')::numeric, 0), cx.saldo, v_restante);
      if v_aplicar <= 0 then continue; end if;
      insert into pagos_proveedores_aplicaciones (empresa_id, pago_id, cxp_id, monto) values (v_empresa, v_pago, cx.id, v_aplicar);
      update cuentas_por_pagar set pagado = pagado + v_aplicar, estado = estado_cxp(monto, pagado + v_aplicar, false), updated_at = now() where id = cx.id;
      v_restante := v_restante - v_aplicar;
    end loop;
  end if;
  for cx in select * from cuentas_por_pagar
             where proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda
               and estado in ('pendiente', 'parcial') and saldo > 0
             order by vencimiento, fecha_emision, numero for update loop
    exit when v_restante <= 0;
    v_aplicar := least(cx.saldo, v_restante);
    insert into pagos_proveedores_aplicaciones (empresa_id, pago_id, cxp_id, monto) values (v_empresa, v_pago, cx.id, v_aplicar);
    update cuentas_por_pagar set pagado = pagado + v_aplicar, estado = estado_cxp(monto, pagado + v_aplicar, false), updated_at = now() where id = cx.id;
    v_restante := v_restante - v_aplicar;
  end loop;
  if v_restante > 0 then
    raise exception 'El pago supera lo que se le debe a este proveedor en %: revisá los montos', v_moneda;
  end if;

  return jsonb_build_object('id', v_pago, 'numero', v_numero, 'total', v_total, 'moneda', v_moneda);
end;
$fn$;

grant execute on function :"schema".registrar_compra(jsonb), :"schema".anular_compra(uuid, text),
  :"schema".guardar_orden_compra(jsonb), :"schema".registrar_pago_proveedor(jsonb) to authenticated, service_role;
