-- =============================================================================
-- 91 · Optimizaciones de rendimiento (QA total, 2026-10-28). Sin cambios de comportamiento:
--      mismas firmas, mismos resultados.
--
--   1. unidad_normal / unidad_dim / unidad_factor / unidad_convertir: funciones puras que se
--      llaman miles de veces por carga (receta_insumos → necesidad_stock → plato_porciones, por
--      cada plato de la carta / de la caja / de Recetas). Tenían `SET search_path`, que obliga a
--      guardar y restaurar la configuración en CADA llamada y además impide que Postgres las
--      "inlinee" dentro de la consulta que las usa. Ahora las llamadas internas van con el
--      schema escrito y sin SET (no leen tablas: no hay nada que proteger con search_path).
--      Además (1b) el árbol de insumos de las recetas pasa a plpgsql con plan guardado.
--      productos_pos (Caja › Nueva venta), mesa_menu_publico (carta del QR) y recetas_listar
--      bajan de 220-450 ms a 50-75 ms en la base.
--   2. notificaciones_campanita: la campanita (cada 20 s en cada pestaña) hacía 3-5 viajes a
--      la base (lista, dos contadores, citas de la agenda y sus responsables). Ahora es UNO.
--      SECURITY INVOKER: la RLS de usuario_notificaciones / agenda_citas sigue mandando.
--   3. Índice parcial para los contadores de no leídas de la campanita.
--   4. dashboard_inicio: ventas por día agrupadas en una pasada (antes 120 subconsultas).
-- IDEMPOTENTE: se puede correr las veces que haga falta.
-- =============================================================================

set search_path to :"schema", public;

-- ── 1. Unidades: puras, sin SET search_path, llamadas internas con schema ─────────────────
create or replace function unidad_normal(p text)
 returns text
 language sql
 immutable parallel safe
as $function$
  select case
    when lower(btrim(coalesce(p, ''))) in ('', 'unidad', 'unidades', 'u', 'u.', 'un', 'und', 'unid', 'unid.') then 'Unidad'
    when lower(btrim(p)) in ('kg', 'kgs', 'kg.', 'kilo', 'kilos', 'kilogramo', 'kilogramos') then 'kg'
    when lower(btrim(p)) in ('g', 'gr', 'gr.', 'grs', 'gramo', 'gramos') then 'g'
    when lower(btrim(p)) in ('l', 'lt', 'lts', 'litro', 'litros') then 'l'
    when lower(btrim(p)) in ('ml', 'mililitro', 'mililitros', 'cc') then 'ml'
    else null end
$function$;
-- create or replace no saca un SET que ya tenía la función: se lo saca explícito.
alter function unidad_normal(text) reset all;

do $u$
declare
  s text := quote_ident(current_schema());
begin
  execute format($f$
    create or replace function %1$s.unidad_dim(p text)
     returns text
     language sql
     immutable parallel safe
    as $b$
      select case %1$s.unidad_normal(p) when 'kg' then 'masa' when 'g' then 'masa' when 'l' then 'volumen' when 'ml' then 'volumen'
                                        when 'Unidad' then 'unidad' else null end
    $b$;
    alter function %1$s.unidad_dim(text) reset all;

    create or replace function %1$s.unidad_factor(p text)
     returns numeric
     language sql
     immutable parallel safe
    as $b$
      select case %1$s.unidad_normal(p) when 'kg' then 1000 when 'l' then 1000 else 1 end::numeric
    $b$;
    alter function %1$s.unidad_factor(text) reset all;

    -- Misma regla y mismo mensaje que antes; normaliza cada unidad UNA vez (antes: 6 veces).
    create or replace function %1$s.unidad_convertir(p_cant numeric, p_de text, p_a text)
     returns numeric
     language plpgsql
     immutable parallel safe
    as $b$
    declare
      v_de text := %1$s.unidad_normal(p_de);
      v_a  text := %1$s.unidad_normal(p_a);
      d_de text := case v_de when 'kg' then 'masa' when 'g' then 'masa' when 'l' then 'volumen' when 'ml' then 'volumen'
                             when 'Unidad' then 'unidad' end;
      d_a  text := case v_a when 'kg' then 'masa' when 'g' then 'masa' when 'l' then 'volumen' when 'ml' then 'volumen'
                            when 'Unidad' then 'unidad' end;
    begin
      if d_de is null or d_a is null or d_de <> d_a then
        raise exception 'No se puede pasar de "%%" a "%%"', coalesce(p_de, '—'), coalesce(p_a, '—');
      end if;
      return p_cant * (case v_de when 'kg' then 1000 when 'l' then 1000 else 1 end)::numeric
                    / (case v_a when 'kg' then 1000 when 'l' then 1000 else 1 end)::numeric;
    end;
    $b$;
    alter function %1$s.unidad_convertir(numeric, text, text) reset all;
  $f$, s);
end
$u$;

-- ── 1b. Recetas: el árbol de insumos con plan guardado ──────────────────────────────────────
-- receta_insumos / receta_insumos_sin / necesidad_stock / necesidad_mods / plato_insumos /
-- opcion_insumos / extra_insumos eran funciones SQL: en Postgres 17 una
-- función SQL que no se puede "inlinear" (SECURITY DEFINER) se vuelve a PLANIFICAR en cada
-- llamada, y la consulta recursiva de la receta se llama decenas de veces por carga. Como
-- plpgsql (`return query` con la MISMA consulta) el plan queda guardado en la conexión.
-- Misma firma, mismo SECURITY DEFINER y search_path, mismos resultados.
do $r$
declare
  r record;
  v_def text;
  v_src text;
  v_new text;
begin
  for r in
    select p.oid, p.proname, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname = current_schema() and l.lanname = 'sql'
       and p.proretset and p.prosecdef
       and p.proname in ('receta_insumos', 'receta_insumos_sin', 'necesidad_stock', 'necesidad_mods',
                         'plato_insumos', 'opcion_insumos', 'extra_insumos')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_src := rtrim(btrim(r.prosrc, E' \n\r\t'), ';');
    if strpos(v_def, ' LANGUAGE sql') = 0 or strpos(v_def, r.prosrc) = 0 then
      raise exception '91: no se pudo pasar % a plpgsql', r.proname;
    end if;
    v_new := replace(v_def, ' LANGUAGE sql', ' LANGUAGE plpgsql');
    v_new := replace(v_new, r.prosrc,
      E'\n#variable_conflict use_column\nbegin\n  return query\n' || v_src || E';\nend;\n');
    execute v_new;
  end loop;
end
$r$;

-- ── 2. Campanita en UN viaje ───────────────────────────────────────────────────────────────
-- Lo mismo que armaba /api/notificaciones con 3-5 consultas: las últimas 50 del usuario (o solo
-- las no leídas), los dos contadores (General = todo lo que no es Soporte) y las citas de la
-- agenda entre p_desde y p_hasta que NO están canceladas / reprogramadas, con sus responsables.
-- Los recordatorios se siguen calculando en el servidor de la app (modules/agenda/avisos.ts).
-- SECURITY INVOKER: la RLS de cada tabla se aplica igual que con las consultas sueltas.
create or replace function notificaciones_campanita(
  p_usuario uuid,
  p_solo_no_leidas boolean default false,
  p_desde timestamptz default null,
  p_hasta timestamptz default null
) returns jsonb
 language sql
 stable
 set search_path to :"schema", public
as $function$
  with emp as (select empresa_actual() as id)
  select jsonb_build_object(
    'notificaciones', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
        from (select n.id, n.tipo, n.bandeja, n.titulo, n.cuerpo, n.url, n.leida_at, n.created_at
                from usuario_notificaciones n, emp
               where n.empresa_id = emp.id and n.usuario_id = p_usuario
                 and (not coalesce(p_solo_no_leidas, false) or n.leida_at is null)
               order by n.created_at desc
               limit 50) x), '[]'::jsonb),
    'general', (select count(*) from usuario_notificaciones n, emp
                 where n.empresa_id = emp.id and n.usuario_id = p_usuario and n.leida_at is null and n.bandeja <> 'soporte'),
    'soporte', (select count(*) from usuario_notificaciones n, emp
                 where n.empresa_id = emp.id and n.usuario_id = p_usuario and n.leida_at is null and n.bandeja = 'soporte'),
    'citas', case when p_desde is null or p_hasta is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'titulo', c.titulo, 'inicio_at', c.inicio_at, 'estado', c.estado,
               'responsable_id', c.responsable_id, 'created_by', c.created_by, 'ubicacion', c.ubicacion,
               'responsables', coalesce((select jsonb_agg(r.usuario_id)
                                           from agenda_cita_responsables r
                                          where r.cita_id = c.id and r.empresa_id = emp.id), '[]'::jsonb)))
        from agenda_citas c, emp
       where c.empresa_id = emp.id and c.inicio_at >= p_desde and c.inicio_at <= p_hasta
         and c.estado not in ('cancelada', 'reprogramada')), '[]'::jsonb) end
  )
$function$;
revoke all on function notificaciones_campanita(uuid, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function notificaciones_campanita(uuid, boolean, timestamptz, timestamptz) to authenticated, service_role;

-- ── 3. Índices de lo que se consulta en cada poll ──────────────────────────────────────────
-- Contadores de no leídas de la campanita (por usuario, solo las no leídas).
create index if not exists unotif_no_leidas_idx on usuario_notificaciones (usuario_id, bandeja) where leida_at is null;

-- ── 4. Inicio (dashboard_inicio) ───────────────────────────────────────────────────────────
-- Ventas por día (30 días): eran 4 subconsultas POR DÍA sobre todas las ventas del período
--     (120 recorridos). Ahora se agrupa una vez por día (y por día+sucursal) y se une a los días.
--     Mismos totales, cantidades, "anterior" (30 días antes) y reparto por sucursal.
do $d$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.proname = 'dashboard_inicio'
  loop
    v_def := pg_get_functiondef(r.oid);
    continue when strpos(v_def, '91: por_dia agrupado') > 0;
    v_new := replace(v_def,
$old$        'total', coalesce((select sum(total) from v where v.dia = d.dia), 0),
        'cantidad', (select count(*) from v where v.dia = d.dia),
        'anterior', coalesce((select sum(total) from v where v.dia = d.dia - 30), 0),
        'por_sucursal', coalesce((select jsonb_object_agg(x.suc, x.t) from (select suc, sum(total) t from v where v.dia = d.dia group by suc) x), '{}'::jsonb))
      order by d.dia) from dias d),$old$,
$new$        'total', coalesce(pd_a.t, 0),
        'cantidad', coalesce(pd_a.n, 0),
        'anterior', coalesce(pd_b.t, 0),
        'por_sucursal', coalesce(pd_c.ps, '{}'::jsonb))
      order by d.dia)
      -- 91: por_dia agrupado (una pasada por v en vez de 4 subconsultas por día)
      from dias d
      left join (select v.dia, sum(v.total) t, count(*) n from v group by v.dia) pd_a on pd_a.dia = d.dia
      left join (select v.dia, sum(v.total) t from v group by v.dia) pd_b on pd_b.dia = d.dia - 30
      left join (select x.dia, jsonb_object_agg(x.suc, x.t) ps
                   from (select v.dia, v.suc, sum(v.total) t from v group by v.dia, v.suc) x group by x.dia) pd_c on pd_c.dia = d.dia),$new$);
    if v_new = v_def then raise exception '91: no se encontró por_dia en dashboard_inicio'; end if;
    execute v_new;
  end loop;
end
$d$;
