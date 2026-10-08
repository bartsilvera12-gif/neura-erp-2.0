-- =============================================================================
-- Módulo INVENTARIO (portado de Ferretería República, re-plomado a 2.0):
--   · categorias_productos (jerárquica, nombre único por empresa sin importar mayúsculas)
--   · productos.codigo_fabrica / costo_mayorista (datos de la importación inicial)
--   · movimientos_inventario (kardex: entradas/salidas con origen y referencia)
--   · aplicar_importacion_productos(): aplica una importación (Excel o inicial) en UNA
--     transacción — PostgREST no hace transacciones multi-tabla y fila por fila por HTTP
--     serían minutos con miles de productos.
-- RLS deny-by-default + políticas por empresa (misma lógica que el core). IDEMPOTENTE.
-- =============================================================================

-- --- Categorías de productos ---
create table if not exists :"schema".categorias_productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  codigo text,
  descripcion text,
  parent_id uuid references :"schema".categorias_productos(id) on delete set null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_categorias_productos_empresa_nombre
  on :"schema".categorias_productos(empresa_id, lower(btrim(nombre)));
create index if not exists categorias_productos_empresa_idx on :"schema".categorias_productos(empresa_id);
create index if not exists categorias_productos_parent_idx on :"schema".categorias_productos(parent_id);

-- productos.categoria_principal_id ya existía como uuid suelto: ahora con FK.
alter table :"schema".productos drop constraint if exists productos_categoria_fk;
alter table :"schema".productos add constraint productos_categoria_fk
  foreign key (categoria_principal_id) references :"schema".categorias_productos(id) on delete set null;
create index if not exists productos_categoria_idx on :"schema".productos(categoria_principal_id);

-- Datos que trae la importación inicial (reportes del sistema anterior).
alter table :"schema".productos add column if not exists codigo_fabrica text;
alter table :"schema".productos add column if not exists costo_mayorista numeric;
create index if not exists productos_codigo_barras_idx on :"schema".productos(empresa_id, codigo_barras);

-- --- Kardex ---
create table if not exists :"schema".movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  -- RESTRICT: un producto con historial no se borra (se desactiva), como en Ferretería.
  producto_id uuid not null references :"schema".productos(id) on delete restrict,
  producto_nombre text,
  producto_sku text,
  tipo text not null,
  cantidad numeric not null,
  costo_unitario numeric not null default 0,
  origen text not null,
  referencia text,
  fecha timestamptz not null default now(),
  created_by uuid,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  constraint movinv_tipo_check check (tipo = any (array['ENTRADA','SALIDA'])),
  constraint movinv_cantidad_check check (cantidad > 0),
  constraint movinv_origen_check check (origen = any (array['inventario_inicial','ajuste_manual','venta','anulacion_venta','compra']))
);
create index if not exists movinv_producto_idx on :"schema".movimientos_inventario(producto_id, fecha desc);
create index if not exists movinv_empresa_fecha_idx on :"schema".movimientos_inventario(empresa_id, fecha desc);

-- --- RLS ---
alter table :"schema".categorias_productos   enable row level security;
alter table :"schema".categorias_productos   force  row level security;
alter table :"schema".movimientos_inventario enable row level security;
alter table :"schema".movimientos_inventario force  row level security;

drop policy if exists categorias_propias on :"schema".categorias_productos;
create policy categorias_propias on :"schema".categorias_productos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists movinv_propios on :"schema".movimientos_inventario;
create policy movinv_propios on :"schema".movimientos_inventario to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());

grant select, insert, update, delete on
  :"schema".categorias_productos, :"schema".movimientos_inventario
  to authenticated, service_role;

-- =============================================================================
-- aplicar_importacion_productos
--   p_filas: [{ id?, nombre, sku, codigo_barras?, codigo_fabrica?, categoria?, unidad?,
--               costo?, costo_mayorista?, precio?, stock?, stock_minimo?, tipo_iva?, activo? }]
--     id presente → UPDATE de ese producto; ausente → INSERT.
--   p_modo:
--     'excel'   → importación normal: pisa todos los campos (vacío = vacío/0), como Ferretería.
--     'inicial' → importación inicial: nunca pisa con vacío (COALESCE); pisa nombre, stock e IVA.
--   p_crear_categorias: crea las categorías que no existan (por nombre, sin importar mayúsculas).
--   Cada diferencia de stock queda en el kardex con p_origen y p_referencia.
-- Devuelve { creados, actualizados, errores, mensajes_error[], categorias_creadas,
--            movimientos_generados, unidades_entrada, unidades_salida }.
-- Una fila con error no frena las demás (SAVEPOINT por fila).
-- =============================================================================
create or replace function :"schema".aplicar_importacion_productos(
  p_filas jsonb,
  p_modo text,
  p_crear_categorias boolean,
  p_origen text,
  p_referencia text
) returns jsonb
language plpgsql
security invoker
set search_path = :"schema", public
as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_usuario uuid;
  v_usuario_nombre text;
  f jsonb;
  v_cat_nombre text;
  v_cat_id uuid;
  v_id uuid;
  v_prev numeric;
  v_stock numeric;
  v_delta numeric;
  v_costo numeric;
  v_creados int := 0;
  v_actualizados int := 0;
  v_errores int := 0;
  v_mensajes text[] := '{}';
  v_cats_creadas int := 0;
  v_movs int := 0;
  v_ent numeric := 0;
  v_sal numeric := 0;
  v_cats jsonb := '{}'::jsonb;  -- nombre MAYÚSCULAS → id
begin
  if v_empresa is null then raise exception 'Sin empresa'; end if;
  if p_modo not in ('excel', 'inicial') then raise exception 'Modo inválido'; end if;
  select u.id, u.nombre into v_usuario, v_usuario_nombre from usuarios u where u.auth_user_id = auth.uid() limit 1;

  -- Categorías existentes (activas o no) indexadas por nombre en mayúsculas.
  select coalesce(jsonb_object_agg(upper(btrim(c.nombre)), c.id), '{}'::jsonb) into v_cats
    from categorias_productos c where c.empresa_id = v_empresa;

  -- Crear las faltantes antes de tocar productos.
  if p_crear_categorias then
    for v_cat_nombre in
      select distinct upper(btrim(x->>'categoria')) from jsonb_array_elements(p_filas) x
       where coalesce(btrim(x->>'categoria'), '') <> ''
    loop
      if not v_cats ? v_cat_nombre then
        insert into categorias_productos (empresa_id, nombre, activo)
          values (v_empresa, v_cat_nombre, true) returning id into v_cat_id;
        v_cats := v_cats || jsonb_build_object(v_cat_nombre, v_cat_id);
        v_cats_creadas := v_cats_creadas + 1;
      end if;
    end loop;
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    begin
      v_cat_nombre := nullif(upper(btrim(coalesce(f->>'categoria', ''))), '');
      v_cat_id := case when v_cat_nombre is null then null else (v_cats->>v_cat_nombre)::uuid end;
      v_stock := nullif(f->>'stock', '')::numeric;
      v_costo := nullif(f->>'costo', '')::numeric;

      if nullif(f->>'id', '') is not null then
        select stock_actual into v_prev from productos
         where id = (f->>'id')::uuid and empresa_id = v_empresa for update;
        if not found then raise exception 'El producto ya no existe'; end if;

        if p_modo = 'excel' then
          update productos set
            nombre = f->>'nombre',
            sku = coalesce(nullif(f->>'sku', ''), sku),
            codigo_barras = nullif(f->>'codigo_barras', ''),
            categoria_principal_id = v_cat_id,
            unidad_medida = coalesce(nullif(f->>'unidad', ''), 'Unidad'),
            costo_promedio = coalesce(v_costo, 0),
            precio_venta = coalesce(nullif(f->>'precio', '')::numeric, 0),
            stock_actual = coalesce(v_stock, 0),
            stock_minimo = coalesce(nullif(f->>'stock_minimo', '')::numeric, 0),
            tipo_iva = coalesce(nullif(f->>'tipo_iva', ''), tipo_iva),
            activo = coalesce((f->>'activo')::boolean, true),
            updated_at = now()
          where id = (f->>'id')::uuid;
          v_stock := coalesce(v_stock, 0);
        else
          update productos set
            nombre = f->>'nombre',
            sku = coalesce(nullif(f->>'sku', ''), sku),
            codigo_barras = coalesce(nullif(f->>'codigo_barras', ''), codigo_barras),
            codigo_fabrica = coalesce(nullif(f->>'codigo_fabrica', ''), codigo_fabrica),
            categoria_principal_id = coalesce(v_cat_id, categoria_principal_id),
            unidad_medida = coalesce(nullif(f->>'unidad', ''), unidad_medida),
            costo_promedio = coalesce(v_costo, costo_promedio),
            costo_mayorista = coalesce(nullif(f->>'costo_mayorista', '')::numeric, costo_mayorista),
            precio_venta = coalesce(nullif(f->>'precio', '')::numeric, precio_venta),
            stock_actual = coalesce(v_stock, 0),
            tipo_iva = coalesce(nullif(f->>'tipo_iva', ''), tipo_iva),
            updated_at = now()
          where id = (f->>'id')::uuid;
          v_stock := coalesce(v_stock, 0);
        end if;
        v_id := (f->>'id')::uuid;
        v_actualizados := v_actualizados + 1;
      else
        v_prev := 0;
        v_stock := coalesce(v_stock, 0);
        insert into productos (
          empresa_id, nombre, sku, codigo_barras, codigo_fabrica, categoria_principal_id, unidad_medida,
          costo_promedio, costo_mayorista, precio_venta, stock_actual, stock_minimo, tipo_iva,
          activo, es_vendible, controla_stock
        ) values (
          v_empresa, f->>'nombre', f->>'sku', nullif(f->>'codigo_barras', ''), nullif(f->>'codigo_fabrica', ''),
          v_cat_id, coalesce(nullif(f->>'unidad', ''), 'Unidad'),
          coalesce(v_costo, 0), nullif(f->>'costo_mayorista', '')::numeric,
          coalesce(nullif(f->>'precio', '')::numeric, 0), v_stock,
          coalesce(nullif(f->>'stock_minimo', '')::numeric, 0),
          coalesce(nullif(f->>'tipo_iva', ''), '10%'),
          coalesce((f->>'activo')::boolean, true), true, true
        ) returning id into v_id;
        v_creados := v_creados + 1;
      end if;

      -- Kardex: la diferencia de stock queda registrada.
      v_delta := v_stock - coalesce(v_prev, 0);
      if v_delta <> 0 then
        insert into movimientos_inventario (
          empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario,
          origen, referencia, created_by, usuario_nombre
        ) values (
          v_empresa, v_id, f->>'nombre', f->>'sku',
          case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end, abs(v_delta), coalesce(v_costo, 0),
          case when nullif(f->>'id', '') is null and p_origen = 'ajuste_manual' then 'inventario_inicial' else p_origen end,
          left(p_referencia || case when nullif(f->>'id', '') is not null
                                    then ' Δ ' || to_char(v_delta, 'FMS999999990.###') || ' (prev=' || to_char(v_prev, 'FM999999990.###') || ')'
                                    else '' end, 200),
          v_usuario, v_usuario_nombre
        );
        v_movs := v_movs + 1;
        if v_delta > 0 then v_ent := v_ent + v_delta; else v_sal := v_sal + abs(v_delta); end if;
      end if;
    exception when others then
      v_errores := v_errores + 1;
      if array_length(v_mensajes, 1) is null or array_length(v_mensajes, 1) < 50 then
        v_mensajes := v_mensajes || (coalesce(f->>'fila', '') ||
          case when f ? 'fila' then ': ' else '' end ||
          coalesce(f->>'nombre', '?') || ' — ' ||
          case when sqlstate = '23505' then 'SKU o código duplicado' else left(sqlerrm, 150) end);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'creados', v_creados, 'actualizados', v_actualizados, 'errores', v_errores,
    'mensajes_error', to_jsonb(v_mensajes), 'categorias_creadas', v_cats_creadas,
    'movimientos_generados', v_movs, 'unidades_entrada', v_ent, 'unidades_salida', v_sal
  );
end;
$fn$;

grant execute on function :"schema".aplicar_importacion_productos(jsonb, text, boolean, text, text) to authenticated, service_role;

-- =============================================================================
-- registrar_movimiento_stock: movimiento MANUAL de stock (pantalla "Nuevo movimiento").
--   p_tipo 'ENTRADA' | 'SALIDA' → p_cantidad > 0 suma/resta.
--   p_tipo 'AJUSTE'             → p_cantidad = stock REAL contado; se registra la diferencia
--                                 (ENTRADA o SALIDA) contra el stock bloqueado en ese momento.
--   Una ENTRADA de compra con costo recalcula el costo promedio ponderado (CPP).
--   No deja el stock negativo. Stock + kardex en la misma transacción.
-- Devuelve { stock_anterior, stock_nuevo, tipo, cantidad, costo_promedio }.
-- =============================================================================
create or replace function :"schema".registrar_movimiento_stock(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_costo_unitario numeric,
  p_origen text,
  p_referencia text
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
                    case when p_tipo = 'AJUSTE' then 'Ajuste por conteo físico' else 'Movimiento manual' end);
  if p_tipo = 'AJUSTE' then
    v_ref := v_ref || ' (contado ' || to_char(p_cantidad, 'FM999999990.###') ||
             ', había ' || to_char(prod.stock_actual, 'FM999999990.###') || ')';
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;
  insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
                                      costo_unitario, origen, referencia, created_by, usuario_nombre)
    values (v_empresa, prod.id, prod.nombre, prod.sku,
            case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end, abs(v_delta),
            case when v_costo > 0 then v_costo else coalesce(prod.costo_promedio, 0) end,
            p_origen, left(v_ref, 200), v_usuario, v_usuario_nombre);

  return jsonb_build_object('stock_anterior', prod.stock_actual, 'stock_nuevo', v_nuevo,
                            'tipo', case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end,
                            'cantidad', abs(v_delta), 'costo_promedio', v_cpp);
end;
$fn$;

grant execute on function :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text) to authenticated, service_role;

-- ── Subcategorías (categorias_productos.parent_id) ─────────────────────────────
-- El producto apunta a la hoja: la subcategoría si tiene, si no la categoría.
-- categoria_ruta: "Bebidas › Gaseosas" para mostrar en reportes.
-- categoria_coincide: filtrar por una categoría incluye también sus subcategorías.
create or replace function :"schema".categoria_ruta(p_id uuid)
returns text language sql stable security invoker set search_path = :"schema", public as $$
  select case when pa.id is null then c.nombre else pa.nombre || ' › ' || c.nombre end
    from categorias_productos c
    left join categorias_productos pa on pa.id = c.parent_id
   where c.id = p_id
$$;

create or replace function :"schema".categoria_coincide(p_cat uuid, p_filtro text)
returns boolean language sql stable security invoker set search_path = :"schema", public as $$
  select p_cat is not null and (
    p_cat::text = p_filtro
    or exists (select 1 from categorias_productos c where c.id = p_cat and c.parent_id::text = p_filtro))
$$;

grant execute on function :"schema".categoria_ruta(uuid) to authenticated, service_role;
grant execute on function :"schema".categoria_coincide(uuid, text) to authenticated, service_role;

-- Productos activos por categoría (pantalla de Categorías en árbol). La madre suma la de
-- sus subcategorías en la pantalla, no acá.
create or replace function :"schema".conteo_productos_por_categoria()
returns table (categoria_id uuid, productos bigint)
language sql stable security invoker set search_path = :"schema", public as $$
  select categoria_principal_id, count(*)
    from productos
   where empresa_id = empresa_actual() and activo and categoria_principal_id is not null
   group by categoria_principal_id
$$;
grant execute on function :"schema".conteo_productos_por_categoria() to authenticated, service_role;

-- Color elegido por el usuario para la categoría principal (las subcategorías usan el de su
-- categoría). Vacío = el sistema asigna uno distinto a cada una.
alter table :"schema".categorias_productos add column if not exists color text;
alter table :"schema".categorias_productos drop constraint if exists chk_categoria_color;
alter table :"schema".categorias_productos add constraint chk_categoria_color check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
