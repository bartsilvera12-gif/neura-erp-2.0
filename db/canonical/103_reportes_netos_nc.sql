-- =============================================================================
-- REPORTES NETOS DE NOTAS DE CRÉDITO (pedido del dueño, 30-oct-2026).
--
-- Las notas emitidas restan en el período en que se EMITEN (no en el de la venta), como en el RG 90.
-- Lo que no se toca: la cantidad de ventas (la nota no es una venta menos) y las cajas y turnos,
-- donde la devolución ya figura como egreso.
--   · Ventas: el monto y el IVA de la nota restan.
--   · Unidades y costo: restan solo en las devoluciones; el descuento por monto no devolvió nada.
--     El costo resta también si el producto no volvió al stock: ese costo ya está en Pérdidas
--     (receta 99) y si no se contaría dos veces.
--   · Formas de pago: la nota resta de donde sale la plata: "credito" lo que bajó la deuda, el
--     medio de la devolución lo devuelto y "saldo_favor" lo que quedó a favor (se compensa cuando
--     el cliente lo usa). Así la suma por medio da igual a las ventas netas.
--   · Flujo de caja (Estado de cuenta): lo pagado con saldo a favor no es plata que entró, y lo
--     devuelto es plata que salió (flujo.devoluciones).
-- rep_nc_notas / rep_nc_items devuelven los montos en positivo y en la moneda de la venta; `fx` los
-- pasa a guaraníes. Son SECURITY DEFINER (las tablas de notas están cerradas a authenticated) y
-- solo leen la empresa de la sesión.
--
-- IDEMPOTENTE. Va después de 102.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".rep_nc_notas(p_ini timestamptz, p_fin timestamptz, p_sucursal uuid default null)
returns table (nota_id uuid, venta_id uuid, cliente_id uuid, fecha timestamptz, dia date, suc uuid, tipo_venta text,
               fx numeric, total numeric, a_cuenta numeric, devuelto numeric, a_favor numeric, metodo text, costo numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select n.id, n.venta_id, n.cliente_id, n.fecha, (n.fecha at time zone 'America/Asuncion')::date,
         coalesce(n.sucursal_id, v.sucursal_id, sucursal_principal(n.empresa_id)), v.tipo_venta, rep_fx(v.moneda, v.tipo_cambio),
         n.total, n.a_cuenta, n.devuelto, n.a_favor, n.metodo_devolucion,
         (select coalesce(sum(i.cantidad * coalesce(i.costo_unitario, 0)), 0) from notas_credito_items i
           where i.nota_id = n.id and n.tipo <> 'descuento')
    from notas_credito n join ventas v on v.id = n.venta_id
   where n.empresa_id = empresa_actual() and n.estado = 'emitida'
     and (p_ini is null or n.fecha >= p_ini) and (p_fin is null or n.fecha < p_fin)
     and (p_sucursal is null or coalesce(n.sucursal_id, v.sucursal_id, sucursal_principal(n.empresa_id)) = p_sucursal)
$$;

create or replace function :"schema".rep_nc_items(p_ini timestamptz, p_fin timestamptz, p_sucursal uuid default null)
returns table (item_id uuid, nota_id uuid, numero text, venta_id uuid, fecha timestamptz, dia date, tipo_venta text, created_by uuid,
               cliente_id uuid, receptor_ocasional boolean, receptor_nombre text, fx numeric,
               producto_id uuid, nombre text, sku text, categoria uuid, tipo_iva text,
               cantidad numeric, precio numeric, monto numeric, iva numeric, costo_unitario numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select i.id, n.id, n.numero, n.venta_id, n.fecha, (n.fecha at time zone 'America/Asuncion')::date, v.tipo_venta, v.created_by,
         v.cliente_id, v.receptor_ocasional, v.receptor_nombre, rep_fx(v.moneda, v.tipo_cambio),
         i.producto_id, i.producto_nombre, i.sku, p.categoria_principal_id,
         case when i.tipo_iva in ('10%', '5%') then i.tipo_iva else 'EXENTA' end,
         case when n.tipo = 'descuento' then 0 else i.cantidad end, i.precio_unitario, i.total_linea, i.monto_iva,
         case when n.tipo = 'descuento' then 0 else coalesce(i.costo_unitario, 0) end
    from notas_credito n
    join notas_credito_items i on i.nota_id = n.id
    join ventas v on v.id = n.venta_id
    left join productos p on p.id = i.producto_id
   where n.empresa_id = empresa_actual() and n.estado = 'emitida'
     and (p_ini is null or n.fecha >= p_ini) and (p_fin is null or n.fecha < p_fin)
     and (p_sucursal is null or coalesce(n.sucursal_id, v.sucursal_id, sucursal_principal(n.empresa_id)) = p_sucursal)
$$;

revoke all on function :"schema".rep_nc_notas(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function :"schema".rep_nc_items(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function :"schema".rep_nc_notas(timestamptz, timestamptz, uuid), :"schema".rep_nc_items(timestamptz, timestamptz, uuid) to authenticated, service_role;

-- Parches sobre la versión vigente (cada patrón tiene que aparecer, o ya estar aplicado).
do $do$
declare
  c record;
  v_def text;
begin
  for c in select * from (values
    -- ── Reporte de ventas ──────────────────────────────────────────────────────
    -- (primero el renombre: el parche de "pagos" agrega un "items" nuevo)
    ('reporte_ventas_resumen', $a$  items as ($a$, $b$  items0 as ($b$),
    ('reporte_ventas_resumen', $a$    select vi.*, v.fecha, v.created_by, p.categoria_principal_id,$a$,
      $b$    select null::uuid as nota_id, vi.venta_id, vi.producto_id, vi.producto_nombre, vi.sku, vi.tipo_iva, vi.cantidad, vi.costo_unitario, vi.total_linea, vi.monto_iva,
           v.fecha, v.created_by, p.categoria_principal_id,$b$),
    ('reporte_ventas_resumen', $a$  pagos as ($a$,
      $b$  -- 103: notas de crédito (en positivo), con los mismos filtros de la venta.
  nc_filtro as (
    select i.* from rep_nc_items((p_desde::timestamp at time zone 'America/Asuncion'), ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')) i
      join reporte_ventas_base(null, null, p_cajero, p_tipo, p_medio, p_categoria) b on b.id = i.venta_id
     where p_categoria is null
        or (case when p_categoria = '__sin__' then i.categoria is null else categoria_coincide(i.categoria, p_categoria) end)
  ),
  items as (
    select * from items0
    union all
    select i.nota_id, null::uuid, i.producto_id, i.nombre, i.sku, i.tipo_iva, -i.cantidad, i.costo_unitario, -i.monto, -i.iva,
           i.fecha, i.created_by, i.categoria, -i.monto + i.cantidad * i.costo_unitario, i.dia
      from nc_filtro i
  ),
  nc_notas as (
    select n.* from rep_nc_notas((p_desde::timestamp at time zone 'America/Asuncion'), ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')) n
      join reporte_ventas_base(null, null, p_cajero, p_tipo, p_medio, p_categoria) b on b.id = n.venta_id
  ),
  pagos as ($b$),
    ('reporte_ventas_resumen', $a$    select v.id, 'credito', v.total from vig v where v.tipo_venta = 'CREDITO'$a$,
      $b$    select v.id, 'credito', v.total from vig v where v.tipo_venta = 'CREDITO'
    union all
    select null, 'credito', -n.a_cuenta from nc_notas n where n.a_cuenta > 0
    union all
    select null, categoria_pago(coalesce(n.metodo, 'efectivo')), -n.devuelto from nc_notas n where n.devuelto > 0
    union all
    select null, categoria_pago('saldo_favor'), -n.a_favor from nc_notas n where n.a_favor > 0$b$),
    ('reporte_ventas_resumen', $a$'productos_sin_costo', count(distinct producto_id) filter (where coalesce(costo_unitario, 0) = 0)$a$,
      $b$'productos_sin_costo', count(distinct producto_id) filter (where coalesce(costo_unitario, 0) = 0 and cantidad > 0)$b$),
    ('reporte_ventas_resumen', $a$bool_or(coalesce(costo_unitario, 0) = 0) sc$a$,
      $b$bool_or(coalesce(costo_unitario, 0) = 0 and cantidad > 0) sc$b$),
    ('reporte_ventas_resumen', $a$    'anuladas', ($a$,
      $b$    'notas_credito', (select jsonb_build_object('cantidad', count(distinct nota_id), 'monto', coalesce(-sum(total_linea), 0)) from items where nota_id is not null),
    'anuladas', ($b$),

    ('reporte_ventas_detalle', $a$  pag as ($a$,
      $b$  nc as materialized (select x.venta_id, sum(x.total) as t from rep_nc_notas(null, null, null) x group by 1),
  pag as ($b$),
    ('reporte_ventas_detalle', $a$'total', v.total, 'iva', v.monto_iva,$a$,
      $b$'total', v.total, 'iva', v.monto_iva, 'notas_credito', coalesce((select nc.t from nc where nc.venta_id = v.id), 0),$b$),

    -- ── Ventas por mes ─────────────────────────────────────────────────────────
    ('reporte_ventas_mes', $a$  act as (select * from v where mes >= v_m0),$a$,
      $b$  -- 103: notas de crédito (restan en el mes en que se emiten).
  nc as (
    select date_trunc('month', n.dia)::date as mes, n.total * n.fx as total, n.a_cuenta * n.fx as a_cuenta, n.devuelto * n.fx as devuelto,
           n.a_favor * n.fx as a_favor, n.metodo, n.tipo_venta, n.suc
      from rep_nc_notas(rep_ts((v_desde - interval '12 months')::date), rep_ts(v_hasta + 1), s.s_sucursal) n
  ),
  vn as (
    select mes, total, tipo_venta, suc, 1 as n from v
    union all
    select mes, -total, tipo_venta, suc, 0 from nc
  ),
  act as (select * from v where mes >= v_m0),$b$),
    ('reporte_ventas_mes', $a$    select act.mes, 'credito', sum(act.total) from act where act.tipo_venta = 'CREDITO' group by 1$a$,
      $b$    select act.mes, 'credito', sum(act.total) from act where act.tipo_venta = 'CREDITO' group by 1
    union all
    select nc.mes, 'credito', -sum(nc.a_cuenta) from nc where nc.mes >= v_m0 and nc.a_cuenta > 0 group by 1
    union all
    select nc.mes, metodo_caja(coalesce(nc.metodo, 'efectivo')), -sum(nc.devuelto) from nc where nc.mes >= v_m0 and nc.devuelto > 0 group by 1, 2
    union all
    select nc.mes, 'saldo_favor', -sum(nc.a_favor) from nc where nc.mes >= v_m0 and nc.a_favor > 0 group by 1$b$),
    ('reporte_ventas_mes', $a$from act join ventas_items vi on vi.venta_id = act.id left join productos p on p.id = vi.producto_id group by 1, 2) x$a$,
      $b$from act join ventas_items vi on vi.venta_id = act.id left join productos p on p.id = vi.producto_id group by 1, 2
            union all
            select date_trunc('month', i.dia)::date, i.categoria, -sum(i.monto * i.fx)
              from rep_nc_items(rep_ts(v_m0), rep_ts(v_hasta + 1), s.s_sucursal) i group by 1, 2) x$b$),
    ('reporte_ventas_mes', $a$vm as (select mes, sum(total) as total, count(*) as n,$a$, $b$vm as (select mes, sum(total) as total, sum(n) as n,$b$),
    ('reporte_ventas_mes', $a$           from v group by mes),$a$, $b$           from vn group by mes),$b$),
    ('reporte_ventas_mes', $a$sum(total) t from v group by mes, suc) x group by mes),$a$, $b$sum(total) t from vn group by mes, suc) x group by mes),$b$),
    ('reporte_ventas_mes', $a$from (select suc, sum(total) t, count(*) n from act group by suc) x join sucursales$a$,
      $b$from (select suc, sum(total) t, sum(n) n from vn where mes >= v_m0 group by suc) x join sucursales$b$),
    ('reporte_ventas_mes', $a$'cantidad', count(*) filter (where mes >= v_m0),$a$, $b$'cantidad', coalesce(sum(n) filter (where mes >= v_m0), 0),$b$),
    ('reporte_ventas_mes', $a$'anterior_cantidad', count(*) filter (where mes < v_m0)) from v)$a$,
      $b$'anterior_cantidad', coalesce(sum(n) filter (where mes < v_m0), 0)) from vn)$b$),

    -- ── Estado de cuenta ───────────────────────────────────────────────────────
    ('reporte_estado_cuenta', $a$  with vi as ($a$, $b$  with vi0 as ($b$),
    ('reporte_estado_cuenta', $a$  per as (select * from vi where dia >= g.r_desde),$a$,
      $b$  -- 103: notas de crédito (restan en el mes en que se emiten; venta_id null: no descuentan ventas).
  vi as (
    select dia, monto, iva, costo, producto_id, sin_costo, venta_id from vi0
    union all
    select i.dia, -i.monto * i.fx, -i.iva * i.fx, -i.cantidad * i.costo_unitario * i.fx, i.producto_id, false, null::uuid
      from rep_nc_items(rep_ts(v_mes_ini), v_fin, s.s_sucursal) i
  ),
  per as (select * from vi where dia >= g.r_desde),$b$),
    ('reporte_estado_cuenta', $a$      from ventas v join ventas_pagos_detalle d on d.venta_id = v.id$a$,
      $b$      from ventas v join ventas_pagos_detalle d on d.venta_id = v.id and d.metodo_pago <> 'saldo_favor'$b$),
    ('reporte_estado_cuenta', $a$    select 'cobros', c.total from cobros_clientes c$a$,
      $b$    select 'cobros', c.total - coalesce((select sum(p.monto) from cobros_pagos p where p.cobro_id = c.id and p.metodo = 'saldo_favor'), 0) from cobros_clientes c$b$),
    ('reporte_estado_cuenta', $a$    select 'cobros', a.monto from cobros_clientes c join cobros_aplicaciones a on a.cobro_id = c.id$a$,
      $b$    select 'cobros', a.monto * (1 - coalesce((select sum(p.monto) from cobros_pagos p where p.cobro_id = c.id and p.metodo = 'saldo_favor'), 0) / nullif(c.total, 0))
      from cobros_clientes c join cobros_aplicaciones a on a.cobro_id = c.id$b$),
    ('reporte_estado_cuenta', $a$    'anuladas', (select jsonb_build_object('cantidad', count(*),$a$,
      $b$    'notas_credito', (select jsonb_build_object('cantidad', count(*), 'total', round(coalesce(sum(n.total * n.fx), 0)))
                        from rep_nc_notas(rep_ts(g.r_desde), v_fin, s.s_sucursal) n),
    'anuladas', (select jsonb_build_object('cantidad', count(*),$b$),
    ('reporte_estado_cuenta', $a$'pagos_proveedores', (select coalesce(sum(monto), 0) from pagado where concepto = 'pagos_proveedores')),$a$,
      $b$'pagos_proveedores', (select coalesce(sum(monto), 0) from pagado where concepto = 'pagos_proveedores'),
        'devoluciones', (select round(coalesce(sum(n.devuelto * n.fx), 0)) from rep_nc_notas(rep_ts(g.r_desde), v_fin, s.s_sucursal) n)),$b$),

    -- ── Inicio ─────────────────────────────────────────────────────────────────
    ('dashboard_inicio', $a$  mes as (select * from v where fecha >= rep_ts(v_mes)),$a$,
      $b$  -- 103: notas de crédito (restan el día en que se emiten; no restan cantidad de ventas).
  nc as (select * from rep_nc_notas(rep_ts(v_desde), null, s.s_sucursal)),
  vn as (
    select id, fecha, dia, total, tipo_venta, metodo_pago, suc, true as es_venta from v
    union all
    select nota_id, fecha, dia, -total * fx, tipo_venta, null, suc, false from nc
  ),
  mes as (select * from vn where fecha >= rep_ts(v_mes)),$b$),
    ('dashboard_inicio', $a$      from ventas_items vi join mes on mes.id = vi.venta_id$a$,
      $b$      from (select vi.producto_id, vi.producto_nombre, vi.cantidad, vi.total_linea, vi.costo_unitario
              from ventas_items vi join mes on mes.id = vi.venta_id
            union all
            select i.producto_id, i.nombre, -i.cantidad, -i.monto * i.fx, i.costo_unitario * i.fx
              from rep_nc_items(rep_ts(v_mes), null, s.s_sucursal) i) vi$b$),
    ('dashboard_inicio', $a$     where mes.tipo_venta <> 'CREDITO' and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = mes.id)$a$,
      $b$     where mes.es_venta and mes.tipo_venta <> 'CREDITO' and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = mes.id)$b$),
    ('dashboard_inicio', $a$    select 'credito', mes.total from mes where mes.tipo_venta = 'CREDITO'$a$,
      $b$    select 'credito', mes.total from mes where mes.es_venta and mes.tipo_venta = 'CREDITO'
    union all
    select 'credito', -n.a_cuenta * n.fx from nc n where n.fecha >= rep_ts(v_mes) and n.a_cuenta > 0
    union all
    select metodo_caja(coalesce(n.metodo, 'efectivo')), -n.devuelto * n.fx from nc n where n.fecha >= rep_ts(v_mes) and n.devuelto > 0
    union all
    select 'saldo_favor', -n.a_favor * n.fx from nc n where n.fecha >= rep_ts(v_mes) and n.a_favor > 0$b$),
    ('dashboard_inicio', $a$count(*) filter (where dia$a$, $b$count(*) filter (where es_venta and dia$b$),
    ('dashboard_inicio', $a$      from v),$a$, $b$      from vn),$b$),
    ('dashboard_inicio', $a$left join (select v.dia, sum(v.total) t, count(*) n from v group by v.dia) pd_a$a$,
      $b$left join (select v.dia, sum(v.total) t, count(*) filter (where v.es_venta) n from vn v group by v.dia) pd_a$b$),
    ('dashboard_inicio', $a$left join (select v.dia, sum(v.total) t from v group by v.dia) pd_b$a$,
      $b$left join (select v.dia, sum(v.total) t from vn v group by v.dia) pd_b$b$),
    ('dashboard_inicio', $a$(select v.dia, v.suc, sum(v.total) t from v group by v.dia, v.suc) x$a$,
      $b$(select v.dia, v.suc, sum(v.total) t from vn v group by v.dia, v.suc) x$b$),
    ('dashboard_inicio', $a$from (select suc, sum(total) t, count(*) n from mes group by suc) x$a$,
      $b$from (select suc, sum(total) t, count(*) filter (where es_venta) n from mes group by suc) x$b$),

    -- ── Productos vendidos ─────────────────────────────────────────────────────
    ('reporte_productos_vendidos', $a$  vendidos as ($a$,
      $b$  -- 103: lo devuelto resta unidades, total y costo en el período en que se emitió la nota.
  lineas_n as (
    select * from lineas
    union all
    select i.producto_id, i.nombre, i.sku, -i.cantidad, -i.monto, -i.cantidad * i.costo_unitario, false, null::uuid
      from rep_nc_items((p_desde::timestamp at time zone 'America/Asuncion'), ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')) i
     where (p_producto is null or i.producto_id = p_producto)
       and (p_categoria is null or (p_categoria = '__sin__' and i.categoria is null) or categoria_coincide(i.categoria, p_categoria))
  ),
  vendidos as ($b$),
    ('reporte_productos_vendidos', $a$      from lineas group by producto_id$a$, $b$      from lineas_n group by producto_id$b$),
    ('reporte_productos_vendidos', $a$'productos_sin_ventas', count(*) filter (where t.unidades = 0),$a$,
      $b$'productos_sin_ventas', count(*) filter (where t.unidades = 0 and t.producto_id is not null),$b$),

    ('reporte_productos_vendidos_detalle', $a$  with lineas as ($a$, $b$  with lineas0 as ($b$),
    ('reporte_productos_vendidos_detalle', $a$  pag as ($a$,
      $b$  -- 103: lo devuelto, como línea en negativo con el número de la nota.
  lineas as (
    select * from lineas0
    union all
    select i.item_id, i.venta_id, i.numero, i.fecha, i.tipo_venta, i.created_by, i.cliente_id, i.receptor_ocasional, i.receptor_nombre,
           i.producto_id, i.nombre, i.sku, -i.cantidad, i.precio, null::numeric, -i.monto, -i.monto + i.cantidad * i.costo_unitario
      from rep_nc_items((p_desde::timestamp at time zone 'America/Asuncion'), ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')) i
     where (p_producto is null or i.producto_id = p_producto)
       and (p_categoria is null or (p_categoria = '__sin__' and i.categoria is null) or categoria_coincide(i.categoria, p_categoria))
       and (nullif(trim(p_q), '') is null or coincide_busqueda(
             concat_ws(' ', norm(i.nombre), compacto(i.nombre), norm(i.sku), compacto(i.sku), norm(i.numero), compacto(i.numero)), tokens_busqueda(p_q)))
  ),
  pag as ($b$),

    -- ── Formas de pago ─────────────────────────────────────────────────────────
    ('reporte_formas_pago', $a$  agg as ($a$,
      $b$  -- 103: la nota resta de donde sale la plata (crédito, medio de la devolución o saldo a favor).
  pcn as (
    select pc.id, pc.dia, pc.met, pc.monto, pc.costo from pc
    union all
    select null::uuid, n.dia, x.met, -x.m * n.fx, -n.costo * n.fx * x.m / nullif(n.total, 0)
      from rep_nc_notas(v_ini, v_fin, s.s_sucursal) n
      cross join lateral (values ('credito', n.a_cuenta), (metodo_caja(coalesce(n.metodo, 'efectivo')), n.devuelto), ('saldo_favor', n.a_favor)) x(met, m)
     where x.m > 0
  ),
  agg as ($b$),
    ('reporte_formas_pago', $a$      from pc group by met$a$, $b$      from pcn group by met$b$),
    ('reporte_formas_pago', $a$      from pc group by 1, 2$a$, $b$      from pcn group by 1, 2$b$),
    -- "Plata que entró": el saldo a favor no es plata nueva.
    ('reporte_formas_pago', $a$order by orden, met) from ing), '[]'::jsonb),$a$,
      $b$order by orden, met) from ing where met <> 'saldo_favor'), '[]'::jsonb),$b$),

    -- ── Día en caja y clientes ─────────────────────────────────────────────────
    ('resumen_ventas_dia', $a$  return r;$a$,
      $b$  -- 103: neto de las notas de crédito emitidas en el día.
  select r || jsonb_build_object(
      'total_vendido', (r->>'total_vendido')::numeric - coalesce(sum(n.total), 0),
      'ventas_contado', (r->>'ventas_contado')::numeric - coalesce(sum(n.total) filter (where n.tipo_venta <> 'CREDITO'), 0),
      'ventas_credito', (r->>'ventas_credito')::numeric - coalesce(sum(n.total) filter (where n.tipo_venta = 'CREDITO'), 0),
      'notas_credito', coalesce(sum(n.total), 0))
    into r from rep_nc_notas(v_desde, v_hasta, v_suc) n;
  return r;$b$),
    ('resumen_cliente', $a$  select coalesce(sum(saldo), 0), coalesce(sum(saldo) filter (where vencimiento < v_hoy), 0) into v_deuda, v_venc$a$,
      $b$  v_tc := v_tc - coalesce((select sum(n.total) from rep_nc_notas(null, null, null) n where n.cliente_id = p_cliente), 0);  -- 103
  select coalesce(sum(saldo), 0), coalesce(sum(saldo) filter (where vencimiento < v_hoy), 0) into v_deuda, v_venc$b$),
    ('cifras_clientes', $a$  d as ($a$,
      $b$  nc as (
    select n.cliente_id, sum(n.total) as t from rep_nc_notas(null, null, null) n
     where n.cliente_id is not null and (p_cliente is null or n.cliente_id = p_cliente) group by 1
  ),
  d as ($b$),
    ('cifras_clientes', $a$coalesce(v.total_comprado, 0), coalesce(v.compras, 0)$a$,
      $b$coalesce(v.total_comprado, 0) - coalesce((select nc.t from nc where nc.cliente_id = v.cliente_id), 0), coalesce(v.compras, 0)$b$)
  ) x(fn, patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = c.fn;
    if v_def is null then raise exception 'Parche 103: no existe %', c.fn; end if;
    if position(c.nuevo in v_def) > 0 then continue; end if;   -- ya aplicado
    if position(c.patron in v_def) = 0 then raise exception 'Parche 103: % no tiene el patrón esperado (%)', c.fn, left(c.patron, 60); end if;
    execute replace(v_def, c.patron, c.nuevo);
  end loop;
end;
$do$;

commit;
