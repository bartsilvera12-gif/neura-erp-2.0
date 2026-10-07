-- =============================================================================
-- Anulación de venta (transaccional). Revierte lo que la venta hizo:
--   - devuelve el stock de cada ítem (si el producto controla stock)
--   - anula el movimiento de caja del cobro (anulado_at)
--   - marca la venta como 'anulada'
-- Atómica y bajo RLS (SECURITY INVOKER). IDEMPOTENTE (re-anular no hace nada).
-- =============================================================================

create or replace function :"schema".anular_venta(p_venta_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = :"schema", public
as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_venta record;
  it record;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;

  select * into v_venta from ventas where id = p_venta_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_venta.estado = 'anulada' then
    return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', true);
  end if;

  -- Devolver stock de cada ítem.
  for it in select vi.producto_id, vi.cantidad from ventas_items vi
            where vi.venta_id = p_venta_id and vi.empresa_id = v_empresa loop
    update productos
       set stock_actual = stock_actual + it.cantidad, updated_at = now()
     where id = it.producto_id and empresa_id = v_empresa and controla_stock;
  end loop;

  -- Anular el movimiento de caja del cobro (si lo hubo).
  update caja_movimientos
     set anulado_at = now(), anulado_motivo = 'Venta anulada'
   where venta_id = p_venta_id and empresa_id = v_empresa and anulado_at is null;

  update ventas set estado = 'anulada', anulada_at = now() where id = p_venta_id;

  return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', false);
end;
$fn$;

grant execute on function :"schema".anular_venta(uuid) to authenticated, service_role;
