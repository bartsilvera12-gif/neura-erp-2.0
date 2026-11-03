-- =============================================================================
-- SEGURIDAD: LA PLATA SOLO SE MUEVE POR FUNCIONES, Y CADA FUNCIÓN CONTROLA EL PERMISO.
--
-- Hasta ahora, cualquier usuario con sesión podía escribir directo por PostgREST (la URL y la llave
-- anon son públicas), saltándose las reglas de la app, y llamar sin control a las funciones de plata.
--
--   1. Funciones: nadie sin sesión las ejecuta, salvo las del QR de mesa y el presupuesto público.
--   2. Tablas de plata: authenticated pierde INSERT / UPDATE / DELETE. La app ya no las escribe directo.
--   3. Las funciones que las escriben pasan a SECURITY DEFINER con dueño `erp_funciones`, un rol sin
--      BYPASSRLS y miembro de authenticated: siguen atadas a la RLS de la empresa, y es el único que
--      conserva esas escrituras.
--   4. Esas funciones controlan en la base el mismo permiso o rol que su ruta. anular_cobro y
--      registrar_cobro también aceptan aprobar_transferencias, porque Conciliación las usa por dentro.
--   5. productos: el stock no se escribe directo (se mueve con documentos).
--   6. Las tablas nuevas ya no nacen escribibles: cada receta da la escritura que necesite.
--
-- Una función nueva nace ejecutable por todos (el default de Postgres no se puede cambiar por schema):
-- cada receta que cree una tiene que hacerle revoke ... from public, anon.
--
-- IDEMPOTENTE. Va después de 111.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $do$ begin
  if not exists (select 1 from pg_roles where rolname = 'erp_funciones') then
    create role erp_funciones nologin nobypassrls inherit;
  end if;
end $do$;
grant authenticated to erp_funciones;
-- postgres no es superusuario en Supabase: para pasarle las funciones (y poder reemplazarlas en
-- recetas futuras) tiene que poder actuar como erp_funciones, y este necesita CREATE mientras dura.
-- (Postgres 16+ separa INHERIT y SET; en 15, el de producción, una membresía simple ya alcanza.)
do $do$
begin
  if current_setting('server_version_num')::int >= 160000 then
    execute 'grant erp_funciones to postgres with inherit true, set true';
  else
    execute 'grant erp_funciones to postgres';
  end if;
end $do$;
grant usage, create on schema :"schema" to erp_funciones;
-- inv_sesion no es de authenticated: la usan los controles de abajo.
grant execute on function :"schema".inv_sesion(text[]) to erp_funciones;

do $do$
declare
  r record;
  v_def text;
  v_tablas text[] := array[
    'caja_movimientos', 'cliente_historial', 'cobros_aplicaciones', 'cobros_clientes', 'cobros_pagos',
    'cobros_pendientes', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'ordenes_compra', 'ordenes_compra_items',
    'pagos_proveedores', 'pagos_proveedores_aplicaciones', 'pagos_proveedores_medios',
    'saldo_favor_movimientos', 'secuencias_producto', 'suscripciones', 'ventas', 'ventas_items',
    'ventas_pagos_correcciones', 'ventas_pagos_detalle'];
  v_t text;
  v_publicas text[] := array[
    'mesa_menu_publico', 'mesa_qr_activo', 'mesa_pedido_publico_crear', 'mesa_pedidos_publico_estado',
    'mesa_publico_buscar_ruc', 'mesa_publico_cuenta', 'mesa_publico_dividir', 'mesa_publico_facturacion',
    'mesa_publico_pedir_cuenta', 'presupuesto_publico', 'presupuesto_publico_responder', 'presupuesto_publico_visto'];
  v_cols text;
begin
  -- 1. Sin sesión, solo lo público. Quien la tenía por PUBLIC la conserva: se le da explícita.
  for r in
    select p.oid::regprocedure as firma, p.proname
      from pg_proc p
     where p.pronamespace = current_schema()::text::regnamespace and p.prokind = 'f'
       and has_function_privilege('anon', p.oid, 'execute')
       and not (p.proname = any (v_publicas))
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.firma);
    execute format('revoke execute on function %s from public, anon', r.firma);
  end loop;
  for r in
    select p.oid::regprocedure as firma from pg_proc p
     where p.pronamespace = current_schema()::text::regnamespace and p.prokind = 'f' and p.proname = any (v_publicas)
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', r.firma);
    execute format('revoke execute on function %s from public', r.firma);
  end loop;

  -- 4. El control va al empezar. Se agrega antes del cambio de dueño: el reemplazo lo conserva igual.
  for r in select * from (values
    ('registrar_cobro(jsonb)', $c$if not (tiene_permiso('registrar_cobros') or tiene_permiso('aprobar_transferencias')) then perform exigir_permiso('registrar_cobros'); end if;$c$),
    ('anular_cobro(uuid,text)', $c$if not (tiene_permiso('anular_cobros') or tiene_permiso('aprobar_transferencias')) then perform exigir_permiso('anular_cobros'); end if;$c$),
    ('registrar_transferencia(jsonb)', $c$perform exigir_permiso('registrar_transferencias');$c$),
    ('usar_saldo_favor(uuid)', $c$perform exigir_permiso('registrar_cobros');$c$),
    ('registrar_pago_proveedor(jsonb)', $c$perform exigir_permiso('pagar_proveedores');$c$),
    ('anular_pago_proveedor(uuid,text)', $c$perform exigir_permiso('pagar_proveedores');$c$),
    ('guardar_orden_compra(jsonb)', $c$perform exigir_permiso('registrar_compras');$c$),
    ('cancelar_orden_compra(uuid,text)', $c$perform exigir_permiso('registrar_compras');$c$),
    ('completar_costo_ventas(uuid[])', $c$perform exigir_permiso('ver_costos'); perform exigir_permiso('editar_productos');$c$),
    ('crear_suscripcion(jsonb)', $c$perform inv_sesion(array['ADMIN', 'VENDEDOR']);$c$),
    ('cambiar_estado_suscripcion(uuid,text,text)', $c$perform inv_sesion(array['ADMIN', 'VENDEDOR']);$c$),
    ('cambiar_plan_suscripcion(uuid,uuid,text,numeric)', $c$perform inv_sesion(array['ADMIN', 'VENDEDOR']);$c$),
    ('cambiar_vencimiento_suscripcion(uuid,integer,boolean)', $c$perform inv_sesion(array['ADMIN', 'VENDEDOR']);$c$),
    ('emitir_cuota_suscripcion(uuid,date)', $c$perform inv_sesion(array['ADMIN', 'VENDEDOR']);$c$),
    ('emitir_cuotas_mes(date)', $c$perform inv_sesion(array['ADMIN']);$c$),
    ('emitir_factura_contado(uuid,numeric,text,text)', $c$perform inv_sesion(array['ADMIN', 'VENDEDOR', 'CAJERO', 'SUPERVISOR']);$c$)
  ) as x(firma, control) loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    if position('-- 112: control' in v_def) = 0 then
      if v_def !~ E'\nbegin[ \t]*\r?\n' then raise exception 'Receta 112: % no tiene el begin esperado', r.firma; end if;
      execute regexp_replace(v_def, E'\nbegin[ \t]*\r?\n', E'\nbegin\n  -- 112: control\n  ' || r.control || E'\n');
    end if;
  end loop;

  -- 3. Las funciones que escriben las tablas de plata corren como erp_funciones.
  for r in select * from unnest(array[
    'registrar_cobro(jsonb)', 'anular_cobro(uuid,text)', 'anular_cobro_pendiente(uuid,text)',
    'registrar_transferencia(jsonb)', 'registrar_pago_proveedor(jsonb)', 'anular_pago_proveedor(uuid,text)',
    'guardar_orden_compra(jsonb)', 'cancelar_orden_compra(uuid,text)', 'recalcular_orden_compra(uuid)',
    'completar_costo_ventas(uuid[])', 'crear_suscripcion(jsonb)', 'cambiar_estado_suscripcion(uuid,text,text)',
    'cambiar_plan_suscripcion(uuid,uuid,text,numeric)', 'cambiar_vencimiento_suscripcion(uuid,integer,boolean)',
    'emitir_cuota_suscripcion(uuid,date)', 'emitir_cuotas_mes(date)', 'emitir_factura_contado(uuid,numeric,text,text)',
    'reservar_secuencia(text,bigint)']) as firma
  loop
    execute format('alter function %s security definer', r.firma);
    execute format('alter function %s owner to erp_funciones', r.firma);
  end loop;
  for r in
    select p.oid::regprocedure as firma from pg_proc p
     where p.pronamespace = current_schema()::text::regnamespace
       and p.proname in ('aprobar_cobro_pendiente', 'rechazar_cobro_pendiente')
  loop
    execute format('alter function %s security definer', r.firma);
    execute format('alter function %s owner to erp_funciones', r.firma);
  end loop;

  -- 2. Tablas de plata.
  foreach v_t in array v_tablas loop
    if to_regclass(v_t) is null then raise exception 'Receta 112: falta la tabla %', v_t; end if;
    execute format('grant select, insert, update, delete on %I to erp_funciones', v_t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated, anon, public', v_t);
  end loop;

  -- 5. productos: todas las columnas menos el stock.
  select string_agg(quote_ident(column_name), ', ') into v_cols
    from information_schema.columns
   where table_schema = current_schema() and table_name = 'productos' and column_name <> 'stock_actual'
     and is_generated = 'NEVER';
  grant select, insert, update, delete on productos to erp_funciones;
  revoke insert, update on productos from authenticated;
  execute format('grant insert (%s), update (%s) on productos to authenticated', v_cols, v_cols);

  -- Ninguna función con los permisos del usuario puede quedar escribiendo una tabla cerrada.
  for r in
    select p.proname, t.t
      from pg_proc p
      join unnest(v_tablas) as t(t) on lower(pg_get_functiondef(p.oid)) ~ ('(insert\s+into|update|delete\s+from)\s+([a-z_]+\.)?' || t.t || '\M')
     where p.pronamespace = current_schema()::text::regnamespace and p.prokind = 'f' and not p.prosecdef
       and p.prorettype <> 'trigger'::regtype
  loop
    raise exception 'Receta 112: % sigue escribiendo % con los permisos del usuario', r.proname, r.t;
  end loop;
end;
$do$;

revoke create on schema :"schema" from erp_funciones;

-- 6. Las tablas nuevas no nacen escribibles.
alter default privileges for role postgres in schema :"schema" revoke insert, update, delete, truncate on tables from authenticated;

commit;

notify pgrst, 'reload schema';
