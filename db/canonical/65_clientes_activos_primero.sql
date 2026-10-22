-- =============================================================================
-- CLIENTES: ACTIVOS PRIMERO (extiende 58_busqueda_precisa.sql).
--
--   · listar_clientes v6: MISMA firma y MISMA salida que en 58. Cuando el filtro de estado
--     trae activos e inactivos ("Todos"), los activos van primero y los inactivos / de baja
--     al final; dentro de cada grupo, el orden de siempre (sin búsqueda: más nuevos primero;
--     con búsqueda: relevancia). Se ordena en la consulta, así la paginación lo respeta.
--   · Filtro de deuda "sin_deuda": clientes sin saldo abierto (saldo 0 o sin cuentas).
--   · Índice clientes_lista_activo_idx (empresa_id, activo desc, creado_at desc, id) para
--     paginar ese orden sin ordenar toda la tabla.
--
-- IDEMPOTENTE. Va después de 58: si se vuelve a correr 58, correr 65 después.
-- =============================================================================

do $$ begin perform extensions.similarity('a', 'b'); end $$;

create index if not exists clientes_lista_activo_idx on :"schema".clientes (empresa_id, activo desc, creado_at desc, id)
  where deleted_at is null;
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
  elsif p_deuda = 'sin_deuda' then
    -- Saldo 0 o sin cuentas abiertas.
    v_f := v_f || format(' and not exists (select 1 from cuentas_por_cobrar x where x.empresa_id = %L and x.cliente_id = c.id and x.estado in (''pendiente'', ''parcial'') and x.saldo > 0)', v_emp);
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
        execute 'select array(select c.id from clientes c where ' || v_f || ' order by c.activo desc, c.creado_at desc, c.id limit $1 offset $2)'
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
                 select c.id, c.creado_at, c.activo,
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
                      array(select id from h order by activo desc, _score desc, creado_at desc, id limit $2 offset $3)',
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

grant execute on function :"schema".listar_clientes(text, text, text, text, text, text, uuid, integer, integer) to authenticated, service_role;