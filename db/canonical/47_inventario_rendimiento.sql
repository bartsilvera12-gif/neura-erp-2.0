-- =============================================================================
-- Rendimiento de INVENTARIO (medido con 20.000 productos, 200.000 movimientos y 8.000
-- lotes, ver números en cada bloque). Las pantallas no cambian: mismas filas, mismo
-- orden, mismos totales. Lo que cambia:
--   · índices "de lista": la página y su conteo salen del índice (index-only) en vez de
--     recorrer y ordenar la tabla entera
--   · listar_productos_inventario / productos_pos / listar_movimientos: UNA llamada a la
--     base por pantalla (antes: 2 o más viajes en serie, o 20 lotes en paralelo para la
--     caja) y saltos de página por el índice ("deferred join": se salta por ids del
--     índice y recién después se leen las filas de la página)
--   · el kardex con búsqueda usa el índice de trigramas (SECURITY DEFINER: con RLS,
--     Postgres no deja usar índices con LIKE porque no es "leakproof")
--   · reporte_vencimientos: misma salida, sin RLS por fila y con el índice de lotes
-- Las funciones nuevas filtran SIEMPRE por empresa_actual(). Las rutas caen a la consulta
-- anterior si esta receta no está aplicada en el schema. IDEMPOTENTE.
-- =============================================================================

-- Carga pg_trgm antes de crear funciones con "set pg_trgm.…" (ver 27_rendimiento.sql).
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Índices ──────────────────────────────────────────────────────────────────
-- Lista de productos / caja / conteos por categoría: (empresa, nombre, id) es el orden de
-- todas esas pantallas; activo, es_vendible y categoría van incluidos para que el filtro y
-- el conteo no lean la tabla. stock_actual NO está en ningún índice a propósito: así cada
-- venta sigue actualizando el stock con HOT update (sin tocar índices).
create index if not exists productos_lista_idx on :"schema".productos (empresa_id, nombre, id)
  include (activo, es_vendible, categoria_principal_id);
-- "¿hay productos con lotes?" (pantalla Vencimientos): sin recorrer los productos.
create index if not exists productos_con_lotes_idx on :"schema".productos (empresa_id) where controla_lotes;

-- Kardex: página y conteo (con filtros de tipo / origen / fechas) desde el índice.
-- Reemplaza a movinv_empresa_fecha_idx (mismo prefijo: le sirve a todas sus consultas).
create index if not exists movinv_lista_idx on :"schema".movimientos_inventario (empresa_id, fecha desc, id desc)
  include (tipo, origen);
drop index if exists :"schema".movinv_empresa_fecha_idx;
-- La búsqueda del kardex con fastupdate=off (como productos/clientes en 27): sin la lista
-- de pendientes que cada búsqueda tenía que recorrer entera.
alter index if exists :"schema".movinv_busqueda_trgm set (fastupdate = off);
select gin_clean_pending_list(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema' and c.relname = 'movinv_busqueda_trgm';

-- =============================================================================
-- Lista de productos de Inventario (sin búsqueda; con búsqueda sigue buscar_productos).
--   p_categoria: null (todas) · '__sin__' (sin categoría) · uuid (la categoría y sus
--   subcategorías). Devuelve { rows, total } con las MISMAS columnas, en el mismo orden,
--   que la consulta anterior de /api/productos?paginado=1.
-- 20k productos: página 1 29 ms → <1 ms; página 400 62 ms → ~4 ms; conteo 12 → ~2 ms.
-- =============================================================================
create or replace function :"schema".listar_productos_inventario(
  p_categoria text default null, p_inactivos boolean default false,
  p_limit integer default 25, p_offset integer default 0
) returns json
language plpgsql stable security invoker
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_w text;
  v_total bigint;
  v_rows json;
begin
  if v_emp is null then return json_build_object('rows', '[]'::json, 'total', 0); end if;
  -- SQL dinámico: cada llamada se planifica con sus filtros reales (sin ORs genéricos).
  v_w := format('p.empresa_id = %L', v_emp);
  if not coalesce(p_inactivos, false) then v_w := v_w || ' and p.activo'; end if;
  if p_categoria = '__sin__' then
    v_w := v_w || ' and p.categoria_principal_id is null';
  elsif p_categoria ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    -- La categoría incluye a los productos de sus subcategorías.
    v_w := v_w || format(
      ' and p.categoria_principal_id in (select c.id from categorias_productos c where c.empresa_id = %L and (c.id = %L or c.parent_id = %L))',
      v_emp, p_categoria, p_categoria);
  end if;

  execute 'select count(*) from productos p where ' || v_w into v_total;
  -- Deferred join: los ids de la página salen del índice (empresa, nombre, id) sin leer
  -- la tabla; recién después se leen las columnas de esas filas.
  execute format(
    'select coalesce(json_agg(r), ''[]''::json) from (
       select x.id, x.nombre, x.sku, x.codigo_barras, x.categoria_principal_id, x.proveedor_principal_id,
              x.costo_promedio, x.precio_venta, x.precio_mayorista, x.precio_distribuidor, x.descuento_pct,
              x.stock_actual, x.stock_minimo, x.unidad_medida, x.tipo_iva, x.tipo_producto, x.controla_stock,
              x.controla_lotes, x.es_vendible, x.activo, x.imagen_url
         from (select p.id, p.nombre from productos p where %s order by p.nombre, p.id limit %s offset %s) k
         join productos x on x.id = k.id
        order by k.nombre, k.id) r', v_w, v_lim, v_off) into v_rows;
  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;
revoke execute on function :"schema".listar_productos_inventario(text, boolean, integer, integer) from public, anon;
grant execute on function :"schema".listar_productos_inventario(text, boolean, integer, integer) to authenticated, service_role;

-- =============================================================================
-- Catálogo de la caja (/api/productos?pos=1) en UNA llamada: antes eran 1 + N lotes de
-- 1000 filas (PostgREST corta en 1000) con OFFSET creciente. Devuelve
--   { productos: [...mismas columnas y orden que antes...], vencidos: [{producto_id, vencido}] }
-- (vencidos = lo mismo que lotes_stock_vencido(); la ruta lo une como antes).
-- p_solo_nombre → solo { nombre } (lista de nombres de la caja) y sin vencidos.
-- =============================================================================
create or replace function :"schema".productos_pos(p_solo_nombre boolean default false)
returns json
language plpgsql stable security invoker
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_prod json;
  v_venc json;
begin
  if v_emp is null then return json_build_object('productos', '[]'::json, 'vencidos', '[]'::json); end if;
  if coalesce(p_solo_nombre, false) then
    select coalesce(json_agg(r), '[]'::json) into v_prod from (
      select p.nombre from productos p
       where p.empresa_id = v_emp and p.activo and p.es_vendible
       order by p.nombre, p.id) r;
    return json_build_object('productos', v_prod, 'vencidos', '[]'::json);
  end if;
  select coalesce(json_agg(r), '[]'::json) into v_prod from (
    select p.id, p.nombre, p.sku, p.codigo_barras, p.precio_venta, p.precio_mayorista, p.precio_distribuidor,
           p.descuento_pct, p.stock_actual, p.unidad_medida, p.tipo_iva, p.controla_stock, p.imagen_url
      from productos p
     where p.empresa_id = v_emp and p.activo and p.es_vendible
     order by p.nombre, p.id) r;
  select coalesce(json_agg(v), '[]'::json) into v_venc from lotes_stock_vencido() v;
  return json_build_object('productos', v_prod, 'vencidos', v_venc);
end;
$$;
revoke execute on function :"schema".productos_pos(boolean) from public, anon;
grant execute on function :"schema".productos_pos(boolean) to authenticated, service_role;

-- =============================================================================
-- Kardex (Inventario › Movimientos y su Excel) en UNA llamada: la búsqueda inteligente
-- (variantes_busqueda: errores de tipeo) se resuelve acá adentro en vez de en un viaje
-- previo. Mismo criterio que antes: cada palabra (o alguna de sus variantes) tiene que
-- aparecer en `busqueda`; fechas en hora de Paraguay; más reciente primero.
--   → { rows, total } (total solo si p_total; el Excel no lo necesita)
-- SECURITY DEFINER a propósito (índice de trigramas, ver 27); filtra por empresa_actual().
-- 200k movimientos: página 1 + conteo 83 ms → ~10 ms; con búsqueda 470 ms → ~20 ms.
-- =============================================================================
create or replace function :"schema".listar_movimientos(
  p_q text default null, p_tipo text default null, p_origen text default null,
  p_producto uuid default null, p_desde text default null, p_hasta text default null,
  p_limit integer default 25, p_offset integer default 0, p_total boolean default true
) returns json
language plpgsql stable security definer
set search_path = :"schema", public, extensions
as $$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 5000);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_w text;
  v_cond text;
  v_total bigint;
  v_rows json;
begin
  if v_emp is null then return json_build_object('rows', '[]'::json, 'total', 0); end if;
  v_w := format('m.empresa_id = %L', v_emp);
  if p_tipo in ('ENTRADA', 'SALIDA') then v_w := v_w || format(' and m.tipo = %L', p_tipo); end if;
  if p_origen in ('inventario_inicial', 'ajuste_manual', 'venta', 'anulacion_venta', 'compra', 'anulacion_compra') then
    v_w := v_w || format(' and m.origen = %L', p_origen);
  end if;
  if p_producto is not null then v_w := v_w || format(' and m.producto_id = %L', p_producto); end if;
  if p_desde ~ '^\d{4}-\d{2}-\d{2}$' then v_w := v_w || format(' and m.fecha >= %L::timestamptz', p_desde || 'T00:00:00-03:00'); end if;
  if p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then v_w := v_w || format(' and m.fecha <= %L::timestamptz', p_hasta || 'T23:59:59.999-03:00'); end if;
  if nullif(btrim(coalesce(p_q, '')), '') is not null then
    -- Un grupo por palabra: (la palabra o alguna variante). Literales en el SQL para que
    -- el planificador use el índice de trigramas.
    select string_agg('(' || g.cond || ')', ' and ' order by g.o) into v_cond
      from (select x.o, string_agg(format('m.busqueda ilike %L', '%' || v.t || '%'), ' or ' order by v.n) as cond
              from jsonb_array_elements(variantes_busqueda(left(p_q, 200))) with ordinality x(grupo, o)
              cross join lateral jsonb_array_elements_text(x.grupo) with ordinality v(t, n)
             where v.t ~ '^[a-z0-9]+$'
             group by x.o) g;
    if v_cond is not null then v_w := v_w || ' and ' || v_cond; end if;
  end if;

  if coalesce(p_total, true) then
    execute 'select count(*) from movimientos_inventario m where ' || v_w into v_total;
  end if;
  -- Deferred join: el salto de página (OFFSET) recorre solo el índice (empresa, fecha, id).
  execute format(
    'select coalesce(json_agg(r), ''[]''::json) from (
       select x.id, x.producto_id, x.producto_nombre, x.producto_sku, x.tipo, x.cantidad, x.costo_unitario,
              x.origen, x.referencia, x.proveedor, x.numero_factura, x.usuario_nombre, x.fecha
         from (select m.id, m.fecha from movimientos_inventario m where %s
                order by m.fecha desc, m.id desc limit %s offset %s) k
         join movimientos_inventario x on x.id = k.id
        order by k.fecha desc, k.id desc) r', v_w, v_lim, v_off) into v_rows;
  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;
revoke execute on function :"schema".listar_movimientos(text, text, text, uuid, text, text, integer, integer, boolean) from public, anon;
grant execute on function :"schema".listar_movimientos(text, text, text, uuid, text, text, integer, integer, boolean) to authenticated, service_role;

-- =============================================================================
-- Vencimientos: MISMA firma y MISMA salida que 44_lotes.sql. SECURITY DEFINER con la
-- empresa en una variable (antes: RLS + empresa_actual() en cada tabla) y el "¿hay
-- productos con lotes?" por su índice.
-- =============================================================================
create or replace function :"schema".reporte_vencimientos(p_dias integer default 30, p_q text default null, p_estado text default null)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_dias integer := greatest(0, least(coalesce(p_dias, 30), 3650));
  v_q text := nullif(btrim(norm(coalesce(p_q, ''))), '');
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  with base as materialized (
    select l.id, l.producto_id, p.nombre as producto, p.sku, p.unidad_medida, l.numero, l.vencimiento,
           (l.vencimiento - v_hoy) as dias, l.cantidad,
           case when l.costo_unitario > 0 then l.costo_unitario else coalesce(p.costo_promedio, 0) end as costo,
           case when l.vencimiento < v_hoy then 'vencido' else 'por_vencer' end as estado
      from lotes l join productos p on p.id = l.producto_id and p.empresa_id = v_emp
     where l.empresa_id = v_emp and l.cantidad > 0 and l.vencimiento <= v_hoy + v_dias
  ),
  filtrado as (
    select * from base b
     where (p_estado is null or p_estado = '' or b.estado = p_estado)
       and (v_q is null or norm(b.producto) like '%' || v_q || '%' or norm(b.sku) like '%' || v_q || '%'
            or norm(b.numero) like '%' || v_q || '%')
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'dias', v_dias,
    'hay_productos_con_lotes', exists (select 1 from productos where empresa_id = v_emp and controla_lotes),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'lote_id', f.id, 'producto_id', f.producto_id, 'producto', f.producto, 'sku', f.sku, 'unidad_medida', f.unidad_medida,
        'numero', f.numero, 'vencimiento', f.vencimiento, 'dias', f.dias, 'cantidad', f.cantidad,
        'costo', f.costo, 'valor', round(f.cantidad * f.costo), 'estado', f.estado
      ) order by f.vencimiento, f.producto, f.numero) from filtrado f), '[]'::jsonb),
    -- La franja de cifras usa TODO el rango (sin el filtro de búsqueda ni de estado).
    'totales', (select jsonb_build_object(
        'vencidos_unidades', coalesce(sum(cantidad) filter (where estado = 'vencido'), 0),
        'vencidos_valor', coalesce(round(sum(cantidad * costo) filter (where estado = 'vencido')), 0),
        'vencidos_lotes', count(*) filter (where estado = 'vencido'),
        'por_vencer_unidades', coalesce(sum(cantidad) filter (where estado = 'por_vencer'), 0),
        'por_vencer_valor', coalesce(round(sum(cantidad * costo) filter (where estado = 'por_vencer')), 0),
        'por_vencer_lotes', count(*) filter (where estado = 'por_vencer')
      ) from base)
  ) into r;
  return r;
end;
$$;
revoke execute on function :"schema".reporte_vencimientos(integer, text, text) from public, anon;
grant execute on function :"schema".reporte_vencimientos(integer, text, text) to authenticated, service_role;

-- =============================================================================
-- Búsqueda de productos: MISMA firma, MISMAS filas, MISMO orden y MISMA relevancia que
-- 27_rendimiento.sql (verificado comparando ambas versiones con 20k productos). Antes,
-- por cada producto encontrado se llamaba a coincide_busqueda / puntaje_busqueda /
-- compacto(sku) (funciones SQL que no se "inlinean": ~50 µs por fila; "yogur" con 534
-- productos = 80 ms). Ahora esas mismas expresiones van escritas en la consulta con las
-- palabras como literales (sin llamadas por fila), el parecido de cada palabra se calcula
-- una sola vez por fila, los candidatos salen del índice de trigramas YA filtrados por
-- empresa, y el "SKU exacto" sale de un índice. "yogur" 86 -> 14 ms; "yerva" 109 -> ~35 ms.
-- =============================================================================
-- SKU compacto ("COC-COL-2L" → "coccol2l") indexado: el "código exacto primero" de la
-- búsqueda es una búsqueda por índice en vez de calcular compacto(sku) en cada fila.
create index if not exists productos_sku_compacto_idx on :"schema".productos (empresa_id, :"schema".compacto(sku));

create or replace function :"schema".buscar_productos(
  p_q text, p_categoria text default null, p_inactivos boolean default false,
  p_solo_vendibles boolean default false, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
declare
  v_emp uuid := empresa_actual();
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := trim(norm(p_q));
  v_qc text := compacto(p_q);
  v_crudo text := trim(coalesce(p_q, ''));
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_n integer := coalesce(cardinality(v_tk), 0);
  v_w text;
  v_cand text;
  v_coincide text;
  v_tok text;
  v_ws text := '';
  v_exacto text := 'false';
  v_ids uuid[];
  v_score text;
  r jsonb;
begin
  -- Filtros fijos (igual que antes: activos, vendibles, categoría con sus subcategorías).
  v_w := format('p.empresa_id = %L', v_emp);
  if not coalesce(p_inactivos, false) then v_w := v_w || ' and p.activo'; end if;
  if coalesce(p_solo_vendibles, false) then v_w := v_w || ' and p.es_vendible'; end if;
  if p_categoria = '__sin__' then
    v_w := v_w || ' and p.categoria_principal_id is null';
  elsif p_categoria is not null then
    -- = categoria_coincide(): la categoría o una subcategoría suya.
    v_w := v_w || format(' and p.categoria_principal_id in (select c.id from categorias_productos c where c.id::text = %L or c.parent_id::text = %L)',
                         p_categoria, p_categoria);
  end if;

  if v_n > 0 then
    -- Candidatos (= candidatos_busqueda): cada palabra tal cual o, con 4+ caracteres y
    -- alguna letra, parecida (<%). Con literales → índice de trigramas.
    select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                           then format('(p.busqueda like %L or %L <%% p.busqueda)', '%' || t || '%', t)
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o),
           -- = coincide_busqueda(p.busqueda, tokens), con el parecido ya calculado (_wsN)
           string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                           then format('(p.busqueda like %L or p._ws%s >= 0.4)', '%' || t || '%', o)
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o),
           -- = puntaje_busqueda: parte por palabra (sum(case…)) …
           string_agg(format('(case when p.busqueda_nombre ~ %L then 40 when p.busqueda_nombre ~ %L then 30 when p.busqueda like %L then 20 else 0 end)',
                             '(^|[^a-z0-9])' || t || '($|[^a-z0-9])', '(^|[^a-z0-9])' || t, '%' || t || '%'), ' + ' order by o)
             -- … + 50 * avg(word_similarity) (misma suma en el mismo orden que avg()).
             || ' + 50 * ((' || string_agg(format('p._ws%s::float8', o), ' + ' order by o) || ') / ' || v_n || '::float8)',
           -- word_similarity de cada palabra, UNA vez por fila (lo usan el filtro y la relevancia)
           string_agg(format(', word_similarity(%L, p.busqueda) as _ws%s', t, o), '' order by o)
      into v_cand, v_coincide, v_tok, v_ws
      from unnest(v_tk) with ordinality x(t, o);
    v_w := v_w || ' and ' || v_cand;
  end if;

  -- SKU o código de barras exacto primero (lector de códigos).
  if v_qc <> '' then
    select array_agg(id) into v_ids from productos where empresa_id = v_emp and compacto(sku) = v_qc;
    v_exacto := format('(p.codigo_barras = %L or (strpos(p.busqueda, %L) > 0 and p.id = any(%L::uuid[])))', v_crudo, v_qc, coalesce(v_ids, '{}'));
  end if;
  v_score := format(
    '((case when p.busqueda_nombre = %L then 400 when p.busqueda_nombre like %L then 300 when p.busqueda_nombre like %L then 200 else 0 end) + coalesce(%s, 0))::real',
    v_q, v_q || '%', '%' || v_q || '%', coalesce(v_tok, 'null'));

  execute format(
    'with hits as materialized (
       select p.id, p.nombre, case when %s then 1000 else %s end as _score
         from (select p.id, p.nombre, p.busqueda, p.busqueda_nombre, p.codigo_barras %s
                 from productos p where %s offset 0) p
        where %s
     ),
     pag as (select * from hits order by _score desc, nombre, id limit %s offset %s)
     select jsonb_build_object(
       ''total'', (select count(*) from hits),
       ''rows'', coalesce((select jsonb_agg(to_jsonb(x) - ''busqueda'' - ''busqueda_nombre'' - ''empresa_id'' order by pag._score desc, pag.nombre, pag.id)
                             from pag join productos x on x.id = pag.id), ''[]''::jsonb))',
    v_exacto, v_score, v_ws, v_w, coalesce(v_coincide, 'true'), v_lim, v_off) into r;
  return r;
end;
$$;

analyze :"schema".productos;
analyze :"schema".movimientos_inventario;
