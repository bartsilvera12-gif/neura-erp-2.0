-- =============================================================================
-- RUBROS BIEN CONECTADOS (pedido del dueño, 2-nov-2026).
--
--   · Prender Mesas y QR o Cocina ahora también se la da a los perfiles Cajero y Supervisor (pantalla
--     y permiso): antes solo las veía el Administrador y había que armar cada perfil a mano. Pasa solo
--     al prenderla: si después se la sacan a un perfil, queda como la dejaron. Apagarla no toca nada.
--     Recetas y Producción no: muestran costos y siguen siendo del Administrador.
--   · Con Mesas y QR apagada, un QR viejo no crea pedidos aunque se llame directo a la base (hasta
--     ahora lo cortaba solo la ruta de la app).
--
-- IDEMPOTENTE. Va después de 112.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".rubro_dar_pantallas(p_empresa uuid, p_mesas boolean, p_cocina boolean)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  x record;
begin
  for x in select * from (values ('/caja/mesas', 'pedidos_mesas', p_mesas), ('/caja/cocina', 'cocina', p_cocina)) as t(pantalla, permiso, dar) where dar loop
    insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
    select pf.id, pf.empresa_id, x.pantalla from perfiles pf where pf.empresa_id = p_empresa and pf.codigo in ('CAJERO', 'SUPERVISOR')
    on conflict do nothing;
    insert into perfil_permisos (perfil_id, empresa_id, permiso)
    select pf.id, pf.empresa_id, x.permiso from perfiles pf where pf.empresa_id = p_empresa and pf.codigo in ('CAJERO', 'SUPERVISOR')
    on conflict do nothing;
  end loop;
end;
$fn$;
revoke all on function :"schema".rubro_dar_pantallas(uuid, boolean, boolean) from public, anon, authenticated;

do $do$
declare
  v_def text;
  r record;
begin
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('-- 113: perfiles' in v_def) = 0 then
    if array_length(regexp_split_to_array(v_def, E'\n  update empresa_funciones'), 1) <> 2 then
      raise exception 'Receta 113: guardar_funciones_empresa no tiene el patrón esperado';
    end if;
    execute replace(v_def, E'\n  update empresa_funciones',
      E'\n  -- 113: perfiles que atienden las funciones que se prenden'
      || E'\n  perform rubro_dar_pantallas(s.p_empresa, v_mesas and not f.mesas, v_cocina and not f.cocina);'
      || E'\n\n  update empresa_funciones');
  end if;

  v_def := pg_get_functiondef('mesa_pedido_publico_crear(text,jsonb,text,text)'::regprocedure);
  if position('-- 113: qr' in v_def) = 0 then
    if v_def !~ E'\nbegin[ \t]*\r?\n' then raise exception 'Receta 113: mesa_pedido_publico_crear no tiene el begin esperado'; end if;
    execute regexp_replace(v_def, E'\nbegin[ \t]*\r?\n',
      E'\nbegin\n  -- 113: qr de una empresa con Mesas y QR apagada\n  if p_token ~ ''^[0-9a-f]{64}$'' and exists (select 1 from mesas qr where qr.token = p_token) and not mesa_qr_activo(p_token) then raise exception ''Este QR no está disponible''; end if;\n');
  end if;

  -- Las empresas que ya tienen la función prendida.
  for r in select empresa_id, mesas, cocina and mesas as cocina from empresa_funciones where mesas loop
    perform rubro_dar_pantallas(r.empresa_id, r.mesas, r.cocina);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
