-- =============================================================================
-- SORTEOS: página pública (fase 3, 4-nov-2026).
--   · El link de referido /r/<código> sin sorteo lleva al sorteo a la venta más reciente de la empresa
--     del vendedor (antes necesitaba el slug).
--   · La página pública devuelve, por premio, el `intento` del sorteo digital y cuándo se sorteó:
--     con eso cualquiera recalcula el ganador desde la semilla revelada y la lista de vendidos.
-- IDEMPOTENTE. Va después de 123.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

create or replace function :"schema".sorteo_referido(p_codigo text, p_slug text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v sorteo_vendedores;
  s sorteos;
begin
  if p_codigo is null or upper(p_codigo) !~ '^[A-Z0-9]{3,20}$' then return null; end if;
  if p_slug is not null then
    select * into s from sorteos where slug = p_slug and estado = 'activo';
  end if;
  select * into v from sorteo_vendedores
   where codigo = upper(p_codigo) and activo and (s.id is null or empresa_id = s.empresa_id)
   order by created_at limit 1;
  if v.id is null or not funcion_activa(v.empresa_id, 'sorteos') then return null; end if;
  -- Sin sorteo pedido (o ya no a la venta): el más reciente a la venta de esa empresa.
  if s.id is null then
    select * into s from sorteos where empresa_id = v.empresa_id and estado = 'activo' order by activado_at desc nulls last limit 1;
  end if;
  perform sorteo_limite('ref:' || v.id, 600, interval '1 minute');
  insert into sorteo_vendedor_clicks (empresa_id, vendedor_id, sorteo_id) values (v.empresa_id, v.id, s.id);
  return jsonb_build_object('codigo', v.codigo, 'vendedor', v.nombre, 'slug', s.slug);
end;
$fn$;

do $do$
declare
  v_def text := pg_get_functiondef('sorteo_publico(text)'::regprocedure);
begin
  if position('-- 124: intento' in v_def) = 0 then
    if position($a$'metodo', pr.metodo) order by pr.posicion)$a$ in v_def) = 0 then
      raise exception 'Receta 124: sorteo_publico no tiene el patrón esperado';
    end if;
    execute replace(v_def, $a$'metodo', pr.metodo) order by pr.posicion)$a$,
      $b$'metodo', pr.metodo, 'intento', pr.intento, 'sorteado_at', pr.sorteado_at) order by pr.posicion) -- 124: intento$b$);
  end if;
end;
$do$;

revoke all on function :"schema".sorteo_referido(text, text) from public;
grant execute on function :"schema".sorteo_referido(text, text) to anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
