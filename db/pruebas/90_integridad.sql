-- Al final de todo: lo que la base controla sobre sí misma, con los datos reales de la empresa incluidos.
do $$
declare
  v_inv jsonb := verificar_inventario();
  v_cap jsonb := verificar_capas();
begin
  perform pg_temp.ok('integridad: inventario', (v_inv->>'ok')::boolean, v_inv::text);
  perform pg_temp.ok('integridad: capas de costo', (v_cap->>'ok')::boolean, left(v_cap::text, 1500));
  perform pg_temp.igual('integridad: cuentas por cobrar con saldo que no cierra',
    (select count(*) from cuentas_por_cobrar where saldo < 0), 0);
  perform pg_temp.igual('integridad: cuentas por pagar con saldo negativo',
    (select count(*) from cuentas_por_pagar where saldo < 0), 0);
  perform pg_temp.igual('integridad: ventas cuyo total no da con sus líneas', (
    select count(*) from ventas v
     where v.estado <> 'anulada' and exists (select 1 from ventas_items i where i.venta_id = v.id)
       and v.total <> (select sum(i.total_linea) from ventas_items i where i.venta_id = v.id)), 0);
exception when others then
  perform pg_temp.ok('integridad: el escenario se cortó', false, sqlerrm);
end $$;
