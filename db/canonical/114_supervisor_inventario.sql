-- =============================================================================
-- EL SUPERVISOR TAMBIÉN USA INVENTARIO (pedido del dueño, 2-nov-2026).
--
--   El módulo lo dejaba afuera por nivel, aunque el perfil ya tenía permisos de inventario (cargar
--   pérdidas y recibir traslados). Las funciones de la base ya lo aceptaban: el cambio de nivel va en
--   src/modules/inventario/module.ts.
--   · Los perfiles Supervisor reciben las mismas pantallas de Inventario que Cajero y Vendedor.
--   · Las empresas nuevas ya lo siembran así.
--
-- IDEMPOTENTE. Va después de 113.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $do$
declare
  v_def text;
  v_patron text := $a$when 'SUPERVISOR' then v_comun || array['/reportes']$a$;
  v_nuevo text := $b$when 'SUPERVISOR' then v_comun || v_inventario || array['/reportes']$b$;
begin
  v_def := pg_get_functiondef('perfiles_sistema_asegurar(uuid)'::regprocedure);
  if position(v_nuevo in v_def) = 0 then
    if position(v_patron in v_def) = 0 then raise exception 'Receta 114: perfiles_sistema_asegurar no tiene el patrón esperado'; end if;
    execute replace(v_def, v_patron, v_nuevo);
  end if;
end;
$do$;

insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
select pf.id, pf.empresa_id, x
  from perfiles pf
 cross join unnest(array['/inventario', '/inventario/movimientos', '/inventario/traslados', '/inventario/ajustes',
                         '/inventario/vencimientos', '/inventario/categorias']) as x
 where pf.codigo = 'SUPERVISOR'
on conflict do nothing;

commit;

notify pgrst, 'reload schema';
