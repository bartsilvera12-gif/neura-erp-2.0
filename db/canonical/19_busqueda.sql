-- =============================================================================
-- Búsqueda INTELIGENTE (regla de oro del 2.0): todos los buscadores
--   · ignoran tildes y mayúsculas ("cafe" → "Café")
--   · aceptan palabras en cualquier orden y partes de palabra ("coca 2" → "Coca-Cola 2L")
--   · toleran errores de tipeo ("yerva" → "Yerba")
--   · buscan en todos los campos útiles y ordenan por relevancia
--     (código exacto > nombre igual > empieza con > contiene > parecido)
-- Requiere las extensiones unaccent y pg_trgm (en el schema "extensions" de Supabase).
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
select set_config('app.schema_busqueda', :'schema', false);
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Texto normalizado: sin tildes y en minúsculas. Inmutable a propósito (diccionario fijo)
-- para poder usarlo en columnas generadas.
create or replace function :"schema".norm(p text)
returns text language sql immutable parallel safe as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')))
$$;

-- Igual pero sin separadores: "COC-COL-2L" → "coccol2l", "80.012.345-6" → "800123456".
create or replace function :"schema".compacto(p text)
returns text language sql immutable parallel safe set search_path = :"schema", public as $$
  select regexp_replace(norm(p), '[^a-z0-9]+', '', 'g')
$$;

-- Palabras de lo que escribió el usuario (máx. 8).
create or replace function :"schema".tokens_busqueda(p_q text)
returns text[] language sql immutable parallel safe set search_path = :"schema", public as $$
  select coalesce((select array_agg(t order by o)
                     from regexp_split_to_table(norm(p_q), '[^a-z0-9]+') with ordinality x(t, o)
                    where t <> '' and o <= 8), '{}')
$$;

-- Cada palabra tiene que aparecer (o parecerse, si tiene 4+ caracteres y alguna letra:
-- los números —RUC, CI, teléfono, montos— no se "corrigen", tienen que coincidir).
create or replace function :"schema".coincide_busqueda(p_texto text, p_tokens text[])
returns boolean language sql immutable parallel safe as $$
  select coalesce(bool_and(p_texto like '%' || t || '%'
                           or (length(t) >= 4 and t ~ '[a-z]' and extensions.word_similarity(t, p_texto) >= 0.4)), true)
    from unnest(p_tokens) t
$$;

-- Relevancia: nombre igual > empieza con > contiene la frase > palabra entera > al inicio
-- de una palabra > contenida > parecida.
create or replace function :"schema".puntaje_busqueda(p_principal text, p_texto text, p_q text, p_tokens text[])
returns real language sql immutable parallel safe as $$
  select ((case when p_principal = p_q then 400
                when p_principal like p_q || '%' then 300
                when p_principal like '%' || p_q || '%' then 200
                else 0 end)
          + coalesce((select sum(case when p_principal ~ ('(^|[^a-z0-9])' || t || '($|[^a-z0-9])') then 40
                                      when p_principal ~ ('(^|[^a-z0-9])' || t) then 30
                                      when p_texto like '%' || t || '%' then 20
                                      else 0 end)
                             + 50 * avg(extensions.word_similarity(t, p_texto))
                        from unnest(p_tokens) t), 0))::real
$$;

-- ── Productos ────────────────────────────────────────────────────────────────
-- Busca en nombre, SKU, código de barras y categoría › subcategoría. Un SKU o código de
-- barras exacto va primero de todo (lector de códigos).
create or replace function :"schema".buscar_productos(
  p_q text, p_categoria text default null, p_inactivos boolean default false,
  p_solo_vendibles boolean default false, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with par as (
    select tokens_busqueda(p_q) as tk, trim(norm(p_q)) as q, compacto(p_q) as qc, trim(coalesce(p_q, '')) as crudo
  ),
  base as (
    select p.*,
           norm(p.nombre) as _n,
           norm(p.nombre) || ' ' || compacto(p.nombre) || ' ' || norm(p.sku) || ' ' || compacto(p.sku) || ' '
             || coalesce(p.codigo_barras, '') || ' ' || norm(coalesce(categoria_ruta(p.categoria_principal_id), '')) as _t
      from productos p
     where p.empresa_id = empresa_actual()
       and (coalesce(p_inactivos, false) or p.activo)
       and (not coalesce(p_solo_vendibles, false) or p.es_vendible)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
  ),
  hits as (
    select b.*,
           case when par.qc <> '' and (compacto(b.sku) = par.qc or b.codigo_barras = par.crudo) then 1000
                else puntaje_busqueda(b._n, b._t, par.q, par.tk) end as _score
      from base b, par
     where coincide_busqueda(b._t, par.tk)
        or (par.qc <> '' and (compacto(b.sku) = par.qc or b.codigo_barras = par.crudo))
  ),
  pag as (
    select * from hits order by _score desc, nombre, id
     limit least(greatest(coalesce(p_limit, 25), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_n' - '_t' - '_score' - 'empresa_id' order by _score desc, nombre, id) from pag), '[]'::jsonb)
  )
$$;

-- ── Clientes ─────────────────────────────────────────────────────────────────
-- Busca en nombre, razón social, CI, RUC (con o sin puntos/guion), teléfono, email y
-- ciudad. CI/RUC/teléfono exacto va primero.
create or replace function :"schema".buscar_clientes(p_q text, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with par as (
    select tokens_busqueda(p_q) as tk, trim(norm(p_q)) as q, compacto(p_q) as qc
  ),
  base as (
    select c.*,
           norm(coalesce(c.razon_social, c.nombre)) || ' ' || norm(c.nombre) as _n,
           norm(c.nombre) || ' ' || norm(coalesce(c.razon_social, '')) || ' ' || compacto(c.documento) || ' '
             || compacto(c.ruc) || ' ' || compacto(c.telefono) || ' ' || norm(coalesce(c.email, '')) || ' '
             || norm(coalesce(c.ciudad, '')) as _t
      from clientes c
     where c.empresa_id = empresa_actual() and c.deleted_at is null
  ),
  hits as (
    select b.*,
           case when length(par.qc) >= 5 and (compacto(b.documento) = par.qc or compacto(b.ruc) = par.qc or compacto(b.telefono) = par.qc)
                then 1000 else puntaje_busqueda(b._n, b._t, par.q, par.tk) end as _score
      from base b, par
     where coincide_busqueda(b._t, par.tk)
  ),
  pag as (
    select * from hits order by _score desc, nombre, id
     limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_n' - '_t' - '_score' - 'empresa_id' order by _score desc, nombre, id) from pag), '[]'::jsonb)
  )
$$;

-- ── Variantes por errores de tipeo (para listados que filtra PostgREST) ──────
-- Para cada palabra devuelve [palabra, parecidas…] tomadas del vocabulario real (nombres
-- de productos y clientes). Ej. "yerva" → ["yerva","yerba"]. Solo se buscan parecidas
-- si la palabra tiene 4+ letras y no aparece tal cual en ningún nombre.
create or replace function :"schema".variantes_busqueda(p_q text)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with vocab as (
    select distinct w
      from (select norm(nombre) as n from productos where empresa_id = empresa_actual()
            union all
            select norm(coalesce(razon_social, nombre)) from clientes where empresa_id = empresa_actual() and deleted_at is null) s,
           regexp_split_to_table(s.n, '[^a-z0-9]+') w
     where length(w) >= 3
  )
  select coalesce(jsonb_agg(to_jsonb(v.lista) order by v.o), '[]'::jsonb)
    from (
      select x.o, array[x.t] || coalesce((
               select array_agg(w order by extensions.word_similarity(x.t, w) desc)
                 from (select w from vocab
                        where length(x.t) >= 4 and x.t ~ '[a-z]'
                          and not exists (select 1 from vocab v2 where v2.w like '%' || x.t || '%')
                          and extensions.word_similarity(x.t, w) >= 0.4
                        order by extensions.word_similarity(x.t, w) desc, extensions.similarity(x.t, w) desc
                        limit 3) m), '{}') as lista
        from unnest(tokens_busqueda(p_q)) with ordinality x(t, o)
    ) v
$$;

-- ── Columna "busqueda" (texto normalizado) para los listados que filtra PostgREST ──
-- Kardex: generada a partir de sus propios datos (producto, SKU, referencia, usuario,
-- origen legible "ajuste manual" / "inventario inicial" y tipo entrada/salida).
-- (v2: se recrea si existía sin origen/tipo)
do $do$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = current_setting('app.schema_busqueda', true) and table_name = 'movimientos_inventario'
                and column_name = 'busqueda'
                and generation_expression not like '%origen%') then
    execute format('alter table %I.movimientos_inventario drop column busqueda', current_setting('app.schema_busqueda', true));
  end if;
end
$do$;
alter table :"schema".movimientos_inventario
  add column if not exists busqueda text generated always as (
    :"schema".norm(producto_nombre) || ' ' || :"schema".compacto(producto_nombre) || ' '
    || :"schema".norm(producto_sku) || ' ' || :"schema".compacto(producto_sku) || ' '
    || :"schema".norm(referencia) || ' ' || :"schema".compacto(referencia) || ' ' || :"schema".norm(usuario_nombre) || ' '
    || replace(coalesce(origen, ''), '_', ' ') || ' ' || lower(coalesce(tipo, ''))
  ) stored;

-- Ventas: número, tipo, estado, cliente, cajero y nombre/SKU de sus ítems. La mantienen
-- triggers (los ítems viven en otra tabla).
alter table :"schema".ventas add column if not exists busqueda text;

create or replace function :"schema".texto_busqueda_venta(
  p_venta uuid, p_numero text, p_tipo text, p_estado text, p_usuario text, p_cliente uuid
) returns text language sql stable security definer set search_path = :"schema", public as $$
  select concat_ws(' ',
           norm(p_numero), compacto(p_numero), norm(p_tipo), norm(p_estado), norm(p_usuario),
           (select concat_ws(' ', norm(c.nombre), norm(c.razon_social), compacto(c.ruc), compacto(c.documento))
              from clientes c where c.id = p_cliente),
           (select string_agg(norm(i.producto_nombre) || ' ' || compacto(i.producto_nombre) || ' ' || norm(i.sku) || ' ' || compacto(i.sku), ' ')
              from ventas_items i where i.venta_id = p_venta))
$$;

create or replace function :"schema".tg_ventas_busqueda()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if tg_table_name = 'ventas' then
    new.busqueda := texto_busqueda_venta(new.id, new.numero_control, new.tipo_venta, new.estado, new.usuario_nombre, new.cliente_id);
    return new;
  end if;
  update ventas v
     set busqueda = texto_busqueda_venta(v.id, v.numero_control, v.tipo_venta, v.estado, v.usuario_nombre, v.cliente_id)
   where v.id = case when tg_op = 'DELETE' then old.venta_id else new.venta_id end;
  return null;
end;
$fn$;

drop trigger if exists trg_ventas_busqueda on :"schema".ventas;
create trigger trg_ventas_busqueda before insert or update of numero_control, estado, tipo_venta, cliente_id, usuario_nombre
  on :"schema".ventas for each row execute function :"schema".tg_ventas_busqueda();
drop trigger if exists trg_ventas_items_busqueda on :"schema".ventas_items;
create trigger trg_ventas_items_busqueda after insert or update or delete
  on :"schema".ventas_items for each row execute function :"schema".tg_ventas_busqueda();

-- Completar las ventas que ya existen.
update :"schema".ventas v
   set busqueda = :"schema".texto_busqueda_venta(v.id, v.numero_control, v.tipo_venta, v.estado, v.usuario_nombre, v.cliente_id)
 where busqueda is null;

grant execute on function :"schema".norm(text) to authenticated, service_role;
grant execute on function :"schema".compacto(text) to authenticated, service_role;
grant execute on function :"schema".tokens_busqueda(text) to authenticated, service_role;
grant execute on function :"schema".coincide_busqueda(text, text[]) to authenticated, service_role;
grant execute on function :"schema".puntaje_busqueda(text, text, text, text[]) to authenticated, service_role;
grant execute on function :"schema".buscar_productos(text, text, boolean, boolean, integer, integer) to authenticated, service_role;
grant execute on function :"schema".buscar_clientes(text, integer, integer) to authenticated, service_role;
grant execute on function :"schema".variantes_busqueda(text) to authenticated, service_role;
revoke execute on function :"schema".texto_busqueda_venta(uuid, text, text, text, text, uuid) from public, anon;
