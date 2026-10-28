-- =============================================================================
-- Receta 92 — QA área 1 (caja, ventas, compras, inventario, reportes, finanzas).
-- Idempotente. Aplicar con -v schema=<schema>.
--
--   resumen_ventas_dia(p_fecha, p_sucursal)
--     Lo vendido EN EL DÍA (por la fecha de cada venta, hora de Asunción), no "lo de los
--     turnos abiertos ese día": en Caja › Apertura y cierre, "Vendido hoy" daba Gs. 0 cuando
--     el turno venía abierto de días anteriores aunque se hubiera vendido en el día.
--     ADMIN ve todas las sucursales (o la elegida); el resto, la suya (como resumen_cajas_dia).
-- =============================================================================

set search_path to :"schema", public;

create or replace function :"schema".resumen_ventas_dia(p_fecha date default null, p_sucursal uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path from current
as $$
declare
  s record;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Asuncion')::date);
  v_suc uuid := p_sucursal;
  v_desde timestamptz;
  v_hasta timestamptz;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  if s.s_rol <> 'ADMIN' then v_suc := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)); end if;
  v_desde := (v_fecha::timestamp at time zone 'America/Asuncion');
  v_hasta := ((v_fecha + 1)::timestamp at time zone 'America/Asuncion');

  select jsonb_build_object(
    'fecha', v_fecha,
    'sucursal_id', v_suc,
    'total_vendido', coalesce(sum(v.total), 0),
    'ventas_contado', coalesce(sum(v.total) filter (where v.tipo_venta <> 'CREDITO'), 0),
    'ventas_credito', coalesce(sum(v.total) filter (where v.tipo_venta = 'CREDITO'), 0),
    'cantidad_ventas', count(*),
    'cobros', coalesce((
      select sum(cb.total)
        from cobros_clientes cb
        left join cajas c on c.id = cb.caja_id
       where cb.empresa_id = s.s_empresa
         and cb.anulado_at is null
         and cb.fecha >= v_desde and cb.fecha < v_hasta
         and (v_suc is null or c.sucursal_id = v_suc)), 0))
    into r
    from ventas v
   where v.empresa_id = s.s_empresa
     and v.estado <> 'anulada'
     and v.fecha >= v_desde and v.fecha < v_hasta
     and (v_suc is null or v.sucursal_id = v_suc);
  return r;
end;
$$;

revoke all on function :"schema".resumen_ventas_dia(date, uuid) from public;
grant execute on function :"schema".resumen_ventas_dia(date, uuid) to authenticated, service_role;

-- Dato viejo del demo: un pago 'pos_credito' (y su movimiento de caja 'tarjeta') que los reportes
-- mostraban distinto ("Tarjeta" suelta en Cierre de caja, "Tarjeta de crédito" en Formas de pago).
-- Se normaliza a tarjeta_credito, como el resto. Idempotente (si no hay, no toca nada).
update :"schema".caja_movimientos set metodo = 'tarjeta_credito' where metodo in ('tarjeta', 'pos_credito');
update :"schema".ventas_pagos_detalle set metodo_pago = 'tarjeta_credito' where metodo_pago = 'pos_credito';
notify pgrst, 'reload schema';
