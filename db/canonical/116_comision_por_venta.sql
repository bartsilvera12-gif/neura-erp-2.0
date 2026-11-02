-- =============================================================================
-- EL VENDEDOR COMISIONA POR SUS VENTAS (decisión del dueño, 2-nov-2026). Cambia lo que trajo la 115.
--
--   · De quién es la venta: el vendedor marcado en la venta → quien armó el pedido (al cobrarse en
--     caja) → quien registró la venta → el vendedor del cliente. Ya no hace falta que tenga cliente.
--   · Comisiona toda venta, salvo las de suscripción y las marcadas como no comisionables. Sale la
--     regla "solo la primera venta del cliente".
--   · Las ventas de mesa no comisionan (el pedido llega por QR y no hay vendedor) salvo que tengan
--     un vendedor marcado.
--   · Con base "pago registrado", lo devuelto o dejado a favor por una nota de crédito resta en el
--     mes en que se emitió.
--   · Cajero también ve su comisión: comisiona por lo que vende directo en Nueva venta.
--
-- IDEMPOTENTE. Va después de 115.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- ventas.created_by guarda el usuario de acceso (auth), no usuarios.id.
create or replace function :"schema".comision_ventas_base(p_empresa uuid, p_desde date, p_hasta date)
returns table (id uuid, cliente_id uuid, cliente text, alta date, numero text, fecha date, factor numeric, monto numeric, neto numeric,
               saldo numeric, tiene_suscripcion boolean, comisionable boolean, vendedor uuid, monto_suscripcion numeric, cxc_id uuid)
language sql stable security definer set search_path = :"schema", public as $fn$
  with ids as (
    select v.id from ventas v where v.empresa_id = p_empresa and (v.fecha at time zone 'America/Asuncion')::date between p_desde and p_hasta
    union select q.venta_id from cuentas_por_cobrar q where q.empresa_id = p_empresa and q.saldo > 0 and q.venta_id is not null
    union select d.venta_id from ventas_pagos_detalle d where d.empresa_id = p_empresa and (d.fecha_pago at time zone 'America/Asuncion')::date between p_desde and p_hasta
    union select q.venta_id from cobros_aplicaciones a
            join cobros_clientes c on c.id = a.cobro_id and c.anulado_at is null
            join cuentas_por_cobrar q on q.id = a.cxc_id
           where a.empresa_id = p_empresa and (c.fecha at time zone 'America/Asuncion')::date between p_desde and p_hasta
    union select n.venta_id from notas_credito n where n.empresa_id = p_empresa and n.estado <> 'anulada' and (n.fecha at time zone 'America/Asuncion')::date between p_desde and p_hasta
  )
  select v.id, v.cliente_id, coalesce(c.nombre, nullif(v.receptor_nombre, ''), 'Consumidor final'), (c.creado_at at time zone 'America/Asuncion')::date,
         coalesce(v.fiscal_numero, v.numero_control), (v.fecha at time zone 'America/Asuncion')::date,
         x.factor, v.total * x.factor,
         greatest(v.total - coalesce((select sum(n.total) from notas_credito n where n.venta_id = v.id and n.estado <> 'anulada'), 0), 0) * x.factor,
         coalesce((select sum(q.saldo) from cuentas_por_cobrar q where q.venta_id = v.id), 0) * x.factor,
         v.suscripcion_id is not null, v.comisionable,
         coalesce(v.vendedor_usuario_id, p.creado_por, u.id, c.vendedor_usuario_id),
         (select nullif(sum(s.precio), 0) from suscripciones s where s.cliente_id = v.cliente_id and s.empresa_id = p_empresa and s.estado <> 'cancelada'),
         (select q.id from cuentas_por_cobrar q where q.venta_id = v.id and q.saldo > 0 order by q.vencimiento, q.created_at limit 1)
    from ventas v
    join ids on ids.id = v.id
    left join clientes c on c.id = v.cliente_id
    left join pedidos_mostrador p on p.venta_id = v.id
    left join usuarios u on u.auth_user_id = v.created_by and u.empresa_id = p_empresa
   cross join lateral (select case when v.moneda = 'USD' then coalesce(nullif(v.tipo_cambio, 0), 1) else 1 end as factor) x
   where v.empresa_id = p_empresa and v.estado <> 'anulada'
     and (v.vendedor_usuario_id is not null
          or not (exists (select 1 from mesa_cuentas mc where mc.venta_id = v.id) or exists (select 1 from mesa_cuenta_partes mp where mp.venta_id = v.id)))
$fn$;
revoke all on function :"schema".comision_ventas_base(uuid, date, date) from public, anon, authenticated;

create or replace function :"schema".comisiones_datos(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pol comision_politicas;
  v_admin boolean;
  v_lineas jsonb;
  v_a_cobrar jsonb;
  v_recurrencia jsonb;
begin
  select * into s from inv_sesion(null);
  v_admin := s.s_rol = 'ADMIN';
  select * into pol from comision_politicas where empresa_id = s.s_empresa;
  if not found or not pol.activo then
    return jsonb_build_object('estado', case when pol.id is null then 'sin_politica' else 'politica_inactiva' end, 'es_admin', v_admin, 'usuario_id', s.s_usuario);
  end if;

  with b as materialized (select * from comision_ventas_base(s.s_empresa, p_desde, p_hasta)),
  pagos as (
    select d.id as pago_id, d.venta_id, (d.fecha_pago at time zone 'America/Asuncion')::date as fecha, d.monto
      from ventas_pagos_detalle d where d.empresa_id = s.s_empresa
    union all
    select a.id, x.venta_id, (c.fecha at time zone 'America/Asuncion')::date, a.monto
      from cobros_aplicaciones a
      join cobros_clientes c on c.id = a.cobro_id and c.anulado_at is null
      join cuentas_por_cobrar x on x.id = a.cxc_id
     where a.empresa_id = s.s_empresa
  ),
  cobrado as (
    select p.venta_id, sum(p.monto) as total, max(p.fecha) as ultima,
           coalesce(sum(p.monto) filter (where p.fecha between p_desde and p_hasta), 0) as del_periodo
      from pagos p where p.fecha <= p_hasta group by 1
  ),
  filas as (
    -- Cada pago del período.
    select 'pago' as tipo, b.*, p.pago_id, b.numero as numero_linea, p.fecha as fecha_linea, p.monto * b.factor as monto_base, p.monto * b.factor as cobrado_periodo, b.saldo as pendiente
      from pagos p join b on b.id = p.venta_id
     where pol.base_calculo = 'pago_registrado' and p.fecha between p_desde and p_hasta
    union all
    -- Lo devuelto o dejado a favor por una nota de crédito resta en su mes.
    select 'nota_credito', b.*, n.id, n.numero, (n.fecha at time zone 'America/Asuncion')::date, -(n.devuelto + n.a_favor) * b.factor, -(n.devuelto + n.a_favor) * b.factor, b.saldo
      from notas_credito n join b on b.id = n.venta_id
     where pol.base_calculo = 'pago_registrado' and n.empresa_id = s.s_empresa and n.estado <> 'anulada'
       and (n.fecha at time zone 'America/Asuncion')::date between p_desde and p_hasta and n.devuelto + n.a_favor > 0
    union all
    -- Ventas emitidas en el período.
    select 'factura_emitida', b.*, null, b.numero, b.fecha, b.neto, coalesce(co.del_periodo, 0) * b.factor, 0
      from b left join cobrado co on co.venta_id = b.id
     where pol.base_calculo = 'factura_emitida' and b.fecha between p_desde and p_hasta and b.neto > 0
    union all
    -- Ventas que terminaron de cobrarse en el período.
    select 'factura_pagada', b.*, null, b.numero, co.ultima, b.neto, co.del_periodo * b.factor, 0
      from b join cobrado co on co.venta_id = b.id
     where pol.base_calculo = 'factura_pagada' and co.ultima between p_desde and p_hasta and b.saldo <= 0.02 and b.neto > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', f.tipo, 'cliente_id', f.cliente_id, 'cliente_label', f.cliente, 'factura_id', f.id, 'numero_factura', f.numero_linea,
           'pago_id', f.pago_id, 'fecha', f.fecha_linea, 'monto_base', round(f.monto_base, 2), 'cobrado_periodo', round(f.cobrado_periodo, 2),
           'saldo_pendiente', round(f.saldo, 2), 'pendiente_por_comisionar', round(f.pendiente, 2), 'comisionable', f.comisionable,
           'tiene_suscripcion', f.tiene_suscripcion, 'cliente_alta', f.alta,
           'factura_monto_total', round(f.monto, 2), 'vendedor_usuario_id', f.vendedor, 'monto_suscripcion', f.monto_suscripcion
         ) order by f.fecha_linea, f.numero_linea), '[]'::jsonb)
    into v_lineas
    from filas f
   where v_admin or f.vendedor = s.s_usuario;

  -- Lo que le falta cobrar a cada vendedor, sea del mes que sea.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', b.cliente_id, 'cliente_label', b.cliente, 'factura_id', b.id, 'numero_factura', b.numero, 'cxc_id', b.cxc_id,
           'fecha', b.fecha, 'monto_total', round(b.monto, 2), 'saldo_pendiente', round(b.saldo, 2), 'vendedor_usuario_id', b.vendedor,
           'comisionable', b.comisionable, 'tiene_suscripcion', b.tiene_suscripcion, 'monto_suscripcion', b.monto_suscripcion
         ) order by b.saldo desc, b.cliente), '[]'::jsonb)
    into v_a_cobrar
    from comision_ventas_base(s.s_empresa, p_desde, p_hasta) b
   where b.saldo > 0.02 and b.vendedor is not null and b.cliente_id is not null and (v_admin or b.vendedor = s.s_usuario);

  select coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', c.id, 'cliente', c.nombre, 'fecha', (c.creado_at at time zone 'America/Asuncion')::date, 'vendedor_usuario_id', c.vendedor_usuario_id,
           'monto', x.monto, 'plan', x.plan
         ) order by c.creado_at desc), '[]'::jsonb)
    into v_recurrencia
    from clientes c
    join lateral (
      select sum(su.precio) as monto, string_agg(su.plan_nombre, ' + ') as plan
        from suscripciones su where su.cliente_id = c.id and su.empresa_id = s.s_empresa and su.estado <> 'cancelada'
    ) x on x.monto > 0
   where c.empresa_id = s.s_empresa and c.deleted_at is null
     and (c.creado_at at time zone 'America/Asuncion')::date between p_desde and p_hasta
     and (v_admin or c.vendedor_usuario_id = s.s_usuario);

  return jsonb_build_object(
    'estado', 'ok', 'es_admin', v_admin, 'usuario_id', s.s_usuario,
    'politica', jsonb_build_object('id', pol.id, 'nombre', pol.nombre, 'base_calculo', pol.base_calculo),
    'escalas', coalesce((select jsonb_agg(jsonb_build_object('orden', e.orden, 'desde_monto', e.desde_monto, 'hasta_monto', e.hasta_monto,
                                                             'porcentaje_comision', e.porcentaje_comision, 'premio_fijo', e.premio_fijo) order by e.orden, e.desde_monto)
                           from comision_escalas e where e.politica_id = pol.id), '[]'::jsonb),
    'overrides', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('pago_id', o.pago_id, 'decision', o.decision, 'motivo', o.motivo,
                                                                                      'decidido_por', o.decidido_por_nombre, 'decidido_at', o.decidido_at))
                           from comision_overrides o where o.empresa_id = s.s_empresa and o.periodo_ym = to_char(p_desde, 'YYYY-MM')), '[]'::jsonb)
                  else coalesce((select jsonb_agg(jsonb_build_object('pago_id', o.pago_id, 'decision', o.decision))
                           from comision_overrides o where o.empresa_id = s.s_empresa and o.periodo_ym = to_char(p_desde, 'YYYY-MM')), '[]'::jsonb) end,
    'lineas', v_lineas, 'a_cobrar', v_a_cobrar, 'recurrencia', v_recurrencia,
    'nombres', coalesce((select jsonb_object_agg(u.id, u.nombre) from usuarios u where u.empresa_id = s.s_empresa), '{}'::jsonb));
end;
$fn$;

drop function if exists :"schema".comision_ventas_base(uuid);

do $do$
declare
  v_def text;
  v_patron text := $a$when 'VENDEDOR' then v_comun || v_inventario || array['/comisiones'] else v_comun || v_inventario end$a$;
  v_nuevo text := $b$else v_comun || v_inventario || array['/comisiones'] end$b$;
begin
  v_def := pg_get_functiondef('perfiles_sistema_asegurar(uuid)'::regprocedure);
  if position(v_nuevo in v_def) = 0 then
    if position(v_patron in v_def) = 0 then raise exception 'Receta 116: perfiles_sistema_asegurar no tiene el patrón esperado'; end if;
    execute replace(v_def, v_patron, v_nuevo);
  end if;
end;
$do$;

insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
select pf.id, pf.empresa_id, '/comisiones' from perfiles pf where pf.codigo = 'CAJERO'
on conflict do nothing;

commit;

notify pgrst, 'reload schema';
