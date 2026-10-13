-- =============================================================================
-- "Factura al contado" de la ficha del cliente (igual que el sistema actual): un servicio
-- puntual — monto, descripción y tipo de IVA — sin productos ni carrito y sin pasar por la
-- caja. Nace una venta de una sola línea manual con su cuenta a cobrar que VENCE HOY; se
-- cobra después con "Registrar pago" (transferencia → Conciliación) o con el cobro en caja.
--   emitir_factura_contado(p_cliente, p_monto, p_descripcion, p_tipo_iva) → jsonb
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create or replace function :"schema".emitir_factura_contado(
  p_cliente uuid, p_monto numeric, p_descripcion text default null, p_tipo_iva text default '10%')
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
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
  v_moneda := case when c.moneda_preferida = 'USD' then 'USD' else 'GS' end;
  v_monto := case when v_moneda = 'USD' then round(coalesce(p_monto, 0), 2) else round(coalesce(p_monto, 0)) end;
  if v_monto <= 0 then raise exception 'El monto debe ser mayor a 0'; end if;
  v_tasa := case p_tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0
                when v_moneda = 'USD' then round(v_monto * v_tasa / (100 + v_tasa), 2)
                else round(v_monto * v_tasa / (100 + v_tasa)) end;

  select nombre into v_usuario_nombre from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  select coalesce(max(case when numero_control ~ '^VTA-[0-9]+$'
           then substring(numero_control from '[0-9]+$')::bigint end), 0) + 1
    into v_next from ventas where empresa_id = v_empresa;
  v_numero := 'VTA-' || lpad(v_next::text, 6, '0');

  -- A crédito con plazo 0: así tiene su cuenta a cobrar (vence hoy) y se cobra después.
  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones)
  values (v_empresa, c.id, v_numero, v_moneda, 1, 0, 0, 0, 'completada',
          'CREDITO', 0, null, null, auth.uid(), v_usuario_nombre, now(), 'Factura al contado — ' || v_desc)
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
$$;
grant execute on function :"schema".emitir_factura_contado(uuid, numeric, text, text) to authenticated, service_role;
