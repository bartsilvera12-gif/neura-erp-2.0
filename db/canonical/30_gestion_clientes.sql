-- =============================================================================
-- Gestión del Cliente (consola de un cliente, como la del sistema actual):
--   documentos_cliente: todas sus ventas (contado, crédito y cuotas de suscripción) con
--   saldo, vencimiento, días de mora, estado y fecha del último pago registrado, más las
--   cifras de arriba (cantidad, monto total, saldo pendiente, vencidas, pendientes, pagadas).
--   Filtros como en el actual: rango de emisión, rango de vencimiento, incluir saldo cero,
--   incluir contado, moneda.
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

create or replace function :"schema".documentos_cliente(
  p_cliente uuid,
  p_emision_desde date default null, p_emision_hasta date default null,
  p_venc_desde date default null, p_venc_hasta date default null,
  p_incluir_saldo_cero boolean default true, p_incluir_contado boolean default true,
  p_moneda text default null
) returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  docs as (
    select v.id, v.numero_control as numero, v.tipo_venta, v.estado as estado_venta, v.moneda, v.total as monto,
           (v.fecha at time zone 'America/Asuncion')::date as emision,
           case when v.suscripcion_id is not null then 'suscripcion' when v.tipo_venta = 'CREDITO' then 'credito' else 'contado' end as tipo,
           v.suscripcion_id, v.periodo,
           case when v.periodo is not null then nombre_mes(v.periodo) end as periodo_nombre,
           x.id as cxc_id, x.vencimiento, x.estado as estado_cxc,
           case when v.estado = 'anulada' then 0
                when v.tipo_venta = 'CREDITO' then coalesce(x.saldo, 0) else 0 end as saldo,
           case when v.estado <> 'anulada' and v.tipo_venta = 'CREDITO' and x.estado in ('pendiente', 'parcial') and x.vencimiento < hoy.d
                then hoy.d - x.vencimiento else 0 end as dias_mora,
           case when v.estado = 'anulada' then 'anulado'
                when v.tipo_venta = 'CONTADO' then 'pagado'
                when x.estado = 'pagada' then 'pagado'
                when x.vencimiento < hoy.d then 'vencido'
                when x.estado = 'parcial' then 'parcial'
                else 'pendiente' end as estado,
           case when v.tipo_venta = 'CONTADO' and v.estado <> 'anulada' then (v.fecha at time zone 'America/Asuncion')::date
                else (select max((k.fecha at time zone 'America/Asuncion')::date)
                        from cobros_aplicaciones a join cobros_clientes k on k.id = a.cobro_id
                       where a.cxc_id = x.id and k.anulado_at is null) end as pago_registrado,
           (select count(*) from cobros_aplicaciones a join cobros_clientes k on k.id = a.cobro_id
             where a.cxc_id = x.id and k.anulado_at is null) as recibos
      from ventas v
      left join cuentas_por_cobrar x on x.venta_id = v.id
      cross join hoy
     where v.cliente_id = p_cliente and v.empresa_id = empresa_actual()
  ),
  filtrados as (
    select * from docs
     where (p_emision_desde is null or emision >= p_emision_desde)
       and (p_emision_hasta is null or emision <= p_emision_hasta)
       and (p_venc_desde is null or vencimiento >= p_venc_desde)
       and (p_venc_hasta is null or vencimiento <= p_venc_hasta)
       and (coalesce(p_incluir_saldo_cero, true) or saldo > 0)
       and (coalesce(p_incluir_contado, true) or tipo <> 'contado')
       and (p_moneda is null or moneda = p_moneda)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.emision desc, f.numero desc) from filtrados f), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
        'documentos', count(*),
        'monto_total', coalesce(sum(monto) filter (where estado <> 'anulado'), 0),
        'saldo_pendiente', coalesce(sum(saldo), 0),
        'vencidas', count(*) filter (where estado = 'vencido'),
        'pendientes', count(*) filter (where estado in ('pendiente', 'parcial')),
        'pagadas', count(*) filter (where estado = 'pagado'),
        'anuladas', count(*) filter (where estado = 'anulado'))
      from filtrados)
  )
$$;
grant execute on function :"schema".documentos_cliente(uuid, date, date, date, date, boolean, boolean, text) to authenticated, service_role;

-- Cambio de fecha de vencimiento de una suscripción (botón "Cambio fecha venc." del actual).
-- Rige para las cuotas que se emitan desde ahora; opcionalmente mueve también la del mes
-- en curso si está emitida y sin cobrar.
create or replace function :"schema".cambiar_vencimiento_suscripcion(p_suscripcion uuid, p_dia integer, p_mover_cuota_mes boolean default false)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  s suscripciones;
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion'))::date;
  v_cuota uuid;
  v_movida boolean := false;
begin
  select * into s from suscripciones where id = p_suscripcion and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;
  if p_dia is null or p_dia < 1 or p_dia > 31 then raise exception 'El día de vencimiento va de 1 a 31'; end if;
  if p_dia < s.dia_facturacion then raise exception 'El vencimiento no puede ser antes del día de facturación (%)', s.dia_facturacion; end if;
  update suscripciones set dia_vencimiento = p_dia, updated_at = now() where id = s.id;
  if coalesce(p_mover_cuota_mes, false) then
    select v.id into v_cuota from ventas v join cuentas_por_cobrar x on x.venta_id = v.id
     where v.suscripcion_id = s.id and v.periodo = v_mes and v.estado <> 'anulada' and x.cobrado = 0;
    if v_cuota is not null then
      update cuentas_por_cobrar set vencimiento = dia_del_mes(v_mes, p_dia), updated_at = now() where venta_id = v_cuota;
      v_movida := true;
    end if;
  end if;
  perform registrar_historial_cliente(s.cliente_id, 'suscripcion',
    jsonb_build_object('evento', 'cambio_vencimiento', 'plan', s.plan_nombre, 'antes', s.dia_vencimiento, 'despues', p_dia, 'cuota_movida', v_movida));
  return jsonb_build_object('ok', true, 'cuota_movida', v_movida);
end;
$$;
grant execute on function :"schema".cambiar_vencimiento_suscripcion(uuid, integer, boolean) to authenticated, service_role;
