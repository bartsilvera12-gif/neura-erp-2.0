-- =============================================================================
-- Cierre de caja (transaccional). Guarda lo que el cajero CONTÓ y, al lado, lo que
-- el sistema ESPERABA en efectivo:
--
--   esperado = apertura + ingresos(efectivo) − egresos(efectivo) − retiros(efectivo) + ajustes(efectivo)
--
-- Solo efectivo: una transferencia no está en el cajón. Los movimientos anulados no
-- cuentan (esa plata no entró ni salió). `monto` se guarda siempre positivo; el signo
-- lo da `tipo`. Atómico (lock de la caja + update) y bajo RLS (SECURITY INVOKER).
-- =============================================================================

create or replace function :"schema".cerrar_caja(
  p_caja_id uuid,
  p_monto_contado numeric,
  p_observacion text,
  p_arqueo_json jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = :"schema", public
as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_usuario uuid;
  v_caja record;
  v_esperado numeric;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if p_monto_contado is null or p_monto_contado < 0 then
    raise exception 'Contá el efectivo antes de cerrar (monto ≥ 0)';
  end if;

  select * into v_caja from cajas where id = p_caja_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Caja no encontrada'; end if;
  if v_caja.estado = 'cerrada' then raise exception 'Esa caja ya está cerrada'; end if;

  select coalesce(sum(case
           when tipo = 'ingreso' then monto
           when tipo in ('egreso', 'retiro') then -monto
           when tipo = 'ajuste' then monto
           else 0 end), 0)
    into v_esperado
    from caja_movimientos
   where empresa_id = v_empresa and caja_id = p_caja_id
     and anulado_at is null
     and lower(btrim(coalesce(medio_pago, ''))) = 'efectivo';
  v_esperado := v_caja.monto_apertura + v_esperado;

  select id into v_usuario from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;

  update cajas
     set estado = 'cerrada', fecha_cierre = now(), cerrada_por = v_usuario,
         monto_cierre_contado = p_monto_contado,
         monto_esperado_efectivo = v_esperado,
         diferencia = p_monto_contado - v_esperado,
         observacion_cierre = p_observacion,
         arqueo_cierre_json = p_arqueo_json,
         updated_at = now()
   where id = p_caja_id;

  return jsonb_build_object(
    'caja_id', p_caja_id, 'numero_caja', v_caja.numero_caja,
    'contado', p_monto_contado, 'esperado', v_esperado,
    'diferencia', p_monto_contado - v_esperado);
end;
$fn$;

grant execute on function :"schema".cerrar_caja(uuid, numeric, text, jsonb) to authenticated, service_role;
