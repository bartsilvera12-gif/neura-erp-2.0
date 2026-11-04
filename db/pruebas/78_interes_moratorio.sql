-- Interés moratorio (receta 135): apagado no cambia nada; prendido se calcula por días, se cobra
-- primero y aparte; no se cobra dos veces; perdonar pide permiso y motivo.
do $$
declare
  v jsonb;
  v_prod uuid;
  v_cli uuid;
  v1 jsonb; v2 jsonb;
  v_cxc1 uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  r jsonb;
begin
  v_prod := pg_temp.producto('Mora', 1000000);
  perform pg_temp.comprar(v_prod, 10, 500000);
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Moroso') returning id into v_cli;
  v1 := pg_temp.vender_a(v_cli, v_prod, 1, 'CREDITO');
  v2 := pg_temp.vender_a(v_cli, v_prod, 1, 'CREDITO');
  execute 'set local role service_role';
  update cuentas_por_cobrar set vencimiento = v_hoy - 40 where venta_id = (v1->>'venta_id')::uuid;
  update cuentas_por_cobrar set vencimiento = v_hoy - 3 where venta_id = (v2->>'venta_id')::uuid;
  execute 'set local role authenticated';
  select id into v_cxc1 from cuentas_por_cobrar where venta_id = (v1->>'venta_id')::uuid;

  -- Apagada: no hay interés.
  perform mora_config_guardar('{"activa": false, "tasa": 3, "gracia": 5}');
  perform pg_temp.igual('Mora: apagada no calcula nada', (mora_calcular(v_cli)->>'total')::numeric, 0);

  -- Prendida: 3 % mensual, 5 días de gracia.
  v := mora_config_guardar('{"activa": true, "tasa": 3, "gracia": 5, "iva": "10%"}');
  perform pg_temp.ok('Mora: el administrador la prende', (v->>'activa')::boolean and (v->>'tasa')::numeric = 3, v::text);
  v := mora_calcular(v_cli);
  perform pg_temp.igual('Mora: 40 días de atraso al 3 % mensual sobre 1.000.000 = 40.000', (v->>'total')::numeric, 40000);
  perform pg_temp.igual('Mora: la que está dentro de la gracia no suma', jsonb_array_length(v->'cuotas')::numeric, 1);

  -- Perdonar: el cajero no puede.
  perform pg_temp.como('cajero');
  perform pg_temp.rechaza('Mora: perdonar pide permiso',
    format($q$select registrar_cobro_con_mora('{"cliente_id": "%s", "caja_id": "%s", "pagos": [{"metodo": "efectivo", "monto": 1000}], "mora": {"perdonar": true, "motivo": "PRUEBA"}}')$q$,
      v_cli, pg_temp.fx('caja')), 'permiso');
  perform pg_temp.como('admin');

  -- Cobrar: primero el interés, después la cuota.
  r := registrar_cobro_con_mora(jsonb_build_object('cliente_id', v_cli, 'caja_id', pg_temp.fx('caja'),
    'pagos', '[{"metodo": "efectivo", "monto": 1040000}]'::jsonb));
  perform pg_temp.igual('Mora: el cobro trae el interés', (r->>'interes')::numeric, 40000);
  perform pg_temp.ok('Mora: el interés queda como cargo aparte y pagado',
    exists (select 1 from ventas v join cuentas_por_cobrar c on c.venta_id = v.id where v.es_interes and v.cliente_id = v_cli and v.total = 40000 and c.estado = 'pagada'));
  perform pg_temp.ok('Mora: con el resto se pagó la cuota vencida', (select estado from cuentas_por_cobrar where id = v_cxc1) = 'pagada');
  perform pg_temp.igual('Mora: ya no queda interés que cobrar', (mora_calcular(v_cli)->>'total')::numeric, 0);

  -- La otra cuota pasa la gracia: el perdón queda registrado y no se vuelve a cobrar.
  execute 'set local role service_role';
  update cuentas_por_cobrar set vencimiento = v_hoy - 20 where venta_id = (v2->>'venta_id')::uuid;
  execute 'set local role authenticated';
  perform pg_temp.igual('Mora: 20 días = 20.000', (mora_calcular(v_cli)->>'total')::numeric, 20000);
  perform pg_temp.rechaza('Mora: perdonar pide motivo',
    format($q$select registrar_cobro_con_mora('{"cliente_id": "%s", "caja_id": "%s", "pagos": [{"metodo": "efectivo", "monto": 1000}], "mora": {"perdonar": true, "motivo": ""}}')$q$,
      v_cli, pg_temp.fx('caja')), 'por qué');
  r := registrar_cobro_con_mora(jsonb_build_object('cliente_id', v_cli, 'caja_id', pg_temp.fx('caja'),
    'pagos', '[{"metodo": "efectivo", "monto": 500000}]'::jsonb, 'mora', '{"perdonar": true, "motivo": "PRUEBA buen cliente"}'::jsonb));
  perform pg_temp.igual('Mora: perdonado no se cobra', (r->>'interes_perdonado')::numeric, 20000);
  execute 'set local role service_role';
  perform pg_temp.ok('Mora: el perdón queda registrado', exists (select 1 from mora_condonaciones where cliente_id = v_cli and monto = 20000 and motivo = 'PRUEBA buen cliente'));
  execute 'set local role authenticated';
  perform pg_temp.rechaza('Mora: nadie lee los perdones directo', $q$select * from mora_condonaciones$q$, 'permission denied');
  perform pg_temp.igual('Mora: después del perdón no queda interés', (mora_calcular(v_cli)->>'total')::numeric, 0);

  perform mora_config_guardar('{"activa": false, "tasa": 1.5, "gracia": 0}');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Mora: el escenario se cortó', false, sqlerrm);
end $$;
