-- =============================================================================
-- Rendimiento (medido con 20.000 productos, 5.000 clientes y 15.000 ventas).
-- Antes, la búsqueda inteligente normalizaba (unaccent) el texto de CADA fila en cada
-- consulta: buscar_productos tardaba 10-12 s, listar_cuentas_cobrar 2,9 s. Ahora:
--   · productos.busqueda / clientes.busqueda: el texto ya normalizado, guardado y
--     mantenido por triggers (también cuando se renombra una categoría)
--   · índices GIN de trigramas en esos textos y en ventas / kardex / compras / órdenes:
--     el filtro "contiene la palabra" o "se parece" (<%) usa el índice
--   · vocabulario_busqueda: las palabras reales para corregir errores de tipeo, ya
--     guardadas (antes se armaba recorriendo todos los nombres en cada búsqueda)
--   · índices que faltaban: ventas por cliente, ítems por producto, caja por cobro
-- Las funciones de búsqueda primero filtran con la palabra más larga (con índice) y
-- recién sobre esos candidatos aplican la búsqueda completa y la relevancia.
-- IDEMPOTENTE.
-- =============================================================================

-- Carga pg_trgm antes de crear funciones con "set pg_trgm.…" (si se carga a mitad de la
-- sesión, Postgres rechaza el parámetro con "permission denied").
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Productos ────────────────────────────────────────────────────────────────
alter table :"schema".productos add column if not exists busqueda text;
alter table :"schema".productos add column if not exists busqueda_nombre text;

create or replace function :"schema".texto_busqueda_producto(p_nombre text, p_sku text, p_barras text, p_categoria uuid)
returns text language sql stable security invoker set search_path = :"schema", public as $$
  select concat_ws(' ', norm(p_nombre), compacto(p_nombre), norm(p_sku), compacto(p_sku), coalesce(p_barras, ''),
                   norm(coalesce(categoria_ruta(p_categoria), '')))
$$;

create or replace function :"schema".tg_productos_busqueda()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
begin
  new.busqueda := texto_busqueda_producto(new.nombre, new.sku, new.codigo_barras, new.categoria_principal_id);
  new.busqueda_nombre := norm(new.nombre);
  return new;
end;
$fn$;
drop trigger if exists trg_productos_busqueda on :"schema".productos;
create trigger trg_productos_busqueda before insert or update of nombre, sku, codigo_barras, categoria_principal_id
  on :"schema".productos for each row execute function :"schema".tg_productos_busqueda();

-- Renombrar o mover una categoría actualiza el texto de sus productos (y los de sus subcategorías).
create or replace function :"schema".tg_categorias_busqueda()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
begin
  update productos p set busqueda = texto_busqueda_producto(p.nombre, p.sku, p.codigo_barras, p.categoria_principal_id)
   where p.categoria_principal_id = new.id
      or p.categoria_principal_id in (select c.id from categorias_productos c where c.parent_id = new.id);
  return null;
end;
$fn$;
drop trigger if exists trg_categorias_busqueda on :"schema".categorias_productos;
create trigger trg_categorias_busqueda after update of nombre, parent_id
  on :"schema".categorias_productos for each row execute function :"schema".tg_categorias_busqueda();

update :"schema".productos p
   set busqueda = :"schema".texto_busqueda_producto(p.nombre, p.sku, p.codigo_barras, p.categoria_principal_id),
       busqueda_nombre = :"schema".norm(p.nombre)
 where p.busqueda is null or p.busqueda_nombre is null;

create index if not exists productos_busqueda_trgm on :"schema".productos using gin (busqueda extensions.gin_trgm_ops);
-- Sin "fastupdate": las altas van directo al índice, no a una cola que cada búsqueda
-- recorre entera hasta que pase el autovacuum (pocas altas, muchas lecturas).
alter index :"schema".productos_busqueda_trgm set (fastupdate = off);

-- ── Clientes ─────────────────────────────────────────────────────────────────
alter table :"schema".clientes add column if not exists busqueda text;
alter table :"schema".clientes add column if not exists busqueda_nombre text;

create or replace function :"schema".tg_clientes_busqueda()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
begin
  new.busqueda := concat_ws(' ', norm(new.nombre), norm(new.razon_social), compacto(new.documento), compacto(new.ruc),
                            compacto(new.telefono), norm(new.email), norm(new.ciudad));
  new.busqueda_nombre := concat_ws(' ', norm(coalesce(new.razon_social, new.nombre)), norm(new.nombre));
  return new;
end;
$fn$;
drop trigger if exists trg_clientes_busqueda on :"schema".clientes;
create trigger trg_clientes_busqueda before insert or update of nombre, razon_social, documento, ruc, telefono, email, ciudad
  on :"schema".clientes for each row execute function :"schema".tg_clientes_busqueda();

update :"schema".clientes c
   set busqueda = concat_ws(' ', :"schema".norm(c.nombre), :"schema".norm(c.razon_social), :"schema".compacto(c.documento),
                            :"schema".compacto(c.ruc), :"schema".compacto(c.telefono), :"schema".norm(c.email), :"schema".norm(c.ciudad)),
       busqueda_nombre = concat_ws(' ', :"schema".norm(coalesce(c.razon_social, c.nombre)), :"schema".norm(c.nombre))
 where c.busqueda is null or c.busqueda_nombre is null;

create index if not exists clientes_busqueda_trgm on :"schema".clientes using gin (busqueda extensions.gin_trgm_ops);
alter index :"schema".clientes_busqueda_trgm set (fastupdate = off);

-- ── Vocabulario para corregir errores de tipeo ──────────────────────────────
create table if not exists :"schema".vocabulario_busqueda (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  palabra text not null,
  primary key (empresa_id, palabra)
);
alter table :"schema".vocabulario_busqueda enable row level security;
drop policy if exists vocab_propio on :"schema".vocabulario_busqueda;
create policy vocab_propio on :"schema".vocabulario_busqueda to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".vocabulario_busqueda to authenticated, service_role;
create index if not exists vocab_palabra_trgm on :"schema".vocabulario_busqueda using gin (palabra extensions.gin_trgm_ops);
alter index :"schema".vocab_palabra_trgm set (fastupdate = off);

create or replace function :"schema".tg_vocabulario()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into vocabulario_busqueda (empresa_id, palabra)
  select new.empresa_id, w
    from regexp_split_to_table(new.busqueda_nombre, '[^a-z0-9]+') w
   where length(w) >= 3 and w ~ '[a-z]'
  on conflict do nothing;
  return null;
end;
$fn$;
drop trigger if exists trg_productos_vocab on :"schema".productos;
create trigger trg_productos_vocab after insert or update of nombre
  on :"schema".productos for each row execute function :"schema".tg_vocabulario();
drop trigger if exists trg_clientes_vocab on :"schema".clientes;
create trigger trg_clientes_vocab after insert or update of nombre, razon_social
  on :"schema".clientes for each row execute function :"schema".tg_vocabulario();

insert into :"schema".vocabulario_busqueda (empresa_id, palabra)
select distinct x.empresa_id, w
  from (select empresa_id, busqueda_nombre as n from :"schema".productos
        union all
        select empresa_id, busqueda_nombre from :"schema".clientes where deleted_at is null) x,
       regexp_split_to_table(x.n, '[^a-z0-9]+') w
 where length(w) >= 3 and w ~ '[a-z]'
on conflict do nothing;

-- ── Índices de trigramas en los textos de búsqueda de los listados ──────────
create index if not exists ventas_busqueda_trgm on :"schema".ventas using gin (busqueda extensions.gin_trgm_ops);
create index if not exists movinv_busqueda_trgm on :"schema".movimientos_inventario using gin (busqueda extensions.gin_trgm_ops);
create index if not exists compras_busqueda_trgm on :"schema".compras using gin (busqueda extensions.gin_trgm_ops);
create index if not exists oc_busqueda_trgm on :"schema".ordenes_compra using gin (busqueda extensions.gin_trgm_ops);

-- ── Índices que faltaban ─────────────────────────────────────────────────────
create index if not exists ventas_cliente_idx on :"schema".ventas (cliente_id, fecha desc) where cliente_id is not null;
create index if not exists vitems_producto_idx on :"schema".ventas_items (producto_id);
create index if not exists caja_mov_cobro_idx on :"schema".caja_movimientos (cobro_id) where cobro_id is not null;

-- =============================================================================
-- Candidatos por texto: ids cuyo "busqueda" tiene TODAS las palabras (cada una tal cual o,
-- si tiene 4+ caracteres y alguna letra, parecida: <%). Lo mismo que coincide_busqueda
-- pero con el índice de trigramas. SQL dinámico a propósito: con las palabras como
-- literales el planificador usa el índice (con parámetros recorre la tabla entera).
create or replace function :"schema".candidatos_busqueda(p_tabla text, p_tokens text[])
returns setof uuid
language plpgsql stable security invoker
set search_path = :"schema", public, extensions
as $fn$
declare
  v_cond text;
begin
  if p_tabla not in ('productos', 'clientes') or coalesce(cardinality(p_tokens), 0) = 0 then
    return;
  end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.39', true);
  select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                         then format('(busqueda like %L or %L <%% busqueda)', '%' || t || '%', t)
                         else format('busqueda like %L', '%' || t || '%') end, ' and ')
    into v_cond
    from unnest(p_tokens) t;
  return query execute format('select id from %I where %s', p_tabla, v_cond);
end;
$fn$;
drop function if exists :"schema".candidatos_busqueda(text, text);
revoke execute on function :"schema".candidatos_busqueda(text, text[]) from public, anon, authenticated;

-- =============================================================================
-- Funciones de búsqueda sobre los textos guardados
-- =============================================================================
-- plpgsql (no sql) a propósito: así cada llamada se planifica con los valores reales (un
-- p_q vacío elimina el filtro de texto); en sql el plan genérico tardaba 4-5 veces más.
-- SECURITY DEFINER a propósito: con RLS, Postgres no deja usar los índices de trigramas
-- (LIKE y <% no son "leakproof") y recorre la tabla entera. Cada función filtra igual
-- por empresa_actual() en todas sus tablas.
create or replace function :"schema".buscar_productos(
  p_q text, p_categoria text default null, p_inactivos boolean default false,
  p_solo_vendibles boolean default false, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
begin
  return (
  with par as (
    select x.tk, trim(norm(p_q)) as q, compacto(p_q) as qc, trim(coalesce(p_q, '')) as crudo
      from (select tokens_busqueda(p_q) as tk) x
  ),
  cand as (
    select p.* from productos p, par
     where p.empresa_id = empresa_actual()
       and (coalesce(p_inactivos, false) or p.activo)
       and (not coalesce(p_solo_vendibles, false) or p.es_vendible)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or categoria_coincide(p.categoria_principal_id, p_categoria))
       and (cardinality((select tk from par)) = 0
            or p.id in (select candidatos_busqueda('productos', (select tk from par))))
  ),
  hits as (
    select c.*,
           case when par.qc <> '' and (c.codigo_barras = par.crudo or (strpos(c.busqueda, par.qc) > 0 and compacto(c.sku) = par.qc)) then 1000
                else puntaje_busqueda(c.busqueda_nombre, c.busqueda, par.q, par.tk) end as _score
      from cand c, par
     where coincide_busqueda(c.busqueda, par.tk)
  ),
  pag as (
    select * from hits order by _score desc, nombre, id
     limit least(greatest(coalesce(p_limit, 25), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_score' - 'busqueda' - 'busqueda_nombre' - 'empresa_id' order by _score desc, nombre, id) from pag), '[]'::jsonb)
  )
  );
end;
$$;

create or replace function :"schema".buscar_clientes(p_q text, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
begin
  return (
  with par as (
    select x.tk, trim(norm(p_q)) as q, compacto(p_q) as qc
      from (select tokens_busqueda(p_q) as tk) x
  ),
  cand as (
    select c.* from clientes c, par
     where c.empresa_id = empresa_actual() and c.deleted_at is null
       and (cardinality((select tk from par)) = 0
            or c.id in (select candidatos_busqueda('clientes', (select tk from par))))
  ),
  hits as (
    select b.*,
           case when length(par.qc) >= 5 and strpos(b.busqueda, par.qc) > 0 and (compacto(b.documento) = par.qc or compacto(b.ruc) = par.qc or compacto(b.telefono) = par.qc)
                then 1000 else puntaje_busqueda(b.busqueda_nombre, b.busqueda, par.q, par.tk) end as _score
      from cand b, par
     where coincide_busqueda(b.busqueda, par.tk)
  ),
  pag as (
    select * from hits order by _score desc, nombre, id
     limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_score' - 'busqueda' - 'busqueda_nombre' - 'empresa_id' order by _score desc, nombre, id) from pag), '[]'::jsonb)
  )
  );
end;
$$;

create or replace function :"schema".variantes_busqueda(p_q text)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
begin
  return (
  select coalesce(jsonb_agg(to_jsonb(v.lista) order by v.o), '[]'::jsonb)
    from (
      select x.o, array[x.t] || coalesce((
               select array_agg(m.palabra order by m.ws desc, m.s desc)
                 from (select vb.palabra, word_similarity(x.t, vb.palabra) as ws, similarity(x.t, vb.palabra) as s
                         from vocabulario_busqueda vb
                        where vb.empresa_id = empresa_actual()
                          and length(x.t) >= 4 and x.t ~ '[a-z]'
                          and x.t <% vb.palabra
                          and not exists (select 1 from vocabulario_busqueda v2
                                           where v2.empresa_id = empresa_actual() and v2.palabra like '%' || x.t || '%')
                        order by word_similarity(x.t, vb.palabra) desc, similarity(x.t, vb.palabra) desc
                        limit 3) m), '{}') as lista
        from unnest(tokens_busqueda(p_q)) with ordinality x(t, o)
    ) v
  );
end;
$$;

create or replace function :"schema".listar_clientes(
  p_q text default null, p_tipo text default null, p_condicion text default null,
  p_deuda text default null, p_inactivos boolean default false,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
begin
  return (
  with par as (
    select x.tk, trim(norm(p_q)) as q, compacto(p_q) as qc
      from (select tokens_busqueda(p_q) as tk) x
  ),
  cif as (select * from cifras_clientes()),
  base as (
    select c.id, c.nombre, c.razon_social, c.tipo_cliente, c.documento, c.ruc, c.telefono, c.email, c.direccion,
           c.ciudad, c.condicion_pago, c.plazo_dias, c.limite_credito, c.activo, c.origen, c.creado_at,
           coalesce(f.total_comprado, 0) as total_comprado, coalesce(f.compras, 0) as compras, f.ultima_compra,
           coalesce(f.deuda, 0) as deuda, coalesce(f.vencido, 0) as vencido,
           c.busqueda_nombre as _n, c.busqueda as _t
      from clientes c left join cif f on f.cliente_id = c.id, par
     where c.empresa_id = empresa_actual() and c.deleted_at is null
       and (coalesce(p_inactivos, false) or c.activo)
       and (p_tipo is null or c.tipo_cliente = p_tipo)
       and (p_condicion is null or c.condicion_pago = p_condicion)
       and (p_deuda is null or (p_deuda = 'con_deuda' and coalesce(f.deuda, 0) > 0) or (p_deuda = 'vencidos' and coalesce(f.vencido, 0) > 0))
       and (cardinality((select tk from par)) = 0
            or c.id in (select candidatos_busqueda('clientes', (select tk from par))))
  ),
  hits as (
    select b.*, case when nullif(par.q, '') is null then 0
                     when length(par.qc) >= 5 and strpos(b._t, par.qc) > 0 and (compacto(b.documento) = par.qc or compacto(b.ruc) = par.qc or compacto(b.telefono) = par.qc) then 1000
                     else puntaje_busqueda(b._n, b._t, par.q, par.tk) end as _score
      from base b, par
     where nullif(par.q, '') is null or coincide_busqueda(b._t, par.tk)
  ),
  pag as (
    select * from hits
     order by _score desc, case when nullif((select q from par), '') is null then deuda end desc nulls last, nombre, id
     limit least(greatest(coalesce(p_limit, 25), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_n' - '_t' - '_score'
                                       order by _score desc, case when nullif((select q from par), '') is null then deuda end desc nulls last, nombre, id) from pag), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
               'clientes', (select count(*) from clientes where empresa_id = empresa_actual() and deleted_at is null and activo),
               'con_deuda', count(*) filter (where f.deuda > 0),
               'a_cobrar', coalesce(sum(f.deuda), 0),
               'vencido', coalesce(sum(f.vencido), 0))
               from cif f)
  )
  );
end;
$$;

create or replace function :"schema".listar_cuentas_cobrar(
  p_q text default null, p_filtro text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
begin
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  par as (select tokens_busqueda(p_q) as tk),
  vivas as (
    select x.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, c.documento as cliente_documento,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           c.busqueda || ' ' || lower(x.numero) || ' ' || regexp_replace(lower(x.numero), '[^a-z0-9]+', '', 'g') as _t
      from cuentas_por_cobrar x join clientes c on c.id = x.cliente_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
  ),
  filtradas as (
    select v.* from vivas v, par, hoy
     where (cardinality(par.tk) = 0 or coincide_busqueda(v._t, par.tk))
       and (p_filtro is null
            or (p_filtro = 'vencidas' and v.vencimiento < hoy.d)
            or (p_filtro = 'por_vencer' and v.vencimiento >= hoy.d)
            or (p_filtro = 'semana' and v.vencimiento between hoy.d and hoy.d + 7))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_saldo', (select coalesce(sum(saldo), 0) from filtradas),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' order by f.vencimiento, f.numero)
                        from (select * from filtradas order by vencimiento, numero
                               limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb),
    'antiguedad', (select jsonb_build_object(
        'por_vencer', coalesce(sum(saldo) filter (where dias_atraso = 0), 0),
        'd1_30', coalesce(sum(saldo) filter (where dias_atraso between 1 and 30), 0),
        'd31_60', coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        'd61_90', coalesce(sum(saldo) filter (where dias_atraso between 61 and 90), 0),
        'd90', coalesce(sum(saldo) filter (where dias_atraso > 90), 0),
        'clientes', count(distinct cliente_id),
        'total', coalesce(sum(saldo), 0),
        'cobrado_mes', (select coalesce(sum(total), 0) from cobros_clientes, hoy
                         where empresa_id = empresa_actual() and anulado_at is null
                           and fecha >= (date_trunc('month', hoy.d)::timestamp at time zone 'America/Asuncion')))
      from vivas)
  )
  );
end;
$$;

grant execute on function :"schema".texto_busqueda_producto(text, text, text, uuid) to authenticated, service_role;

-- ── Reportes: una consulta por tabla en vez de una por fila ─────────────────
-- Deudores: último cobro y saldo a favor agregados de una vez (antes, 3 subconsultas por cliente).
create or replace function :"schema".reporte_deudores(p_solo_vencidos boolean default false)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  cx as (
    select x.cliente_id, x.saldo, greatest((select d from hoy) - x.vencimiento, 0) as atraso
      from cuentas_por_cobrar x where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
  ),
  por_cliente as (
    select cliente_id, sum(saldo) as deuda,
           sum(saldo) filter (where atraso > 0) as vencido,
           sum(saldo) filter (where atraso = 0) as por_vencer,
           sum(saldo) filter (where atraso between 1 and 30) as d1_30,
           sum(saldo) filter (where atraso between 31 and 60) as d31_60,
           sum(saldo) filter (where atraso between 61 and 90) as d61_90,
           sum(saldo) filter (where atraso > 90) as d90,
           max(atraso) as max_atraso, count(*) as cuentas
      from cx group by cliente_id
  ),
  ult as (
    select distinct on (k.cliente_id) k.cliente_id, k.fecha, k.total
      from cobros_clientes k
     where k.empresa_id = empresa_actual() and k.anulado_at is null
       and k.cliente_id in (select cliente_id from por_cliente)
     order by k.cliente_id, k.fecha desc
  ),
  sf as (
    select s.cliente_id, sum(s.monto) as saldo
      from saldo_favor_movimientos s
     where s.empresa_id = empresa_actual() and s.anulado_at is null
       and s.cliente_id in (select cliente_id from por_cliente)
     group by s.cliente_id
  ),
  filas as (
    select c.id, c.nombre, c.razon_social, c.documento, c.telefono, c.ciudad, c.limite_credito,
           p.deuda, coalesce(p.vencido, 0) as vencido, coalesce(p.por_vencer, 0) as por_vencer,
           coalesce(p.d1_30, 0) as d1_30, coalesce(p.d31_60, 0) as d31_60, coalesce(p.d61_90, 0) as d61_90,
           coalesce(p.d90, 0) as d90, p.max_atraso, p.cuentas,
           u.fecha as ultimo_cobro, u.total as ultimo_cobro_monto, coalesce(sf.saldo, 0) as saldo_favor
      from por_cliente p
      join clientes c on c.id = p.cliente_id
      left join ult u on u.cliente_id = p.cliente_id
      left join sf on sf.cliente_id = p.cliente_id
     where not coalesce(p_solo_vencidos, false) or coalesce(p.vencido, 0) > 0
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.vencido desc, f.deuda desc, f.nombre) from filas f), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'clientes', count(*), 'deuda', coalesce(sum(deuda), 0), 'vencido', coalesce(sum(vencido), 0),
        'por_vencer', coalesce(sum(por_vencer), 0), 'd1_30', coalesce(sum(d1_30), 0), 'd31_60', coalesce(sum(d31_60), 0),
        'd61_90', coalesce(sum(d61_90), 0), 'd90', coalesce(sum(d90), 0)) from filas)
  )
$$;

-- Stock mínimo: la categoría › subcategoría sale de un join (antes, categoria_ruta() por fila).
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
           p.categoria_principal_id,
           case when pa.id is null then c.nombre else pa.nombre || ' › ' || c.nombre end as categoria_nombre,
           p.imagen_url
      from productos p
      left join categorias_productos c on c.id = p.categoria_principal_id
      left join categorias_productos pa on pa.id = c.parent_id
     where p.empresa_id = empresa_actual()
       and p.activo and p.controla_stock
       and coalesce(p.stock_minimo, 0) > 0
       and coalesce(p.stock_actual, 0) < p.stock_minimo
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or (p.categoria_principal_id is not null and (p.categoria_principal_id::text = p_categoria or c.parent_id::text = p_categoria)))
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
