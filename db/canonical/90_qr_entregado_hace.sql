-- =============================================================================
-- 90 · Estado de los pedidos en el QR: cuánto hace que se entregó cada uno.
--   El celular deja "¡Todo listo!" a la vista 10 minutos después de la entrega (no desde que lo
--   ve): mesa_pedidos_publico_estado suma 'entregado_hace_s' (segundos, con el reloj del servidor).
-- IDEMPOTENTE (el parche no se aplica dos veces).
-- =============================================================================

set search_path to :"schema", public;

do $patch$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.proname = 'mesa_pedidos_publico_estado'
  loop
    v_def := pg_get_functiondef(r.oid);
    continue when strpos(v_def, 'entregado_hace_s') > 0;
    v_new := replace(v_def, $$'cuenta_cerrada', c.estado <> 'abierta',$$,
      $$'cuenta_cerrada', c.estado <> 'abierta',
      'entregado_hace_s', case when p.estado = 'entregado'
                               then greatest(0, floor(extract(epoch from now() - coalesce(p.entregado_at, p.updated_at)))) end,$$);
    if v_new = v_def then raise exception '90: no se encontró dónde agregar entregado_hace_s'; end if;
    execute v_new;
  end loop;
end
$patch$;
