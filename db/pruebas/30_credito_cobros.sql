-- Ventas a crédito, cobros, saldo a favor y límite de crédito.
do $$
declare
  p uuid := pg_temp.producto('Crédito', 100000);
  v_cli uuid := pg_temp.fx('cliente');
  v_caja numeric := pg_temp.efectivo();
  v_saldo numeric := cliente_saldo(pg_temp.fx('cliente'));
  v jsonb;
  v_cxc uuid;
  c1 jsonb;
  c2 jsonb;
begin
  perform pg_temp.comprar(p, 20, 1000);

  v := pg_temp.vender_a(v_cli, p, 1, 'CREDITO');
  select id into v_cxc from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid;
  perform pg_temp.igual('crédito: nace la cuenta por cobrar', (select saldo from cuentas_por_cobrar where id = v_cxc), 100000);
  perform pg_temp.igual('crédito: suma a lo que debe el cliente', cliente_saldo(v_cli), v_saldo + 100000);
  perform pg_temp.igual('crédito: la caja no se mueve', pg_temp.efectivo(), v_caja);
  perform pg_temp.igual('crédito: baja el stock', pg_temp.stock(p), 19);

  c1 := registrar_cobro(jsonb_build_object('cliente_id', v_cli, 'caja_id', pg_temp.fx('caja'),
    'pagos', jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', 40000)),
    'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', v_cxc, 'monto', 40000))));
  perform pg_temp.igual('cobro parcial: baja el saldo', (select saldo from cuentas_por_cobrar where id = v_cxc), 60000);
  perform pg_temp.ok('cobro parcial: estado parcial', (select estado from cuentas_por_cobrar where id = v_cxc) = 'parcial');
  perform pg_temp.igual('cobro en efectivo: entra a la caja', pg_temp.efectivo(), v_caja + 40000);

  perform anular_cobro((c1->>'id')::uuid, 'prueba');
  perform pg_temp.igual('anular cobro: vuelve el saldo', (select saldo from cuentas_por_cobrar where id = v_cxc), 100000);
  perform pg_temp.igual('anular cobro: sale la plata', pg_temp.efectivo(), v_caja);
  perform pg_temp.rechaza('anular cobro dos veces', format($q$select anular_cobro(%L, 'prueba')$q$, c1->>'id'), 'ya está anulado');

  -- Paga de más: lo que sobra queda a favor del cliente.
  c2 := registrar_cobro(jsonb_build_object('cliente_id', v_cli, 'sin_caja', true,
    'pagos', jsonb_build_array(jsonb_build_object('metodo', 'transferencia', 'monto', 120000)),
    'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', v_cxc, 'monto', 120000))));
  perform pg_temp.igual('paga de más: la cuenta queda en cero', (select saldo from cuentas_por_cobrar where id = v_cxc), 0);
  perform pg_temp.ok('paga de más: cuenta pagada', (select estado from cuentas_por_cobrar where id = v_cxc) = 'pagada', (select estado from cuentas_por_cobrar where id = v_cxc));
  perform pg_temp.igual('paga de más: devuelve lo que sobró', (c2->>'a_favor')::numeric, 20000);
  perform pg_temp.igual('paga de más: queda a favor', saldo_favor_cliente(v_cli), 20000);
  perform pg_temp.igual('cobro por transferencia: la caja no se mueve', pg_temp.efectivo(), v_caja);

  perform pg_temp.rechaza('usar más saldo a favor del que hay',
    format($q$select pg_temp.vender_a(%L, %L, 1, 'CONTADO', '[{"metodo_pago": "saldo_favor", "monto": 100000}]')$q$, v_cli, p), 'no alcanza');

  -- Paga con el saldo a favor: se gasta y no entra a la caja.
  v := pg_temp.vender_a(v_cli, p, 1, 'CONTADO', '[{"metodo_pago": "saldo_favor", "monto": 20000}, {"metodo_pago": "efectivo", "monto": 80000}]');
  perform pg_temp.igual('saldo a favor: se gasta', saldo_favor_cliente(v_cli), 0);
  perform pg_temp.igual('saldo a favor: a la caja entra solo el efectivo', pg_temp.efectivo(), v_caja + 80000);
  perform pg_temp.rechaza('anular cobro cuyo saldo a favor ya se usó', format($q$select anular_cobro(%L, 'prueba')$q$, c2->>'id'), 'ya se usó');
exception when others then
  perform pg_temp.ok('crédito y cobros: el escenario se cortó', false, sqlerrm);
end $$;

-- Cuotas: la suma da exacto el total, sin perder guaraníes por redondeo.
do $$
declare
  p uuid := pg_temp.producto('Cuotas', 100000);
  v jsonb;
begin
  perform pg_temp.comprar(p, 5, 1000);
  v := pg_temp.vender_a(pg_temp.fx('cliente'), p, 1, 'CREDITO', null, 3);
  perform pg_temp.igual('cuotas: nacen tres', (select count(*) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid), 3);
  perform pg_temp.igual('cuotas: suman exacto el total', (select sum(monto) from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid), 100000);
exception when others then
  perform pg_temp.ok('cuotas: el escenario se cortó', false, sqlerrm);
end $$;

-- Límite de crédito.
do $$
declare
  p uuid := pg_temp.producto('Límite', 60000);
begin
  perform pg_temp.comprar(p, 5, 1000);
  perform pg_temp.rechaza('supera el límite de crédito', format($q$select pg_temp.vender_a(%L, %L, 1, 'CREDITO')$q$, pg_temp.fx('cliente_limite'), p), 'límite de crédito');
  perform pg_temp.igual('límite: el stock no se movió', pg_temp.stock(p), 5);
  perform pg_temp.igual('límite: no queda deuda', cliente_saldo(pg_temp.fx('cliente_limite')), 0);
exception when others then
  perform pg_temp.ok('límite de crédito: el escenario se cortó', false, sqlerrm);
end $$;
