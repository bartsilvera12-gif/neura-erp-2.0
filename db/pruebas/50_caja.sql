-- Caja: apertura, retiros, ingresos, arqueo y lo que ya no se toca después del cierre.
do $$
declare
  p uuid := pg_temp.producto('Caja', 10000);
  v_caja uuid;
  v jsonb;
  v_cobro jsonb;
  v_cxc uuid;
  r jsonb;
begin
  perform pg_temp.comprar(p, 10, 1000);
  v_caja := (abrir_caja(pg_temp.fx('pv2'), 100000)->>'caja_id')::uuid;
  perform pg_temp.igual('apertura: arranca con el monto', caja_efectivo_esperado(v_caja), 100000);
  perform pg_temp.rechaza('abrir una caja ya abierta', format($q$select abrir_caja(%L, 0)$q$, pg_temp.fx('pv2')), 'ya está abierta');
  perform pg_temp.rechaza('apertura negativa', format($q$select abrir_caja(%L, -1)$q$, pg_temp.fx('pv2')), '0 o más');

  perform registrar_movimiento_caja(jsonb_build_object('tipo', 'retiro', 'motivo', 'otro', 'detalle', 'prueba', 'monto', 30000, 'caja_id', v_caja));
  perform pg_temp.igual('retiro: baja el efectivo', caja_efectivo_esperado(v_caja), 70000);
  perform registrar_movimiento_caja(jsonb_build_object('tipo', 'ingreso', 'motivo', 'otro', 'detalle', 'prueba', 'monto', 5000, 'caja_id', v_caja));
  perform pg_temp.igual('ingreso: sube el efectivo', caja_efectivo_esperado(v_caja), 75000);
  perform pg_temp.rechaza('retirar más de lo que hay',
    format($q$select registrar_movimiento_caja('{"tipo": "retiro", "motivo": "otro", "detalle": "prueba", "monto": 999999, "caja_id": "%s"}')$q$, v_caja), 'no se puede retirar');

  v := crear_venta(pg_temp.fx('cliente'), 'CONTADO', 'efectivo', 'GS', null, jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 1)), null, null, p_caja_id => v_caja);
  perform pg_temp.igual('venta en esta caja: suma el efectivo', caja_efectivo_esperado(v_caja), 85000);

  -- Cobro en esta caja, para probarlo después del cierre.
  v := crear_venta(pg_temp.fx('cliente'), 'CREDITO', 'efectivo', 'GS', null, jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 1)), null, null, p_plazo_dias => 30, p_caja_id => v_caja);
  select id into v_cxc from cuentas_por_cobrar where venta_id = (v->>'venta_id')::uuid;
  v_cobro := registrar_cobro(jsonb_build_object('cliente_id', pg_temp.fx('cliente'), 'caja_id', v_caja,
    'pagos', jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', 10000)),
    'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', v_cxc, 'monto', 10000))));
  perform pg_temp.igual('cobro en esta caja: suma el efectivo', caja_efectivo_esperado(v_caja), 95000);

  perform pg_temp.rechaza('cierre con diferencia y sin motivo', format($q$select cerrar_caja(%L, 90000, null, '{}')$q$, v_caja), 'diferencias');
  perform pg_temp.rechaza('cierre con monto negativo', format($q$select cerrar_caja(%L, -1, null, '{}')$q$, v_caja), 'contá el efectivo');

  r := cerrar_caja(v_caja, 95000, null, '{}');
  perform pg_temp.ok('cierre sin diferencia: se cierra', (select estado from cajas where id = v_caja) = 'cerrada', r::text);
  perform pg_temp.rechaza('cerrar dos veces', format($q$select cerrar_caja(%L, 95000, null, '{}')$q$, v_caja), 'ya está cerrada');
  perform pg_temp.rechaza('vender en una caja cerrada',
    format($q$select crear_venta(null, 'CONTADO', 'efectivo', 'GS', null, '[{"producto_id": "%s", "cantidad": 1}]', null, null, p_caja_id => %L)$q$, p, v_caja), 'ya no está abierta');
  perform pg_temp.rechaza('anular un cobro de caja cerrada', format($q$select anular_cobro(%L, 'prueba')$q$, v_cobro->>'id'), 'ya se cerró');
  perform pg_temp.rechaza('retirar de una caja cerrada',
    format($q$select registrar_movimiento_caja('{"tipo": "retiro", "motivo": "otro", "detalle": "prueba", "monto": 1, "caja_id": "%s"}')$q$, v_caja), 'ya no está abierta');
exception when others then
  perform pg_temp.ok('caja: el escenario se cortó', false, sqlerrm);
end $$;
