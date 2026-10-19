-- =============================================================================
-- REPORTE "FORMAS DE PAGO" (amplía 54): cuánto se vendió y se ganó con cada medio de pago.
--
--   reporte_formas_pago(p_desde, p_hasta, p_sucursal)
--
-- Qué devuelve (período + sucursal; ADMIN, sucursal efectiva por rep_sesion como los demás
-- reportes financieros):
--   · medios      un renglón por forma de pago de las ventas de CONTADO (metodo_caja: efectivo,
--                 débito, crédito, transferencia, QR / billetera, cheque…, con su label y orden de
--                 caja): ventas (IVA incluido), cantidad de ventas en que intervino, costo (CMV
--                 prorrateado) y ganancia bruta.
--   · credito     lo vendido a crédito en el período (fila aparte, no se mezcla con los medios).
--   · totales     ventas netas (= reporte_ventas_mes / reporte_estado_cuenta), CMV, ganancia.
--   · cobros      lo cobrado de créditos en el período por medio (cobros de clientes no anulados).
--   · ingresos    plata que entró por medio = ventas de contado + cobros.
--   · evolucion   por día (período ≤ 31 días) o por mes, por medio (crédito incluido).
-- Reglas:
--   · Ventas netas = ventas no anuladas, IVA incluido (mismo criterio que 54). Sin comisiones de
--     procesadoras: se muestra el ingreso completo.
--   · Pagos mixtos: cada medio recibe lo que se pagó con él (ventas_pagos_detalle). El costo de
--     la venta se prorratea entre sus medios en proporción al monto de cada uno; el último medio
--     de la venta se lleva el resto, así Σ costos por medio = CMV de la venta exacto.
--   · Ventas sin detalle de pago (legado): su metodo_pago de cabecera (vacío → efectivo).
--   · CMV = Σ cantidad × costo_unitario guardado en cada línea.
--   · Redondeo: los montos se redondean al final con redondeo acumulado (en el orden de caja),
--     así la suma de los renglones redondeados es exactamente el total redondeado.
--   · Cobros con sucursal: lo aplicado a cuentas de ventas de esa sucursal (como el flujo de
--     reporte_estado_cuenta), repartido entre los medios del cobro en proporción.
-- SECURITY DEFINER + search_path fijo; EXECUTE solo para authenticated. IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create index if not exists cobros_pagos_cobro_idx on :"schema".cobros_pagos (cobro_id);
create index if not exists vpd_venta_idx on :"schema".ventas_pagos_detalle (venta_id);

create or replace function :"schema".reporte_formas_pago(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  v_ini timestamptz;
  v_fin timestamptz;
  v_dia boolean;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);
  v_ini := rep_ts(g.r_desde);
  v_fin := rep_ts(g.r_hasta + 1);
  v_dia := g.r_hasta - g.r_desde < 31;

  with v as (
    select v.id, (v.fecha at time zone 'America/Asuncion')::date as dia, rep_fx(v.moneda, v.tipo_cambio) as fx,
           v.total * rep_fx(v.moneda, v.tipo_cambio) as total, v.tipo_venta = 'CREDITO' as es_credito, v.metodo_pago
      from ventas v
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada'
       and v.fecha >= v_ini and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  costo as (
    select vi.venta_id, sum(vi.cantidad * coalesce(vi.costo_unitario, 0)) * max(v.fx) as c,
           bool_or(coalesce(vi.costo_unitario, 0) = 0 and vi.producto_id is not null) as sin_costo
      from ventas_items vi join v on v.id = vi.venta_id
     group by vi.venta_id
  ),
  -- Partes de cada venta: (venta, medio, monto). Crédito = un solo medio "credito".
  partes as (
    select x.id, x.dia, x.met, sum(x.monto) as monto
      from (select v.id, v.dia, metodo_caja(d.metodo_pago) as met, d.monto * v.fx as monto
              from v join ventas_pagos_detalle d on d.venta_id = v.id
             where not v.es_credito
            union all
            select v.id, v.dia, metodo_caja(coalesce(nullif(btrim(v.metodo_pago), ''), 'efectivo')), v.total
              from v
             where not v.es_credito and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = v.id)
            union all
            select v.id, v.dia, 'credito', v.total from v where v.es_credito) x
     group by 1, 2, 3
  ),
  -- Proporción de cada parte dentro de su venta (venta en 0: partes iguales).
  pr as (
    select p.*, coalesce(c.c, 0) as costo_venta,
           case when sum(p.monto) over w = 0 then 1.0 / count(*) over w else p.monto / sum(p.monto) over w end as prop,
           row_number() over (partition by p.id order by p.monto, p.met) as rn,
           count(*) over w as n
      from partes p left join costo c on c.venta_id = p.id
    window w as (partition by p.id)
  ),
  -- Costo prorrateado: el último medio de la venta absorbe la diferencia (Σ = costo de la venta).
  pc as (
    select pr.id, pr.dia, pr.met, pr.monto,
           case when pr.rn = pr.n
                then pr.costo_venta - coalesce(sum(pr.costo_venta * pr.prop) over (partition by pr.id order by pr.rn rows between unbounded preceding and 1 preceding), 0)
                else pr.costo_venta * pr.prop end as costo
      from pr
  ),
  agg as (
    select met, case when met = 'credito' then 99 else metodo_caja_orden(met) end as orden,
           sum(monto) as ventas, count(distinct id) as n, sum(costo) as costo
      from pc group by met
  ),
  -- Redondeo acumulado: Σ renglones = total redondeado.
  agg_r as (
    select met, orden, n,
           round(sum(ventas) over o) - round(sum(ventas) over o - ventas) as ventas,
           round(sum(costo) over o) - round(sum(costo) over o - costo) as costo
      from agg
    window o as (order by orden, met rows between unbounded preceding and current row)
  ),
  -- Cobros de créditos (no anulados) del período; con sucursal, lo aplicado a ventas de esa sucursal.
  cob as (
    select c.id, (c.fecha at time zone 'America/Asuncion')::date as dia,
           case when s.s_sucursal is null then c.total
                else (select coalesce(sum(a.monto), 0)
                        from cobros_aplicaciones a
                        join cuentas_por_cobrar x on x.id = a.cxc_id
                        join ventas vv on vv.id = x.venta_id
                       where a.cobro_id = c.id and coalesce(vv.sucursal_id, s.s_principal) = s.s_sucursal) end as base
      from cobros_clientes c
     where c.empresa_id = s.s_empresa and c.anulado_at is null
       and c.fecha >= v_ini and c.fecha < v_fin
  ),
  cobp as (
    select x.id, x.dia, x.met, sum(x.monto) as monto
      from (select cob.id, cob.dia, metodo_caja(p.metodo) as met,
                   cob.base * p.monto / nullif(sum(p.monto) over (partition by cob.id), 0) as monto
              from cob join cobros_pagos p on p.cobro_id = cob.id
             where cob.base > 0
            union all
            select cob.id, cob.dia, 'otro', cob.base from cob
             where cob.base > 0 and not exists (select 1 from cobros_pagos p where p.cobro_id = cob.id)) x
     group by 1, 2, 3
  ),
  cagg as (
    select met, metodo_caja_orden(met) as orden, sum(monto) as total, count(distinct id) as n from cobp group by met
  ),
  cagg_r as (
    select met, orden, n, round(sum(total) over o) - round(sum(total) over o - total) as total
      from cagg
    window o as (order by orden, met rows between unbounded preceding and current row)
  ),
  ing as (
    select coalesce(a.met, c.met) as met, coalesce(a.orden, c.orden) as orden,
           coalesce(a.ventas, 0) as ventas, coalesce(c.total, 0) as cobros
      from (select * from agg_r where met <> 'credito') a full join cagg_r c on c.met = a.met
  ),
  -- Evolución: por día (≤ 31 días) o por mes.
  buckets as (
    select k::date as x
      from generate_series(case when v_dia then g.r_desde else date_trunc('month', g.r_desde)::date end,
                           g.r_hasta, case when v_dia then interval '1 day' else interval '1 month' end) k
  ),
  evo as (
    select case when v_dia then dia else date_trunc('month', dia)::date end as x, met, sum(monto) as monto
      from pc group by 1, 2
  ),
  evo_c as (
    select case when v_dia then dia else date_trunc('month', dia)::date end as x, sum(monto) as monto
      from cobp group by 1
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'agrupacion', case when v_dia then 'dia' else 'mes' end,
    'medios', coalesce((select jsonb_agg(jsonb_build_object(
        'metodo', met, 'label', metodo_caja_label(met), 'orden', orden, 'ventas', ventas, 'cantidad', n,
        'costo', costo, 'ganancia', ventas - costo) order by orden, met)
      from agg_r where met <> 'credito'), '[]'::jsonb),
    'credito', (select jsonb_build_object('ventas', coalesce(sum(ventas), 0), 'cantidad', coalesce(sum(n), 0),
                                          'costo', coalesce(sum(costo), 0), 'ganancia', coalesce(sum(ventas - costo), 0))
                  from agg_r where met = 'credito'),
    'totales', jsonb_build_object(
        'ventas', (select coalesce(sum(ventas), 0) from agg_r),
        'contado', (select coalesce(sum(ventas), 0) from agg_r where met <> 'credito'),
        'credito', (select coalesce(sum(ventas), 0) from agg_r where met = 'credito'),
        'cantidad', (select count(*) from v),
        'costo', (select coalesce(sum(costo), 0) from agg_r),
        'ganancia', (select coalesce(sum(ventas - costo), 0) from agg_r),
        'mixtas', (select count(*) from (select id from partes where met <> 'credito' group by id having count(*) > 1) x),
        'productos_sin_costo', (select count(*) from costo where sin_costo)),
    'cobros', jsonb_build_object(
        'total', (select coalesce(sum(total), 0) from cagg_r),
        'cantidad', (select count(*) from cob where base > 0),
        'por_metodo', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', metodo_caja_label(met), 'total', total, 'cantidad', n)
                                                 order by orden, met) from cagg_r), '[]'::jsonb)),
    'ingresos', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', metodo_caja_label(met), 'ventas', ventas,
                                                              'cobros', cobros, 'total', ventas + cobros) order by orden, met) from ing), '[]'::jsonb),
    'anuladas', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(v.total * rep_fx(v.moneda, v.tipo_cambio)), 0))
                   from ventas v where v.empresa_id = s.s_empresa and v.estado = 'anulada'
                    and v.fecha >= v_ini and v.fecha < v_fin
                    and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)),
    'evolucion', (select coalesce(jsonb_agg(jsonb_build_object(
        'x', b.x,
        'por_metodo', coalesce((select jsonb_object_agg(e.met, round(e.monto)) from evo e where e.x = b.x), '{}'::jsonb),
        'cobros', coalesce((select round(ec.monto) from evo_c ec where ec.x = b.x), 0)) order by b.x), '[]'::jsonb)
      from buckets b)
  ) into r;
  return r;
end;
$fn$;

revoke all on function :"schema".reporte_formas_pago(date, date, uuid) from public, anon;
grant execute on function :"schema".reporte_formas_pago(date, date, uuid) to authenticated;

commit;
