-- La plata y el stock no se escriben por fuera de las funciones, y cada perfil hace solo lo suyo.
do $$
declare
  p uuid := pg_temp.producto('Seguridad', 5000);
  v jsonb;
begin
  perform pg_temp.comprar(p, 10, 1000);

  perform pg_temp.rechaza('escribir el stock directo', format($q$update productos set stock_actual = 999 where id = %L$q$, p), 'permission denied');
  perform pg_temp.rechaza('crear una venta directo', $q$insert into ventas (empresa_id) values (pg_temp.fx('empresa'))$q$, 'permission denied');
  perform pg_temp.rechaza('borrar movimientos de caja directo', $q$delete from caja_movimientos$q$, 'permission denied');
  perform pg_temp.rechaza('tocar una cuenta por cobrar directo', $q$update cuentas_por_cobrar set cobrado = monto$q$, 'permission denied');

  -- Sin sesión.
  perform pg_temp.rechaza('sin sesión no se vende', $q$set local role anon; select crear_venta(null, 'CONTADO', 'efectivo', 'GS', null, '[]', null, null)$q$, 'permission denied');
  perform pg_temp.rechaza('sin sesión no se cobra', $q$set local role anon; select registrar_cobro('{}')$q$, 'permission denied');

  -- Cajero: vende, pero no compra ni ajusta ni anula compras.
  perform pg_temp.como('cajero');
  perform pg_temp.rechaza('cajero no registra compras', format($q$select pg_temp.comprar(%L, 1, 1000)$q$, p), 'sin permiso');
  perform pg_temp.rechaza('cajero no ajusta stock',
    format($q$select registrar_ajuste('{"tipo": "ajuste", "motivo": "correccion", "items": [{"producto_id": "%s", "cantidad": 1}]}')$q$, p), 'sin permiso');
  perform pg_temp.rechaza('cajero no paga a proveedores',
    format($q$select registrar_pago_proveedor('{"proveedor_id": "%s", "medios": [{"metodo": "efectivo", "monto": 1}]}')$q$, pg_temp.fx('proveedor')), 'permiso');
  perform pg_temp.cajero_descuentos(false, null);
  perform pg_temp.rechaza('cajero sin el permiso no da descuentos', format($q$select pg_temp.vender(%L, 1, null, null, 5)$q$, p), 'permiso');
  perform pg_temp.cajero_descuentos(true, 5);
  perform pg_temp.rechaza('cajero no pasa su tope de descuento', format($q$select pg_temp.vender(%L, 1, null, null, 10)$q$, p), 'tope');
  v := pg_temp.vender(p, 1, null, null, 5);
  perform pg_temp.igual('cajero dentro de su tope sí vende', (select total from ventas where id = (v->>'venta_id')::uuid), 4750);
  perform pg_temp.como('admin');
exception when others then
  perform pg_temp.como('admin');
  perform pg_temp.ok('seguridad: el escenario se cortó', false, sqlerrm);
end $$;
