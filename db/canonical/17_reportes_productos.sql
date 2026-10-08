-- =============================================================================
-- Reporte "Productos vendidos" (portado de Ferretería República): cuánto se vendió de cada
-- producto en un período. Dos modos:
--   reporte_productos_vendidos(...)          → RESUMIDO por producto
--   reporte_productos_vendidos_detalle(...)  → DETALLADO: cada línea de venta (paginado)
-- Suma respecto de Ferretería: precio promedio, costo, ganancia y margen; stock actual;
-- y (opcional) los productos SIN ventas en el período con su stock inmovilizado.
-- Filtros: p_desde / p_hasta (día de Paraguay), p_categoria (uuid | '__sin__'), p_producto.
-- Excluye ventas anuladas. SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create or replace function :"schema".reporte_productos_vendidos(
  p_desde date, p_hasta date, p_categoria text default null, p_producto uuid default null,
  p_incluir_sin_ventas boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with lineas as (
    select vi.producto_id, vi.producto_nombre, vi.sku, vi.cantidad, vi.total_linea,
           vi.cantidad * coalesce(vi.costo_unitario, 0) as costo, coalesce(vi.costo_unitario, 0) = 0 as sin_costo,
           vi.venta_id
      from ventas_items vi
      join ventas v on v.id = vi.venta_id
      left join productos p on p.id = vi.producto_id
     where v.empresa_id = empresa_actual()
       and v.estado <> 'anulada'
       and v.fecha >= (p_desde::timestamp at time zone 'America/Asuncion')
       and v.fecha < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
       and (p_producto is null or vi.producto_id = p_producto)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
  ),
  vendidos as (
    select producto_id, max(producto_nombre) nombre, max(sku) sku, sum(cantidad) unidades,
           count(distinct venta_id) ventas, sum(total_linea) total, sum(costo) costo, bool_or(sin_costo) sin_costo
      from lineas group by producto_id
  ),
  sin_ventas as (
    select p.id as producto_id, p.nombre, p.sku
      from productos p
     where p_incluir_sin_ventas
       and p.empresa_id = empresa_actual() and p.activo and p.es_vendible
       and (p_producto is null or p.id = p_producto)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
       and not exists (select 1 from vendidos x where x.producto_id = p.id)
  ),
  todos as (
    select producto_id, nombre, sku, unidades, ventas, total, costo, sin_costo from vendidos
    union all
    select producto_id, nombre, sku, 0, 0, 0, 0, false from sin_ventas
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'producto_id', t.producto_id, 'nombre', coalesce(p.nombre, t.nombre), 'sku', coalesce(p.sku, t.sku),
        'categoria', categoria_ruta(p.categoria_principal_id), 'unidad_medida', p.unidad_medida, 'imagen_url', p.imagen_url,
        'unidades', t.unidades, 'ventas', t.ventas, 'total', t.total, 'costo', t.costo,
        'ganancia', t.total - t.costo, 'sin_costo', t.sin_costo,
        'precio_promedio', case when t.unidades > 0 then round(t.total / t.unidades) else 0 end,
        'stock_actual', p.stock_actual, 'controla_stock', p.controla_stock,
        'valor_stock', case when p.controla_stock then greatest(coalesce(p.stock_actual, 0), 0) * coalesce(p.costo_promedio, 0) else 0 end
      ) order by t.unidades desc, t.total desc, coalesce(p.nombre, t.nombre)), '[]'::jsonb),
    'totales', jsonb_build_object(
      'productos_vendidos', count(*) filter (where t.unidades > 0),
      'productos_sin_ventas', count(*) filter (where t.unidades = 0),
      'unidades', coalesce(sum(t.unidades), 0),
      'total', coalesce(sum(t.total), 0),
      'ganancia', coalesce(sum(t.total - t.costo), 0),
      'valor_stock_sin_ventas', coalesce(sum(case when t.unidades = 0 and p.controla_stock
                                                 then greatest(coalesce(p.stock_actual, 0), 0) * coalesce(p.costo_promedio, 0) end), 0)
    )
  ) into r
  from todos t
  left join productos p on p.id = t.producto_id
  left join categorias_productos c on c.id = p.categoria_principal_id;
  return r;
end;
$fn$;

create or replace function :"schema".reporte_productos_vendidos_detalle(
  p_desde date, p_hasta date, p_categoria text default null, p_producto uuid default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with lineas as (
    select vi.id, vi.venta_id, v.numero_control, v.fecha, v.tipo_venta, v.created_by, v.cliente_id,
           vi.producto_id, vi.producto_nombre, vi.sku, vi.cantidad, vi.precio_venta, vi.precio_venta_original,
           vi.total_linea, vi.total_linea - vi.cantidad * coalesce(vi.costo_unitario, 0) as ganancia
      from ventas_items vi
      join ventas v on v.id = vi.venta_id
      left join productos p on p.id = vi.producto_id
     where v.empresa_id = empresa_actual()
       and v.estado <> 'anulada'
       and v.fecha >= (p_desde::timestamp at time zone 'America/Asuncion')
       and v.fecha < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
       and (p_producto is null or vi.producto_id = p_producto)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
  ),
  pag as (
    select * from lineas order by fecha desc, id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 50000) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from lineas),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'venta_id', l.venta_id, 'numero', l.numero_control, 'fecha', l.fecha, 'tipo', l.tipo_venta,
        'producto_id', l.producto_id, 'producto', l.producto_nombre, 'sku', l.sku,
        'cantidad', l.cantidad, 'precio', l.precio_venta, 'precio_lista', l.precio_venta_original,
        'total', l.total_linea, 'ganancia', l.ganancia,
        'cajero', u.nombre, 'cliente', coalesce(c.razon_social, c.nombre)
      ) order by l.fecha desc, l.id desc)
        from pag l
        left join usuarios u on u.auth_user_id = l.created_by and u.empresa_id = empresa_actual()
        left join clientes c on c.id = l.cliente_id
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

grant execute on function :"schema".reporte_productos_vendidos(date, date, text, uuid, boolean) to authenticated, service_role;
grant execute on function :"schema".reporte_productos_vendidos_detalle(date, date, text, uuid, integer, integer) to authenticated, service_role;
