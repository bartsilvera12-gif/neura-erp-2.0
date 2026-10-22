-- =============================================================================
-- CLIENTE OCASIONAL (X): se le puede facturar a un consumidor final que no da sus datos
-- (regla confirmada por el contador del dueño). En la factura figura como nombre "X" y
-- RUC "X" (o lo que se configure). En SIFEN se informa como receptor innominado
-- (iNatRec=2, iTiOpe=2 B2C, iTipIDRec=5 "Innominado", dNumIDRec "0", dNomRec "Sin Nombre").
--
--   · ventas.receptor_ocasional (boolean, default false): la venta es a cliente ocasional.
--     Solo sin cliente (cliente_id null) y al CONTADO (el crédito necesita un cliente real).
--   · facturacion_config: ocasional_nombre (default 'X'), ocasional_ruc (default 'X') y
--     ocasional_tope (Gs., null = sin tope). Por encima del tope NO hay factura (ticket sí).
--     Se leen en config_facturacion() y se editan en guardar_config_facturacion (solo ADMIN).
--   · tg_ventas_receptor (de 66): con receptor_ocasional guarda el receptor configurado (X/X)
--     y deja facturar sin RUC; sin la marca, la regla de 66 queda igual (sin RUC no hay
--     factura). También corre al cambiar el total (tope) y la condición.
--   · crear_venta (caja): + p_cliente_ocasional (14 parámetros: se borra la de 13).
--   · Listas: reporte_ventas_detalle, reporte_productos_vendidos_detalle y resumen_turno
--     muestran "Cliente ocasional (X)" en las ventas ocasionales (las demás sin cliente, igual).
--
-- IDEMPOTENTE. Va después de 66. Si se vuelve a correr 15 / 17 / 51 / 54 / 58 / 61 / 66,
-- correr 67 después.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columnas
-- =============================================================================
alter table :"schema".ventas add column if not exists receptor_ocasional boolean not null default false;

alter table :"schema".facturacion_config add column if not exists ocasional_nombre text not null default 'X';
alter table :"schema".facturacion_config add column if not exists ocasional_ruc text not null default 'X';
alter table :"schema".facturacion_config add column if not exists ocasional_tope numeric(18,0);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturacion_config_ocasional_chk' and conrelid = 'facturacion_config'::regclass) then
    alter table facturacion_config add constraint facturacion_config_ocasional_chk
      check (length(btrim(ocasional_nombre)) between 1 and 160 and length(btrim(ocasional_ruc)) between 1 and 20
             and (ocasional_tope is null or ocasional_tope > 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ventas_ocasional_chk' and conrelid = 'ventas'::regclass) then
    alter table ventas add constraint ventas_ocasional_chk check (not receptor_ocasional or cliente_id is null);
  end if;
end $$;

-- Etiqueta para las listas: "Cliente ocasional (X)" (null si la venta no es ocasional).
create or replace function :"schema".etiqueta_ocasional(p_ocasional boolean, p_receptor text)
returns text language sql immutable set search_path = :"schema", public as $$
  select case when p_ocasional then 'Cliente ocasional (' || coalesce(nullif(btrim(p_receptor), ''), 'X') || ')' end
$$;

-- Mensaje de 66 sin cliente: ahora menciona el cliente ocasional.
create or replace function :"schema".exigir_ruc_factura(p_cliente uuid)
returns void language plpgsql stable set search_path = :"schema", public as $fn$
declare
  c record;
begin
  if p_cliente is null then
    raise exception 'Para emitir factura elegí un cliente con RUC o "Cliente ocasional (X)". Sin cliente solo se puede emitir ticket.';
  end if;
  select cl.nombre, cl.razon_social, cl.ruc, cl.documento into c from clientes cl where cl.id = p_cliente;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if ruc_receptor(c.ruc, c.documento) is null then
    raise exception 'El cliente "%" no tiene RUC: solo se puede emitir ticket. Cargá su RUC en Datos para facturación (con la CI sola no se puede facturar).',
      nombre_receptor(c.razon_social, c.nombre);
  end if;
end;
$fn$;

-- =============================================================================
-- 2. Trigger del receptor (66 + cliente ocasional)
-- =============================================================================
create or replace function :"schema".tg_ventas_receptor()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare
  c record;
  f record;
begin
  -- 67: cliente ocasional (X). Sin cliente y al contado; receptor = lo configurado.
  if new.receptor_ocasional then
    if new.cliente_id is not null then
      raise exception 'Una venta a "Cliente ocasional (X)" no lleva cliente: quitá el cliente o la marca de ocasional.';
    end if;
    if upper(coalesce(new.tipo_venta, 'CONTADO')) <> 'CONTADO' then
      raise exception 'La venta a crédito necesita un cliente: el "Cliente ocasional (X)" es solo al contado.';
    end if;
    select coalesce(nullif(btrim(fc.ocasional_nombre), ''), 'X') as nombre, coalesce(nullif(btrim(fc.ocasional_ruc), ''), 'X') as ruc,
           fc.ocasional_tope as tope
      into f from facturacion_config fc where fc.empresa_id = new.empresa_id;
    if tg_op = 'INSERT' or new.receptor_nombre is null or old.receptor_ocasional is distinct from true then
      new.receptor_nombre := coalesce(f.nombre, 'X');
      new.receptor_ruc := coalesce(f.ruc, 'X');
    end if;
    -- Tope: por encima, factura no (ticket sí). Solo al crecer el total o al pasar a factura.
    if new.tipo_documento = 'factura' and f.tope is not null and coalesce(new.total, 0) > f.tope
       and (tg_op = 'INSERT' or coalesce(new.total, 0) > coalesce(old.total, 0)
            or new.tipo_documento is distinct from old.tipo_documento or old.receptor_ocasional is distinct from true) then
      raise exception 'La venta (Gs. %) supera el tope para facturar a "Cliente ocasional (X)" (Gs. %): elegí un cliente con RUC o emití solo ticket.',
        replace(to_char(new.total, 'FM999,999,999,990'), ',', '.'), replace(to_char(f.tope, 'FM999,999,999,990'), ',', '.');
    end if;
    return new;
  end if;

  -- 66 (igual): receptor desde el cliente; sin RUC no hay factura.
  if new.cliente_id is null then
    new.receptor_nombre := null;
    new.receptor_ruc := null;
  elsif tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id
        or new.tipo_documento is distinct from old.tipo_documento or new.receptor_nombre is null
        or old.receptor_ocasional then
    select cl.nombre, cl.razon_social, cl.ruc, cl.documento into c from clientes cl where cl.id = new.cliente_id;
    new.receptor_nombre := nombre_receptor(c.razon_social, c.nombre);
    new.receptor_ruc := ruc_receptor(c.ruc, c.documento);
  end if;
  if new.tipo_documento = 'factura' and new.receptor_ruc is null
     and (tg_op = 'INSERT' or new.tipo_documento is distinct from old.tipo_documento or new.cliente_id is distinct from old.cliente_id
          or old.receptor_ocasional) then
    perform exigir_ruc_factura(new.cliente_id);
    raise exception 'No se puede emitir factura sin RUC del cliente: solo ticket.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ventas_receptor on :"schema".ventas;
create trigger trg_ventas_receptor
  before insert or update of tipo_documento, cliente_id, receptor_ocasional, tipo_venta, total on :"schema".ventas
  for each row execute function :"schema".tg_ventas_receptor();

-- =============================================================================
-- 3. crear_venta (caja): + p_cliente_ocasional. Resto igual a 66.
-- =============================================================================
drop function if exists :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid, text);
create or replace function :"schema".crear_venta(
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_deposito_id uuid default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket', p_cliente_ocasional boolean default false)
returns jsonb
language plpgsql security definer
set search_path = :"schema", public
as $function$
declare
  s record;
  v_empresa uuid;
  v_caja record;
  v_caja_id uuid;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario uuid;
  v_dep uuid;
  v_dep_info record;
  v_tipo text := upper(coalesce(nullif(btrim(p_tipo_venta), ''), 'CONTADO'));
  v_doc text := lower(coalesce(nullif(btrim(p_tipo_documento), ''), 'ticket'));  -- 66
  v_ocasional boolean := coalesce(p_cliente_ocasional, false);                    -- 67
  it jsonb;
  pg jsonb;
  v_pagos jsonb;
  v_pago_metodo text;
  v_pago_monto numeric;
  v_recibido numeric;
  v_vuelto numeric;
  v_vuelto_total numeric := 0;
  v_pagos_sum numeric := 0;
  v_metodos text[] := '{}';
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
  v_item uuid;
  tot_sub numeric := 0;
  tot_iva numeric := 0;
  tot_total numeric := 0;
  -- 55: permisos del perfil sobre el precio.
  v_puede_precio boolean;
  v_tope numeric;
  v_ref numeric;
  v_piso numeric;
  v_manual boolean;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_empresa := s.s_empresa;
  v_usuario := s.s_usuario;

  if v_tipo not in ('CONTADO', 'CREDITO') then raise exception 'Condición de venta inválida'; end if;
  if v_doc not in ('factura', 'ticket') then raise exception 'Tipo de documento inválido (factura o ticket)'; end if;
  -- 67: cliente ocasional (X): sin cliente y solo al contado.
  if v_ocasional and p_cliente_id is not null then
    raise exception 'Elegí un cliente o "Cliente ocasional (X)", no los dos';
  end if;
  if v_ocasional and v_tipo = 'CREDITO' then
    raise exception 'La venta a crédito necesita un cliente: el "Cliente ocasional (X)" es solo al contado.';
  end if;
  -- 55: crédito, descuentos y precio manual dependen del perfil (tope % del perfil).
  if v_tipo = 'CREDITO' then perform exigir_permiso('vender_credito'); end if;
  v_puede_precio := tiene_permiso('descuentos_precio');
  v_tope := (select x.p_tope from perfil_sesion() x);
  if coalesce(p_descuento_pct, 0) > 0 then
    if not v_puede_precio then perform exigir_permiso('descuentos_precio'); end if;
    if v_tope is not null and p_descuento_pct > v_tope then
      raise exception 'El descuento (% %%) supera el tope de tu perfil (% %%)', trim_scale(p_descuento_pct), trim_scale(v_tope) using errcode = '42501';
    end if;
  end if;
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

  -- Caja (turno abierto) de la venta.
  v_caja_id := caja_abierta_para(null, null, p_caja_id);
  if v_caja_id is null then raise exception 'Abrí la caja para vender'; end if;
  select c.id, c.sucursal_id, c.punto_venta_id, c.deposito_id, c.numero_caja into v_caja
    from cajas c where c.id = v_caja_id for share;

  -- Cliente (si viene): de la empresa y no borrado. Crédito: obligatorio.
  if p_cliente_id is not null and not exists (
       select 1 from clientes where id = p_cliente_id and empresa_id = v_empresa and deleted_at is null) then
    raise exception 'Cliente no encontrado';
  end if;
  -- 66: sin RUC no hay factura (ticket sí, aun sin cliente). 67: salvo cliente ocasional (X).
  if v_doc = 'factura' and not v_ocasional then perform exigir_ruc_factura(p_cliente_id); end if;
  if v_tipo = 'CREDITO' then
    if p_cliente_id is null then raise exception 'La venta a crédito necesita un cliente'; end if;
    if p_plazo_dias is not null and (p_plazo_dias < 1 or p_plazo_dias > 3650) then
      raise exception 'El plazo del crédito tiene que estar entre 1 y 3650 días';
    end if;
  end if;

  -- Depósito del que sale el stock: el de la caja (o el elegido, validado como antes).
  if p_deposito_id is not null then
    select * into v_dep_info from inv_deposito(v_empresa, p_deposito_id, true);
    if not alcance_todas() and s.s_sucursal is not null and v_dep_info.suc_id <> s.s_sucursal then  -- 55
      raise exception 'Solo podés vender desde los depósitos de tu sucursal';
    end if;
    v_dep := p_deposito_id;
  else
    select * into v_dep_info from inv_deposito(v_empresa, v_caja.deposito_id, true);
    v_dep := v_caja.deposito_id;
  end if;

  -- Numeración: varias cajas venden a la vez → se serializa (misma llave que suscripciones).
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  v_numero := siguiente_numero_venta(v_empresa);  -- 61: prefijo y numeración de Configuración › Facturación

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio,
                      subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago,
                      caja_id, created_by, usuario_nombre, fecha, observaciones, idempotency_key, deposito_id,
                      sucursal_id, punto_venta_id, tipo_documento, receptor_ocasional)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', v_tipo,
            case when v_tipo = 'CREDITO' then p_plazo_dias else null end,
            case when v_tipo = 'CREDITO' then 'credito' else null end,
            v_caja.id, auth.uid(), s.s_nombre, now(), p_observaciones, nullif(p_idempotency_key, ''), v_dep,
            v_caja.sucursal_id, v_caja.punto_venta_id, v_doc, v_ocasional)
    returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un ítem'; end if;

    select * into prod from productos
      where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no existe en esta empresa', it->>'producto_id'; end if;

    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then prod.costo_promedio
                  else prod.precio_venta end;
    v_precio_override := nullif(it->>'precio_unitario', '')::numeric;
    v_precio := case when v_precio_override is not null and v_precio_override > 0
                     then v_precio_override else v_precio_lista end;
    v_precio := round(v_precio
                      * (1 - greatest(0, least(coalesce((it->>'descuento_pct')::numeric, 0), 100)) / 100.0)
                      * v_factor);
    -- 55: precio manual, precio de costo o más descuento que el del producto (Inventario)
    -- necesitan "descuentos y precios"; el descuento extra no puede pasar el tope del perfil.
    v_ref := case when coalesce(it->>'tipo_precio', 'minorista') = 'costo' then prod.precio_venta else v_precio_lista end;
    v_piso := coalesce(v_ref, 0) * (1 - greatest(0, least(coalesce(prod.descuento_pct, 0), 100)) / 100.0);
    v_manual := coalesce(it->>'tipo_precio', 'minorista') = 'costo'
             or (v_precio_override is not null and v_precio_override > 0 and v_precio_override is distinct from v_precio_lista)
             or v_precio < round(v_piso) - 1;
    if v_manual then
      if not v_puede_precio then
        raise exception 'Tu perfil no permite cambiar precios ni dar descuentos en caja ("%")', prod.nombre
          using errcode = '42501', hint = 'permiso:descuentos_precio';
      end if;
      if v_tope is not null and v_piso > 0 and v_precio + 1 < v_piso * (1 - v_tope / 100.0) then
        raise exception '"%": el descuento (% %%) supera el tope de tu perfil (% %%)',
          prod.nombre, trim_scale(round((1 - v_precio / v_piso) * 100, 1)), trim_scale(v_tope) using errcode = '42501';
      end if;
    end if;

    v_total_linea := round(v_cant * v_precio);
    v_iva_tipo := coalesce(nullif(it->>'tipo_iva', ''), prod.tipo_iva);
    v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
    v_iva := case when v_tasa = 0 then 0 else round(v_total_linea * v_tasa / (100 + v_tasa)) end;
    v_sub := v_total_linea - v_iva;

    insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
                             precio_venta_original, precio_venta, tipo_precio, tipo_iva,
                             subtotal, monto_iva, total_linea, costo_unitario)
      values (v_empresa, v_venta, prod.id, prod.nombre, prod.sku, v_cant,
              v_precio_lista, v_precio, coalesce(it->>'tipo_precio', 'minorista'), v_iva_tipo,
              v_sub, v_iva, v_total_linea, prod.costo_promedio)
      returning id into v_item;

    if prod.controla_stock then
      perform inv_mover(v_empresa, prod.id, v_dep, -v_cant, coalesce(prod.costo_promedio, 0), 'venta', 'venta',
                        v_venta, v_numero, 'Venta ' || v_numero, v_usuario, s.s_nombre);
      if prod.controla_lotes then
        perform lotes_consumir(v_empresa, prod.id, v_dep, v_cant, 'venta', v_venta, v_item, null, 'venta', v_venta, v_item);
      end if;
    end if;

    tot_sub := tot_sub + v_sub;
    tot_iva := tot_iva + v_iva;
    tot_total := tot_total + v_total_linea;
  end loop;

  -- 67: el trigger del receptor controla acá el tope de la factura a cliente ocasional.
  update ventas set subtotal = tot_sub, monto_iva = tot_iva, total = tot_total, updated_at = now()
    where id = v_venta;

  -- Límite de crédito: cliente_saldo ya incluye esta venta (la cuenta por cobrar la crea el trigger).
  if v_tipo = 'CREDITO' then
    declare
      v_limite numeric;
      v_saldo numeric;
    begin
      select limite_credito into v_limite from clientes where id = p_cliente_id and empresa_id = v_empresa;
      if coalesce(v_limite, 0) > 0 then
        v_saldo := cliente_saldo(p_cliente_id);
        if v_saldo > v_limite then
          raise exception 'Supera el límite de crédito del cliente (límite Gs. %, con esta venta quedaría en Gs. %)',
            replace(to_char(v_limite, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_saldo, 'FM999,999,999,990'), ',', '.');
        end if;
      end if;
    end;
  end if;

  -- Cobro (contado): una o varias formas de pago. Sin detalle = todo en efectivo.
  if v_tipo = 'CONTADO' then
    v_pagos := case when p_pagos is not null and jsonb_typeof(p_pagos) = 'array' and jsonb_array_length(p_pagos) > 0
                    then p_pagos
                    else jsonb_build_array(jsonb_build_object('metodo_pago', coalesce(nullif(p_metodo_pago, ''), 'efectivo'), 'monto', tot_total)) end;
    for pg in select * from jsonb_array_elements(v_pagos) loop
      v_pago_metodo := lower(coalesce(nullif(btrim(pg->>'metodo_pago'), ''), 'efectivo'));
      if v_pago_metodo not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'tarjeta_debito', 'tarjeta_credito',
                               'pos', 'pos_debito', 'pos_credito', 'qr', 'billetera', 'otro') then
        raise exception 'Forma de pago inválida: %', v_pago_metodo;
      end if;
      v_pago_monto := round((pg->>'monto')::numeric);
      if v_pago_monto is null or v_pago_monto <= 0 then raise exception 'Hay una forma de pago con monto en cero'; end if;
      v_recibido := round(nullif(pg->>'recibido', '')::numeric);
      v_vuelto := 0;
      if v_pago_metodo = 'efectivo' and v_recibido is not null then
        if v_recibido < v_pago_monto then
          raise exception 'El efectivo recibido (Gs. %) no alcanza para lo que se paga en efectivo (Gs. %)',
            replace(to_char(v_recibido, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_pago_monto, 'FM999,999,999,990'), ',', '.');
        end if;
        v_vuelto := v_recibido - v_pago_monto;
      else
        v_recibido := null;
      end if;
      v_vuelto_total := v_vuelto_total + v_vuelto;
      v_pagos_sum := v_pagos_sum + v_pago_monto;
      if not (metodo_caja(v_pago_metodo) = any (v_metodos)) then v_metodos := v_metodos || metodo_caja(v_pago_metodo); end if;

      insert into ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto, referencia, titular, banco, recibido, vuelto)
        values (v_empresa, v_venta, v_pago_metodo, v_pago_monto, nullif(btrim(pg->>'referencia'), ''), nullif(btrim(pg->>'titular'), ''),
                nullif(btrim(pg->>'banco'), ''), v_recibido, v_vuelto);
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, referencia, banco,
                                    categoria, venta_id, usuario_id, fecha)
        values (v_empresa, v_caja.id, 'ingreso', left('Venta ' || v_numero || ' · ' || metodo_caja_label(v_pago_metodo), 200),
                v_pago_monto, medio_caja(v_pago_metodo), metodo_caja(v_pago_metodo), nullif(btrim(pg->>'referencia'), ''),
                nullif(btrim(pg->>'banco'), ''), 'venta', v_venta, v_usuario, (now() at time zone 'America/Asuncion')::date);
    end loop;
    if v_pagos_sum <> tot_total then
      raise exception 'Las formas de pago suman Gs. % y la venta es de Gs. %',
        replace(to_char(v_pagos_sum, 'FM999,999,999,990'), ',', '.'), replace(to_char(tot_total, 'FM999,999,999,990'), ',', '.');
    end if;
    update ventas set metodo_pago = case when array_length(v_metodos, 1) > 1 then 'mixto' else v_metodos[1] end
     where id = v_venta;
  end if;

  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', tot_total, 'reusada', false,
                            'vuelto', v_vuelto_total, 'caja_id', v_caja.id, 'tipo_documento', v_doc,
                            'cliente_ocasional', v_ocasional);
end;
$function$;

revoke execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid, text, boolean) from public, anon;
grant execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid, text, boolean) to authenticated, service_role;

-- =============================================================================
-- 4. Configuración › Facturación: lectura (61 + cliente ocasional)
-- =============================================================================
create or replace function :"schema".config_facturacion()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c facturacion_config;
  a facturacion_autoimpresor;
  e empresas;
  sc sifen_config;
  v_sec record;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  select * into c from facturacion_config where empresa_id = s.p_empresa;
  select * into a from facturacion_autoimpresor where empresa_id = s.p_empresa;
  select * into e from empresas where id = s.p_empresa;
  select * into sc from sifen_config where empresa_id = s.p_empresa;
  select (x.certificado_p12 is not null) as cert, (x.certificado_password_cifrada is not null) as pw
    into v_sec from sifen_secretos x where x.empresa_id = s.p_empresa;

  return jsonb_build_object(
    'modo', coalesce(c.modo, 'sin_factura_fiscal'),
    'impresion_tipo_default', coalesce(c.impresion_tipo_default, 'ticket_80mm'),
    'preguntar_datos_al_confirmar', coalesce(c.preguntar_datos_al_confirmar, false),
    'prefijo_factura', coalesce(c.prefijo_factura, 'VTA-'),
    'numeracion_inicial', coalesce(c.numeracion_inicial, 1),
    'dias_vencimiento_default', coalesce(c.dias_vencimiento_default, 30),
    'interes_moratorio', coalesce(c.interes_moratorio, 1.5),
    'gestion_tributaria_clientes', coalesce(c.gestion_tributaria_clientes, false),
    -- 67: cliente ocasional (X)
    'ocasional_nombre', coalesce(nullif(btrim(c.ocasional_nombre), ''), 'X'),
    'ocasional_ruc', coalesce(nullif(btrim(c.ocasional_ruc), ''), 'X'),
    'ocasional_tope', c.ocasional_tope,
    'updated_at', c.updated_at,
    'updated_by_nombre', (select u.nombre from usuarios u where u.id = c.updated_by),
    'proximo_numero', siguiente_numero_venta(s.p_empresa),
    'ultimo_numero', (select v.numero_control from ventas v where v.empresa_id = s.p_empresa order by v.created_at desc limit 1),
    'sifen', jsonb_build_object(
      'configurada', sc.empresa_id is not null,
      'activo', coalesce(sc.activo, false),
      'ambiente', sc.ambiente,
      'completa', coalesce(sc.empresa_id is not null and sc.activo and sc.direccion_fiscal is not null
                  and coalesce(v_sec.cert, false) and coalesce(v_sec.pw, false), false)),
    -- Autoimpresor: lo guardado; lo vacío se precarga de Datos de la empresa (como sugerencia).
    'autoimpresor', jsonb_build_object(
      'guardado', a.empresa_id is not null,
      'activo', coalesce(a.activo, false),
      'ruc_emisor', coalesce(a.ruc_emisor, e.ruc),
      'razon_social_emisor', coalesce(a.razon_social_emisor, upper(e.razon_social)),
      'nombre_fantasia', coalesce(a.nombre_fantasia, upper(e.nombre_fantasia)),
      'direccion_matriz', coalesce(a.direccion_matriz, upper(e.direccion)),
      'telefono', coalesce(a.telefono, e.telefono),
      'timbrado_numero', a.timbrado_numero,
      'timbrado_inicio_vigencia', a.timbrado_inicio_vigencia,
      'timbrado_fin_vigencia', a.timbrado_fin_vigencia,
      'establecimiento_codigo', a.establecimiento_codigo,
      'punto_expedicion_codigo', a.punto_expedicion_codigo,
      'numero_actual', a.numero_actual,
      'numero_inicial', a.numero_inicial,
      'numero_final', a.numero_final,
      'tipo_documento_default', coalesce(a.tipo_documento_default, 'factura'),
      'formato_impresion_default', coalesce(a.formato_impresion_default, 'pdf_a4'),
      'leyenda_papel_termico', a.leyenda_papel_termico,
      'observaciones', a.observaciones),
    'puede_editar', s.p_rol = 'ADMIN' and tiene_permiso('configuracion'));
end;
$fn$;

-- =============================================================================
-- 5. Configuración › Facturación: escritura (61 + ocasional_nombre / ocasional_ruc / ocasional_tope)
-- =============================================================================
create or replace function :"schema".guardar_config_facturacion(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c facturacion_config;
  v_txt text;
  v_num numeric;
begin
  select * into s from fac_sesion_admin();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos de la configuración'; end if;

  insert into facturacion_config (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  select * into c from facturacion_config where empresa_id = s.p_empresa for update;

  if p ? 'modo' then
    if coalesce(p->>'modo', '') not in ('sin_factura_fiscal', 'sifen', 'autoimpresor') then raise exception 'Modo de facturación inválido'; end if;
    c.modo := p->>'modo';
  end if;
  if p ? 'impresion_tipo_default' then
    if coalesce(p->>'impresion_tipo_default', '') not in ('pdf_a4', 'pdf_media_hoja', 'ticket_80mm', 'ticket_58mm') then
      raise exception 'Tipo de impresión inválido';
    end if;
    c.impresion_tipo_default := p->>'impresion_tipo_default';
  end if;
  if p ? 'preguntar_datos_al_confirmar' then
    if jsonb_typeof(p->'preguntar_datos_al_confirmar') <> 'boolean' then raise exception '"Pedir datos del comprador" debe ser sí o no'; end if;
    c.preguntar_datos_al_confirmar := (p->>'preguntar_datos_al_confirmar')::boolean;
  end if;
  if p ? 'gestion_tributaria_clientes' then
    if jsonb_typeof(p->'gestion_tributaria_clientes') <> 'boolean' then raise exception 'La gestión tributaria debe ser sí o no'; end if;
    c.gestion_tributaria_clientes := (p->>'gestion_tributaria_clientes')::boolean;
  end if;
  if p ? 'prefijo_factura' then
    v_txt := upper(regexp_replace(coalesce(p->>'prefijo_factura', ''), '\s+', '', 'g'));
    if v_txt = '' then raise exception 'Escribí el prefijo de factura (ej. FAC-, FT-, VTA-)'; end if;
    if v_txt !~ '^[A-Z0-9][A-Z0-9/_.-]{0,11}$' then
      raise exception 'Prefijo inválido: hasta 12 letras o números y - / _ . (ej. FAC-, 001-001-)';
    end if;
    c.prefijo_factura := v_txt;
  end if;
  if p ? 'numeracion_inicial' then
    v_num := nullif(p->>'numeracion_inicial', '')::numeric;
    if v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 999999999 then
      raise exception 'La numeración inicial debe ser un número entero desde 1';
    end if;
    c.numeracion_inicial := v_num::bigint;
  end if;
  if p ? 'dias_vencimiento_default' then
    v_num := nullif(p->>'dias_vencimiento_default', '')::numeric;
    if v_num is null or v_num <> trunc(v_num) or v_num < 0 or v_num > 365 then
      raise exception 'Los días de vencimiento deben ser un número entero entre 0 y 365';
    end if;
    c.dias_vencimiento_default := v_num::integer;
  end if;
  if p ? 'interes_moratorio' then
    v_num := nullif(p->>'interes_moratorio', '')::numeric;
    if v_num is null or v_num < 0 or v_num > 100 then raise exception 'El interés moratorio debe estar entre 0 y 100 %% mensual'; end if;
    c.interes_moratorio := round(v_num, 2);
  end if;
  -- 67: cliente ocasional (X). Vacío = vuelve a "X".
  if p ? 'ocasional_nombre' then
    v_txt := coalesce(fac_txt(p->>'ocasional_nombre'), 'X');
    if length(v_txt) > 160 then raise exception 'El nombre del cliente ocasional no puede pasar de 160 caracteres'; end if;
    c.ocasional_nombre := v_txt;
  end if;
  if p ? 'ocasional_ruc' then
    v_txt := coalesce(upper(regexp_replace(coalesce(p->>'ocasional_ruc', ''), '\s+', '', 'g')), '');
    if v_txt = '' then v_txt := 'X'; end if;
    if length(v_txt) > 20 then raise exception 'El RUC del cliente ocasional no puede pasar de 20 caracteres'; end if;
    c.ocasional_ruc := v_txt;
  end if;
  if p ? 'ocasional_tope' then
    v_num := nullif(btrim(coalesce(p->>'ocasional_tope', '')), '')::numeric;
    if v_num is not null and (v_num <> trunc(v_num) or v_num <= 0 or v_num > 999999999999) then
      raise exception 'El tope para cliente ocasional tiene que ser un monto en guaraníes mayor a 0 (o vacío: sin tope)';
    end if;
    c.ocasional_tope := v_num;
  end if;

  update facturacion_config
     set modo = c.modo, impresion_tipo_default = c.impresion_tipo_default,
         preguntar_datos_al_confirmar = c.preguntar_datos_al_confirmar, gestion_tributaria_clientes = c.gestion_tributaria_clientes,
         prefijo_factura = c.prefijo_factura, numeracion_inicial = c.numeracion_inicial,
         dias_vencimiento_default = c.dias_vencimiento_default, interes_moratorio = c.interes_moratorio,
         ocasional_nombre = c.ocasional_nombre, ocasional_ruc = c.ocasional_ruc, ocasional_tope = c.ocasional_tope,
         updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return config_facturacion();
end;
$fn$;

-- =============================================================================
-- 6. Listas: "Cliente ocasional (X)" donde va el cliente
-- =============================================================================

-- 6.a Reporte de ventas (detalle). Igual a la vigente (15/54) + etiqueta del ocasional.
create or replace function :"schema".reporte_ventas_detalle(
  p_desde date, p_hasta date, p_cajero uuid default null, p_tipo text default null, p_medio text default null,
  p_categoria text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable set search_path = :"schema", public as $function$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with base as (
    select * from reporte_ventas_base(p_desde, p_hasta, p_cajero, p_tipo, p_medio, p_categoria)
  ),
  pag as (
    select * from base order by fecha desc, id desc
     limit least(greatest(coalesce(p_limit, 25), 1), 50000) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'numero', v.numero_control, 'fecha', v.fecha, 'tipo', v.tipo_venta, 'estado', v.estado,
        'total', v.total, 'iva', v.monto_iva,
        'cliente', coalesce(c.razon_social, c.nombre, etiqueta_ocasional(v.receptor_ocasional, v.receptor_nombre)),  -- 67
        'cajero', u.nombre,
        'items', (select count(*) from ventas_items vi where vi.venta_id = v.id),
        'ganancia', (select coalesce(sum(vi.total_linea - vi.cantidad * coalesce(vi.costo_unitario, 0)), 0)
                       from ventas_items vi where vi.venta_id = v.id),
        'medios', case when v.tipo_venta = 'CREDITO' then jsonb_build_array('credito')
                       else coalesce((select jsonb_agg(distinct categoria_pago(d.metodo_pago))
                                        from ventas_pagos_detalle d where d.venta_id = v.id),
                                     jsonb_build_array(categoria_pago(v.metodo_pago))) end
      ) order by v.fecha desc, v.id desc)
        from pag v
        left join clientes c on c.id = v.cliente_id
        left join usuarios u on u.auth_user_id = v.created_by and u.empresa_id = v.empresa_id
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$function$;

-- 6.b Productos vendidos (detalle). Igual a la vigente (58) + etiqueta del ocasional (y se busca por "ocasional").
create or replace function :"schema".reporte_productos_vendidos_detalle(
  p_desde date, p_hasta date, p_categoria text default null, p_producto uuid default null,
  p_limit integer default 50, p_offset integer default 0, p_q text default null)
returns jsonb language plpgsql stable set search_path = :"schema", public as $function$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with lineas as (
    select vi.id, vi.venta_id, v.numero_control, v.fecha, v.tipo_venta, v.created_by, v.cliente_id,
           v.receptor_ocasional, v.receptor_nombre,
           vi.producto_id, vi.producto_nombre, vi.sku, vi.cantidad, vi.precio_venta, vi.precio_venta_original,
           vi.total_linea, vi.total_linea - vi.cantidad * coalesce(vi.costo_unitario, 0) as ganancia
      from ventas_items vi
      join ventas v on v.id = vi.venta_id
      left join productos p on p.id = vi.producto_id
      left join clientes cq on p_q is not null and cq.id = v.cliente_id
      left join usuarios uq on p_q is not null and uq.auth_user_id = v.created_by and uq.empresa_id = empresa_actual()
     where v.empresa_id = empresa_actual()
       and (nullif(trim(p_q), '') is null or coincide_busqueda(
             concat_ws(' ', norm(vi.producto_nombre), compacto(vi.producto_nombre), norm(vi.sku), compacto(vi.sku),
                       norm(v.numero_control), compacto(v.numero_control), norm(cq.nombre), norm(cq.razon_social),
                       compacto(cq.ruc), norm(uq.nombre),
                       case when v.receptor_ocasional then 'cliente ocasional' end),
             tokens_busqueda(p_q)))
       and v.estado <> 'anulada'
       and v.fecha >= (p_desde::timestamp at time zone 'America/Asuncion')
       and v.fecha < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
       and (p_producto is null or vi.producto_id = p_producto)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
  ),
  pag as (
    select * from lineas order by fecha desc, id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 50000) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from lineas),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'venta_id', l.venta_id, 'numero', l.numero_control, 'fecha', l.fecha, 'tipo', l.tipo_venta,
        'producto_id', l.producto_id, 'producto', l.producto_nombre, 'sku', l.sku,
        'cantidad', l.cantidad, 'precio', l.precio_venta, 'precio_lista', l.precio_venta_original,
        'total', l.total_linea, 'ganancia', l.ganancia,
        'cajero', u.nombre, 'cliente', coalesce(c.razon_social, c.nombre, etiqueta_ocasional(l.receptor_ocasional, l.receptor_nombre))  -- 67
      ) order by l.fecha desc, l.id desc)
        from pag l
        left join usuarios u on u.auth_user_id = l.created_by and u.empresa_id = empresa_actual()
        left join clientes c on c.id = l.cliente_id
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$function$;

-- 6.c Resumen del turno (51/58, función larga): solo se cambia el nombre del cliente de las
--     listas de ventas. Idempotente: si ya tiene la etiqueta, no hace nada.
do $do$
declare
  v_def text;
  v_nueva text;
begin
  v_def := pg_get_functiondef(to_regprocedure(current_schema() || '.resumen_turno(uuid)'));
  if v_def is null then raise exception 'No está resumen_turno(uuid): correr 51 antes'; end if;
  if position('etiqueta_ocasional' in v_def) = 0 then
    v_nueva := replace(v_def,
      $$'cliente_nombre', coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre)$$,
      $$'cliente_nombre', coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre, etiqueta_ocasional(v.receptor_ocasional, v.receptor_nombre))$$);
    if v_nueva = v_def then raise exception 'resumen_turno: no se encontró el nombre del cliente para agregar el cliente ocasional'; end if;
    execute v_nueva;
  end if;
end;
$do$;

-- =============================================================================
-- 7. Permisos
-- =============================================================================
revoke all on function :"schema".etiqueta_ocasional(boolean, text) from public, anon;
grant execute on function :"schema".etiqueta_ocasional(boolean, text) to authenticated, service_role;

commit;
