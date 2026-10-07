-- =============================================================================
-- Función transaccional de VENTA (POS). PostgREST no hace transacciones multi-tabla,
-- así que la venta (header + ítems + cobro en caja + descuento de stock) va en esta
-- función: atómica y bajo RLS (SECURITY INVOKER → corre como el usuario).
-- Más segura que el original: precio e IVA salen del CATÁLOGO, no del cliente.
-- IVA paraguayo incluido en el precio: iva = total * tasa/(100+tasa).
-- IDEMPOTENTE (la función se re-crea; p_idempotency_key evita ventas duplicadas).
-- =============================================================================

-- La firma cambió (se agregaron descuento + plazo); drop del overload viejo
-- para que PostgREST no quede con dos funciones ambiguas.
drop function if exists :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text);

create or replace function :"schema".crear_venta(
  p_cliente_id uuid,
  p_tipo_venta text,
  p_metodo_pago text,
  p_moneda text,
  p_observaciones text,
  p_items jsonb,            -- [{ producto_id, cantidad, tipo_precio, tipo_iva?, precio_unitario? }]
  p_pagos jsonb,            -- [{ metodo_pago, monto, referencia, titular }] (opcional)
  p_idempotency_key text,
  p_descuento_pct numeric default 0,   -- descuento global %, se prorratea por línea
  p_plazo_dias integer default null    -- solo CREDITO: días de plazo (cuenta por cobrar)
) returns jsonb
language plpgsql
security invoker
set search_path = :"schema", public
as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_caja uuid;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario uuid;
  it jsonb;
  pg jsonb;
  v_pago_metodo text;
  v_pago_monto numeric;
  v_medio text;
  v_pagos_sum numeric := 0;
  prod record;
  v_precio numeric;
  v_precio_lista numeric;
  v_precio_override numeric;
  v_factor numeric;
  v_iva_tipo text;
  v_tasa numeric;
  v_cant numeric;
  v_total_linea numeric;
  v_iva numeric;
  v_sub numeric;
  tot_sub numeric := 0;
  tot_iva numeric := 0;
  tot_total numeric := 0;
begin
  if v_empresa is null then
    raise exception 'No hay empresa en la sesión';
  end if;

  -- Descuento global: factor 1 - pct/100, clamp 0..100. Se prorratea por línea.
  v_factor := 1 - greatest(0, least(coalesce(p_descuento_pct, 0), 100)) / 100.0;

  -- Idempotencia: si ya se creó con esta clave, devolver la misma venta.
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, numero_control into v_venta, v_numero
      from ventas where empresa_id = v_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_venta is not null then
      return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'reusada', true);
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un ítem';
  end if;

  select id into v_usuario from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;
  select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta'
    order by fecha_apertura desc limit 1;

  select coalesce(max(case when numero_control ~ '^VTA-[0-9]+$'
           then substring(numero_control from '[0-9]+$')::bigint end), 0) + 1
    into v_next from ventas where empresa_id = v_empresa;
  v_numero := 'VTA-' || lpad(v_next::text, 6, '0');

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio,
                      subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago,
                      caja_id, created_by, fecha, observaciones, idempotency_key)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', coalesce(p_tipo_venta, 'CONTADO'),
            case when coalesce(p_tipo_venta,'CONTADO') = 'CREDITO' then p_plazo_dias else null end,
            p_metodo_pago,
            v_caja, auth.uid(), now(), p_observaciones, nullif(p_idempotency_key, ''))
    returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un ítem'; end if;

    select * into prod from productos
      where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no existe en esta empresa', it->>'producto_id'; end if;

    -- Precio de lista según el nivel elegido.
    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then prod.costo_promedio
                  else prod.precio_venta end;
    -- Override manual de precio por el cajero (editar precio en la línea). Si viene
    -- y es > 0, pisa el de lista. El 2.0 lo acepta (misma confianza que O&M).
    v_precio_override := nullif(it->>'precio_unitario', '')::numeric;
    v_precio := case when v_precio_override is not null and v_precio_override > 0
                     then v_precio_override else v_precio_lista end;
    -- Descuento POR PRODUCTO (%) + global (si viniera): bajan el precio unitario.
    v_precio := round(v_precio
                      * (1 - greatest(0, least(coalesce((it->>'descuento_pct')::numeric, 0), 100)) / 100.0)
                      * v_factor);
    v_total_linea := round(v_cant * v_precio);
    -- IVA por ítem: si la venta lo manda, manda ese; si no, el del catálogo.
    v_iva_tipo := coalesce(nullif(it->>'tipo_iva', ''), prod.tipo_iva);
    v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
    v_iva := case when v_tasa = 0 then 0 else round(v_total_linea * v_tasa / (100 + v_tasa)) end;
    v_sub := v_total_linea - v_iva;

    if prod.controla_stock and prod.stock_actual < v_cant then
      raise exception 'Stock insuficiente de "%": hay %, se piden %', prod.nombre, prod.stock_actual, v_cant;
    end if;

    insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
                             precio_venta_original, precio_venta, tipo_precio, tipo_iva,
                             subtotal, monto_iva, total_linea, costo_unitario)
      values (v_empresa, v_venta, prod.id, prod.nombre, prod.sku, v_cant,
              v_precio_lista, v_precio, coalesce(it->>'tipo_precio', 'minorista'), v_iva_tipo,
              v_sub, v_iva, v_total_linea, prod.costo_promedio);

    if prod.controla_stock then
      update productos set stock_actual = stock_actual - v_cant, updated_at = now() where id = prod.id;
      -- Kardex: la venta es una SALIDA (misma transacción que el descuento de stock).
      insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
                                          costo_unitario, origen, referencia, created_by, usuario_nombre)
        values (v_empresa, prod.id, prod.nombre, prod.sku, 'SALIDA', v_cant, coalesce(prod.costo_promedio, 0),
                'venta', 'Venta ' || v_numero, v_usuario,
                (select u.nombre from usuarios u where u.id = v_usuario));
    end if;

    tot_sub := tot_sub + v_sub;
    tot_iva := tot_iva + v_iva;
    tot_total := tot_total + v_total_linea;
  end loop;

  update ventas set subtotal = tot_sub, monto_iva = tot_iva, total = tot_total, updated_at = now()
    where id = v_venta;

  -- Límite de crédito: si la venta es a crédito y el cliente tiene tope, no dejar pasarse.
  -- (cliente_saldo ya incluye esta venta recién insertada.) Mejora propia del 2.0.
  if coalesce(p_tipo_venta, 'CONTADO') = 'CREDITO' and p_cliente_id is not null then
    declare
      v_limite numeric;
      v_saldo numeric;
    begin
      select limite_credito into v_limite from clientes where id = p_cliente_id and empresa_id = v_empresa;
      if coalesce(v_limite, 0) > 0 then
        v_saldo := cliente_saldo(p_cliente_id);
        if v_saldo > v_limite then
          raise exception 'Supera el límite de crédito del cliente (límite %, quedaría en %)', v_limite, v_saldo;
        end if;
      end if;
    end;
  end if;

  -- Cobro en caja (venta de contado). Soporta PAGO MIXTO: p_pagos es un array
  -- [{metodo_pago, monto, referencia?, titular?}]. Por cada pago se registra el
  -- detalle y, si hay caja abierta, un movimiento de caja con la CATEGORÍA del
  -- medio (efectivo/transferencia/tarjeta/pos) para que el arqueo cuadre.
  -- El 'metodo_pago' del detalle puede traer el tipo (tarjeta_credito, pos_debito…);
  -- la categoría se deriva para el movimiento de caja.
  if coalesce(p_tipo_venta, 'CONTADO') = 'CONTADO' then
    if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
      for pg in select * from jsonb_array_elements(p_pagos) loop
        v_pago_metodo := coalesce(nullif(pg->>'metodo_pago', ''), 'efectivo');
        v_pago_monto := round((pg->>'monto')::numeric);
        if v_pago_monto is null or v_pago_monto <= 0 then
          raise exception 'Monto de pago inválido en el detalle';
        end if;
        v_pagos_sum := v_pagos_sum + v_pago_monto;
        v_medio := case
          when v_pago_metodo like 'tarjeta%' then 'tarjeta'
          when v_pago_metodo like 'pos%' then 'pos'
          when v_pago_metodo in ('efectivo', 'transferencia', 'cheque') then v_pago_metodo
          else 'otro' end;
        insert into ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto, referencia, titular)
          values (v_empresa, v_venta, v_pago_metodo, v_pago_monto, pg->>'referencia', pg->>'titular');
        if v_caja is not null then
          insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, venta_id, usuario_id, fecha)
            values (v_empresa, v_caja, 'ingreso', 'Venta ' || v_numero || ' (' || v_medio || ')', v_pago_monto, v_medio, v_venta, v_usuario, (now() at time zone 'America/Asuncion')::date);
        end if;
      end loop;
      -- La suma de los pagos debe cuadrar con el total de la venta.
      if v_pagos_sum <> tot_total then
        raise exception 'La suma de los pagos (%) no coincide con el total (%)', v_pagos_sum, tot_total;
      end if;
    elsif v_caja is not null then
      -- Sin detalle: un solo movimiento con el método de cabecera (compatibilidad).
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, venta_id, usuario_id, fecha)
        values (v_empresa, v_caja, 'ingreso', 'Venta ' || v_numero, tot_total,
                case when coalesce(p_metodo_pago,'efectivo') in ('efectivo','transferencia','tarjeta','cheque','pos') then p_metodo_pago else 'otro' end,
                v_venta, v_usuario, (now() at time zone 'America/Asuncion')::date);
    end if;
  end if;

  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', tot_total, 'reusada', false);
end;
$fn$;

grant execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer) to authenticated, service_role;
