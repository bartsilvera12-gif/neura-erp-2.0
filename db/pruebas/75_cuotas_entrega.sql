-- Cuotas largas, entrega inicial y planes de cuotas (receta 131), y venta de una propiedad.
do $$
declare
  v jsonb;
  v_prod uuid;
  v_plan uuid;
  v_efe numeric;
  v_venta uuid;
  p1 jsonb;
  v_tipos jsonb;
begin
  v_prod := pg_temp.producto('Lote cuotas', 1200000, '5%');
  perform pg_temp.comprar(v_prod, 20, 500000);

  -- Tope y planes.
  v := planes_cuota_guardar('{"max_cuotas": 120, "planes": [{"nombre": "PRUEBA 10 cuotas con 10 %", "cuotas": 10, "cada": "mes", "primera_dias": 30, "entrega_pct": 10}]}');
  perform pg_temp.ok('Cuotas: el administrador arma un plan y el tope', (v->>'max_cuotas')::integer = 120 and jsonb_array_length(v->'planes') = 1, v::text);
  v_plan := (v->'planes'->0->>'id')::uuid;
  perform pg_temp.rechaza('Cuotas: un plan no pasa el tope',
    $q$select planes_cuota_guardar('{"max_cuotas": 120, "planes": [{"nombre": "PRUEBA 200", "cuotas": 200}]}')$q$, 'entre 1 y 120');

  -- Más de 60 cuotas (antes el tope era 60).
  v := pg_temp.vender_a(pg_temp.fx('cliente'), v_prod, 1, 'CREDITO', null, 100);
  perform pg_temp.igual('Cuotas: una venta en 100 cuotas arma 100 cuentas', (select count(*) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid)::numeric, 100);
  perform pg_temp.rechaza('Cuotas: más que el tope no',
    format($q$select crear_venta(%L, 'CREDITO', null, 'GS', null, '[{"producto_id": "%s", "cantidad": 1}]', null, null, p_plazo_dias => 30, p_caja_id => %L, p_cuotas => 121)$q$,
      pg_temp.fx('cliente'), v_prod, pg_temp.fx('caja')), 'de 1 a 120');

  -- Entrega + cuotas, cobrada en el mismo paso.
  v_efe := pg_temp.efectivo();
  v := vender_en_cuotas(jsonb_build_object('cliente_id', pg_temp.fx('cliente'), 'caja_id', pg_temp.fx('caja'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1)),
    'cuotas', 10, 'plazo_dias', 30, 'entrega', 200000, 'pagos', '[{"metodo_pago": "efectivo", "monto": 200000}]'::jsonb));
  v_venta := (v->>'venta_id')::uuid;
  perform pg_temp.ok('Entrega: la entrega es la cuota 0 y ya quedó pagada',
    exists (select 1 from cuentas_por_cobrar where venta_id = v_venta and cuota = 0 and monto = 200000 and estado = 'pagada'), v::text);
  perform pg_temp.igual('Entrega: las 10 cuotas suman el resto', (select sum(monto) from cuentas_por_cobrar where venta_id = v_venta and cuota > 0), 1000000);
  perform pg_temp.igual('Entrega: cada cuota es igual', (select max(monto) - min(monto) from cuentas_por_cobrar where venta_id = v_venta and cuota > 0), 0);
  perform pg_temp.igual('Entrega: la entrega entra a la caja', pg_temp.efectivo() - v_efe, 200000);
  perform pg_temp.igual('Entrega: el cliente debe solo las cuotas', (select sum(saldo) from cuentas_por_cobrar where venta_id = v_venta), 1000000);

  perform pg_temp.rechaza('Entrega: lo que paga tiene que ser igual a la entrega',
    format($q$select vender_en_cuotas('{"cliente_id": "%s", "caja_id": "%s", "items": [{"producto_id": "%s", "cantidad": 1}], "cuotas": 5, "entrega": 100000, "pagos": [{"metodo_pago": "efectivo", "monto": 50000}]}')$q$,
      pg_temp.fx('cliente'), pg_temp.fx('caja'), v_prod), 'igual a la entrega');
  perform pg_temp.rechaza('Entrega: no puede ser todo el total',
    format($q$select vender_en_cuotas('{"cliente_id": "%s", "caja_id": "%s", "items": [{"producto_id": "%s", "cantidad": 1}], "cuotas": 5, "entrega": 1200000, "pagos": [{"metodo_pago": "efectivo", "monto": 1200000}]}')$q$,
      pg_temp.fx('cliente'), pg_temp.fx('caja'), v_prod), 'menor que el total');

  -- El plan pone las cuotas y exige su entrega mínima.
  perform pg_temp.rechaza('Plan: pide la entrega mínima',
    format($q$select vender_en_cuotas('{"cliente_id": "%s", "caja_id": "%s", "items": [{"producto_id": "%s", "cantidad": 1}], "plan_id": "%s", "entrega": 50000, "pagos": [{"metodo_pago": "efectivo", "monto": 50000}]}')$q$,
      pg_temp.fx('cliente'), pg_temp.fx('caja'), v_prod, v_plan), 'al menos 10');
  v := vender_en_cuotas(jsonb_build_object('cliente_id', pg_temp.fx('cliente'), 'caja_id', pg_temp.fx('caja'), 'plan_id', v_plan,
    'items', jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1)),
    'entrega', 120000, 'pagos', '[{"metodo_pago": "transferencia", "monto": 120000, "referencia": "PRUEBA-1"}]'::jsonb));
  perform pg_temp.ok('Plan: la venta sale con las cuotas del plan',
    (select cuotas from ventas where id = (v->>'venta_id')::uuid) = 10
    and (select count(*) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid and cuota > 0) = 10, v::text);

  -- Caja (receta 136): crear_venta_cuotas con plan y entrega pagada con tarjeta de débito.
  v_efe := pg_temp.efectivo();
  v := crear_venta_cuotas(pg_temp.fx('cliente'), 'CREDITO', null, 'GS', null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 2)), 'prueba-caja-plan-1', 0, null, pg_temp.fx('caja'), 'ticket',
    1, 'mes', 300000, '[{"metodo_pago": "tarjeta_debito", "monto": 300000, "referencia": "PRUEBA-POS"}]'::jsonb, v_plan);
  perform pg_temp.ok('Caja: el plan pone 10 cuotas y la entrega queda cobrada',
    (select cuotas from ventas where id = (v->>'venta_id')::uuid) = 10
    and exists (select 1 from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid and cuota = 0 and estado = 'pagada' and monto = 300000)
    and v->>'recibo_entrega' is not null, v::text);
  perform pg_temp.igual('Caja: la entrega con tarjeta no suma al efectivo', pg_temp.efectivo() - v_efe, 0);
  perform pg_temp.rechaza('Caja: el plan pide su entrega mínima',
    format($q$select crear_venta_cuotas(%L, 'CREDITO', null, 'GS', null, '[{"producto_id": "%s", "cantidad": 1}]', null, 0, null, %L, 'ticket', 1, 'mes', 0, null, %L)$q$,
      pg_temp.fx('cliente'), v_prod, pg_temp.fx('caja'), v_plan), 'al menos 10');
  v := crear_venta_cuotas(pg_temp.fx('cliente'), 'CREDITO', null, 'GS', null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1)), 'prueba-caja-plan-2', 0, 30, pg_temp.fx('caja'), 'ticket',
    6, 'quincena', 200000, '[{"metodo_pago": "efectivo", "monto": 200000}]'::jsonb, null);
  perform pg_temp.ok('Caja: sin plan, las cuotas a mano con entrega',
    (select count(*) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid and cuota > 0) = 6
    and (select sum(monto) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid and cuota > 0) = 1000000, v::text);

  -- Recargo por financiación (receta 137): 20 % sobre lo financiado, renglón en la misma venta.
  v := planes_cuota_guardar('{"max_cuotas": 120, "planes": [{"nombre": "PRUEBA 12 con recargo", "cuotas": 12, "entrega_pct": 10, "recargo_pct": 20}]}');
  perform pg_temp.igual('Recargo: el plan guarda su recargo', (v->'planes'->0->>'recargo_pct')::numeric, 20);
  v_plan := (v->'planes'->0->>'id')::uuid;
  perform pg_temp.rechaza('Recargo: no pasa del 300 %',
    $q$select planes_cuota_guardar('{"max_cuotas": 120, "planes": [{"nombre": "PRUEBA loco", "cuotas": 3, "recargo_pct": 400}]}')$q$, 'va de 0 a 300');
  v := crear_venta_cuotas(pg_temp.fx('cliente'), 'CREDITO', null, 'GS', null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1)), 'prueba-caja-recargo-1', 0, null, pg_temp.fx('caja'), 'ticket',
    1, 'mes', 120000, '[{"metodo_pago": "efectivo", "monto": 120000}]'::jsonb, v_plan);
  v_venta := (v->>'venta_id')::uuid;
  perform pg_temp.igual('Recargo: el total suma el 20 % de lo financiado', (select total from ventas where id = v_venta), 1416000);
  perform pg_temp.ok('Recargo: va como renglón con IVA 10 %',
    exists (select 1 from ventas_items where venta_id = v_venta and producto_nombre like 'Recargo por financiación%' and total_linea = 216000 and monto_iva = 19636), v::text);
  perform pg_temp.igual('Recargo: las 12 cuotas absorben el recargo', (select sum(monto) from cuentas_por_cobrar where venta_id = v_venta and cuota > 0), 1296000);
  perform pg_temp.igual('Recargo: la entrega no cambia', (select monto from cuentas_por_cobrar where venta_id = v_venta and cuota = 0), 120000);
  v := vender_en_cuotas(jsonb_build_object('cliente_id', pg_temp.fx('cliente'), 'caja_id', pg_temp.fx('caja'), 'plan_id', v_plan,
    'items', jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1)),
    'entrega', 200000, 'pagos', '[{"metodo_pago": "efectivo", "monto": 200000}]'::jsonb));
  perform pg_temp.igual('Recargo: también al vender en cuotas', (v->>'total')::numeric, 1400000);

  -- Propiedad: vender la marca vendida; anular la venta la vuelve a disponible.
  v := guardar_funciones_empresa('{"inmobiliaria": true}');
  p1 := propiedad_guardar('{"titulo": "PRUEBA Terreno para vender", "gestion": "venta", "precio_venta": 90000000}');
  v := propiedad_vender(jsonb_build_object('propiedad_id', p1->>'id', 'cliente_id', pg_temp.fx('cliente'), 'caja_id', pg_temp.fx('caja'),
    'contado', true, 'pagos', '[{"metodo_pago": "transferencia", "monto": 90000000, "referencia": "PRUEBA-T"}]'::jsonb));
  perform pg_temp.ok('Propiedad: al venderla queda vendida y fuera de la caja', v->'propiedad'->>'estado' = 'vendida'
    and exists (select 1 from productos where id = (p1->>'producto_id')::uuid and not es_vendible), v::text);
  perform pg_temp.rechaza('Propiedad: una vendida no se vende dos veces',
    format($q$select propiedad_vender('{"propiedad_id": "%s", "cliente_id": "%s", "caja_id": "%s", "contado": true, "pagos": [{"metodo_pago": "efectivo", "monto": 90000000}]}')$q$,
      p1->>'id', pg_temp.fx('cliente'), pg_temp.fx('caja')), 'vendida');
  perform anular_venta((v->>'venta_id')::uuid, 'PRUEBA se cayó la operación', pg_temp.fx('caja'));
  perform pg_temp.ok('Propiedad: anular la venta la vuelve a disponible',
    propiedad_detalle((p1->>'id')::uuid)->>'estado' = 'disponible'
    and exists (select 1 from productos where id = (p1->>'producto_id')::uuid and es_vendible));

  -- En cuotas con entrega.
  v := propiedad_vender(jsonb_build_object('propiedad_id', p1->>'id', 'cliente_id', pg_temp.fx('cliente'), 'caja_id', pg_temp.fx('caja'),
    'cuotas', 120, 'plazo_dias', 30, 'entrega', 9000000, 'pagos', '[{"metodo_pago": "efectivo", "monto": 9000000}]'::jsonb));
  perform pg_temp.ok('Propiedad: en 120 cuotas con entrega', v->'propiedad'->>'estado' = 'vendida'
    and (select count(*) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid) = 121, v::text);
  perform guardar_funciones_empresa('{"inmobiliaria": false}');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Cuotas y entrega: el escenario se cortó', false, sqlerrm);
end $$;
