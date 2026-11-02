-- Notas de crédito: devolver plata o dejarla a favor, con o sin volver al stock.
do $$
declare
  p uuid := pg_temp.producto('NC', 11000);
  v_caja numeric;
  v jsonb;
  v_item uuid;
  nc jsonb;
begin
  perform pg_temp.comprar(p, 10, 1000);
  v := pg_temp.vender(p, 3);
  select id into v_item from ventas_items where venta_id = (v->>'venta_id')::uuid;
  v_caja := pg_temp.efectivo();

  nc := crear_nota_credito(jsonb_build_object('venta_id', v->>'venta_id', 'motivo', 'prueba', 'tipo', 'devolucion', 'destino', 'devolver', 'metodo', 'efectivo', 'caja_id', pg_temp.fx('caja'),
    'items', jsonb_build_array(jsonb_build_object('venta_item_id', v_item, 'cantidad', 1, 'vuelve_stock', true))));
  perform pg_temp.igual('NC: total de lo devuelto', (nc->>'total')::numeric, 11000);
  perform pg_temp.igual('NC: vuelve al stock', pg_temp.stock(p), 8);
  perform pg_temp.igual('NC: sale la plata de la caja', pg_temp.efectivo(), v_caja - 11000);
  perform pg_temp.ok('NC: capas cuadradas', (verificar_capas(p)->>'ok')::boolean, (verificar_capas(p))::text);

  perform pg_temp.rechaza('NC por más de lo vendido',
    format($q$select crear_nota_credito('{"venta_id": "%s", "motivo": "prueba", "destino": "devolver", "metodo": "efectivo", "caja_id": "%s", "items": [{"venta_item_id": "%s", "cantidad": 3}]}')$q$, v->>'venta_id', pg_temp.fx('caja'), v_item), 'podés devolver hasta');
  perform pg_temp.rechaza('NC con saldo a favor sin cliente',
    format($q$select crear_nota_credito('{"venta_id": "%s", "motivo": "prueba", "destino": "saldo_favor", "items": [{"venta_item_id": "%s", "cantidad": 1}]}')$q$, v->>'venta_id', v_item), 'no tiene cliente');
  perform pg_temp.rechaza('anular venta con NC', format($q$select anular_venta(%L, 'prueba', %L)$q$, v->>'venta_id', pg_temp.fx('caja')), 'notas de crédito');

  perform anular_nota_credito((nc->>'id')::uuid, 'prueba');
  perform pg_temp.igual('anular NC: el stock vuelve a salir', pg_temp.stock(p), 7);
  perform pg_temp.igual('anular NC: la plata vuelve a la caja', pg_temp.efectivo(), v_caja);

  -- Sin volver al stock (mercadería rota).
  nc := crear_nota_credito(jsonb_build_object('venta_id', v->>'venta_id', 'motivo', 'prueba', 'destino', 'devolver', 'metodo', 'efectivo', 'caja_id', pg_temp.fx('caja'),
    'items', jsonb_build_array(jsonb_build_object('venta_item_id', v_item, 'cantidad', 1, 'vuelve_stock', false))));
  perform pg_temp.igual('NC sin volver al stock: el stock no cambia', pg_temp.stock(p), 7);
  perform pg_temp.igual('NC sin volver al stock: la plata sí sale', pg_temp.efectivo(), v_caja - 11000);

  -- Descuento: plata sin productos.
  v_caja := pg_temp.efectivo();
  nc := crear_nota_credito(jsonb_build_object('venta_id', v->>'venta_id', 'motivo', 'prueba', 'tipo', 'descuento', 'monto', 2000, 'destino', 'devolver', 'metodo', 'efectivo', 'caja_id', pg_temp.fx('caja')));
  perform pg_temp.igual('NC de descuento: el stock no cambia', pg_temp.stock(p), 7);
  perform pg_temp.igual('NC de descuento: sale la plata', pg_temp.efectivo(), v_caja - 2000);
  perform pg_temp.rechaza('NC de descuento mayor a lo que queda',
    format($q$select crear_nota_credito('{"venta_id": "%s", "motivo": "prueba", "tipo": "descuento", "monto": 999999, "destino": "devolver", "metodo": "efectivo", "caja_id": "%s"}')$q$, v->>'venta_id', pg_temp.fx('caja')), 'supera');
exception when others then
  perform pg_temp.ok('NC: el escenario se cortó', false, sqlerrm);
end $$;

-- A favor del cliente y sobre una venta a crédito.
do $$
declare
  p uuid := pg_temp.producto('NC cliente', 10000);
  v_cli uuid := pg_temp.fx('cliente');
  v_favor numeric := saldo_favor_cliente(pg_temp.fx('cliente'));
  v_caja numeric;
  v jsonb;
  v_item uuid;
  v_cxc uuid;
begin
  perform pg_temp.comprar(p, 10, 1000);
  v := pg_temp.vender_a(v_cli, p, 2);
  select id into v_item from ventas_items where venta_id = (v->>'venta_id')::uuid;
  v_caja := pg_temp.efectivo();
  perform crear_nota_credito(jsonb_build_object('venta_id', v->>'venta_id', 'motivo', 'prueba', 'destino', 'saldo_favor',
    'items', jsonb_build_array(jsonb_build_object('venta_item_id', v_item, 'cantidad', 1))));
  perform pg_temp.igual('NC a favor: queda a favor del cliente', saldo_favor_cliente(v_cli), v_favor + 10000);
  perform pg_temp.igual('NC a favor: la caja no se mueve', pg_temp.efectivo(), v_caja);

  v := pg_temp.vender_a(v_cli, p, 2, 'CREDITO');
  select id into v_item from ventas_items where venta_id = (v->>'venta_id')::uuid;
  select id into v_cxc from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid;
  perform crear_nota_credito(jsonb_build_object('venta_id', v->>'venta_id', 'motivo', 'prueba', 'destino', 'devolver', 'metodo', 'efectivo', 'caja_id', pg_temp.fx('caja'),
    'items', jsonb_build_array(jsonb_build_object('venta_item_id', v_item, 'cantidad', 1))));
  perform pg_temp.igual('NC sobre crédito: baja lo que debe', (select saldo from cuentas_por_cobrar where id = v_cxc), 10000);
  perform pg_temp.igual('NC sobre crédito: no sale plata porque no había pagado', pg_temp.efectivo(), v_caja);
exception when others then
  perform pg_temp.ok('NC con cliente: el escenario se cortó', false, sqlerrm);
end $$;
