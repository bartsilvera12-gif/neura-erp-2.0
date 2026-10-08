-- =============================================================================
-- Historial de costos de compra (qué se pagó cada vez, a quién y con qué factura).
--   · movimientos_inventario.proveedor / numero_factura (texto; el módulo de
--     Proveedores puede venir después)
--   · registrar_movimiento_stock(..., p_proveedor, p_numero_factura)
--   · historial_costos_producto(p_producto_id)  → compras con variación vs la anterior
--   · proveedores_usados()                      → sugerencias para el campo Proveedor
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
alter table :"schema".movimientos_inventario add column if not exists proveedor text;
alter table :"schema".movimientos_inventario add column if not exists numero_factura text;

drop function if exists :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text);
create or replace function :"schema".registrar_movimiento_stock(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_costo_unitario numeric,
  p_origen text,
  p_referencia text,
  p_proveedor text default null,
  p_numero_factura text default null
) returns jsonb
language plpgsql
security invoker
set search_path = :"schema", public
as $fn$
declare
  v_empresa uuid := empresa_actual();
  prod record;
  v_delta numeric;
  v_nuevo numeric;
  v_costo numeric := coalesce(p_costo_unitario, 0);
  v_cpp numeric;
  v_usuario uuid;
  v_usuario_nombre text;
  v_ref text;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if p_tipo not in ('ENTRADA', 'SALIDA', 'AJUSTE') then raise exception 'Tipo de movimiento inválido'; end if;
  if p_origen not in ('compra', 'ajuste_manual') then raise exception 'Origen inválido'; end if;
  if p_cantidad is null or p_cantidad < 0 or (p_tipo <> 'AJUSTE' and p_cantidad = 0) then
    raise exception 'Cantidad inválida';
  end if;

  select * into prod from productos where id = p_producto_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not prod.controla_stock then raise exception '"%" no controla stock', prod.nombre; end if;

  v_delta := case p_tipo when 'ENTRADA' then p_cantidad when 'SALIDA' then -p_cantidad
                         else p_cantidad - prod.stock_actual end;
  if v_delta = 0 then raise exception 'El stock contado es igual al actual: no hay nada que ajustar'; end if;
  v_nuevo := prod.stock_actual + v_delta;
  if v_nuevo < 0 then
    raise exception 'Stock insuficiente de "%": hay %, no se pueden sacar %', prod.nombre, prod.stock_actual, abs(v_delta);
  end if;

  -- CPP: solo una entrada de compra con costo cambia el costo promedio.
  v_cpp := prod.costo_promedio;
  if v_delta > 0 and p_origen = 'compra' and v_costo > 0 then
    v_cpp := round(((greatest(prod.stock_actual, 0) * coalesce(prod.costo_promedio, 0)) + (v_delta * v_costo))
                   / (greatest(prod.stock_actual, 0) + v_delta), 2);
  end if;

  update productos set stock_actual = v_nuevo, costo_promedio = v_cpp, updated_at = now() where id = prod.id;

  v_ref := coalesce(nullif(btrim(p_referencia), ''),
                    case when p_tipo = 'AJUSTE' then 'Ajuste por conteo físico' when p_origen = 'compra' and p_tipo = 'ENTRADA' then 'Compra' else 'Movimiento manual' end);
  if p_tipo = 'AJUSTE' then
    v_ref := v_ref || ' (contado ' || to_char(p_cantidad, 'FM999999990.###') ||
             ', había ' || to_char(prod.stock_actual, 'FM999999990.###') || ')';
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;
  insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
                                      costo_unitario, origen, referencia, created_by, usuario_nombre,
                                      proveedor, numero_factura)
    values (v_empresa, prod.id, prod.nombre, prod.sku,
            case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end, abs(v_delta),
            case when v_costo > 0 then v_costo else coalesce(prod.costo_promedio, 0) end,
            p_origen, left(v_ref, 200), v_usuario, v_usuario_nombre,
            -- proveedor y factura solo tienen sentido en una compra
            case when p_origen = 'compra' and v_delta > 0 then nullif(left(btrim(p_proveedor), 120), '') end,
            case when p_origen = 'compra' and v_delta > 0 then nullif(left(btrim(p_numero_factura), 60), '') end);

  return jsonb_build_object('stock_anterior', prod.stock_actual, 'stock_nuevo', v_nuevo,
                            'tipo', case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end,
                            'cantidad', abs(v_delta), 'costo_promedio', v_cpp);
end;
$fn$;
grant execute on function :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text, text, text) to authenticated, service_role;

-- Compras de un producto (entradas con costo: compras e inventario inicial), la más
-- reciente primero, con la variación de costo contra la compra anterior.
create or replace function :"schema".historial_costos_producto(p_producto_id uuid, p_limit integer default 100)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with c as (
    select m.id, m.fecha, m.cantidad, m.costo_unitario as costo, m.proveedor, m.numero_factura, m.origen,
           m.referencia, m.usuario_nombre,
           lag(m.costo_unitario) over (order by m.fecha, m.id) as anterior
      from movimientos_inventario m
     where m.empresa_id = empresa_actual() and m.producto_id = p_producto_id
       and m.tipo = 'ENTRADA' and m.origen in ('compra', 'inventario_inicial')
       and coalesce(m.costo_unitario, 0) > 0
  )
  select jsonb_build_object(
    'costo_promedio', (select costo_promedio from productos where id = p_producto_id and empresa_id = empresa_actual()),
    'total_compras', (select count(*) from c),
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'fecha', x.fecha, 'cantidad', x.cantidad, 'costo', x.costo,
               'proveedor', x.proveedor, 'factura', x.numero_factura, 'origen', x.origen,
               'referencia', x.referencia, 'usuario', x.usuario_nombre,
               'variacion_pct', case when x.anterior > 0 then round((x.costo - x.anterior) / x.anterior * 100, 1) end
             ) order by x.fecha desc, x.id desc)
        from (select * from c order by fecha desc, id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x
    ), '[]'::jsonb)
  )
$$;

-- Proveedores ya cargados (los más usados primero) para sugerirlos al escribir.
create or replace function :"schema".proveedores_usados()
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(p order by n desc, p), '[]'::jsonb)
    from (select proveedor as p, count(*) as n
            from movimientos_inventario
           where empresa_id = empresa_actual() and coalesce(btrim(proveedor), '') <> ''
           group by proveedor
           order by count(*) desc
           limit 200) x
$$;

grant execute on function :"schema".historial_costos_producto(uuid, integer) to authenticated, service_role;
grant execute on function :"schema".proveedores_usados() to authenticated, service_role;
