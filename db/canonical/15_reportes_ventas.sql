-- =============================================================================
-- Reporte "Ventas del período": todo se agrega EN LA BASE (una consulta por pantalla),
-- así anda igual con 50 ventas que con 50.000.
--   reporte_ventas_resumen(...)  → KPIs + por día + por medio + por cajero + productos + categorías
--   reporte_ventas_detalle(...)  → ventas una por una, paginado (+ total)
-- Filtros comunes (todos opcionales, NULL = sin filtro):
--   p_desde / p_hasta : fechas (día de Paraguay, ambos inclusive)
--   p_cajero          : auth_user_id de quien registró la venta (ventas.created_by)
--   p_tipo            : 'CONTADO' | 'CREDITO'
--   p_medio           : 'efectivo' | 'tarjeta' | 'pos' | 'transferencia' | 'cheque' | 'otro' | 'credito'
--   p_categoria       : uuid de categoría, o '__sin__' = productos sin categoría
-- Con filtro de categoría, los montos se calculan sobre los ÍTEMS de esa categoría.
-- La ganancia bruta es venta − costo (los dos con IVA incluido, igual que el margen del
-- inventario); el costo es el del producto al momento de vender (ventas_items.costo_unitario).
-- SECURITY INVOKER + empresa_actual(): cada empresa ve solo lo suyo. IDEMPOTENTE.
-- =============================================================================

-- Medio de pago detallado → categoría del reporte.
create or replace function :"schema".categoria_pago(p_metodo text)
returns text language sql immutable as $$
  select case
    when p_metodo is null then 'otro'
    when lower(p_metodo) like 'tarjeta%' then 'tarjeta'
    when lower(p_metodo) like 'pos%' then 'pos'
    when lower(p_metodo) in ('efectivo', 'transferencia', 'cheque') then lower(p_metodo)
    else 'otro'
  end
$$;

-- Ventas (con anuladas) que cumplen los filtros de cabecera.
create or replace function :"schema".reporte_ventas_base(
  p_desde date, p_hasta date, p_cajero uuid, p_tipo text, p_medio text, p_categoria text
) returns setof :"schema".ventas
language sql stable security invoker set search_path = :"schema", public as $$
  select v.* from ventas v
   where v.empresa_id = empresa_actual()
     and (p_desde is null or v.fecha >= (p_desde::timestamp at time zone 'America/Asuncion'))
     and (p_hasta is null or v.fecha < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion'))
     and (p_cajero is null or v.created_by = p_cajero)
     and (p_tipo is null or v.tipo_venta = p_tipo)
     and (p_medio is null
          or (p_medio = 'credito' and v.tipo_venta = 'CREDITO')
          or (p_medio <> 'credito' and v.tipo_venta <> 'CREDITO' and (
                exists (select 1 from ventas_pagos_detalle d where d.venta_id = v.id and categoria_pago(d.metodo_pago) = p_medio)
                or (not exists (select 1 from ventas_pagos_detalle d where d.venta_id = v.id)
                    and categoria_pago(v.metodo_pago) = p_medio))))
     and (p_categoria is null or exists (
            select 1 from ventas_items vi left join productos p on p.id = vi.producto_id
             where vi.venta_id = v.id
               and (case when p_categoria = '__sin__' then p.categoria_principal_id is null
                         else categoria_coincide(p.categoria_principal_id, p_categoria) end)))
$$;

create or replace function :"schema".reporte_ventas_resumen(
  p_desde date, p_hasta date, p_cajero uuid default null, p_tipo text default null,
  p_medio text default null, p_categoria text default null
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;

  with base as (
    select * from reporte_ventas_base(p_desde, p_hasta, p_cajero, p_tipo, p_medio, p_categoria)
  ),
  vig as (select * from base where estado <> 'anulada'),
  items as (
    select vi.*, v.fecha, v.created_by, p.categoria_principal_id,
           vi.total_linea - vi.cantidad * coalesce(vi.costo_unitario, 0) as ganancia,
           (date_trunc('day', v.fecha at time zone 'America/Asuncion'))::date as dia
      from ventas_items vi
      join vig v on v.id = vi.venta_id
      left join productos p on p.id = vi.producto_id
     where p_categoria is null
        or (case when p_categoria = '__sin__' then p.categoria_principal_id is null
                 else categoria_coincide(p.categoria_principal_id, p_categoria) end)
  ),
  pagos as (
    select v.id, categoria_pago(d.metodo_pago) as medio, d.monto
      from vig v join ventas_pagos_detalle d on d.venta_id = v.id
     where v.tipo_venta <> 'CREDITO'
    union all
    select v.id, categoria_pago(v.metodo_pago), v.total
      from vig v
     where v.tipo_venta <> 'CREDITO'
       and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = v.id)
    union all
    select v.id, 'credito', v.total from vig v where v.tipo_venta = 'CREDITO'
  ),
  usu as (select auth_user_id, nombre from usuarios where empresa_id = empresa_actual())
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'ventas_netas', coalesce(sum(total_linea), 0),
        'cantidad_ventas', count(distinct venta_id),
        'unidades', coalesce(sum(cantidad), 0),
        'costo', coalesce(sum(cantidad * coalesce(costo_unitario, 0)), 0),
        'ganancia', coalesce(sum(ganancia), 0),
        'iva_total', coalesce(sum(monto_iva), 0),
        'productos_sin_costo', count(distinct producto_id) filter (where coalesce(costo_unitario, 0) = 0)
      ) from items
    ),
    'iva', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', tipo_iva, 'total', t, 'iva', i, 'gravado', t - i) order by orden)
        from (select tipo_iva, sum(total_linea) t, sum(monto_iva) i,
                     case tipo_iva when '10%' then 1 when '5%' then 2 else 3 end orden
                from items group by tipo_iva) x
    ), '[]'::jsonb),
    'anuladas', (
      select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total), 0))
        from base where estado = 'anulada'
    ),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'ventas', t, 'cantidad', c, 'ganancia', g) order by dia)
        from (select dia, sum(total_linea) t, count(distinct venta_id) c, sum(ganancia) g from items group by dia) x
    ), '[]'::jsonb),
    'por_medio', coalesce((
      select jsonb_agg(jsonb_build_object('medio', medio, 'monto', m, 'ventas', c) order by m desc)
        from (select medio, sum(monto) m, count(distinct id) c from pagos group by medio) x
    ), '[]'::jsonb),
    'por_cajero', coalesce((
      select jsonb_agg(jsonb_build_object('cajero_id', created_by, 'nombre', coalesce(nombre, 'Sin usuario'),
                                          'ventas', t, 'cantidad', c, 'ganancia', g, 'anuladas', a) order by t desc)
        from (select i.created_by, u.nombre, sum(i.total_linea) t, count(distinct i.venta_id) c, sum(i.ganancia) g,
                     (select count(*) from base b where b.estado = 'anulada' and b.created_by is not distinct from i.created_by) a
                from items i left join usu u on u.auth_user_id = i.created_by
               group by i.created_by, u.nombre) x
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre, 'sku', sku, 'unidades', u,
                                          'monto', t, 'ganancia', g, 'sin_costo', sc) order by t desc)
        from (select producto_id, max(producto_nombre) nombre, max(sku) sku, sum(cantidad) u, sum(total_linea) t,
                     sum(ganancia) g, bool_or(coalesce(costo_unitario, 0) = 0) sc
                from items group by producto_id order by sum(total_linea) desc limit 200) x
    ), '[]'::jsonb),
    'por_categoria', coalesce((
      select jsonb_agg(jsonb_build_object('categoria_id', categoria_principal_id, 'nombre', coalesce(categoria_ruta(x.categoria_principal_id), 'Sin categoría'),
                                          'unidades', u, 'monto', t, 'ganancia', g) order by t desc)
        from (select categoria_principal_id, sum(cantidad) u, sum(total_linea) t, sum(ganancia) g
                from items group by categoria_principal_id) x
        left join categorias_productos c on c.id = x.categoria_principal_id
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

create or replace function :"schema".reporte_ventas_detalle(
  p_desde date, p_hasta date, p_cajero uuid default null, p_tipo text default null,
  p_medio text default null, p_categoria text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with base as (
    select * from reporte_ventas_base(p_desde, p_hasta, p_cajero, p_tipo, p_medio, p_categoria)
  ),
  pag as (
    select * from base order by fecha desc, id desc
     limit least(greatest(coalesce(p_limit, 25), 1), 50000) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'numero', v.numero_control, 'fecha', v.fecha, 'tipo', v.tipo_venta, 'estado', v.estado,
        'total', v.total, 'iva', v.monto_iva,
        'cliente', coalesce(c.razon_social, c.nombre),
        'cajero', u.nombre,
        'items', (select count(*) from ventas_items vi where vi.venta_id = v.id),
        'ganancia', (select coalesce(sum(vi.total_linea - vi.cantidad * coalesce(vi.costo_unitario, 0)), 0)
                       from ventas_items vi where vi.venta_id = v.id),
        'medios', case when v.tipo_venta = 'CREDITO' then jsonb_build_array('credito')
                       else coalesce((select jsonb_agg(distinct categoria_pago(d.metodo_pago))
                                        from ventas_pagos_detalle d where d.venta_id = v.id),
                                     jsonb_build_array(categoria_pago(v.metodo_pago))) end
      ) order by v.fecha desc, v.id desc)
        from pag v
        left join clientes c on c.id = v.cliente_id
        left join usuarios u on u.auth_user_id = v.created_by and u.empresa_id = v.empresa_id
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- completar_costo_ventas: a las líneas de venta que quedaron con costo 0 (el producto
-- no tenía costo cargado al venderse) les pone el costo promedio ACTUAL del producto.
-- Solo toca líneas en 0 de los productos indicados que hoy sí tienen costo; no cambia
-- precios, totales, stock ni caja. Devuelve cuántas líneas se completaron.
-- =============================================================================
create or replace function :"schema".completar_costo_ventas(p_producto_ids uuid[])
returns integer
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  n integer;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  update ventas_items vi
     set costo_unitario = p.costo_promedio
    from productos p
   where p.id = vi.producto_id
     and vi.empresa_id = empresa_actual()
     and p.empresa_id = empresa_actual()
     and vi.producto_id = any (p_producto_ids)
     and coalesce(vi.costo_unitario, 0) = 0
     and coalesce(p.costo_promedio, 0) > 0;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

grant execute on function :"schema".completar_costo_ventas(uuid[]) to authenticated, service_role;
grant execute on function :"schema".categoria_pago(text) to authenticated, service_role;
grant execute on function :"schema".reporte_ventas_base(date, date, uuid, text, text, text) to authenticated, service_role;
grant execute on function :"schema".reporte_ventas_resumen(date, date, uuid, text, text, text) to authenticated, service_role;
grant execute on function :"schema".reporte_ventas_detalle(date, date, uuid, text, text, text, integer, integer) to authenticated, service_role;
