-- =============================================================================
-- 82 · Búsqueda de productos precisa (Inventario y demás listas que usan buscar_productos).
--   Si algún producto coincide TAL CUAL (todas las palabras escritas están en su nombre /
--   código / categoría, también en singular: "galletas" → "galleta"), lo que solo "se parece"
--   (por trigramas: "coca" ~ "cocina", "cocido") no se muestra. Si nada coincide tal cual,
--   siguen apareciendo los parecidos (errores de tipeo: "hamburgesa", "galeta").
--   Mismo criterio que el buscador del navegador (src/lib/busqueda.ts, soloReales).
-- Redefinida desde la 72 (misma firma). IDEMPOTENTE.
-- =============================================================================

do $$ begin perform extensions.similarity('a', 'b'); end $$;

create or replace function :"schema".buscar_productos(p_q text, p_categoria text DEFAULT NULL::text, p_inactivos boolean DEFAULT false, p_solo_vendibles boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_tipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO :"schema", 'public', 'extensions'
 SET pg_trgm.word_similarity_threshold = '0.39'
AS $function$
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
  v_real text := 'true';
  v_exacto text := 'false';
  v_ids uuid[];
  v_score text;
  r jsonb;
begin
  -- Filtros fijos (igual que antes: activos, vendibles, categoría con sus subcategorías).
  v_w := format('p.empresa_id = %L', v_emp);
  if not coalesce(p_inactivos, false) then v_w := v_w || ' and p.activo'; end if;
  if coalesce(p_solo_vendibles, false) then v_w := v_w || ' and p.es_vendible'; end if;
  -- 72: tipo de producto.
  if p_tipo in ('reventa', 'menu', 'materia_prima') then
    v_w := v_w || format(' and p.tipo_producto = %L', p_tipo);
  elsif p_tipo = 'stock' then
    v_w := v_w || ' and p.tipo_producto <> ''menu''';
  elsif p_tipo = 'vendible' then
    v_w := v_w || ' and p.tipo_producto <> ''materia_prima''';
  end if;
  if p_categoria = '__sin__' then
    v_w := v_w || ' and p.categoria_principal_id is null';
  elsif p_categoria is not null then
    v_w := v_w || format(' and p.categoria_principal_id in (select c.id from categorias_productos c where c.id::text = %L or c.parent_id::text = %L)',
                         p_categoria, p_categoria);
  end if;

  if v_n > 0 then
    select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                           then format('(p.busqueda like %L or %L <%% p.busqueda)', '%' || t || '%', t)
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o),
           string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                           then format('(p.busqueda like %L or p._ws%s >= 0.4)', '%' || t || '%', o)
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o),
           string_agg(format('(case when p.busqueda_nombre ~ %L then 40 when p.busqueda_nombre ~ %L then 30 when p.busqueda like %L then 20 else 0 end)',
                             '(^|[^a-z0-9])' || t || '($|[^a-z0-9])', '(^|[^a-z0-9])' || t, '%' || t || '%'), ' + ' order by o)
             || ' + 50 * ((' || string_agg(format('p._ws%s::float8', o), ' + ' order by o) || ') / ' || v_n || '::float8)',
           string_agg(format(', word_similarity(%L, p.busqueda) as _ws%s', t, o), '' order by o),
           -- 82: ¿coincide tal cual? (cada palabra está, o su singular).
           string_agg(case when t ~ '^[a-z]{4,}s$'
                           then format('(p.busqueda like %L or p.busqueda like %L)', '%' || t || '%', '%' || left(t, -1) || '%')
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o)
      into v_cand, v_coincide, v_tok, v_ws, v_real
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
    'with hits0 as materialized (
       select p.id, p.nombre, case when %s then 1000 else %s end as _score, (%s) as _real
         from (select p.id, p.nombre, p.busqueda, p.busqueda_nombre, p.codigo_barras %s
                 from productos p where %s offset 0) p
        where %s
     ),
     hits as (select * from hits0 where _real or _score >= 1000 or not exists (select 1 from hits0 where _real or _score >= 1000)),
     pag as (select * from hits order by _score desc, nombre, id limit %s offset %s)
     select jsonb_build_object(
       ''total'', (select count(*) from hits),
       ''rows'', coalesce((select jsonb_agg(to_jsonb(x) - ''busqueda'' - ''busqueda_nombre'' - ''empresa_id'' order by pag._score desc, pag.nombre, pag.id)
                             from pag join productos x on x.id = pag.id), ''[]''::jsonb))',
    v_exacto, v_score, v_real, v_ws, v_w, coalesce(v_coincide, 'true'), v_lim, v_off) into r;
  return r;
end;
$function$;

revoke all on function :"schema".buscar_productos(text, text, boolean, boolean, integer, integer, text) from public, anon;
