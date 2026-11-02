-- Ventas al contado: totales, IVA, formas de pago, costo PEPS, idempotencia y anulación.
do $$
declare
  p uuid := pg_temp.producto('Venta', 11000);
  v_caja numeric := pg_temp.efectivo();
  v jsonb;
  v2 jsonb;
  r record;
begin
  perform pg_temp.comprar(p, 10, 1000);

  v := pg_temp.vender(p, 2);
  select * into r from ventas where id = (v->>'venta_id')::uuid;
  perform pg_temp.igual('venta: total', r.total, 22000);
  perform pg_temp.igual('venta: IVA 10 % incluido', r.monto_iva, 2000);
  perform pg_temp.igual('venta: gravado', r.subtotal, 20000);
  perform pg_temp.igual('venta: baja el stock', pg_temp.stock(p), 8);
  perform pg_temp.igual('venta en efectivo: entra a la caja', pg_temp.efectivo(), v_caja + 22000);

  -- La misma clave no vende dos veces.
  v2 := pg_temp.vender(p, 1, null, 'prueba-clave-1');
  v := pg_temp.vender(p, 1, null, 'prueba-clave-1');
  perform pg_temp.ok('idempotencia: devuelve la misma venta', (v->>'reusada')::boolean and v->>'venta_id' = v2->>'venta_id');
  perform pg_temp.igual('idempotencia: el stock baja una sola vez', pg_temp.stock(p), 7);
  perform pg_temp.igual('idempotencia: la caja suma una sola vez', pg_temp.efectivo(), v_caja + 33000);

  -- Vuelto: a la caja entra lo que cuesta, no lo que se recibió.
  v_caja := pg_temp.efectivo();
  v := pg_temp.vender(p, 1, '[{"metodo_pago": "efectivo", "monto": 11000, "recibido": 20000}]');
  perform pg_temp.igual('vuelto: lo calcula', (v->>'vuelto')::numeric, 9000);
  perform pg_temp.igual('vuelto: entra solo el precio', pg_temp.efectivo(), v_caja + 11000);

  -- Mixto: al efectivo de la caja solo suma la parte en efectivo.
  v_caja := pg_temp.efectivo();
  v := pg_temp.vender(p, 2, '[{"metodo_pago": "efectivo", "monto": 10000}, {"metodo_pago": "transferencia", "monto": 12000}]');
  perform pg_temp.igual('pago mixto: suma solo el efectivo', pg_temp.efectivo(), v_caja + 10000);
  perform pg_temp.ok('pago mixto: queda marcado', (select metodo_pago from ventas where id = (v->>'venta_id')::uuid) = 'mixto');

  -- Descuento general.
  v := pg_temp.vender(p, 1, null, null, 10);
  perform pg_temp.igual('descuento 10 %', (select total from ventas where id = (v->>'venta_id')::uuid), 9900);

  -- Rechazos: no pueden dejar nada a medias.
  perform pg_temp.rechaza('las formas de pago no suman el total', format($q$select pg_temp.vender(%L, 1, '[{"metodo_pago": "efectivo", "monto": 1}]')$q$, p), 'suman');
  perform pg_temp.rechaza('efectivo recibido no alcanza', format($q$select pg_temp.vender(%L, 1, '[{"metodo_pago": "efectivo", "monto": 11000, "recibido": 5000}]')$q$, p), 'no alcanza');
  perform pg_temp.rechaza('cantidad cero', format($q$select pg_temp.vender(%L, 0)$q$, p), 'cantidad inválida');
  perform pg_temp.rechaza('cantidad negativa', format($q$select pg_temp.vender(%L, -1)$q$, p), 'cantidad inválida');
  perform pg_temp.rechaza('vender más de lo que hay', format($q$select pg_temp.vender(%L, 1000)$q$, p), 'stock');
  perform pg_temp.igual('rechazos: el stock queda igual', pg_temp.stock(p), 3);
  perform pg_temp.rechaza('crédito sin cliente', format($q$select pg_temp.vender_a(null, %L, 1, 'CREDITO')$q$, p), 'necesita un cliente');
  perform pg_temp.rechaza('factura sin RUC', format($q$select crear_venta(%L, 'CONTADO', 'efectivo', 'GS', null, '[{"producto_id": "%s", "cantidad": 1}]', null, null, p_caja_id => pg_temp.fx('caja'), p_tipo_documento => 'factura')$q$, pg_temp.fx('cliente'), p), 'RUC');
  perform pg_temp.ok('inventario de la venta cuadrado', (verificar_capas(p)->>'ok')::boolean, (verificar_capas(p))::text);
exception when others then
  perform pg_temp.ok('ventas: el escenario se cortó', false, sqlerrm);
end $$;

-- IVA por tasa y redondeo.
do $$
declare
  p5 uuid := pg_temp.producto('IVA 5', 10500, '5%');
  px uuid := pg_temp.producto('Exenta', 10000, 'EXENTA');
  v jsonb;
begin
  perform pg_temp.comprar(p5, 5, 1000);
  perform pg_temp.comprar(px, 5, 1000);
  v := pg_temp.vender(p5, 1);
  perform pg_temp.igual('IVA 5 %', (select monto_iva from ventas where id = (v->>'venta_id')::uuid), 500);
  v := pg_temp.vender(px, 1);
  perform pg_temp.igual('exenta sin IVA', (select monto_iva from ventas where id = (v->>'venta_id')::uuid), 0);
exception when others then
  perform pg_temp.ok('IVA: el escenario se cortó', false, sqlerrm);
end $$;

-- PEPS: se consume la capa más vieja primero.
do $$
declare
  p uuid := pg_temp.producto('PEPS', 5000);
  a uuid;
  b uuid;
begin
  perform pg_temp.comprar(p, 10, 1000);
  select c.id into a from pg_temp.capas(p) c;
  perform pg_temp.comprar(p, 10, 2000);
  select c.id into b from pg_temp.capas(p) c where c.id <> a;
  perform pg_temp.vender(p, 12);
  perform pg_temp.igual('PEPS: la capa vieja se agota', (select c.quedan from pg_temp.capas(p) c where c.id = a), 0);
  perform pg_temp.igual('PEPS: la nueva da el resto', (select c.quedan from pg_temp.capas(p) c where c.id = b), 8);
  perform pg_temp.ok('PEPS: capas cuadradas', (verificar_capas(p)->>'ok')::boolean, (verificar_capas(p))::text);
exception when others then
  perform pg_temp.ok('PEPS: el escenario se cortó', false, sqlerrm);
end $$;

-- Anular una venta devuelve stock, capa y plata.
do $$
declare
  p uuid := pg_temp.producto('Anular', 11000);
  v_caja numeric;
  v jsonb;
begin
  perform pg_temp.comprar(p, 10, 1000);
  v_caja := pg_temp.efectivo();
  v := pg_temp.vender(p, 3);
  perform anular_venta((v->>'venta_id')::uuid, 'prueba', pg_temp.fx('caja'));
  perform pg_temp.ok('anular venta: queda anulada', (select estado from ventas where id = (v->>'venta_id')::uuid) = 'anulada');
  perform pg_temp.igual('anular venta: vuelve el stock', pg_temp.stock(p), 10);
  perform pg_temp.igual('anular venta: sale la plata', pg_temp.efectivo(), v_caja);
  perform pg_temp.igual('anular venta: la capa se repone', (select sum(c.quedan) from pg_temp.capas(p) c), 10);

  v := anular_venta((v->>'venta_id')::uuid, 'prueba', pg_temp.fx('caja'));
  perform pg_temp.ok('anular dos veces: avisa y no repite', (v->>'reusada')::boolean);
  perform pg_temp.igual('anular dos veces: el stock no se duplica', pg_temp.stock(p), 10);
  perform pg_temp.igual('anular dos veces: la plata no se duplica', pg_temp.efectivo(), v_caja);
exception when others then
  perform pg_temp.ok('anular venta: el escenario se cortó', false, sqlerrm);
end $$;
