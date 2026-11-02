-- Compras: entra el stock, nace la capa de costo, baja la caja si es en efectivo y se anula limpio.
do $$
declare
  p uuid := pg_temp.producto('Compra', 11000);
  v_caja numeric := pg_temp.efectivo();
  c1 jsonb;
  c2 jsonb;
  c3 jsonb;
begin
  c1 := pg_temp.comprar(p, 10, 1000);
  perform pg_temp.igual('compra: entra el stock al depósito', pg_temp.stock(p), 10);
  perform pg_temp.igual('compra: el total del producto sigue al depósito', (select stock_actual from productos where id = p), 10);
  perform pg_temp.igual('compra: costo promedio', (select costo_promedio from productos where id = p), 1000);
  perform pg_temp.igual('compra: nace una capa de costo', (select count(*) from pg_temp.capas(p)), 1);
  perform pg_temp.igual('compra por transferencia: la caja no se mueve', pg_temp.efectivo(), v_caja);

  c2 := pg_temp.comprar(p, 10, 2000);
  perform pg_temp.igual('segunda compra: suma el stock', pg_temp.stock(p), 20);
  perform pg_temp.igual('segunda compra: promedia el costo', (select costo_promedio from productos where id = p), 1500);

  -- Efectivo: sale de la caja.
  c3 := pg_temp.comprar(p, 1, 5000, jsonb_build_object('medio_pago', 'efectivo', 'caja_id', pg_temp.fx('caja')));
  perform pg_temp.igual('compra en efectivo: sale de la caja', pg_temp.efectivo(), v_caja - 5000);

  perform anular_compra((c3->>'id')::uuid, 'prueba');
  perform pg_temp.igual('anular compra: vuelve la plata a la caja', pg_temp.efectivo(), v_caja);
  perform pg_temp.igual('anular compra: sale el stock', pg_temp.stock(p), 20);
  perform pg_temp.ok('anular compra: las capas siguen cuadradas', (verificar_capas(p)->>'ok')::boolean, (verificar_capas(p))::text);

  perform pg_temp.rechaza('anular compra dos veces', format($q$select anular_compra(%L, 'prueba')$q$, c3->>'id'), 'ya está anulada');

  -- Ya vendida no se anula.
  perform pg_temp.vender(p, 15);
  perform pg_temp.rechaza('anular compra ya vendida', format($q$select anular_compra(%L, 'prueba')$q$, c2->>'id'), 'no se puede anular');
  perform pg_temp.igual('anular compra rechazada: el stock no cambia', pg_temp.stock(p), 5);

  perform pg_temp.rechaza('compra sin líneas', $q$select registrar_compra('{"con_comprobante": false, "tipo_pago": "contado", "medio_pago": "transferencia"}')$q$, 'no tiene líneas');
  perform pg_temp.rechaza('compra con cantidad cero', format($q$select pg_temp.comprar(%L, 0, 1000)$q$, p), 'cantidad');
  perform pg_temp.rechaza('compra con costo cero', format($q$select pg_temp.comprar(%L, 1, 0)$q$, p), 'falta el costo');
exception when others then
  perform pg_temp.ok('compras: el escenario se cortó', false, sqlerrm);
end $$;

-- Crédito y pagos al proveedor.
do $$
declare
  p uuid := pg_temp.producto('Compra a crédito', 5000);
  v_prov uuid := pg_temp.fx('proveedor');
  v_caja numeric := pg_temp.efectivo();
  c jsonb;
  v_cxp uuid;
  pg1 jsonb;
begin
  c := pg_temp.comprar(p, 10, 1000, jsonb_build_object('tipo_pago', 'credito', 'proveedor_id', v_prov, 'plazo_dias', 30) - 'medio_pago');
  select id into v_cxp from cuentas_por_pagar where compra_id = (c->>'id')::uuid;
  perform pg_temp.igual('compra a crédito: nace la deuda', (select saldo from cuentas_por_pagar where id = v_cxp), 10000);
  perform pg_temp.igual('compra a crédito: la caja no se mueve', pg_temp.efectivo(), v_caja);

  pg1 := registrar_pago_proveedor(jsonb_build_object('proveedor_id', v_prov, 'caja_id', pg_temp.fx('caja'),
    'medios', jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', 4000)),
    'aplicaciones', jsonb_build_array(jsonb_build_object('cxp_id', v_cxp, 'monto', 4000))));
  perform pg_temp.igual('pago parcial: baja la deuda', (select saldo from cuentas_por_pagar where id = v_cxp), 6000);
  perform pg_temp.ok('pago parcial: estado parcial', (select estado from cuentas_por_pagar where id = v_cxp) = 'parcial');
  perform pg_temp.igual('pago en efectivo: sale de la caja', pg_temp.efectivo(), v_caja - 4000);

  perform pg_temp.rechaza('anular compra con pagos', format($q$select anular_compra(%L, 'prueba')$q$, c->>'id'), 'ya tiene pagos');
  perform pg_temp.rechaza('pagar más de lo que se debe',
    format($q$select registrar_pago_proveedor('{"proveedor_id": "%s", "medios": [{"metodo": "transferencia", "monto": 999999999}]}')$q$, v_prov), 'mayor que la deuda');

  perform anular_pago_proveedor((pg1->>'id')::uuid, 'prueba');
  perform pg_temp.igual('anular pago: vuelve la deuda', (select saldo from cuentas_por_pagar where id = v_cxp), 10000);
  perform pg_temp.igual('anular pago: vuelve la plata a la caja', pg_temp.efectivo(), v_caja);

  perform anular_compra((c->>'id')::uuid, 'prueba');
  perform pg_temp.ok('anular compra a crédito: la deuda queda anulada', (select estado from cuentas_por_pagar where id = v_cxp) = 'anulada', (select estado from cuentas_por_pagar where id = v_cxp));
  perform pg_temp.rechaza('anular compra a crédito: ya no se le puede pagar',
    format($q$select registrar_pago_proveedor('{"proveedor_id": "%s", "medios": [{"metodo": "transferencia", "monto": 1}], "aplicaciones": [{"cxp_id": "%s", "monto": 1}]}')$q$, v_prov, v_cxp), 'proveedor');
  perform pg_temp.igual('anular compra a crédito: sale el stock', pg_temp.stock(p), 0);
exception when others then
  perform pg_temp.ok('compras a crédito: el escenario se cortó', false, sqlerrm);
end $$;
