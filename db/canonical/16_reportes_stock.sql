-- =============================================================================
-- Reporte "Stock mínimo" (portado de Ferretería República): productos activos que
-- controlan stock, con mínimo definido (> 0) y stock actual POR DEBAJO del mínimo
-- (mínimo 50 y stock 49 → entra; stock 50 → no). Mayor faltante primero.
-- Suma respecto de Ferretería: unidades vendidas en los últimos 30 días (urgencia) y
-- costo de reposición (faltante × costo promedio).
--   p_categoria: uuid, '__sin__' (sin categoría) o NULL (todas)
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create or replace function :"schema".reporte_stock_minimo(p_categoria text default null)
returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  r jsonb;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  with prods as (
    select p.id, p.nombre, p.sku, p.codigo_barras, p.unidad_medida, p.stock_actual, p.stock_minimo,
           p.stock_minimo - p.stock_actual as faltante,
           coalesce(p.costo_promedio, 0) as costo,
           p.categoria_principal_id, categoria_ruta(p.categoria_principal_id) as categoria_nombre, p.imagen_url
      from productos p
      left join categorias_productos c on c.id = p.categoria_principal_id
     where p.empresa_id = empresa_actual()
       and p.activo and p.controla_stock
       and coalesce(p.stock_minimo, 0) > 0
       and coalesce(p.stock_actual, 0) < p.stock_minimo
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
  ),
  vendido as (
    select vi.producto_id, sum(vi.cantidad) as unidades
      from ventas_items vi
      join ventas v on v.id = vi.venta_id
     where v.empresa_id = empresa_actual()
       and v.estado <> 'anulada'
       and v.fecha >= now() - interval '30 days'
       and vi.producto_id in (select id from prods)
     group by vi.producto_id
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'codigo_barras', p.codigo_barras,
        'unidad_medida', p.unidad_medida, 'imagen_url', p.imagen_url,
        'stock_actual', p.stock_actual, 'stock_minimo', p.stock_minimo, 'faltante', p.faltante,
        'costo', p.costo, 'costo_reposicion', p.faltante * p.costo,
        'categoria', p.categoria_nombre, 'vendido_30d', coalesce(vd.unidades, 0)
      ) order by p.faltante desc, p.nombre), '[]'::jsonb),
    'totales', jsonb_build_object(
      'productos', count(p.id),
      'sin_stock', count(p.id) filter (where p.stock_actual <= 0),
      'costo_reposicion', coalesce(sum(p.faltante * p.costo), 0),
      'sin_costo', count(p.id) filter (where p.costo = 0)
    )
  ) into r
  from prods p left join vendido vd on vd.producto_id = p.id;
  return r;
end;
$fn$;

grant execute on function :"schema".reporte_stock_minimo(text) to authenticated, service_role;
