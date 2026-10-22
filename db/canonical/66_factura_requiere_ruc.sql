-- =============================================================================
-- SIN RUC NO HAY FACTURA (regla del dueño, en todo el sistema).
--
--   · RUC del receptor: primero clientes.ruc ("RUC" de Datos para facturación); si está
--     vacío, clientes.documento SOLO si tiene formato de RUC paraguayo con el dígito
--     verificador correcto (ruc_valido de 57: 3 a 8 dígitos, guion, DV módulo 11). Una CI
--     sola NO alcanza. → ruc_receptor(ruc, documento).
--   · Nombre del receptor: razon_social (razón social / "nombre para factura"); si está
--     vacía, nombre. → nombre_receptor(razon_social, nombre).
--   · ventas.tipo_documento ('factura' | 'ticket', default 'ticket') y el receptor guardado
--     en la venta (receptor_nombre, receptor_ruc): lo que se imprime sale de ahí.
--   · Trigger tg_ventas_receptor (BEFORE INSERT / UPDATE OF tipo_documento, cliente_id):
--     llena el receptor desde el cliente y RECHAZA tipo 'factura' sin RUC. Vale para
--     cualquier camino que cree ventas, no solo la UI.
--   · crear_venta (caja) v55+61 → misma lógica + p_tipo_documento ('ticket' por defecto).
--     Cambia la firma (13 parámetros): se borra la de 12.
--   · emitir_factura_contado (ficha del cliente) y emitir_cuota_suscripcion: son factura;
--     sin RUC se rechazan antes de numerar. Se redefinen desde la versión vigente (45/29
--     con el bloque de numeración de 61).
--
-- IDEMPOTENTE. Va después de 61. Si se vuelve a correr 11 / 29 / 45 / 50 / 51 / 55 / 61,
-- correr 66 después.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Reglas del receptor
-- =============================================================================
create or replace function :"schema".ruc_receptor(p_ruc text, p_documento text)
returns text language sql immutable set search_path = :"schema", public as $$
  select coalesce(
    nullif(btrim(p_ruc), ''),
    case when ruc_valido(regexp_replace(coalesce(p_documento, ''), '[\s.]', '', 'g'))
         then regexp_replace(p_documento, '[\s.]', '', 'g') end)
$$;

create or replace function :"schema".nombre_receptor(p_razon_social text, p_nombre text)
returns text language sql immutable set search_path = :"schema", public as $$
  select coalesce(nullif(btrim(p_razon_social), ''), nullif(btrim(p_nombre), ''))
$$;

-- Levanta el error claro si a ese cliente (o a nadie) no se le puede facturar.
create or replace function :"schema".exigir_ruc_factura(p_cliente uuid)
returns void language plpgsql stable set search_path = :"schema", public as $fn$
declare
  c record;
begin
  if p_cliente is null then
    raise exception 'Para emitir factura elegí un cliente con RUC. Sin cliente solo se puede emitir ticket.';
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
-- 2. Venta: tipo de documento y receptor guardado
-- =============================================================================
alter table :"schema".ventas add column if not exists tipo_documento text;
alter table :"schema".ventas add column if not exists receptor_nombre text;
alter table :"schema".ventas add column if not exists receptor_ruc text;

-- Ventas anteriores: receptor desde el cliente; cuotas y facturas al contado con RUC → factura.
update ventas v
   set receptor_nombre = nombre_receptor(c.razon_social, c.nombre), receptor_ruc = ruc_receptor(c.ruc, c.documento)
  from clientes c
 where c.id = v.cliente_id and v.receptor_nombre is null;
update ventas
   set tipo_documento = case when receptor_ruc is not null
                              and (suscripcion_id is not null or observaciones like 'Factura al contado —%')
                             then 'factura' else 'ticket' end
 where tipo_documento is null;
alter table :"schema".ventas alter column tipo_documento set default 'ticket';
alter table :"schema".ventas alter column tipo_documento set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ventas_tipo_documento_chk' and conrelid = 'ventas'::regclass) then
    alter table ventas add constraint ventas_tipo_documento_chk check (tipo_documento in ('factura', 'ticket'));
  end if;
end $$;

create or replace function :"schema".tg_ventas_receptor()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare
  c record;
begin
  if new.cliente_id is null then
    new.receptor_nombre := null;
    new.receptor_ruc := null;
  elsif tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id
        or new.tipo_documento is distinct from old.tipo_documento or new.receptor_nombre is null then
    select cl.nombre, cl.razon_social, cl.ruc, cl.documento into c from clientes cl where cl.id = new.cliente_id;
    new.receptor_nombre := nombre_receptor(c.razon_social, c.nombre);
    new.receptor_ruc := ruc_receptor(c.ruc, c.documento);
  end if;
  if new.tipo_documento = 'factura' and new.receptor_ruc is null
     and (tg_op = 'INSERT' or new.tipo_documento is distinct from old.tipo_documento or new.cliente_id is distinct from old.cliente_id) then
    perform exigir_ruc_factura(new.cliente_id);
    raise exception 'No se puede emitir factura sin RUC del cliente: solo ticket.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ventas_receptor on :"schema".ventas;
create trigger trg_ventas_receptor before insert or update of tipo_documento, cliente_id on :"schema".ventas
  for each row execute function :"schema".tg_ventas_receptor();

-- =============================================================================
-- 3. crear_venta (caja): + p_tipo_documento. Resto igual a 55 (+ numeración de 61).
-- =============================================================================
drop function if exists :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid);
create or replace function :"schema".crear_venta(
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_deposito_id uuid default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket')
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
  -- 66: sin RUC no hay factura (ticket sí, aun sin cliente).
  if v_doc = 'factura' then perform exigir_ruc_factura(p_cliente_id); end if;
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
                      sucursal_id, punto_venta_id, tipo_documento)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', v_tipo,
            case when v_tipo = 'CREDITO' then p_plazo_dias else null end,
            case when v_tipo = 'CREDITO' then 'credito' else null end,
            v_caja.id, auth.uid(), s.s_nombre, now(), p_observaciones, nullif(p_idempotency_key, ''), v_dep,
            v_caja.sucursal_id, v_caja.punto_venta_id, v_doc)
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
                            'vuelto', v_vuelto_total, 'caja_id', v_caja.id, 'tipo_documento', v_doc);
end;
$function$;

revoke execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid, text) from public, anon;
grant execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid, text) to authenticated, service_role;

-- =============================================================================
-- 4. Factura al contado (ficha del cliente): siempre factura → exige RUC.
-- =============================================================================
create or replace function :"schema".emitir_factura_contado(
  p_cliente uuid, p_monto numeric, p_descripcion text default null, p_tipo_iva text default '10%')
returns jsonb
language plpgsql
set search_path = :"schema", public
as $function$
declare
  v_empresa uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  c clientes;
  v_desc text := coalesce(nullif(btrim(p_descripcion), ''), 'Venta al contado');
  v_moneda text;
  v_monto numeric;
  v_tasa numeric;
  v_iva numeric;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario_nombre text;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if p_tipo_iva not in ('10%', '5%', 'exenta') then raise exception 'Tipo de IVA inválido'; end if;
  select * into c from clientes where id = p_cliente and empresa_id = v_empresa and deleted_at is null;
  if not found then raise exception 'Cliente no encontrado'; end if;
  perform exigir_ruc_factura(c.id);  -- 66: sin RUC no hay factura
  v_moneda := case when c.moneda_preferida = 'USD' then 'USD' else 'GS' end;
  v_monto := case when v_moneda = 'USD' then round(coalesce(p_monto, 0), 2) else round(coalesce(p_monto, 0)) end;
  if v_monto <= 0 then raise exception 'El monto debe ser mayor a 0'; end if;
  v_tasa := case p_tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0
                when v_moneda = 'USD' then round(v_monto * v_tasa / (100 + v_tasa), 2)
                else round(v_monto * v_tasa / (100 + v_tasa)) end;

  select nombre into v_usuario_nombre from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  v_numero := siguiente_numero_venta(v_empresa);  -- 61: prefijo y numeración de Configuración › Facturación

  -- A crédito con plazo 0: así tiene su cuenta a cobrar (vence hoy) y se cobra después.
  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones,
                      tipo_documento)
  values (v_empresa, c.id, v_numero, v_moneda, 1, 0, 0, 0, 'completada',
          'CREDITO', 0, null, null, auth.uid(), v_usuario_nombre, now(), 'Factura al contado — ' || v_desc,
          'factura')
  returning id into v_venta;

  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (v_empresa, v_venta, null, v_desc, null, 1, v_monto, v_monto,
          'minorista', p_tipo_iva, v_monto - v_iva, v_iva, v_monto, true, 0);

  update ventas set subtotal = v_monto - v_iva, monto_iva = v_iva, total = v_monto, updated_at = now() where id = v_venta;
  update cuentas_por_cobrar set vencimiento = v_hoy, updated_at = now() where venta_id = v_venta;

  perform registrar_historial_cliente(c.id, 'venta',
    jsonb_build_object('evento', 'factura_contado', 'numero', v_numero, 'descripcion', v_desc,
                       'monto', v_monto, 'moneda', v_moneda));
  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', v_monto, 'moneda', v_moneda);
end;
$function$;

-- =============================================================================
-- 5. Cuota de suscripción: es factura → exige RUC (antes de tocar la suscripción).
--    "Emitir cuotas del mes" (emitir_cuotas_mes) ya junta los errores por cliente.
-- =============================================================================
create or replace function :"schema".emitir_cuota_suscripcion(p_suscripcion uuid, p_periodo date default null)
returns jsonb
language plpgsql
set search_path = :"schema", public
as $function$
declare
  v_empresa uuid := empresa_actual();
  s suscripciones;
  v_periodo date;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_plan_nombre text;
  v_precio numeric;
  v_venc date;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario uuid;
  v_usuario_nombre text;
  v_tasa numeric;
  v_iva numeric;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select * into s from suscripciones where id = p_suscripcion and empresa_id = v_empresa for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;
  if s.estado <> 'activa' then raise exception 'La suscripción está %: no se emiten cuotas', s.estado; end if;
  perform exigir_ruc_factura(s.cliente_id);  -- 66: sin RUC no hay factura

  v_periodo := date_trunc('month', coalesce(p_periodo, v_hoy))::date;
  if v_periodo < date_trunc('month', s.fecha_inicio)::date then
    raise exception 'Ese mes es anterior al inicio de la suscripción';
  end if;
  if s.duracion_meses is not null
     and v_periodo >= (date_trunc('month', s.fecha_inicio) + make_interval(months => s.duracion_meses))::date then
    raise exception 'Ese mes está fuera de la duración de la suscripción';
  end if;
  if exists (select 1 from ventas where suscripcion_id = s.id and periodo = v_periodo and estado <> 'anulada') then
    raise exception 'La cuota de % ya está emitida', nombre_mes(v_periodo);
  end if;

  -- Cambio de plan programado: desde su mes en adelante rige el plan nuevo.
  if s.plan_pendiente_id is not null and s.pendiente_desde is not null and v_periodo >= s.pendiente_desde then
    update suscripciones
       set plan_id = plan_pendiente_id, plan_nombre = plan_pendiente_nombre, precio = precio_pendiente,
           moneda = coalesce(moneda_pendiente, moneda), tipo_iva = coalesce(tipo_iva_pendiente, tipo_iva),
           plan_pendiente_id = null, plan_pendiente_nombre = null, precio_pendiente = null, pendiente_desde = null,
           moneda_pendiente = null, tipo_iva_pendiente = null,
           updated_at = now()
     where id = s.id
     returning * into s;
  end if;

  v_plan_nombre := s.plan_nombre;
  v_precio := round(s.precio);
  -- Vencimiento real del mes (una cuota atrasada que se emite hoy ya nace vencida).
  v_venc := dia_del_mes(v_periodo, s.dia_vencimiento);
  v_tasa := case s.tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0 else round(v_precio * v_tasa / (100 + v_tasa)) end;

  select id, nombre into v_usuario, v_usuario_nombre from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  v_numero := siguiente_numero_venta(v_empresa);  -- 61: prefijo y numeración de Configuración › Facturación

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones,
                      suscripcion_id, periodo, tipo_documento)
  values (v_empresa, s.cliente_id, v_numero, s.moneda, 1, 0, 0, 0, 'completada',
          'CREDITO', greatest(v_venc - v_hoy, 0), null, null, auth.uid(), v_usuario_nombre, now(),
          'Cuota ' || v_plan_nombre || ' — ' || nombre_mes(v_periodo), s.id, v_periodo, 'factura')
  returning id into v_venta;

  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (v_empresa, v_venta, null, v_plan_nombre || ' — ' || nombre_mes(v_periodo), null, 1, v_precio, v_precio,
          'minorista', s.tipo_iva, v_precio - v_iva, v_iva, v_precio, true, 0);

  update ventas set subtotal = v_precio - v_iva, monto_iva = v_iva, total = v_precio, updated_at = now() where id = v_venta;
  -- El trigger de cuentas a cobrar calcula el vencimiento por plazo: lo fijamos al día exacto.
  update cuentas_por_cobrar set vencimiento = v_venc, updated_at = now() where venta_id = v_venta;

  perform registrar_historial_cliente(s.cliente_id, 'suscripcion',
    jsonb_build_object('evento', 'cuota', 'plan', v_plan_nombre, 'periodo', nombre_mes(v_periodo),
                       'numero', v_numero, 'monto', v_precio, 'moneda', s.moneda));
  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', v_precio, 'vencimiento', v_venc);
end;
$function$;

-- =============================================================================
-- 6. Permisos
-- =============================================================================
revoke all on function :"schema".ruc_receptor(text, text) from public, anon;
revoke all on function :"schema".nombre_receptor(text, text) from public, anon;
revoke all on function :"schema".exigir_ruc_factura(uuid) from public, anon;
grant execute on function :"schema".ruc_receptor(text, text) to authenticated, service_role;
grant execute on function :"schema".nombre_receptor(text, text) to authenticated, service_role;
grant execute on function :"schema".exigir_ruc_factura(uuid) to authenticated, service_role;

commit;
