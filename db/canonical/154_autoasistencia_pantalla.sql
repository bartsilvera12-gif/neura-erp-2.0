-- =============================================================================
-- Asistencia: la pantalla "Que el alumno marque solo" (/gimnasio/autoasistencia, receta 153) también
-- para los perfiles de recepción (Supervisor, Cajero y Vendedor) al prender la función, y para las
-- empresas que ya la tienen prendida. IDEMPOTENTE. Va después de 153.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".rubro_dar_gimnasio(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(array['/gimnasio', '/gimnasio/clases', '/gimnasio/autoasistencia']) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(case when pf.nivel_base = 'SUPERVISOR'
                                  then array['gimnasio_recepcion', 'gimnasio_forzar_entrada'] else array['gimnasio_recepcion'] end) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
end;
$fn$;
revoke all on function :"schema".rubro_dar_gimnasio(uuid) from public, anon, authenticated;
grant execute on function :"schema".rubro_dar_gimnasio(uuid) to service_role;

do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where gimnasio loop
    perform rubro_dar_gimnasio(r.empresa_id);
  end loop;
end;
$do$;

commit;
