-- =============================================================================
-- BÚSQUEDA PRECISA (extiende 19_busqueda.sql / 27 / 46 / 47): todos los buscadores
-- "inteligentes y totalmente precisos".
--
--   · Teléfonos en cualquier forma: "0981 555 123" = "0981555123" = "+595981555123" =
--     "981555123". tel_busqueda() da las formas (con 0, con 595, sin prefijo) y se guardan
--     en las columnas `busqueda` de clientes, presupuestos y CRM, y en el texto que busca la
--     bandeja de conversaciones (los contactos de WhatsApp vienen con 595…).
--   · RUC / CI con o sin DV: "80012345-6", "800123456", "80.012.345-6" y "80012345" son el
--     mismo (exacto → primero).
--   · Números de documento: "pre 2", "PRE-2", "PRE-000002", "2", "#2" encuentran PRE-000002
--     (q_documento + doc_igual: número sin ceros a la izquierda; el prefijo, si se escribe,
--     tiene que ser el del documento: "aj 1" no trae PE-000001). Si hay un documento con ese
--     número exacto, la lista muestra SOLO los exactos (un número suelto no trae basura que
--     solo contenga ese dígito en otro lado).
--   · Montos: "512170" / "512.170" / "Gs. 512.170" encuentran el total exacto (q_monto).
--   · Relevancia: documento exacto > monto exacto > RUC/código exacto > nombre igual >
--     empieza con > contiene > parecido (relevancia_busqueda suma +100 si todas las palabras
--     están tal cual: lo que solo se parece por un error de tipeo va siempre debajo).
--     Las listas que ordenan por fecha, con búsqueda activa ordenan por relevancia primero.
--   · Listas que filtraban con ILIKE / LIKE '%frase%' crudo (ajustes, traslados,
--     vencimientos, conciliación, ventas a crédito, presupuestos) pasan a palabras en
--     cualquier orden + errores de tipeo (coincide_busqueda).
--   · Campos que faltaban: compras / órdenes de compra suman RUC y nombre comercial del
--     proveedor; pagos a proveedores y tickets de soporte estrenan columna `busqueda`
--     (trigger + índice de trigramas); pagos/cobros suman RUC/CI del cliente.
--   · exactos_busqueda(tabla, q): para los listados que filtra PostgREST (ventas, compras,
--     órdenes de compra, órdenes de pago) devuelve los ids con documento / monto exacto para
--     ponerlos primero (o solos).
--
-- Mismo patrón de seguridad que cada función que se redefine (INVOKER / DEFINER intactos);
-- no se dan permisos de escritura nuevos a authenticated. Las columnas `busqueda` nuevas
-- las recalcula un trigger en CADA insert/update (no se pueden falsear desde afuera).
-- Redefine: tg_clientes_busqueda, buscar_clientes, listar_clientes (27/28/46), chat_bandeja,
-- chat_finalizadas (36/38), crm_candidatos (34), proyectos_candidatos (39),
-- listar_presupuestos (53), listar_gastos (52), listar_ajustes, listar_traslados (50),
-- reporte_vencimientos (44/47/50), listar_cobros_pendientes (43), reporte_ventas_credito (51),
-- listar_cuentas_cobrar (25/27), listar_cuentas_pagar (42/48), pagos_cobrados y
-- pagos_facturas_pendientes (48).
-- IDEMPOTENTE. Va después de todas las anteriores (19 a 57): si se vuelve a correr alguna de
-- esas, correr 58 después.
-- =============================================================================

-- Carga pg_trgm antes de crear funciones con "set pg_trgm.…" (si se carga a mitad de la
-- sesión, Postgres rechaza el parámetro con "permission denied"; ver 27).
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Ayudantes ────────────────────────────────────────────────────────────────

-- Formas de búsqueda de uno o varios teléfonos ("0981 555 123 / 021 600 100"): cada número
-- en dígitos y, si empieza con 0 o con 595, también en las otras formas.
create or replace function :"schema".tel_busqueda(p text)
returns text language sql immutable parallel safe set search_path = :"schema", public as $$
  select nullif(array_to_string(array(
           select v
             from (select regexp_replace(t, '[^0-9]', '', 'g') as d
                     from regexp_split_to_table(coalesce(p, ''), '[/;,]|\s[yo]\s') t) x,
                  lateral unnest(case
                    when length(d) < 7 or length(d) > 15 then array[d]
                    when d like '595%' then array[d, '0' || substr(d, 4), substr(d, 4)]
                    when d like '0%' then array[d, '595' || substr(d, 2), substr(d, 2)]
                    else array[d] end) v
            where v <> ''), ' '), '')
$$;

-- Lo escrito como número de documento: {letras del prefijo, número sin ceros} o null.
-- "PRE-000002" → {pre,2}; "pre 2" → {pre,2}; "#15" / "n° 15" → {"",15} / {n,15}; "2" → {"",2}.
create or replace function :"schema".q_documento(p_q text)
returns text[] language sql immutable parallel safe set search_path = :"schema", public as $$
  select regexp_match(btrim(norm(p_q)), '^#?\s*([a-z]{0,12})[^a-z0-9]*0*([0-9]{1,15})$')
$$;

-- ¿El documento p_numero ("PRE-000002", "VTA-005047", 15) es el número escrito (q_documento)?
-- El prefijo escrito tiene que ser el del documento (o al revés: "p", "pre", "presupuesto");
-- "n", "nro", "num", "numero" o nada no se exigen.
create or replace function :"schema".doc_igual(p_numero text, p_q text[])
returns boolean language sql immutable parallel safe set search_path = :"schema", public as $$
  select coalesce(p_q is not null and d is not null and d[2] = p_q[2]
                  and (p_q[1] in ('', 'n', 'nro', 'num', 'numero')
                       or (d[1] <> '' and (d[1] like p_q[1] || '%' or p_q[1] like d[1] || '%'))), false)
    from (select regexp_match(lower(btrim(coalesce(p_numero, ''))), '^([a-z]*)[^a-z0-9]*0*([0-9]{1,15})$') as d) x
$$;

-- ¿Lo escrito es un número de ESTA serie de documentos? ("pre 9" contra PRE-000001: sí; "rosa 2"
-- o "2" solos: no). Con una serie reconocida la búsqueda es solo por número: si no existe ese
-- número, no aparece nada (en vez de todo lo que tenga "pre" y un 9 en algún lado).
create or replace function :"schema".doc_serie(p_numero text, p_q text[])
returns boolean language sql immutable parallel safe as $$
  select coalesce(p_q is not null and p_q[1] not in ('', 'n', 'nro', 'num', 'numero') and d <> ''
                  and (d like p_q[1] || '%' or p_q[1] like d || '%'), false)
    from (select lower(substring(btrim(coalesce(p_numero, '')) from '^[A-Za-z]+')) as d) x
$$;

-- Lo escrito como monto: "512170", "512.170", "Gs. 512.170", "12,50" → número; si no, null.
create or replace function :"schema".q_monto(p_q text)
returns numeric language sql immutable parallel safe as $$
  select case when t ~ '^([0-9]{1,3}(\.[0-9]{3})+|[0-9]{1,15})(,[0-9]{1,2})?$'
              then replace(replace(t, '.', ''), ',', '.')::numeric end
    from (select regexp_replace(lower(btrim(coalesce(p_q, ''))), '^(gs\.?|₲|\$|usd)\s*', '') as t) x
$$;

-- RUC / CI exacto: con o sin puntos, guion y DV ("80012345-6" = "800123456" = "80012345").
create or replace function :"schema".ruc_igual(p_ruc text, p_qc text)
returns boolean language sql immutable parallel safe set search_path = :"schema", public as $$
  select coalesce(length(p_qc) >= 5 and p_ruc is not null
                  and (compacto(p_ruc) = p_qc or compacto(split_part(p_ruc, '-', 1)) = p_qc), false)
$$;

-- Relevancia = puntaje_busqueda + 100 si TODAS las palabras están tal cual (sin depender
-- del parecido): una coincidencia real va siempre antes que una por error de tipeo.
create or replace function :"schema".relevancia_busqueda(p_principal text, p_texto text, p_q text, p_tokens text[])
returns real language sql immutable parallel safe set search_path = :"schema", public as $$
  select (puntaje_busqueda(coalesce(p_principal, ''), coalesce(p_texto, ''), coalesce(p_q, ''), p_tokens)
          + case when coalesce((select bool_and(coalesce(p_texto, '') like '%' || t || '%') from unnest(p_tokens) t), true)
                 then 100 else 0 end)::real
$$;

-- ── Clientes: teléfonos en todas sus formas en `busqueda` ────────────────────
create or replace function :"schema".tg_clientes_busqueda()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  new.busqueda := concat_ws(' ', norm(new.nombre), norm(new.razon_social), norm(new.nombre_contacto),
                            compacto(new.documento), compacto(new.ruc), tel_busqueda(new.telefono), tel_busqueda(new.telefono_secundario),
                            norm(new.email), norm(new.email_secundario), norm(new.ciudad),
                            'cl' || left(replace(new.id::text, '-', ''), 8));
  new.busqueda_nombre := concat_ws(' ', norm(coalesce(new.razon_social, new.nombre)), norm(new.nombre));
  return new;
end;
$fn$;

-- Completar los que ya existen (sin disparar historial / vocabulario: solo cambia el texto).
set session_replication_role = replica;
update :"schema".clientes c
   set busqueda = concat_ws(' ', :"schema".norm(c.nombre), :"schema".norm(c.razon_social), :"schema".norm(c.nombre_contacto),
                            :"schema".compacto(c.documento), :"schema".compacto(c.ruc), :"schema".tel_busqueda(c.telefono),
                            :"schema".tel_busqueda(c.telefono_secundario), :"schema".norm(c.email), :"schema".norm(c.email_secundario),
                            :"schema".norm(c.ciudad), 'cl' || left(replace(c.id::text, '-', ''), 8))
 where c.busqueda is distinct from concat_ws(' ', :"schema".norm(c.nombre), :"schema".norm(c.razon_social), :"schema".norm(c.nombre_contacto),
                            :"schema".compacto(c.documento), :"schema".compacto(c.ruc), :"schema".tel_busqueda(c.telefono),
                            :"schema".tel_busqueda(c.telefono_secundario), :"schema".norm(c.email), :"schema".norm(c.email_secundario),
                            :"schema".norm(c.ciudad), 'cl' || left(replace(c.id::text, '-', ''), 8));
set session_replication_role = origin;

-- Buscador de clientes (selectores, caja, presupuestos, agenda): CI / RUC (con o sin DV),
-- teléfono (cualquier forma) o código exacto → primero.
create or replace function :"schema".buscar_clientes(p_q text, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = '0.39'
as $$
declare
  v_qc text := compacto(p_q);
  v_tels text[] := case when compacto(p_q) ~ '^[0-9]{7,15}$' then string_to_array(tel_busqueda(compacto(p_q)), ' ') else '{}' end;
begin
  return (
  with par as (
    select x.tk, trim(norm(p_q)) as q, v_qc as qc
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
           case when length(par.qc) >= 5 and strpos(b.busqueda, par.qc) > 0
                     and (ruc_igual(b.documento, par.qc) or ruc_igual(b.ruc, par.qc) or compacto(b.codigo) = par.qc
                          or regexp_replace(coalesce(b.telefono, ''), '[^0-9]', '', 'g') = any(v_tels)
                          or regexp_replace(coalesce(b.telefono_secundario, ''), '[^0-9]', '', 'g') = any(v_tels))
                then 1000 else relevancia_busqueda(b.busqueda_nombre, b.busqueda, par.q, par.tk) end as _score
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

-- Lista de clientes (receta 46) con el mismo criterio de "exacto": RUC/CI con o sin DV,
-- teléfono en cualquier forma, código. Resto idéntico.
create or replace function :"schema".listar_clientes(
  p_q text default null, p_tipo text default null, p_condicion text default null, p_deuda text default null,
  p_estado text default 'activos', p_origen text default null, p_categoria uuid default null,
  p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = '0.39'
as $$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_q text := trim(coalesce(norm(p_q), ''));
  v_tk text[] := coalesce(tokens_busqueda(p_q), '{}'::text[]);
  v_qc text := coalesce(compacto(p_q), '');
  v_tels text[] := case when compacto(p_q) ~ '^[0-9]{7,15}$' then string_to_array(tel_busqueda(compacto(p_q)), ' ') else '{}' end;
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_f text;
  v_total bigint := 0;
  v_ids uuid[] := '{}';
  v_cand uuid[];
  v_src text;
  v_where text;
  v_coinc text; v_pt text; v_ws text; v_punt text; v_lit text;
  v_rows jsonb;
  v_kpis jsonb;
  k record;
  v_solo_estado boolean := p_tipo is null and p_condicion is null and p_origen is null
                             and p_categoria is null and p_deuda is null;
begin
  v_f := format('c.empresa_id = %L and c.deleted_at is null', v_emp);
  case coalesce(p_estado, 'todos')
    when 'todos' then null;
    when 'activos' then v_f := v_f || ' and c.activo';
    when 'inactivos' then v_f := v_f || ' and not c.activo and c.baja_at is null';
    when 'baja' then v_f := v_f || ' and c.baja_at is not null';
    else v_f := v_f || ' and false';
  end case;
  if p_tipo is not null then v_f := v_f || format(' and c.tipo_cliente = %L', p_tipo); end if;
  if p_condicion is not null then v_f := v_f || format(' and c.condicion_pago = %L', p_condicion); end if;
  if p_origen is not null then v_f := v_f || format(' and c.origen = %L', p_origen); end if;
  if p_categoria is not null then v_f := v_f || format(' and c.categoria_id = %L', p_categoria); end if;
  if p_deuda = 'con_deuda' then
    v_f := v_f || format(' and exists (select 1 from cuentas_por_cobrar x where x.empresa_id = %L and x.cliente_id = c.id and x.estado in (''pendiente'', ''parcial'') and x.saldo > 0)', v_emp);
  elsif p_deuda = 'vencidos' then
    v_f := v_f || format(' and exists (select 1 from cuentas_por_cobrar x where x.empresa_id = %L and x.cliente_id = c.id and x.estado in (''pendiente'', ''parcial'') and x.saldo > 0 and x.vencimiento < %L::date)', v_emp, v_hoy);
  elsif p_deuda is not null then
    v_f := v_f || ' and false';
  end if;

  select count(*) as n, count(*) filter (where c.activo) as a, count(*) filter (where c.tipo_cliente = 'empresa') as e,
         count(*) filter (where not c.activo and c.baja_at is null) as i, count(*) filter (where c.baja_at is not null) as b
    into k
    from clientes c where c.empresa_id = v_emp and c.deleted_at is null;
  select jsonb_build_object('clientes', k.n, 'activos', k.a, 'empresas', k.e,
                            'con_deuda', count(distinct x.cliente_id) filter (where x.saldo > 0),
                            'a_cobrar', coalesce(sum(x.saldo), 0),
                            'vencido', coalesce(sum(x.saldo) filter (where x.vencimiento < v_hoy), 0))
    into v_kpis
    from cuentas_por_cobrar x
   where x.empresa_id = v_emp and x.estado in ('pendiente', 'parcial')
     and x.cliente_id not in (select e.id from clientes e where e.empresa_id = v_emp and e.deleted_at is not null);

  if v_emp is not null then
    if v_q = '' then
      if v_solo_estado then
        v_total := case coalesce(p_estado, 'todos') when 'todos' then k.n when 'activos' then k.a
                        when 'inactivos' then k.i when 'baja' then k.b else 0 end;
      else
        execute 'select count(*) from clientes c where ' || v_f into v_total;
      end if;
      if v_total > v_off then
        execute 'select array(select c.id from clientes c where ' || v_f || ' order by c.creado_at desc, c.id limit $1 offset $2)'
          into v_ids using v_lim, v_off;
      end if;
    else
      v_src := 'clientes c';
      v_where := v_f;
      if cardinality(v_tk) > 0 then
        v_cand := array(select candidatos_busqueda('clientes', v_tk));
        v_src := '(select c.* from unnest($1) as u(id) join clientes c on c.id = u.id where ' || v_f || ' offset 0) c';
        v_where := 'true';
      end if;
      select coalesce(string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                                      then format('(c.busqueda like %L or extensions.word_similarity(%L, c.busqueda) >= 0.4)', '%' || t || '%', t)
                                      else format('c.busqueda like %L', '%' || t || '%') end, ' and ' order by o), 'true'),
             string_agg(format('(case when c.busqueda_nombre ~ %L then 40 when c.busqueda_nombre ~ %L then 30 when c.busqueda like %L then 20 else 0 end)',
                               '(^|[^a-z0-9])' || t || '($|[^a-z0-9])', '(^|[^a-z0-9])' || t, '%' || t || '%'), ' + ' order by o),
             string_agg(format('extensions.word_similarity(%L, c.busqueda)::float8', t), ' + ' order by o),
             -- todas las palabras tal cual → +100 (lo parecido va debajo)
             coalesce(string_agg(format('c.busqueda like %L', '%' || t || '%'), ' and ' order by o), 'true')
        into v_coinc, v_pt, v_ws, v_lit
        from unnest(v_tk) with ordinality x(t, o);
      v_punt := format('(case when c.busqueda_nombre = %L then 400 when c.busqueda_nombre like %L then 300 when c.busqueda_nombre like %L then 200 else 0 end',
                       v_q, v_q || '%', '%' || v_q || '%')
                || case when cardinality(v_tk) > 0
                        then format(' + ((%s)::bigint + 50 * ((%s) / %s::float8)) + (case when %s then 100 else 0 end)', v_pt, v_ws, cardinality(v_tk), v_lit) else '' end
                || ')::real';
      execute format('with h as materialized (
                 select c.id, c.creado_at,
                        case when %L::boolean and strpos(c.busqueda, %L) > 0
                                  and (regexp_replace(lower(coalesce(c.documento, '''')), ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(lower(coalesce(c.ruc, '''')), ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(lower(split_part(coalesce(c.documento, ''''), ''-'', 1)), ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(lower(split_part(coalesce(c.ruc, ''''), ''-'', 1)), ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(lower(coalesce(c.codigo, '''')), ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(coalesce(c.telefono, ''''), ''[^0-9]'', '''', ''g'') = any(%L::text[])
                                       or regexp_replace(coalesce(c.telefono_secundario, ''''), ''[^0-9]'', '''', ''g'') = any(%L::text[])) then 1000
                             else %s end as _score
                   from %s where %s and %s)
               select (select count(*) from h),
                      array(select id from h order by _score desc, creado_at desc, id limit $2 offset $3)',
                     length(v_qc) >= 5, v_qc, v_qc, v_qc, v_qc, v_qc, v_qc, v_tels, v_tels, v_punt, v_src, v_where, v_coinc)
        into v_total, v_ids using v_cand, v_lim, v_off;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) - '_ord' order by r._ord), '[]'::jsonb) into v_rows
    from (
      select u._ord, c.id, c.codigo, c.nombre, c.razon_social, c.tipo_cliente, c.documento, c.ruc, c.nombre_contacto, c.telefono,
             c.email, c.direccion, c.ciudad, c.condicion_pago, c.plazo_dias, c.limite_credito, c.activo, c.origen,
             c.creado_at, c.baja_at, c.moneda_preferida,
             c.categoria_id, cat.nombre as categoria_nombre, cat.color as categoria_color,
             coalesce(uv.nombre, c.vendedor_texto) as vendedor_nombre, uc.nombre as creado_por_nombre,
             (select string_agg(s.plan_nombre, ', ' order by s.created_at) from suscripciones s
               where s.cliente_id = c.id and s.estado = 'activa' and s.empresa_id = v_emp) as suscripcion_activa,
             coalesce(v.total_comprado, 0) as total_comprado, coalesce(v.compras, 0) as compras, v.ultima_compra,
             coalesce(d.deuda, 0) as deuda, coalesce(d.vencido, 0) as vencido
        from unnest(v_ids) with ordinality u(id, _ord)
        join clientes c on c.id = u.id
        left join cliente_categorias cat on cat.id = c.categoria_id
        left join usuarios uv on uv.id = c.vendedor_usuario_id
        left join usuarios uc on uc.id = c.created_by
        left join lateral (
          select sum(x.total) as total_comprado, count(*) as compras, max(x.fecha) as ultima_compra
            from ventas x where x.cliente_id = c.id and x.empresa_id = v_emp and x.estado <> 'anulada') v on true
        left join lateral (
          select sum(x.saldo) as deuda, sum(x.saldo) filter (where x.vencimiento < v_hoy) as vencido
            from cuentas_por_cobrar x where x.cliente_id = c.id and x.empresa_id = v_emp and x.estado in ('pendiente', 'parcial')) d on true
    ) r;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'kpis', v_kpis);
end;
$$;

-- ── CRM: teléfono del prospecto en todas sus formas ──────────────────────────
-- (trg_crm_prospectos arma `busqueda`; este corre después —orden alfabético— y suma las formas)
create or replace function :"schema".tg_crm_prospectos_tel()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  new.busqueda := concat_ws(' ', new.busqueda, tel_busqueda(new.telefono));
  return new;
end;
$fn$;
drop trigger if exists trg_crm_prospectos_tel on :"schema".crm_prospectos;
create trigger trg_crm_prospectos_tel before insert or update on :"schema".crm_prospectos
  for each row execute function :"schema".tg_crm_prospectos_tel();
set session_replication_role = replica;
update :"schema".crm_prospectos p
   set busqueda = concat_ws(' ', p.busqueda, :"schema".tel_busqueda(p.telefono))
 where :"schema".tel_busqueda(p.telefono) is not null
   and strpos(coalesce(p.busqueda, ''), split_part(:"schema".tel_busqueda(p.telefono), ' ', 2)) = 0;
set session_replication_role = origin;

-- Candidatos del CRM y de Proyectos: un número de control exacto ("pry 12", "PRY-00012",
-- "12") trae SOLO ese (o nada, si es de la serie y no existe); si no, como antes.
create or replace function :"schema".crm_candidatos(p_q text)
returns setof uuid
language plpgsql stable
set search_path = :"schema", public, extensions
as $$
declare
  v_cond text;
  v_doc text[] := q_documento(p_q);
begin
  if coalesce(trim(p_q), '') = '' then return; end if;
  if v_doc is not null and exists (select 1 from crm_prospectos where empresa_id = empresa_actual()
                                      and (doc_igual(numero_control, v_doc) or doc_serie(numero_control, v_doc))) then
    return query select id from crm_prospectos where empresa_id = empresa_actual() and doc_igual(numero_control, v_doc);
    return;
  end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.39', true);
  select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                         then format('(busqueda like %L or %L <%% busqueda)', '%' || t || '%', t)
                         else format('busqueda like %L', '%' || t || '%') end, ' and ')
    into v_cond from unnest(tokens_busqueda(p_q)) t;
  if v_cond is null then return; end if;
  return query execute format('select id from crm_prospectos where empresa_id = %L and %s', empresa_actual(), v_cond);
end;
$$;

create or replace function :"schema".proyectos_candidatos(p_q text)
returns setof uuid
language plpgsql stable
set search_path = :"schema", public, extensions
as $$
declare
  v_cond text;
  v_doc text[] := q_documento(p_q);
begin
  if coalesce(trim(p_q), '') = '' then return; end if;
  if v_doc is not null and exists (select 1 from proyectos where empresa_id = empresa_actual()
                                      and (doc_igual(numero, v_doc) or doc_serie(numero, v_doc))) then
    return query select id from proyectos where empresa_id = empresa_actual() and doc_igual(numero, v_doc);
    return;
  end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.39', true);
  select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                         then format('(busqueda like %L or %L <%% busqueda)', '%' || t || '%', t)
                         else format('busqueda like %L', '%' || t || '%') end, ' and ')
    into v_cond from unnest(tokens_busqueda(p_q)) t;
  if v_cond is null then return; end if;
  return query execute format('select id from proyectos where empresa_id = %L and %s', empresa_actual(), v_cond);
end;
$$;

-- ── Conversaciones: el teléfono del contacto en todas sus formas ─────────────
create or replace function :"schema".chat_bandeja(p_vista text default 'mias', p_q text default null, p_asignado uuid default null,
  p_canal uuid default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limite integer default 40)
returns jsonb
language plpgsql stable
set search_path = :"schema", public, extensions
as $$
declare v_yo uuid;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;
  return (
  with base as (
    select c.id, c.estado, c.asignado_id, c.canal_id, c.prioridad, c.ultimo_mensaje_at, c.ultimo_preview, c.ultimo_from_me,
           c.ultimo_tipo, c.no_leidos, c.ventana_expira_at, c.etiquetas, c.sla_vence_at, c.primera_respuesta_at, c.espera_motivo,
           k.id as contacto_id, k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.avatar_url, k.cliente_id, k.prospecto_id,
           ca.tipo as canal_tipo, ca.nombre as canal_nombre, u.nombre as asignado_nombre
      from chat_conversaciones c
      join chat_contactos k on k.id = c.contacto_id
      join chat_canales ca on ca.id = c.canal_id
      left join usuarios u on u.id = c.asignado_id
     where c.empresa_id = empresa_actual()
       and case coalesce(p_vista, 'mias')
             when 'mias' then c.asignado_id = v_yo and c.estado <> 'cerrada'
             when 'sin_asignar' then c.asignado_id is null and c.estado <> 'cerrada'
             when 'cerradas' then c.estado = 'cerrada'
             else c.estado <> 'cerrada' end
       and (p_asignado is null or c.asignado_id = p_asignado)
       and (p_canal is null or c.canal_id = p_canal)
       and (p_cursor_at is null or (c.ultimo_mensaje_at, c.id) < (p_cursor_at, p_cursor_id))
       and (coalesce(trim(p_q), '') = '' or coincide_busqueda(
              concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), norm(c.ultimo_preview), array_to_string(c.etiquetas, ' ')),
              tokens_busqueda(p_q)))
     order by c.ultimo_mensaje_at desc nulls last, c.id desc
     limit least(greatest(coalesce(p_limite, 40), 1), 100)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(b order by b.ultimo_mensaje_at desc nulls last, b.id desc) from base b), '[]'::jsonb),
    'contadores', (select jsonb_build_object(
        'mias', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada'),
        'mias_no_leidas', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada' and no_leidos > 0),
        'sin_asignar', count(*) filter (where asignado_id is null and estado <> 'cerrada'),
        'abiertas', count(*) filter (where estado <> 'cerrada'))
      from chat_conversaciones where empresa_id = empresa_actual() and estado <> 'cerrada')
  ));
end;
$$;

create or replace function :"schema".chat_finalizadas(p_desde date default null, p_hasta date default null, p_asesor uuid default null,
  p_estado uuid default null, p_q text default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limite integer default 50)
returns jsonb
language sql stable
set search_path = :"schema", public
as $$
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(r order by r.cerrada_at desc, r.id desc), '[]'::jsonb))
    from (select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
                 k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
                 u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal
            from chat_conversaciones c
            join chat_contactos k on k.id = c.contacto_id
            join chat_canales ca on ca.id = c.canal_id
            left join usuarios u on u.id = c.cerrada_por
            left join tipificacion_familias f on f.id = c.cierre_familia_id
            left join tipificacion_estados e on e.id = c.cierre_estado_id
           where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
             and (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
             and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
             and (p_asesor is null or c.cerrada_por = p_asesor)
             and (p_estado is null or c.cierre_estado_id = p_estado)
             and (p_cursor_at is null or (c.cerrada_at, c.id) < (p_cursor_at, p_cursor_id))
             and (coalesce(trim(p_q), '') = '' or coincide_busqueda(
                    concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), norm(c.cierre_observacion), norm(f.nombre), norm(e.nombre),
                              norm(u.nombre), array_to_string(c.etiquetas, ' ')),
                    tokens_busqueda(p_q)))
           order by c.cerrada_at desc, c.id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 200)) r
$$;

-- ── Presupuestos ─────────────────────────────────────────────────────────────
-- `busqueda` la arma presupuesto_recalcular (53); acá se le suman las formas del teléfono.
create or replace function :"schema".tg_presupuestos_busqueda_tel()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare v text := tel_busqueda(new.cliente_telefono);
begin
  if v is not null and strpos(coalesce(new.busqueda, ''), v) = 0 then
    new.busqueda := concat_ws(' ', new.busqueda, v);
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_presupuestos_busqueda_tel on :"schema".presupuestos;
create trigger trg_presupuestos_busqueda_tel before insert or update of busqueda, cliente_telefono on :"schema".presupuestos
  for each row execute function :"schema".tg_presupuestos_busqueda_tel();
set session_replication_role = replica;
update :"schema".presupuestos p
   set busqueda = concat_ws(' ', p.busqueda, :"schema".tel_busqueda(p.cliente_telefono))
 where :"schema".tel_busqueda(p.cliente_telefono) is not null
   and strpos(coalesce(p.busqueda, ''), :"schema".tel_busqueda(p.cliente_telefono)) = 0;
set session_replication_role = origin;

-- Lista: palabras en cualquier orden + errores de tipeo (antes LIKE ALL, sin tolerancia),
-- número de presupuesto exacto (solo los exactos), monto exacto, RUC exacto y relevancia.
create or replace function :"schema".listar_presupuestos(
  p_q text default null, p_estado text default null, p_cliente uuid default null, p_vendedor uuid default null,
  p_desde date default null, p_hasta date default null, p_pagina integer default 1, p_por_pagina integer default 25)
returns jsonb
language plpgsql stable
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion'))::date;
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_solo boolean := false;
  v_lim integer := least(greatest(coalesce(p_por_pagina, 25), 5), 100);
  v_off integer := (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_por_pagina, 25), 5), 100);
  v_out jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if v_doc is not null then
    v_solo := exists (select 1 from presupuestos p where p.empresa_id = v_emp and (doc_igual(p.numero, v_doc) or doc_serie(p.numero, v_doc)));
  end if;

  with base as (
    select p.*, presupuesto_estado_efectivo(p.estado, p.valido_hasta) as estado_ef,
           case when not v_busca then 0
                when doc_igual(p.numero, v_doc) then 3000
                when p.total = v_monto then 2000
                when ruc_igual(p.cliente_ruc, v_qc) then 1500
                else relevancia_busqueda(norm(p.cliente_nombre), p.busqueda, v_q, v_tk) end as _score
      from presupuestos p
     where p.empresa_id = v_emp
       and (p_cliente is null or p.cliente_id = p_cliente)
       and (p_vendedor is null or p.vendedor_id = p_vendedor)
       and (p_desde is null or p.fecha >= p_desde)
       and (p_hasta is null or p.fecha <= p_hasta)
       and (not v_busca
            or (v_solo and doc_igual(p.numero, v_doc))
            or (not v_solo and (coincide_busqueda(coalesce(p.busqueda, ''), v_tk) or p.total = v_monto)))
  ), filtrada as (
    select * from base
     where coalesce(p_estado, '') = ''
        or (p_estado = 'abiertos' and estado_ef in ('borrador', 'enviado', 'aceptado'))
        or estado_ef = p_estado
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'conteos', (select jsonb_build_object(
        'todos', count(*),
        'abiertos', count(*) filter (where estado_ef in ('borrador', 'enviado', 'aceptado')),
        'borrador', count(*) filter (where estado_ef = 'borrador'),
        'enviado', count(*) filter (where estado_ef = 'enviado'),
        'aceptado', count(*) filter (where estado_ef = 'aceptado'),
        'vencido', count(*) filter (where estado_ef = 'vencido'),
        'rechazado', count(*) filter (where estado_ef = 'rechazado'),
        'convertido', count(*) filter (where estado_ef = 'convertido')) from base),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'numero', f.numero, 'revision', f.revision, 'fecha', f.fecha, 'valido_hasta', f.valido_hasta,
        'cliente_id', f.cliente_id, 'cliente_nombre', f.cliente_nombre, 'cliente_ruc', f.cliente_ruc,
        'vendedor_id', f.vendedor_id, 'vendedor_nombre', f.vendedor_nombre, 'moneda', f.moneda, 'tipo_cambio', f.tipo_cambio,
        'total', f.total, 'estado', f.estado_ef, 'vistas', f.vistas, 'enviado_at', f.enviado_at,
        'venta_id', f.venta_id, 'venta_numero', v.numero_control,
        'dias_para_vencer', case when f.estado_ef in ('borrador', 'enviado') then f.valido_hasta - v_hoy end)
        order by f._score desc, f.fecha desc, f.created_at desc)
      from (select * from filtrada order by _score desc, fecha desc, created_at desc limit v_lim offset v_off) f
      left join ventas v on v.id = f.venta_id), '[]'::jsonb)
  ) into v_out;

  return v_out || jsonb_build_object('kpis', (
    select jsonb_build_object(
      'abiertos', count(*) filter (where e in ('borrador', 'enviado', 'aceptado')),
      'en_negociacion', coalesce(round(sum(total * tipo_cambio) filter (where e in ('enviado', 'aceptado'))), 0),
      'mes_emitidos', count(*) filter (where fecha >= v_mes and estado <> 'borrador'),
      'mes_convertidos', count(*) filter (where fecha >= v_mes and estado = 'convertido'))
      from (select presupuesto_estado_efectivo(estado, valido_hasta) as e, total, tipo_cambio, fecha, estado
              from presupuestos where empresa_id = v_emp) k));
end;
$$;

-- ── Compras y órdenes de compra: RUC y nombre comercial del proveedor ────────
-- `busqueda` la arman las funciones de registro (22/23/44/49/50); este trigger le suma lo
-- que faltaba sin tocar esas funciones (idempotente: no lo repite si ya está).
create or replace function :"schema".tg_busqueda_proveedor_extra()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare v text;
begin
  select nullif(concat_ws(' ', compacto(pr.ruc), norm(pr.nombre_comercial)), '') into v
    from proveedores pr where pr.id = new.proveedor_id;
  if v is not null and strpos(coalesce(new.busqueda, ''), v) = 0 then
    new.busqueda := concat_ws(' ', new.busqueda, v);
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_compras_busqueda_prov on :"schema".compras;
create trigger trg_compras_busqueda_prov before insert or update of busqueda, proveedor_id on :"schema".compras
  for each row execute function :"schema".tg_busqueda_proveedor_extra();
drop trigger if exists trg_oc_busqueda_prov on :"schema".ordenes_compra;
create trigger trg_oc_busqueda_prov before insert or update of busqueda, proveedor_id on :"schema".ordenes_compra
  for each row execute function :"schema".tg_busqueda_proveedor_extra();
set session_replication_role = replica;
update :"schema".compras c
   set busqueda = concat_ws(' ', c.busqueda, x.v)
  from (select pr.id, nullif(concat_ws(' ', :"schema".compacto(pr.ruc), :"schema".norm(pr.nombre_comercial)), '') as v
          from :"schema".proveedores pr) x
 where x.id = c.proveedor_id and x.v is not null and strpos(coalesce(c.busqueda, ''), x.v) = 0;
update :"schema".ordenes_compra c
   set busqueda = concat_ws(' ', c.busqueda, x.v)
  from (select pr.id, nullif(concat_ws(' ', :"schema".compacto(pr.ruc), :"schema".norm(pr.nombre_comercial)), '') as v
          from :"schema".proveedores pr) x
 where x.id = c.proveedor_id and x.v is not null and strpos(coalesce(c.busqueda, ''), x.v) = 0;
set session_replication_role = origin;

-- ── Órdenes de pago a proveedores: columna `busqueda` (antes ILIKE crudo) ────
alter table :"schema".pagos_proveedores add column if not exists busqueda text;
create or replace function :"schema".tg_pagos_proveedores_busqueda()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  new.busqueda := concat_ws(' ', norm(new.numero), compacto(new.numero), norm(new.proveedor_nombre),
                            (select concat_ws(' ', norm(pr.nombre), norm(pr.nombre_comercial), compacto(pr.ruc))
                               from proveedores pr where pr.id = new.proveedor_id),
                            norm(new.observacion), norm(new.usuario_nombre), lower(new.moneda));
  return new;
end;
$fn$;
-- "z": corre después de los demás BEFORE (el número ya está puesto)
drop trigger if exists trg_pagos_prov_z_busqueda on :"schema".pagos_proveedores;
create trigger trg_pagos_prov_z_busqueda before insert or update on :"schema".pagos_proveedores
  for each row execute function :"schema".tg_pagos_proveedores_busqueda();
set session_replication_role = replica;
update :"schema".pagos_proveedores g
   set busqueda = concat_ws(' ', :"schema".norm(g.numero), :"schema".compacto(g.numero), :"schema".norm(g.proveedor_nombre),
                            (select concat_ws(' ', :"schema".norm(pr.nombre), :"schema".norm(pr.nombre_comercial), :"schema".compacto(pr.ruc))
                               from :"schema".proveedores pr where pr.id = g.proveedor_id),
                            :"schema".norm(g.observacion), :"schema".norm(g.usuario_nombre), lower(g.moneda))
 where g.busqueda is null;
set session_replication_role = origin;
create index if not exists pagos_prov_busqueda_trgm on :"schema".pagos_proveedores using gin (busqueda extensions.gin_trgm_ops) with (fastupdate = off);

-- ── Tickets de soporte: columna `busqueda` (antes ILIKE crudo sobre el asunto) ──
alter table :"schema".soporte_tickets add column if not exists busqueda text;
create or replace function :"schema".tg_soporte_tickets_busqueda()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  new.busqueda := concat_ws(' ', norm(new.asunto), norm(new.descripcion), norm(new.proxima_accion), norm(new.resultado_esperado),
                            (select concat_ws(' ', norm(c.nombre), norm(c.razon_social), compacto(c.ruc), compacto(c.documento))
                               from clientes c where c.id = new.cliente_id));
  return new;
end;
$fn$;
-- "z": corre después de trg_soporte_tickets_numero
drop trigger if exists trg_soporte_tickets_z_busqueda on :"schema".soporte_tickets;
create trigger trg_soporte_tickets_z_busqueda before insert or update on :"schema".soporte_tickets
  for each row execute function :"schema".tg_soporte_tickets_busqueda();
set session_replication_role = replica;
update :"schema".soporte_tickets t
   set busqueda = concat_ws(' ', :"schema".norm(t.asunto), :"schema".norm(t.descripcion), :"schema".norm(t.proxima_accion),
                            :"schema".norm(t.resultado_esperado),
                            (select concat_ws(' ', :"schema".norm(c.nombre), :"schema".norm(c.razon_social), :"schema".compacto(c.ruc),
                                              :"schema".compacto(c.documento))
                               from :"schema".clientes c where c.id = t.cliente_id))
 where t.busqueda is null;
set session_replication_role = origin;
create index if not exists soporte_tickets_busqueda_trgm on :"schema".soporte_tickets using gin (busqueda extensions.gin_trgm_ops) with (fastupdate = off);

-- ── Exactos para los listados que filtra PostgREST ───────────────────────────
-- { doc: [ids con ese número de documento], monto: [ids con ese total], solo, valor }.
-- `valor` = el total escrito (si hay alguno con ese total): la ruta filtra total = valor en
-- vez de mandar la lista de ids (con muchos, la URL de PostgREST se pasaba de largo → 502).
-- solo = hay documento exacto, o se escribió un número de la serie ("vta 99999") que no
-- existe: la ruta muestra SOLO `doc` (aunque esté vacío). Si no, `monto` primero y después
-- el resto por texto.
create or replace function :"schema".exactos_busqueda(p_tabla text, p_q text)
returns jsonb
language plpgsql stable security invoker
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_doc text[] := q_documento(p_q);
  v_m numeric := q_monto(p_q);
  v_qc text := compacto(p_q);
  v_docs uuid[] := '{}';
  v_montos uuid[] := '{}';
  v_serie boolean := false;
begin
  if v_emp is null or nullif(btrim(coalesce(p_q, '')), '') is null then
    return jsonb_build_object('doc', '[]'::jsonb, 'monto', '[]'::jsonb, 'solo', false);
  end if;
  if p_tabla = 'ventas' then
    if v_doc is not null then
      select coalesce(array_agg(id), '{}') into v_docs from ventas
       where empresa_id = v_emp and numero_control like '%' || v_doc[2] and doc_igual(numero_control, v_doc);
    end if;
    if v_m is not null then
      select coalesce(array_agg(id), '{}') into v_montos
        from (select id from ventas where empresa_id = v_emp and total = v_m order by fecha desc limit 100) x;
    end if;
  elsif p_tabla = 'compras' then
    -- número de compra, o número de factura completo / sus últimos dígitos (4+)
    select coalesce(array_agg(id), '{}') into v_docs from compras
     where empresa_id = v_emp
       and ((v_doc is not null and doc_igual(numero_control, v_doc))
            or (length(v_qc) >= 7 and compacto(numero_factura) = v_qc)
            or (v_doc is not null and v_doc[1] = '' and length(v_doc[2]) >= 4
                and ltrim((regexp_match(coalesce(numero_factura, ''), '([0-9]+)\s*$'))[1], '0') = v_doc[2]));
    if v_m is not null then
      select coalesce(array_agg(id), '{}') into v_montos
        from (select id from compras where empresa_id = v_emp and total = v_m order by fecha desc limit 100) x;
    end if;
  elsif p_tabla = 'ordenes_compra' then
    if v_doc is not null then
      select coalesce(array_agg(id), '{}') into v_docs from ordenes_compra where empresa_id = v_emp and doc_igual(numero_oc, v_doc);
    end if;
    if v_m is not null then
      select coalesce(array_agg(id), '{}') into v_montos
        from (select id from ordenes_compra where empresa_id = v_emp and total = v_m order by fecha desc limit 100) x;
    end if;
  elsif p_tabla = 'pagos_proveedores' then
    if v_doc is not null then
      select coalesce(array_agg(id), '{}') into v_docs from pagos_proveedores where empresa_id = v_emp and doc_igual(numero, v_doc);
    end if;
    if v_m is not null then
      select coalesce(array_agg(id), '{}') into v_montos
        from (select id from pagos_proveedores where empresa_id = v_emp and total = v_m order by fecha desc limit 100) x;
    end if;
  end if;
  -- "vta 99999" (serie reconocida, número que no existe): solo por número → nada.
  if cardinality(v_docs) = 0 and v_doc is not null and v_doc[1] not in ('', 'n', 'nro', 'num', 'numero') then
    -- (la serie es la misma en todos: alcanza con mirar unos pocos documentos)
    v_serie := case p_tabla
      when 'ventas' then exists (select 1 from (select numero_control as n from ventas where empresa_id = v_emp limit 50) x where doc_serie(x.n, v_doc))
      when 'compras' then exists (select 1 from (select numero_control as n from compras where empresa_id = v_emp limit 50) x where doc_serie(x.n, v_doc))
      when 'ordenes_compra' then exists (select 1 from (select numero_oc as n from ordenes_compra where empresa_id = v_emp limit 50) x where doc_serie(x.n, v_doc))
      when 'pagos_proveedores' then exists (select 1 from (select numero as n from pagos_proveedores where empresa_id = v_emp limit 50) x where doc_serie(x.n, v_doc))
      else false end;
  end if;
  return jsonb_build_object('doc', to_jsonb(v_docs), 'monto', to_jsonb(v_montos), 'solo', cardinality(v_docs) > 0 or v_serie,
                            'valor', case when cardinality(v_montos) > 0 then v_m end);
end;
$$;

-- ── Gastos ───────────────────────────────────────────────────────────────────
-- + número exacto (GS-000006, "gs 6", "6"), total exacto, RUC / comprobante exacto y relevancia.
create or replace function :"schema".listar_gastos(
  p_q text default null, p_estado text default null, p_desde date default null, p_hasta date default null,
  p_sucursal uuid default null, p_categoria uuid default null, p_proveedor uuid default null, p_tipo_costo text default null,
  p_deducible boolean default null, p_origen text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  s record;
  r jsonb;
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_solo boolean := false;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_doc is not null then
    v_solo := exists (select 1 from gastos g where g.empresa_id = s.s_empresa and (doc_igual(g.numero, v_doc) or doc_serie(g.numero, v_doc)));
  end if;
  with cats as (
    select id from gasto_categorias where empresa_id = s.s_empresa and p_categoria is not null and (id = p_categoria or padre_id = p_categoria)
  ),
  base as (
    select g.*,
           case when not v_busca then 0
                when doc_igual(g.numero, v_doc) then 3000
                when g.total = v_monto or g.total_gs = v_monto then 2000
                when ruc_igual(g.proveedor_ruc, v_qc) or (length(v_qc) >= 5 and compacto(g.numero_comprobante) = v_qc) then 1500
                else relevancia_busqueda(norm(coalesce(nullif(g.proveedor_nombre, ''), g.descripcion)), g.busqueda, v_q, v_tk) end as _score
      from gastos g where g.empresa_id = s.s_empresa
  ),
  filtradas as (
    select b.* from base b
     where (p_estado is null or b.estado = p_estado)
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (p_proveedor is null or b.proveedor_id = p_proveedor)
       and (p_deducible is null or b.deducible = p_deducible)
       and (p_sucursal is null or b.sucursal_id = p_sucursal
            or exists (select 1 from gasto_items i where i.gasto_id = b.id and i.sucursal_id = p_sucursal))
       and (p_categoria is null or exists (select 1 from gasto_items i where i.gasto_id = b.id and i.categoria_id in (select id from cats)))
       and (p_tipo_costo is null or exists (select 1 from gasto_items i join gasto_categorias c on c.id = i.categoria_id
                                             where i.gasto_id = b.id and c.tipo_costo = p_tipo_costo))
       and (p_origen is null
            or (p_origen = 'recurrente' and b.recurrente_id is not null)
            or (p_origen = 'personal' and exists (select 1 from gasto_items i join gasto_categorias c on c.id = i.categoria_id
                                                   where i.gasto_id = b.id and c.es_personal))
            or (p_origen = 'sin_comprobante' and not b.con_comprobante))
       and (not v_busca
            or (v_solo and doc_igual(b.numero, v_doc))
            or (not v_solo and (coincide_busqueda(coalesce(b.busqueda, ''), v_tk) or b.total = v_monto or b.total_gs = v_monto)))
  ),
  pagina as (
    select * from filtradas order by _score desc, fecha desc, created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_monto', (select coalesce(sum(total_gs), 0) from filtradas where estado = 'confirmado'),
    'total_iva', (select coalesce(sum(round(monto_iva * tipo_cambio)), 0) from filtradas where estado = 'confirmado' and deducible),
    'total_borradores', (select coalesce(sum(total_gs), 0) from filtradas where estado = 'borrador'),
    'resumen', (select jsonb_build_object('total', count(*), 'borrador', count(*) filter (where estado = 'borrador'),
                  'confirmado', count(*) filter (where estado = 'confirmado'), 'anulado', count(*) filter (where estado = 'anulado'))
                  from base),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'numero', x.numero, 'estado', x.estado, 'fecha', x.fecha,
        'proveedor_id', x.proveedor_id, 'proveedor_nombre', x.proveedor_nombre, 'proveedor_ruc', x.proveedor_ruc,
        'tipo_comprobante', x.tipo_comprobante, 'numero_comprobante', x.numero_comprobante, 'timbrado', x.timbrado,
        'con_comprobante', x.con_comprobante, 'deducible', x.deducible,
        'descripcion', x.descripcion, 'tipo_pago', x.tipo_pago, 'medio_pago', x.medio_pago, 'fecha_vencimiento', x.fecha_vencimiento,
        'fecha_programada', x.fecha_programada, 'recurrente_id', x.recurrente_id,
        'moneda', x.moneda, 'tipo_cambio', x.tipo_cambio, 'total', x.total, 'total_gs', x.total_gs, 'monto_iva', x.monto_iva,
        'sucursal_id', x.sucursal_id, 'sucursal_nombre', (select su.nombre from sucursales su where su.id = x.sucursal_id),
        'adjuntos', (select count(*) from gastos_adjuntos a where a.gasto_id = x.id),
        'categorias', (select string_agg(distinct coalesce(rb.nombre || ' › ', '') || i.categoria_nombre, ', ')
                         from gasto_items i left join gasto_categorias c on c.id = i.categoria_id
                         left join gasto_categorias rb on rb.id = c.padre_id where i.gasto_id = x.id),
        'tipos_costo', (select string_agg(distinct c.tipo_costo, ',') from gasto_items i join gasto_categorias c on c.id = i.categoria_id where i.gasto_id = x.id),
        'cxp', (select jsonb_build_object('id', c.id, 'saldo', c.saldo, 'pagado', c.pagado, 'estado', c.estado)
                  from cuentas_por_pagar c where c.gasto_id = x.id),
        'anulado_motivo', x.anulado_motivo, 'usuario_nombre', x.usuario_nombre, 'confirmado_por', x.confirmado_por, 'created_at', x.created_at
      ) order by x._score desc, x.fecha desc, x.created_at desc) from pagina x), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ── Ajustes y pérdidas de inventario (antes LIKE '%frase%' crudo) ────────────
create or replace function :"schema".listar_ajustes(
  p_tipo text default null, p_estado text default null, p_deposito uuid default null, p_q text default null,
  p_desde text default null, p_hasta text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_doc text[] := q_documento(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_solo boolean := false;
  v_desde timestamptz := case when p_desde ~ '^\d{4}-\d{2}-\d{2}$' then (p_desde || 'T00:00:00-03:00')::timestamptz end;
  v_hasta timestamptz := case when p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then (p_hasta || 'T23:59:59.999-03:00')::timestamptz end;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if v_doc is not null then
    v_solo := exists (select 1 from ajustes_inventario a where a.empresa_id = v_emp and (doc_igual(a.numero, v_doc) or doc_serie(a.numero, v_doc)));
  end if;
  with t as (
    select a.*,
           case when v_busca then concat_ws(' ', norm(a.numero), compacto(a.numero), norm(a.tipo), norm(a.motivo), norm(a.detalle),
                    norm(a.usuario_nombre), norm(a.aplicado_por_nombre),
                    (select string_agg(concat_ws(' ', norm(i.producto_nombre), compacto(i.producto_nombre), norm(i.producto_sku), compacto(i.producto_sku)), ' ')
                       from ajustes_items i where i.ajuste_id = a.id)) end as _t
      from ajustes_inventario a
     where a.empresa_id = v_emp
       and (coalesce(p_tipo, '') = '' or a.tipo = p_tipo)
       and (coalesce(p_estado, '') = '' or a.estado = p_estado)
       and (p_deposito is null or a.deposito_id = p_deposito)
       and (v_desde is null or a.created_at >= v_desde)
       and (v_hasta is null or a.created_at <= v_hasta)
  ), f as (
    select t.*,
           case when not v_busca then 0 when doc_igual(t.numero, v_doc) then 3000
                else relevancia_busqueda(norm(t.detalle), t._t, v_q, v_tk) end as _score
      from t
     where not v_busca
        or (v_solo and doc_igual(t.numero, v_doc))
        or (not v_solo and coincide_busqueda(t._t, v_tk))
  ), pag as (
    select * from f order by _score desc, created_at desc, id desc limit v_lim offset v_off
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'pendientes', (select count(*) from ajustes_inventario a where a.empresa_id = v_emp and a.estado = 'pendiente'),
    'totales', (select jsonb_build_object(
        'perdidas_valor', coalesce(sum(valor_salida) filter (where tipo = 'perdida' and estado = 'aplicado'), 0),
        'perdidas_unidades', coalesce(sum(total_salida) filter (where tipo = 'perdida' and estado = 'aplicado'), 0),
        'ajustes_entrada_valor', coalesce(sum(valor_entrada) filter (where tipo = 'ajuste' and estado = 'aplicado'), 0),
        'ajustes_salida_valor', coalesce(sum(valor_salida) filter (where tipo = 'ajuste' and estado = 'aplicado'), 0)) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'tipo', g.tipo, 'numero', g.numero, 'estado', g.estado, 'motivo', g.motivo, 'detalle', g.detalle,
        'deposito', jsonb_build_object('id', dd.id, 'nombre', dd.nombre, 'sucursal', ds.nombre),
        'items', (select count(*) from ajustes_items i where i.ajuste_id = g.id),
        'total_entrada', g.total_entrada, 'total_salida', g.total_salida, 'valor_entrada', g.valor_entrada,
        'valor_salida', g.valor_salida, 'usuario_nombre', g.usuario_nombre, 'created_at', g.created_at,
        'aplicado_por_nombre', g.aplicado_por_nombre, 'aplicado_at', g.aplicado_at
      ) order by g._score desc, g.created_at desc, g.id desc)
      from pag g join depositos dd on dd.id = g.deposito_id join sucursales ds on ds.id = dd.sucursal_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ── Traslados (antes LIKE '%frase%' crudo) ───────────────────────────────────
create or replace function :"schema".listar_traslados(
  p_estado text default null, p_deposito uuid default null, p_q text default null, p_desde text default null,
  p_hasta text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_solo boolean := false;
  v_desde date := case when p_desde ~ '^\d{4}-\d{2}-\d{2}$' then p_desde::date end;
  v_hasta date := case when p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then p_hasta::date end;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if v_doc is not null then
    v_solo := exists (select 1 from traslados t where t.empresa_id = v_emp and (doc_igual(t.numero, v_doc) or doc_serie(t.numero, v_doc)));
  end if;
  with b as (
    select t.*,
           case when v_busca then concat_ws(' ', norm(t.numero), compacto(t.numero), norm(t.remision_numero), compacto(t.remision_numero),
                    norm(t.observacion), norm(t.chofer_nombre), norm(t.vehiculo_chapa), compacto(t.vehiculo_chapa),
                    norm(t.usuario_nombre), norm(t.recibido_por_nombre), replace(t.estado, '_', ' '),
                    (select concat_ws(' ', norm(od.nombre), norm(os.nombre)) from depositos od join sucursales os on os.id = od.sucursal_id where od.id = t.deposito_origen_id),
                    (select concat_ws(' ', norm(dd.nombre), norm(ds.nombre)) from depositos dd join sucursales ds on ds.id = dd.sucursal_id where dd.id = t.deposito_destino_id),
                    (select string_agg(concat_ws(' ', norm(i.producto_nombre), compacto(i.producto_nombre), norm(i.producto_sku), compacto(i.producto_sku)), ' ')
                       from traslados_items i where i.traslado_id = t.id)) end as _t
      from traslados t
     where t.empresa_id = v_emp
       and (coalesce(p_estado, '') = '' or t.estado = p_estado
            or (p_estado = 'recibido' and t.estado = 'recibido_con_diferencias'))
       and (p_deposito is null or p_deposito in (t.deposito_origen_id, t.deposito_destino_id))
       and (v_desde is null or t.fecha_inicio >= v_desde)
       and (v_hasta is null or t.fecha_inicio <= v_hasta)
  ), f as (
    select b.*,
           case when not v_busca then 0 when doc_igual(b.numero, v_doc) then 3000
                when length(v_qc) >= 5 and compacto(b.remision_numero) = v_qc then 1500
                else relevancia_busqueda(norm(b.observacion), b._t, v_q, v_tk) end as _score
      from b
     where not v_busca
        or (v_solo and doc_igual(b.numero, v_doc))
        or (not v_solo and coincide_busqueda(b._t, v_tk))
  ), pag as (
    select * from f order by _score desc, created_at desc, id desc limit v_lim offset v_off
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'en_transito', (select count(*) from traslados t where t.empresa_id = v_emp and t.estado = 'en_transito'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'numero', g.numero, 'remision_numero', g.remision_numero, 'estado', g.estado,
        'fecha_inicio', g.fecha_inicio, 'created_at', g.created_at, 'motivo_codigo', g.motivo_codigo,
        'origen', jsonb_build_object('id', od.id, 'nombre', od.nombre, 'sucursal', os.nombre),
        'destino', jsonb_build_object('id', dd.id, 'nombre', dd.nombre, 'sucursal', ds.nombre, 'sucursal_id', ds.id),
        'total_items', g.total_items, 'total_unidades', g.total_unidades, 'valor_costo', g.valor_costo,
        'diferencia_unidades', g.diferencia_unidades, 'diferencia_valor', g.diferencia_valor,
        'usuario_nombre', g.usuario_nombre, 'recibido_at', g.recibido_at, 'recibido_por_nombre', g.recibido_por_nombre,
        'anulado_at', g.anulado_at
      ) order by g._score desc, g.created_at desc, g.id desc)
      from pag g
      join depositos od on od.id = g.deposito_origen_id join sucursales os on os.id = od.sucursal_id
      join depositos dd on dd.id = g.deposito_destino_id join sucursales ds on ds.id = dd.sucursal_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ── Vencimientos de lotes (antes LIKE '%frase%' crudo) ───────────────────────
create or replace function :"schema".reporte_vencimientos(p_dias integer default 30, p_q text default null,
  p_estado text default null, p_deposito uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_dias integer := greatest(0, least(coalesce(p_dias, 30), 3650));
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_qc text := compacto(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  with base as materialized (
    select l.id, l.producto_id, p.nombre as producto, p.sku, p.unidad_medida, l.numero, l.vencimiento,
           (l.vencimiento - v_hoy) as dias, l.cantidad,
           case when l.costo_unitario > 0 then l.costo_unitario else coalesce(p.costo_promedio, 0) end as costo,
           case when l.vencimiento < v_hoy then 'vencido' else 'por_vencer' end as estado,
           l.deposito_id, d.nombre as deposito, su.nombre as sucursal,
           case when v_busca then concat_ws(' ', p.busqueda, norm(l.numero), compacto(l.numero), norm(d.nombre), norm(su.nombre)) end as _t,
           p.codigo_barras
      from lotes l
      join productos p on p.id = l.producto_id and p.empresa_id = v_emp
      join depositos d on d.id = l.deposito_id
      join sucursales su on su.id = d.sucursal_id
     where l.empresa_id = v_emp and l.cantidad > 0 and l.vencimiento <= v_hoy + v_dias
       and (p_deposito is null or l.deposito_id = p_deposito)
  ),
  filtrado as (
    select b.*,
           case when not v_busca then 0
                when v_qc <> '' and (compacto(b.sku) = v_qc or compacto(b.numero) = v_qc or b.codigo_barras = btrim(p_q)) then 1000
                else relevancia_busqueda(norm(b.producto), b._t, v_q, v_tk) end as _score
      from base b
     where (p_estado is null or p_estado = '' or b.estado = p_estado)
       and (not v_busca or coincide_busqueda(b._t, v_tk)
            or (v_qc <> '' and (compacto(b.sku) = v_qc or compacto(b.numero) = v_qc or b.codigo_barras = btrim(p_q))))
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'dias', v_dias,
    'hay_productos_con_lotes', exists (select 1 from productos where empresa_id = v_emp and controla_lotes),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'lote_id', f.id, 'producto_id', f.producto_id, 'producto', f.producto, 'sku', f.sku, 'unidad_medida', f.unidad_medida,
        'numero', f.numero, 'vencimiento', f.vencimiento, 'dias', f.dias, 'cantidad', f.cantidad,
        'costo', f.costo, 'valor', round(f.cantidad * f.costo), 'estado', f.estado,
        'deposito_id', f.deposito_id, 'deposito', f.deposito, 'sucursal', f.sucursal
      ) order by f._score desc, f.vencimiento, f.producto, f.numero) from filtrado f), '[]'::jsonb),
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

-- ── Conciliación de transferencias (antes LIKE '%frase%' sin quitar tildes) ──
create or replace function :"schema".listar_cobros_pendientes(p_estado text default null, p_desde date default null,
  p_hasta date default null, p_q text default null, p_limit integer default 500)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  v_emp uuid := empresa_actual();
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_op text := case when nullif(btrim(coalesce(p_q, '')), '') is not null then norm_operacion(lower(btrim(p_q))) end;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  return (
    with base0 as (
      select cp.*, x.numero as numero_factura, x.saldo as saldo_factura, x.vencimiento as vencimiento_factura,
             coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as cliente_nombre,
             su.plan_nombre as plan, cat.nombre as categoria,
             case when v_busca then concat_ws(' ', cl.busqueda, norm(cp.banco_origen), norm(cp.titular), norm(cp.numero_operacion),
                      compacto(cp.numero_operacion), norm(x.numero), compacto(x.numero), norm(su.plan_nombre), norm(cat.nombre)) end as _t
        from cobros_pendientes cp
        join cuentas_por_cobrar x on x.id = cp.cxc_id
        join ventas v on v.id = x.venta_id
        join clientes cl on cl.id = cp.cliente_id
        left join suscripciones su on su.id = v.suscripcion_id
        left join cliente_categorias cat on cat.id = cl.categoria_id
       where cp.empresa_id = v_emp
         and (p_desde is null or cp.fecha >= p_desde)
         and (p_hasta is null or cp.fecha <= p_hasta)
    ), base as (
      select b.*,
             case when not v_busca then 0
                  when doc_igual(b.numero_factura, v_doc) then 3000
                  when b.monto = v_monto then 2000
                  when length(coalesce(v_op, '')) >= 3 and b.numero_operacion_norm = v_op then 1500
                  else relevancia_busqueda(norm(b.cliente_nombre), b._t, v_q, v_tk) end as _score
        from base0 b
       where not v_busca
          or coincide_busqueda(b._t, v_tk)
          or b.monto = v_monto
          or doc_igual(b.numero_factura, v_doc)
          or (length(coalesce(v_op, '')) >= 3 and b.numero_operacion_norm like '%' || v_op || '%')
    )
    select jsonb_build_object(
      'conteos', (select jsonb_build_object(
          'pendiente', count(*) filter (where estado = 'pendiente'), 'aprobado', count(*) filter (where estado = 'aprobado'),
          'rechazado', count(*) filter (where estado = 'rechazado'), 'anulado', count(*) filter (where estado = 'anulado'),
          'todas', count(*)) from base),
      'total_monto', (select coalesce(sum(monto), 0) from base where p_estado is null or estado = p_estado),
      'cobros', coalesce((select jsonb_agg(to_jsonb(b) - 'banco_origen_norm' - 'numero_operacion_norm' - 'idempotency_key' - '_t' - '_score'
                                            order by b._score desc, b.fecha desc, b.created_at desc)
                            from (select * from base where p_estado is null or estado = p_estado
                                   order by _score desc, fecha desc, created_at desc
                                   limit least(greatest(coalesce(p_limit, 500), 1), 2000)) b), '[]'::jsonb)
    )
  );
end;
$$;

-- ── Ventas a crédito (antes ILIKE crudo, frase entera) ───────────────────────
create or replace function :"schema".reporte_ventas_credito(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public
as $$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date := nullif(p->>'desde', '')::date;
  v_hasta date := nullif(p->>'hasta', '')::date;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_punto uuid := nullif(p->>'punto_venta_id', '')::uuid;
  v_turno uuid := nullif(p->>'caja_id', '')::uuid;
  v_cli uuid := nullif(p->>'cliente_id', '')::uuid;
  v_estado text := nullif(p->>'estado', '');
  v_tk text[] := tokens_busqueda(p->>'q');
  v_q text := btrim(norm(p->>'q'));
  v_qc text := compacto(p->>'q');
  v_doc text[] := q_documento(p->>'q');
  v_monto numeric := q_monto(p->>'q');
  v_busca boolean := cardinality(tokens_busqueda(p->>'q')) > 0;
  v_solo boolean := false;
  v_pp integer := least(greatest(coalesce(nullif(p->>'por_pagina', '')::integer, 50), 10), 500);
  v_pag integer := greatest(coalesce(nullif(p->>'pagina', '')::integer, 1), 1);
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  if s.s_rol not in ('ADMIN', 'SUPERVISOR') then v_suc := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)); end if;
  if v_doc is not null then
    v_solo := exists (select 1 from ventas v where v.empresa_id = s.s_empresa and v.tipo_venta = 'CREDITO'
                         and v.numero_control like '%' || v_doc[2] and doc_igual(v.numero_control, v_doc))
              or exists (select 1 from (select v.numero_control as n from ventas v where v.empresa_id = s.s_empresa limit 50) x
                          where doc_serie(x.n, v_doc));
  end if;

  with base as (
    select v.id as venta_id, v.numero_control, v.fecha, v.total, v.plazo_dias, v.estado as estado_venta,
           v.cliente_id, coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as cliente_nombre,
           coalesce(cl.ruc, cl.documento) as cliente_ruc,
           cx.vencimiento, coalesce(cx.cobrado, 0) as cobrado, coalesce(cx.saldo, 0) as saldo,
           case when v.estado = 'anulada' then 'anulada' else coalesce(cx.estado, 'pendiente') end as estado,
           (cx.estado in ('pendiente', 'parcial') and cx.vencimiento < v_hoy) as vencida,
           case when cx.estado in ('pendiente', 'parcial') and cx.vencimiento < v_hoy then v_hoy - cx.vencimiento else 0 end as dias_vencida,
           v.sucursal_id, su.nombre as sucursal_nombre, v.punto_venta_id, pv.nombre as punto_nombre,
           v.caja_id, cj.numero_caja, v.usuario_nombre, uc.nombre as cajero_nombre,
           case when not v_busca then 0
                when doc_igual(v.numero_control, v_doc) then 3000
                when v.total = v_monto or cx.saldo = v_monto then 2000
                when ruc_igual(cl.ruc, v_qc) or ruc_igual(cl.documento, v_qc) then 1500
                else relevancia_busqueda(cl.busqueda_nombre, v.busqueda, v_q, v_tk) end as _score
      from ventas v
      left join clientes cl on cl.id = v.cliente_id
      left join cuentas_por_cobrar cx on cx.venta_id = v.id
      left join sucursales su on su.id = v.sucursal_id
      left join puntos_venta pv on pv.id = v.punto_venta_id
      left join cajas cj on cj.id = v.caja_id
      left join usuarios uc on uc.auth_user_id = v.created_by
     where v.empresa_id = s.s_empresa and v.tipo_venta = 'CREDITO'
       and (v_desde is null or v.fecha >= (v_desde::timestamp at time zone 'America/Asuncion'))
       and (v_hasta is null or v.fecha < ((v_hasta + 1)::timestamp at time zone 'America/Asuncion'))
       and (v_suc is null or v.sucursal_id = v_suc)
       and (v_punto is null or v.punto_venta_id = v_punto)
       and (v_turno is null or v.caja_id = v_turno)
       and (v_cli is null or v.cliente_id = v_cli)
       and (not v_busca
            or (v_solo and doc_igual(v.numero_control, v_doc))
            or (not v_solo and (coincide_busqueda(coalesce(v.busqueda, ''), v_tk) or v.total = v_monto or cx.saldo = v_monto)))
  ), filtrada as (
    select * from base
     where v_estado is null
        or (v_estado = 'vencida' and vencida)
        or (v_estado = 'abiertas' and estado in ('pendiente', 'parcial'))
        or estado = v_estado
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(x) - '_score' order by x._score desc, x.fecha desc, x.venta_id)
                        from (select * from filtrada order by _score desc, fecha desc, venta_id limit v_pp offset (v_pag - 1) * v_pp) x), '[]'::jsonb),
    'total', (select count(*) from filtrada),
    'totales', (select jsonb_build_object(
                  'cantidad', count(*) filter (where estado <> 'anulada'),
                  'total', coalesce(sum(total) filter (where estado <> 'anulada'), 0),
                  'cobrado', coalesce(sum(cobrado) filter (where estado <> 'anulada'), 0),
                  'saldo', coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial')), 0),
                  'vencido', coalesce(sum(saldo) filter (where vencida), 0),
                  'vencidas', count(*) filter (where vencida))
                  from filtrada)
  ) into r;
  return r;
end;
$$;

-- ── Cuentas por cobrar: + documento / monto exacto (primero, o solos) ────────
create or replace function :"schema".listar_cuentas_cobrar(p_q text default null, p_filtro text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = '0.39'
as $$
declare
  v_tk text[] := tokens_busqueda(p_q);
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
  v_solo boolean := false;
begin
  if v_doc is not null then
    v_solo := exists (select 1 from cuentas_por_cobrar x where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial')
                         and x.saldo > 0 and (doc_igual(x.numero, v_doc) or doc_serie(x.numero, v_doc)));
  end if;
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  vivas as (
    select x.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, c.documento as cliente_documento,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           c.busqueda || ' ' || lower(x.numero) || ' ' || regexp_replace(lower(x.numero), '[^a-z0-9]+', '', 'g') as _t,
           case when cardinality(v_tk) = 0 then 0
                when doc_igual(x.numero, v_doc) then 3000
                when x.monto = v_monto or x.saldo = v_monto then 2000
                when ruc_igual(c.ruc, v_qc) or ruc_igual(c.documento, v_qc) then 1500
                else 0 end as _ex
      from cuentas_por_cobrar x join clientes c on c.id = x.cliente_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
  ),
  filtradas as (
    select v.* from vivas v, hoy
     where (cardinality(v_tk) = 0
            or (v_solo and doc_igual(v.numero, v_doc))
            or (not v_solo and (coincide_busqueda(v._t, v_tk) or v.monto = v_monto or v.saldo = v_monto)))
       and (p_filtro is null
            or (p_filtro = 'vencidas' and v.vencimiento < hoy.d)
            or (p_filtro = 'por_vencer' and v.vencimiento >= hoy.d)
            or (p_filtro = 'semana' and v.vencimiento between hoy.d and hoy.d + 7))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_saldo', (select coalesce(sum(saldo), 0) from filtradas),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' - '_ex' order by f._ex desc, f.vencimiento, f.numero)
                        from (select * from filtradas order by _ex desc, vencimiento, numero
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

-- ── Cuentas por pagar: + RUC con o sin DV, documento / monto exacto ──────────
create or replace function :"schema".listar_cuentas_pagar(p_q text default null, p_filtro text default null,
  p_moneda text default 'GS', p_proveedor uuid default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public
as $$
declare
  v_tk text[] := tokens_busqueda(p_q);
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
  v_solo boolean := false;
begin
  if v_doc is not null then
    v_solo := exists (select 1 from cuentas_por_pagar x left join compras c on c.id = x.compra_id left join gastos g on g.id = x.gasto_id
                       where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
                         and (doc_igual(c.numero_control, v_doc) or doc_igual(g.numero, v_doc)
                              or doc_serie(c.numero_control, v_doc) or doc_serie(g.numero, v_doc)));
  end if;
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  vivas as (
    select x.*, pr.nombre as proveedor_nombre, pr.ruc as proveedor_ruc, pr.telefono as proveedor_telefono,
           coalesce(c.numero_control, g.numero) as compra_numero,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           x.vencimiento - (select d from hoy) as dias_para_vencer,
           concat_ws(' ', norm(pr.nombre), norm(pr.nombre_comercial), compacto(pr.ruc), tel_busqueda(pr.telefono),
                     lower(x.numero), compacto(x.numero), lower(c.numero_control), compacto(c.numero_control),
                     lower(g.numero), compacto(g.numero), norm(g.descripcion)) as _t,
           case when cardinality(v_tk) = 0 then 0
                when doc_igual(c.numero_control, v_doc) or doc_igual(g.numero, v_doc) then 3000
                when x.monto = v_monto or x.saldo = v_monto then 2000
                when ruc_igual(pr.ruc, v_qc) or (length(v_qc) >= 7 and compacto(x.numero) = v_qc) then 1500
                else 0 end as _ex,
           (v_solo and (doc_igual(c.numero_control, v_doc) or doc_igual(g.numero, v_doc))) as _doc
      from cuentas_por_pagar x
      join proveedores pr on pr.id = x.proveedor_id
      left join compras c on c.id = x.compra_id
      left join gastos g on g.id = x.gasto_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and x.moneda = coalesce(p_moneda, 'GS')
       and (p_proveedor is null or x.proveedor_id = p_proveedor)
  ),
  filtradas as (
    select v.* from vivas v, hoy
     where (cardinality(v_tk) = 0
            or (v_solo and v._doc)
            or (not v_solo and (coincide_busqueda(v._t, v_tk) or v.monto = v_monto or v.saldo = v_monto)))
       and (p_filtro is null
            or (p_filtro = 'vencidas' and v.vencimiento < hoy.d)
            or (p_filtro = 'por_vencer' and v.vencimiento >= hoy.d)
            or (p_filtro = 'semana' and v.vencimiento between hoy.d and hoy.d + 7))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_saldo', (select coalesce(sum(saldo), 0) from filtradas),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' - '_ex' - '_doc' order by f._ex desc, f.vencimiento, f.numero)
                        from (select * from filtradas order by _ex desc, vencimiento, numero
                               limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb),
    'antiguedad', (select jsonb_build_object(
        'por_vencer', coalesce(sum(saldo) filter (where dias_atraso = 0), 0),
        'vence_semana', coalesce(sum(saldo) filter (where dias_atraso = 0 and dias_para_vencer <= 7), 0),
        'd1_30', coalesce(sum(saldo) filter (where dias_atraso between 1 and 30), 0),
        'd31_60', coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        'd61_90', coalesce(sum(saldo) filter (where dias_atraso between 61 and 90), 0),
        'd90', coalesce(sum(saldo) filter (where dias_atraso > 90), 0),
        'proveedores', count(distinct proveedor_id),
        'total', coalesce(sum(saldo), 0),
        'pagado_mes', (select coalesce(sum(total), 0) from pagos_proveedores, hoy
                        where empresa_id = empresa_actual() and anulado_at is null and moneda = coalesce(p_moneda, 'GS')
                          and fecha >= (date_trunc('month', hoy.d)::timestamp at time zone 'America/Asuncion')))
      from vivas)
  ));
end;
$$;

-- ── Pagos (cobrados / facturas pendientes): + RUC/CI, documento y monto exacto ──
create or replace function :"schema".pagos_cobrados(p_q text default null, p_desde date default null, p_hasta date default null,
  p_categoria text default null, p_plan text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public
as $$
declare
  v_tk text[] := tokens_busqueda(p_q);
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
begin
  return (
  with base as (
    select a.id, k.id as cobro_id, k.numero_recibo, k.fecha, k.created_at, k.cliente_id, k.cliente_nombre, k.usuario_nombre,
           x.numero as factura_numero, x.venta_id, a.monto, c.categoria_id, cc.nombre as categoria_nombre,
           coalesce(u.nombre, nullif(btrim(c.vendedor_texto), '')) as vendedor, s.plan_id, s.plan_nombre,
           (k.fecha at time zone 'America/Asuncion')::date as fecha_pago,
           concat_ws(' ', norm(k.cliente_nombre), c.busqueda, lower(x.numero), compacto(x.numero), lower(k.numero_recibo),
                     compacto(k.numero_recibo), norm(s.plan_nombre), norm(cc.nombre), norm(k.usuario_nombre)) as _t,
           case when cardinality(v_tk) = 0 then 0
                when doc_igual(k.numero_recibo, v_doc) or doc_igual(x.numero, v_doc) then 3000
                when a.monto = v_monto or k.total = v_monto then 2000
                when ruc_igual(c.ruc, v_qc) or ruc_igual(c.documento, v_qc) then 1500
                else 0 end as _ex
      from cobros_aplicaciones a
      join cobros_clientes k on k.id = a.cobro_id
      join cuentas_por_cobrar x on x.id = a.cxc_id
      join clientes c on c.id = k.cliente_id
      left join cliente_categorias cc on cc.id = c.categoria_id
      left join usuarios u on u.id = c.vendedor_usuario_id
      left join ventas v on v.id = x.venta_id
      left join suscripciones s on s.id = v.suscripcion_id
     where k.empresa_id = empresa_actual() and k.anulado_at is null
  ),
  filtradas as (
    select b.* from base b
     where (cardinality(v_tk) = 0 or coincide_busqueda(b._t, v_tk) or b._ex >= 2000)
       and (p_desde is null or b.fecha_pago >= p_desde)
       and (p_hasta is null or b.fecha_pago <= p_hasta)
       and (p_categoria is null or (p_categoria = '__sin__' and b.categoria_id is null) or b.categoria_id::text = p_categoria)
       and (p_plan is null or (p_plan = '__sin__' and b.plan_id is null and b.plan_nombre is null) or b.plan_id::text = p_plan)
  ),
  -- con un documento exacto, solo los exactos
  finales as (
    select * from filtradas
     where not exists (select 1 from filtradas e where e._ex = 3000) or _ex = 3000
  )
  select jsonb_build_object(
    'total', (select count(*) from finales),
    'total_monto', (select coalesce(sum(monto), 0) from finales),
    'total_general', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' - '_ex' || jsonb_build_object(
                 'metodos', (select string_agg(distinct m.metodo, ',') from cobros_pagos m where m.cobro_id = f.cobro_id),
                 'referencia', coalesce(
                    (select cp.banco_origen || ' · ' || cp.numero_operacion from cobros_pendientes cp where cp.cobro_id = f.cobro_id limit 1),
                    (select string_agg(m.referencia, ' · ') from cobros_pagos m where m.cobro_id = f.cobro_id and m.referencia is not null)))
               order by f._ex desc, f.fecha desc, f.numero_recibo desc)
               from (select * from finales order by _ex desc, fecha desc, numero_recibo desc
                      limit least(greatest(coalesce(p_limit, 100), 0), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)
  ));
end;
$$;

create or replace function :"schema".pagos_facturas_pendientes(p_q text default null, p_desde date default null, p_hasta date default null,
  p_categoria text default null, p_plan text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public
as $$
declare
  v_tk text[] := tokens_busqueda(p_q);
  v_qc text := compacto(p_q);
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
begin
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  base as (
    select x.id, x.venta_id, x.numero, x.cliente_id, x.fecha_emision, x.vencimiento, x.monto, x.cobrado, x.saldo, x.estado,
           coalesce(nullif(btrim(c.razon_social), ''), c.nombre) as cliente_nombre,
           c.categoria_id, cc.nombre as categoria_nombre,
           coalesce(u.nombre, nullif(btrim(c.vendedor_texto), '')) as vendedor,
           s.plan_id, s.plan_nombre,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           concat_ws(' ', c.busqueda, lower(x.numero), compacto(x.numero), norm(s.plan_nombre), norm(cc.nombre)) as _t,
           case when cardinality(v_tk) = 0 then 0
                when doc_igual(x.numero, v_doc) then 3000
                when x.monto = v_monto or x.saldo = v_monto then 2000
                when ruc_igual(c.ruc, v_qc) or ruc_igual(c.documento, v_qc) then 1500
                else 0 end as _ex
      from cuentas_por_cobrar x
      join clientes c on c.id = x.cliente_id
      left join cliente_categorias cc on cc.id = c.categoria_id
      left join usuarios u on u.id = c.vendedor_usuario_id
      left join ventas v on v.id = x.venta_id
      left join suscripciones s on s.id = v.suscripcion_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and c.deleted_at is null and c.activo
  ),
  filtradas as (
    select b.* from base b
     where (cardinality(v_tk) = 0 or coincide_busqueda(b._t, v_tk) or b._ex >= 2000)
       and (p_desde is null or b.vencimiento >= p_desde)
       and (p_hasta is null or b.vencimiento <= p_hasta)
       and (p_categoria is null or (p_categoria = '__sin__' and b.categoria_id is null) or b.categoria_id::text = p_categoria)
       and (p_plan is null or (p_plan = '__sin__' and b.plan_id is null and b.plan_nombre is null) or b.plan_id::text = p_plan)
  ),
  finales as (
    select * from filtradas
     where not exists (select 1 from filtradas e where e._ex = 3000) or _ex = 3000
  )
  select jsonb_build_object(
    'total', (select count(*) from finales),
    'total_monto', (select coalesce(sum(monto), 0) from finales),
    'total_saldo', (select coalesce(sum(saldo), 0) from finales),
    'total_general', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' - '_ex' || jsonb_build_object(
                 'en_aprobacion', (select coalesce(sum(cp.monto), 0) from cobros_pendientes cp where cp.cxc_id = f.id and cp.estado = 'pendiente'))
               order by f._ex desc, f.vencimiento, f.fecha_emision, f.numero)
               from (select * from finales order by _ex desc, vencimiento, fecha_emision, numero
                      limit least(greatest(coalesce(p_limit, 100), 0), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)
  ));
end;
$$;

-- ── Permisos ─────────────────────────────────────────────────────────────────
grant execute on function :"schema".tel_busqueda(text) to authenticated, service_role;
grant execute on function :"schema".q_documento(text) to authenticated, service_role;
grant execute on function :"schema".doc_igual(text, text[]) to authenticated, service_role;
grant execute on function :"schema".doc_serie(text, text[]) to authenticated, service_role;
grant execute on function :"schema".q_monto(text) to authenticated, service_role;
grant execute on function :"schema".ruc_igual(text, text) to authenticated, service_role;
grant execute on function :"schema".relevancia_busqueda(text, text, text, text[]) to authenticated, service_role;
grant execute on function :"schema".exactos_busqueda(text, text) to authenticated, service_role;
revoke execute on function :"schema".tg_crm_prospectos_tel() from public, anon;
revoke execute on function :"schema".tg_presupuestos_busqueda_tel() from public, anon;
revoke execute on function :"schema".tg_busqueda_proveedor_extra() from public, anon;
revoke execute on function :"schema".tg_pagos_proveedores_busqueda() from public, anon;
revoke execute on function :"schema".tg_soporte_tickets_busqueda() from public, anon;
revoke execute on function :"schema".exactos_busqueda(text, text) from public, anon;
