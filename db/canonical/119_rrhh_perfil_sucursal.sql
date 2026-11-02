-- =============================================================================
-- RR HH: perfil y sucursal se eligen en la ficha (pedido del dueño, 2-nov-2026).
-- rrhh_ficha devuelve los ids y las opciones. Guardar va por admin_actualizar_usuario, con sus
-- reglas: nadie se cambia su propio perfil, el último administrador queda, y deja historial.
-- IDEMPOTENTE. Va después de 118.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $do$
declare
  v_def text := pg_get_functiondef('rrhh_ficha(uuid)'::regprocedure);
  v_datos text := $a$'perfil', pf.nombre, 'sucursal', su.nombre)$a$;
  v_salida text := $a$'usuario', v,$a$;
begin
  if position('es_yo' in v_def) = 0 then
    if position(v_datos in v_def) = 0 or position(v_salida in v_def) = 0 then raise exception 'Receta 119: rrhh_ficha no tiene el patrón esperado'; end if;
    v_def := replace(v_def, v_datos, $b$'perfil', pf.nombre, 'sucursal', su.nombre, 'perfil_id', u.perfil_id, 'sucursal_id', u.sucursal_id, 'es_yo', u.id = s.s_usuario)$b$);
    v_def := replace(v_def, v_salida, $b$'usuario', v,
    'perfiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre) from perfiles p where p.empresa_id = s.s_empresa), '[]'::jsonb),
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'es_principal', x.es_principal) order by x.nombre)
                              from sucursales x where x.empresa_id = s.s_empresa and (x.activa or x.id = (v->>'sucursal_id')::uuid)), '[]'::jsonb),$b$);
    execute v_def;
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
