-- =============================================================================
-- BÚSQUEDA DE PRODUCTOS POR CÓMO SUENA (pedido del dueño, 30-oct-2026).
--
-- buscar_productos ya tolera errores de tipeo, pero una palabra corta mal escrita no alcanza el
-- umbral de parecido ("koka" no encuentra "Coca-Cola"). Si no hay ningún resultado, se busca de
-- nuevo comparando cómo suena en español: k/c/qu, s/z/ce, b/v, h muda, ll/y, g/j, letras dobles.
-- Solo corre cuando la búsqueda normal no encontró nada: no cambia el orden de lo que ya andaba.
--
-- IDEMPOTENTE. Va después de 104.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- Espera un texto ya normalizado (minúsculas y sin tildes, como `busqueda` y tokens_busqueda).
create or replace function :"schema".fonetico(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(
                       regexp_replace(
                         replace(replace(lower(coalesce(p, '')), 'ch', 'x'), 'qu', 'k'),
                       'c([ei])', 's\1', 'g'),
                     'c', 'k', 'g'),
                   'z', 's', 'g'),
                 'v', 'b', 'g'),
               'h', '', 'g'),
             'll', 'y', 'g'),
           'g([ei])', 'j\1', 'g'),
         '([a-z])\1+', '\1', 'g')
$$;
grant execute on function :"schema".fonetico(text) to authenticated, service_role;

do $do$
declare
  c record;
  v_def text;
begin
  -- La función lleva SET pg_trgm.*: el módulo tiene que estar cargado para poder recrearla.
  perform extensions.similarity('a', 'b');
  for c in select * from (values
    ($a$  v_score text;$a$, $b$  v_score text;
  v_base text;   -- 105: los filtros fijos, sin las palabras$b$),
    ($a$    v_w := v_w || ' and ' || v_cand;$a$, $b$    v_base := v_w;
    v_w := v_w || ' and ' || v_cand;$b$),
    ($a$  return r;$a$, $b$  -- 105: sin resultados, por cómo suena.
  if v_n > 0 and coalesce((r->>'total')::integer, 0) = 0 then
    select string_agg(format('fonetico(p.busqueda) like %L', '%' || fonetico(t) || '%'), ' and ') into v_cand from unnest(v_tk) t;
    execute format(
      'with hits as (select p.id, p.nombre from productos p where %s and %s),
       pag as (select * from hits order by nombre, id limit %s offset %s)
       select jsonb_build_object(
         ''total'', (select count(*) from hits),
         ''rows'', coalesce((select jsonb_agg(to_jsonb(x) - ''busqueda'' - ''busqueda_nombre'' - ''empresa_id'' order by pag.nombre, pag.id)
                               from pag join productos x on x.id = pag.id), ''[]''::jsonb))',
      v_base, v_cand, v_lim, v_off) into r;
  end if;
  return r;$b$)
  ) x(patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'buscar_productos';
    if position(c.nuevo in v_def) > 0 then continue; end if;   -- ya aplicado
    if position(c.patron in v_def) = 0 then raise exception 'Parche 105: buscar_productos no tiene el patrón esperado (%)', left(c.patron, 60); end if;
    execute replace(v_def, c.patron, c.nuevo);
  end loop;
end;
$do$;

commit;
