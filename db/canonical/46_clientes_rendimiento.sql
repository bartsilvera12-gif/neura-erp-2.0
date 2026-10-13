-- =============================================================================
-- CLIENTES — rendimiento con muchos clientes (10k–50k):
--   · listar_clientes v4: MISMA firma y MISMA salida que v3 (28_clientes_ficha), pero ya no
--     calcula las cifras (ventas/deuda) de TODOS los clientes para mostrar 25-50: primero
--     filtra/ordena/pagina ids con un índice y recién después arma las filas de la página.
--     Los KPIs salen de un conteo index-only + las cuentas a cobrar PENDIENTES (no de
--     todas las ventas). 20k clientes / 100k ventas: ~420 ms → pocos ms.
--   · resumen_cliente: misma salida; deja de usar cifras_clientes(p) (el "p is null or
--     cliente_id = p" impedía usar el índice y recorría todas las ventas: ~100 ms).
--   · ficha_cliente(p_cliente, p_suscripciones): TODO lo que muestra la ficha al abrirse
--     en UNA llamada (cliente con nombres resueltos, saldo, ventas, contactos, resumen,
--     cantidad de notas y, si se pide, la facturación de suscripciones). La usa
--     GET /api/clientes/[id]; antes eran 8 consultas + /facturacion aparte.
-- IDEMPOTENTE. Requiere 28_clientes_ficha y 29_suscripciones.
-- =============================================================================
set search_path = :"schema", public, extensions;
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Índices ──────────────────────────────────────────────────────────────────
-- Orden de la lista (más nuevos primero) + lo que piden los KPIs y el filtro de estado:
-- el conteo y la página salen de este índice sin tocar la tabla (index-only).
create index if not exists clientes_lista_idx on :"schema".clientes (empresa_id, creado_at desc, id)
  include (activo, tipo_cliente, baja_at) where deleted_at is null;
-- Clientes eliminados (pocos): para descontarlos de los KPIs de deuda sin recorrer la tabla.
create index if not exists clientes_eliminados_idx on :"schema".clientes (empresa_id) where deleted_at is not null;
-- Cuentas a cobrar abiertas con su saldo y vencimiento: el KPI de deuda y los filtros
-- "Con deuda" / "Con deuda vencida" salen sin tocar la tabla (index-only).
create index if not exists cxc_pendientes_idx on :"schema".cuentas_por_cobrar (empresa_id, cliente_id)
  include (saldo, vencimiento) where estado in ('pendiente', 'parcial');
-- Suscripciones activas por cliente (columna "Suscripción activa").
create index if not exists suscripciones_cliente_estado_idx on :"schema".suscripciones (cliente_id, estado, created_at);

-- ── Lista v4 ─────────────────────────────────────────────────────────────────
-- plpgsql + SQL dinámico a propósito: los filtros que no vienen NO entran a la consulta
-- (con "p is null or ..." el plan genérico no usa índices) y cada llamada se planifica
-- con sus valores. SECURITY DEFINER: con RLS no se usan los índices de trigramas; todo
-- se acota igual por empresa_actual().
create or replace function :"schema".listar_clientes(
  p_q text default null, p_tipo text default null, p_condicion text default null,
  p_deuda text default null, p_estado text default 'activos', p_origen text default null,
  p_categoria uuid default null, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_q text := trim(coalesce(norm(p_q), ''));
  v_tk text[] := coalesce(tokens_busqueda(p_q), '{}'::text[]);
  v_qc text := coalesce(compacto(p_q), '');
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_f text;
  v_total bigint := 0;
  v_ids uuid[] := '{}';
  v_cand uuid[];
  v_src text;
  v_where text;
  v_coinc text; v_pt text; v_ws text; v_punt text;
  v_rows jsonb;
  v_kpis jsonb;
  k record;
  v_solo_estado boolean := p_tipo is null and p_condicion is null and p_origen is null
                             and p_categoria is null and p_deuda is null;
begin
  -- Filtros (solo los que vienen). Mismas reglas que v3.
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
  -- Deuda > 0 ⇔ existe una cuenta abierta con saldo > 0 (saldo = greatest(monto - cobrado, 0)
  -- nunca es negativo): EXISTS por cxc_pendientes_idx en vez de agrupar todas las cuentas.
  if p_deuda = 'con_deuda' then
    v_f := v_f || format(' and exists (select 1 from cuentas_por_cobrar x where x.empresa_id = %L and x.cliente_id = c.id and x.estado in (''pendiente'', ''parcial'') and x.saldo > 0)', v_emp);
  elsif p_deuda = 'vencidos' then
    v_f := v_f || format(' and exists (select 1 from cuentas_por_cobrar x where x.empresa_id = %L and x.cliente_id = c.id and x.estado in (''pendiente'', ''parcial'') and x.saldo > 0 and x.vencimiento < %L::date)', v_emp, v_hoy);
  elsif p_deuda is not null then
    v_f := v_f || ' and false';
  end if;

  -- KPIs de toda la base (no dependen de los filtros). Conteos: UNA pasada por
  -- clientes_lista_idx. Deuda: solo las cuentas ABIERTAS por cxc_pendientes_idx
  -- (index-only), descontando los clientes eliminados; v3 agregaba todas las ventas.
  -- count(distinct) filter (saldo > 0) = clientes con deuda > 0 porque el saldo nunca es negativo.
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
      -- Sin búsqueda: conteo y página por el índice (empresa, creado_at desc, id). Si solo
      -- se filtra por estado (la vista por defecto), el total ya salió de los KPIs.
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
      -- Con búsqueda: candidatos por trigramas, puntaje y orden por relevancia (igual que v3).
      -- Los candidatos se juntan ANTES en un arreglo y se cruzan con clientes detrás de un
      -- OFFSET 0 (barrera): si no, el planificador recorría los 20k clientes evaluando
      -- word_similarity en cada uno antes del join (~280 ms con 20k).
      v_src := 'clientes c';
      v_where := v_f;
      if cardinality(v_tk) > 0 then
        v_cand := array(select candidatos_busqueda('clientes', v_tk));
        v_src := '(select c.* from unnest($1) as u(id) join clientes c on c.id = u.id where ' || v_f || ' offset 0) c';
        v_where := 'true';
      end if;
      -- coincide_busqueda / puntaje_busqueda / compacto, ESCRITAS EN LÍNEA con las palabras
      -- como literales (mismo resultado, mismo orden de operaciones): llamadas por fila con
      -- las palabras como parámetro costaban ~150 µs por cliente (2000 aciertos ≈ 400 ms);
      -- compacto() además tiene SET search_path y Postgres no la puede inlinear. Para texto
      -- ASCII (documentos, teléfonos) norm() = lower(): unaccent no cambia ningún carácter
      -- ASCII, así que se evita la llamada (4x más rápido); con tildes/ñ se usa norm().
      select coalesce(string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                                      then format('(c.busqueda like %L or extensions.word_similarity(%L, c.busqueda) >= 0.4)', '%' || t || '%', t)
                                      else format('c.busqueda like %L', '%' || t || '%') end, ' and ' order by o), 'true'),
             string_agg(format('(case when c.busqueda_nombre ~ %L then 40 when c.busqueda_nombre ~ %L then 30 when c.busqueda like %L then 20 else 0 end)',
                               '(^|[^a-z0-9])' || t || '($|[^a-z0-9])', '(^|[^a-z0-9])' || t, '%' || t || '%'), ' + ' order by o),
             string_agg(format('extensions.word_similarity(%L, c.busqueda)::float8', t), ' + ' order by o)
        into v_coinc, v_pt, v_ws
        from unnest(v_tk) with ordinality x(t, o);
      v_punt := format('(case when c.busqueda_nombre = %L then 400 when c.busqueda_nombre like %L then 300 when c.busqueda_nombre like %L then 200 else 0 end',
                       v_q, v_q || '%', '%' || v_q || '%')
                || case when cardinality(v_tk) > 0
                        then format(' + ((%s)::bigint + 50 * ((%s) / %s::float8))', v_pt, v_ws, cardinality(v_tk)) else '' end
                || ')::real';
      execute format('with h as materialized (
                 select c.id, c.creado_at,
                        case when %L::boolean and strpos(c.busqueda, %L) > 0
                                  and (regexp_replace(case when c.documento ~ ''^[[:ascii:]]*$'' then lower(c.documento) else norm(c.documento) end, ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(case when c.ruc ~ ''^[[:ascii:]]*$'' then lower(c.ruc) else norm(c.ruc) end, ''[^a-z0-9]+'', '''', ''g'') = %L
                                       or regexp_replace(case when c.telefono ~ ''^[[:ascii:]]*$'' then lower(c.telefono) else norm(c.telefono) end, ''[^a-z0-9]+'', '''', ''g'') = %L) then 1000
                             else %s end as _score
                   from %s where %s and %s)
               select (select count(*) from h),
                      array(select id from h order by _score desc, creado_at desc, id limit $2 offset $3)',
                     length(v_qc) >= 5, v_qc, v_qc, v_qc, v_qc, v_punt, v_src, v_where, v_coinc)
        into v_total, v_ids using v_cand, v_lim, v_off;
    end if;
  end if;

  -- Filas de la página (25-50): recién acá se resuelven nombres, suscripción y cifras.
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

-- ── Resumen del cliente (misma salida que 26_saldo_favor) ────────────────────
-- plpgsql con el id como valor: usa ventas_cliente_idx / cxc_cliente_idx (antes recorría
-- todas las ventas de la empresa por el "p_cliente is null or ..." de cifras_clientes).
create or replace function :"schema".resumen_cliente(p_cliente uuid)
returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_tc numeric; v_n bigint; v_ult timestamptz; v_deuda numeric; v_venc numeric;
begin
  select coalesce(sum(total), 0), count(*), max(fecha) into v_tc, v_n, v_ult
    from ventas where cliente_id = p_cliente and empresa_id = v_emp and estado <> 'anulada';
  select coalesce(sum(saldo), 0), coalesce(sum(saldo) filter (where vencimiento < v_hoy), 0) into v_deuda, v_venc
    from cuentas_por_cobrar where cliente_id = p_cliente and empresa_id = v_emp and estado in ('pendiente', 'parcial');
  return jsonb_build_object(
    'total_comprado', v_tc, 'compras', v_n, 'ultima_compra', v_ult, 'deuda', v_deuda, 'vencido', v_venc,
    'ticket_promedio', case when v_n > 0 then round(v_tc / v_n) else 0 end,
    'saldo_favor', saldo_favor_cliente(p_cliente));
end;
$$;
grant execute on function :"schema".resumen_cliente(uuid) to authenticated, service_role;

-- ── Ficha del cliente en una llamada ─────────────────────────────────────────
-- Devuelve lo mismo que armaba GET /api/clientes/[id] (+ 'suscripciones' si se pide), o
-- null si el cliente no existe / está eliminado / es de otra empresa.
create or replace function :"schema".ficha_cliente(p_cliente uuid, p_suscripciones boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $$
declare
  v_emp uuid := empresa_actual();
  v_cli jsonb;
  v_limite numeric;
  v_saldo numeric;
begin
  if v_emp is null then return null; end if;

  select to_jsonb(x), x.limite_credito into v_cli, v_limite
    from (
      select c.id, c.codigo, c.nombre, c.razon_social, c.tipo_cliente, c.documento, c.ruc, c.nombre_contacto, c.telefono,
             c.telefono_secundario, c.email, c.email_secundario, c.direccion, c.ciudad, c.pais, c.sitio_web, c.instagram, c.linkedin,
             c.categoria_id, c.valor_anual, c.moneda_preferida, c.condicion_pago, c.plazo_dias, c.limite_credito, c.origen, c.notas,
             c.activo, c.vendedor_usuario_id, c.vendedor_texto, c.created_by, c.creado_at, c.updated_at, c.baja_at, c.baja_por,
             c.baja_motivo, c.sifen_naturaleza, c.sifen_ti_ope, c.sifen_extranjero, c.sifen_pais_iso3, c.sifen_tipo_documento,
             c.sifen_num_id, c.sifen_direccion, c.sifen_numero_casa,
             cat.nombre as categoria_nombre, cat.color as categoria_color,
             coalesce(uv.nombre, c.vendedor_texto) as vendedor_nombre,
             uc.nombre as creado_por_nombre, ub.nombre as baja_por_nombre
        from clientes c
        left join cliente_categorias cat on cat.id = c.categoria_id and cat.empresa_id = v_emp
        left join usuarios uv on uv.id = c.vendedor_usuario_id and uv.empresa_id = v_emp
        left join usuarios uc on uc.id = c.created_by and uc.empresa_id = v_emp
        left join usuarios ub on ub.id = c.baja_por and ub.empresa_id = v_emp
       where c.id = p_cliente and c.empresa_id = v_emp and c.deleted_at is null
    ) x;
  if v_cli is null then return null; end if;

  select coalesce(sum(saldo), 0) into v_saldo
    from cuentas_por_cobrar where cliente_id = p_cliente and empresa_id = v_emp and estado in ('pendiente', 'parcial');
  v_limite := coalesce(v_limite, 0);

  return jsonb_build_object(
    'cliente', v_cli,
    'estado_cuenta', jsonb_build_object(
      'saldo', v_saldo, 'limite_credito', v_limite,
      'disponible', case when v_limite > 0 then greatest(0, v_limite - v_saldo) end),
    'ventas', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.fecha desc)
        from (select id, numero_control, fecha, total, tipo_venta, estado from ventas
               where cliente_id = p_cliente and empresa_id = v_emp order by fecha desc limit 50) v), '[]'::jsonb),
    'contactos', coalesce((
      select jsonb_agg(to_jsonb(k) - 'created_at' order by k.created_at)
        from (select id, nombre, cargo, telefono, email, notas, created_at from cliente_contactos
               where cliente_id = p_cliente and empresa_id = v_emp) k), '[]'::jsonb),
    'resumen', resumen_cliente(p_cliente),
    'notas_count', (select count(*) from cliente_notas where cliente_id = p_cliente and empresa_id = v_emp)
  ) || case when p_suscripciones then jsonb_build_object('suscripciones', facturacion_suscripciones(p_cliente)) else '{}'::jsonb end;
end;
$$;
revoke execute on function :"schema".ficha_cliente(uuid, boolean) from public, anon;
grant execute on function :"schema".ficha_cliente(uuid, boolean) to authenticated, service_role;
