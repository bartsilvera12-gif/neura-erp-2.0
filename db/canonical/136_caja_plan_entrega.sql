-- =============================================================================
-- CAJA › NUEVA VENTA: plan de cuotas y entrega inicial (pedido del dueño, 4-nov-2026).
--
--   crear_venta_cuotas(...): los mismos datos que crear_venta + plan y entrega. Crea la venta a
--   crédito (con las cuotas del plan si viene uno), pone la entrega (cuota 0, receta 131) y la COBRA
--   en la misma transacción con lo que paga el cliente. Todo o nada.
--   Las formas de pago de la caja se pasan a las del cobro (tarjeta/POS débito y crédito → tarjeta y
--   pos; QR y billetera → otro).
--
-- IDEMPOTENTE. Va después de 135.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

create or replace function :"schema".crear_venta_cuotas(
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text, p_items jsonb,
  p_idempotency_key text, p_descuento_pct numeric, p_plazo_dias integer, p_caja_id uuid, p_tipo_documento text,
  p_cuotas integer, p_cuotas_cada text, p_entrega numeric, p_pagos_entrega jsonb, p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pl planes_cuota;
  v_cuotas integer := coalesce(p_cuotas, 1);
  v_cada text := coalesce(nullif(p_cuotas_cada, ''), 'mes');
  v_plazo integer := p_plazo_dias;
  v_entrega numeric := round(coalesce(p_entrega, 0));
  v_venta jsonb;
  v_id uuid;
  v_total numeric;
  v_pagado numeric := 0;
  v_pagos jsonb := '[]'::jsonb;
  v_metodo text;
  v_cxc uuid;
  v_cobro jsonb;
  pg jsonb;
begin
  select * into s from inv_sesion();
  if coalesce(p_tipo_venta, 'CREDITO') <> 'CREDITO' then raise exception 'El plan y la entrega son para ventas a crédito'; end if;
  if p_plan_id is not null then
    select * into pl from planes_cuota where id = p_plan_id and empresa_id = s.s_empresa and activo;
    if pl.id is null then raise exception 'Ese plan de cuotas no existe o está desactivado'; end if;
    v_cuotas := pl.cuotas; v_cada := pl.cada; v_plazo := pl.primera_dias;
  end if;
  if v_entrega < 0 then raise exception 'La entrega no puede ser negativa'; end if;

  v_venta := crear_venta(p_cliente_id, 'CREDITO', p_metodo_pago, coalesce(p_moneda, 'GS'), p_observaciones, p_items, null,
                         p_idempotency_key, coalesce(p_descuento_pct, 0), v_plazo, null, p_caja_id, coalesce(p_tipo_documento, 'ticket'),
                         false, v_cuotas, v_cada);
  if coalesce((v_venta->>'reusada')::boolean, false) then return v_venta; end if;
  v_id := (v_venta->>'venta_id')::uuid;
  select total into v_total from ventas where id = v_id;

  if pl.id is not null and pl.entrega_pct > 0 and v_entrega < round(v_total * pl.entrega_pct / 100) then
    raise exception 'El plan "%" pide una entrega de al menos % %% (Gs. %)', pl.nombre, trim_scale(pl.entrega_pct),
      replace(to_char(round(v_total * pl.entrega_pct / 100), 'FM999,999,999,990'), ',', '.');
  end if;

  if v_entrega > 0 then
    update ventas set entrega = v_entrega, updated_at = now() where id = v_id;  -- el disparador arma la cuota 0
    if jsonb_typeof(p_pagos_entrega) <> 'array' or jsonb_array_length(p_pagos_entrega) = 0 then
      raise exception 'Elegí cómo paga la entrega';
    end if;
    for pg in select * from jsonb_array_elements(p_pagos_entrega) loop
      v_metodo := lower(coalesce(pg->>'metodo', pg->>'metodo_pago', ''));
      v_metodo := case
        when v_metodo in ('tarjeta_debito', 'tarjeta_credito') then 'tarjeta'
        when v_metodo in ('pos_debito', 'pos_credito') then 'pos'
        when v_metodo in ('qr', 'billetera') then 'otro'
        else v_metodo end;
      if v_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro', 'saldo_favor') then
        raise exception 'Forma de pago inválida para la entrega: %', coalesce(nullif(v_metodo, ''), 'ninguna');
      end if;
      v_pagado := v_pagado + round(coalesce((pg->>'monto')::numeric, 0));
      v_pagos := v_pagos || jsonb_build_object('metodo', v_metodo, 'monto', round((pg->>'monto')::numeric), 'referencia', pg->>'referencia');
    end loop;
    if v_pagado <> v_entrega then
      raise exception 'Lo que paga (Gs. %) tiene que ser igual a la entrega (Gs. %)',
        replace(to_char(v_pagado, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_entrega, 'FM999,999,999,990'), ',', '.');
    end if;
    select id into v_cxc from cuentas_por_cobrar where venta_id = v_id and cuota = 0;
    v_cobro := registrar_cobro(jsonb_build_object(
      'cliente_id', p_cliente_id, 'pagos', v_pagos, 'caja_id', (v_venta->>'caja_id'),
      'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', v_cxc, 'monto', v_entrega)),
      'observacion', 'Entrega inicial de la venta ' || (v_venta->>'numero_control')));
  end if;

  return v_venta || jsonb_build_object('entrega', v_entrega, 'cuotas', v_cuotas, 'recibo_entrega', v_cobro->>'numero_recibo');
end;
$fn$;

revoke all on function :"schema".crear_venta_cuotas(uuid,text,text,text,text,jsonb,text,numeric,integer,uuid,text,integer,text,numeric,jsonb,uuid) from public, anon;
grant execute on function :"schema".crear_venta_cuotas(uuid,text,text,text,text,jsonb,text,numeric,integer,uuid,text,integer,text,numeric,jsonb,uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
