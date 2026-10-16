-- =============================================================================
-- PERFILES EDITABLES (Configuración › Usuarios › Perfiles). Pedido del dueño (16-oct-2026):
-- "solo el perfil Administrador debe ser invulnerable".
--
--   · Administrador (codigo ADMIN): único perfil protegido (sistema = true). Tiene todo de
--     forma implícita; no se edita ni se elimina. Se valida en las funciones admin_* y además
--     en un trigger de perfiles (vale aunque se escriba directo con service role).
--   · Supervisor, Cajero y Vendedor sembrados: perfiles normales (sistema = false). Se editan
--     completos (nombre, descripción, nivel base, alcance, tope, pantallas y permisos), se
--     duplican y se eliminan si ningún usuario los usa (ni inactivos), igual que los propios.
--   · codigo de los sembrados: queda como marca de "perfil por defecto de ese rol" mientras el
--     nivel base coincida. Si se cambia el nivel base, el código se borra (pasa a ser un perfil
--     cualquiera) para que codigo = X siempre implique nivel_base = X.
--   · Perfil de un rol (perfil_de_rol): el que conserva el código de ese rol; si no está
--     (renombrado sigue valiendo; eliminado o cambiado de nivel no), el primero creado con ese
--     nivel base en la empresa. Lo usan el trigger de usuarios (si un script cambia usuarios.rol
--     directo, o inserta sin perfil) y el respaldo de perfil_sesion / sesion_perfil.
--   · Si la empresa no tiene NINGÚN perfil con ese nivel, el trigger RECHAZA con un mensaje
--     claro (no inventa un perfil: un perfil creado solo podría dar más acceso del pensado y
--     dejar un usuario sin perfil lo dejaría sin pantallas). Para ADMIN nunca pasa: el
--     Administrador no se puede borrar.
--   · Empresas nuevas: se siembran los 4 (solo Administrador protegido). En empresas que ya
--     tienen perfiles solo se asegura el Administrador: no se resucitan los que el dueño borró.
--
-- Va DESPUÉS de 55 (redefine funciones de 55 con las mismas firmas): si se vuelve a correr 55,
-- correr 56 después. IDEMPOTENTE. SECURITY DEFINER + search_path fijo.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Perfil de un rol
-- =============================================================================
create or replace function :"schema".perfil_de_rol(p_empresa uuid, p_rol text)
returns uuid language sql stable security definer set search_path = :"schema", public as $$
  select x.id
    from perfiles x
   where x.empresa_id = p_empresa and x.nivel_base = upper(p_rol)
   order by (x.codigo is not distinct from upper(p_rol)) desc, x.created_at, x.id
   limit 1
$$;

-- =============================================================================
-- 2. Guardián del Administrador (y "sistema" = solo Administrador)
-- =============================================================================
create or replace function :"schema".tg_perfiles_protegidos()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if tg_op = 'DELETE' then
    -- Al borrar la empresa entera (cascada) la empresa ya no existe: se deja pasar.
    if old.codigo = 'ADMIN' and exists (select 1 from empresas where id = old.empresa_id) then
      raise exception 'El perfil Administrador no se elimina';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.codigo = 'ADMIN' and (new.codigo is distinct from 'ADMIN' or new.empresa_id is distinct from old.empresa_id
        or new.nivel_base is distinct from 'ADMIN' or new.alcance_sucursal is distinct from 'todas') then
      raise exception 'El perfil Administrador no se modifica';
    end if;
    if new.codigo = 'ADMIN' and old.codigo is distinct from 'ADMIN' then
      raise exception 'Solo el perfil Administrador lleva el código ADMIN';
    end if;
  end if;
  if new.codigo = 'ADMIN' then
    new.nivel_base := 'ADMIN';
    new.alcance_sucursal := 'todas';
  end if;
  new.sistema := coalesce(new.codigo = 'ADMIN', false);
  return new;
end;
$fn$;
drop trigger if exists trg_perfiles_protegidos on :"schema".perfiles;
create trigger trg_perfiles_protegidos before insert or update or delete on :"schema".perfiles
  for each row execute function :"schema".tg_perfiles_protegidos();

-- =============================================================================
-- 3. Siembra: los 4 en empresas nuevas; en las existentes solo se asegura el Administrador
-- =============================================================================
create or replace function :"schema".perfiles_sistema_asegurar(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_id uuid;
  v_nombre text;
  v_nueva boolean := not exists (select 1 from perfiles where empresa_id = p_empresa);
  -- Pantallas que hoy ven todos los roles (los módulos sin `roles` + Caja + Presupuestos).
  v_comun text[] := array[
    '/clientes', '/crm', '/presupuestos', '/clientes/gestion', '/clientes/suscripciones', '/clientes/agenda', '/proyectos',
    '/caja/nueva', '/caja/turnos', '/caja', '/caja/credito', '/cobranzas', '/cobranzas/conciliacion', '/pagos',
    '/conversaciones', '/conversaciones/finalizadas', '/conversaciones/historial',
    '/soporte', '/soporte/tickets', '/soporte/mis-tickets'];
  v_inventario text[] := array['/inventario', '/inventario/movimientos', '/inventario/traslados', '/inventario/ajustes',
    '/inventario/vencimientos', '/inventario/categorias'];
  v_caja text[] := array['anular_ventas', 'descuentos_precio', 'vender_credito', 'abrir_cerrar_caja', 'movimientos_caja',
    'registrar_perdidas', 'recibir_traslados', 'exportar'];
begin
  for r in select * from (values
      ('ADMIN',      'Administrador', 'Acceso total: todas las pantallas y permisos. Administra usuarios y la configuración.', 'todas'),
      ('SUPERVISOR', 'Supervisor',    'Caja de su sucursal, anula ventas de turnos cerrados y ve los cierres de caja.',          'propia'),
      ('CAJERO',     'Cajero',        'Vende y cobra en la caja de su sucursal; carga pérdidas y recibe traslados.',             'propia'),
      ('VENDEDOR',   'Vendedor',      'Vende, cotiza y atiende clientes en su sucursal.',                                        'propia')
    ) x(codigo, nombre, descripcion, alcance) loop
    -- Los editables solo se siembran en una empresa sin perfiles (no resucitar los borrados).
    if r.codigo <> 'ADMIN' and not v_nueva then continue; end if;
    if exists (select 1 from perfiles where empresa_id = p_empresa and codigo = r.codigo) then continue; end if;
    v_nombre := r.nombre;
    if exists (select 1 from perfiles where empresa_id = p_empresa and lower(nombre) = lower(v_nombre)) then
      v_nombre := v_nombre || ' (sistema)';
    end if;
    insert into perfiles (empresa_id, nombre, descripcion, codigo, sistema, nivel_base, alcance_sucursal)
      values (p_empresa, v_nombre, r.descripcion, r.codigo, r.codigo = 'ADMIN', r.codigo, r.alcance)
      returning id into v_id;
    -- Administrador: todo de forma implícita (sin filas): ve las pantallas y permisos nuevos.
    if r.codigo = 'ADMIN' then continue; end if;
    insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
      select v_id, p_empresa, x from unnest(case r.codigo
        when 'SUPERVISOR' then v_comun || array['/reportes']
        else v_comun || v_inventario end) x
      on conflict do nothing;
    insert into perfil_permisos (perfil_id, empresa_id, permiso)
      select v_id, p_empresa, x from unnest(case r.codigo
        when 'SUPERVISOR' then v_caja || array['anular_ventas_cerradas', 'registrar_transferencias', 'ver_cierres_caja']
        when 'CAJERO'     then v_caja || array['registrar_cobros', 'registrar_transferencias']
        else                   v_caja || array['registrar_cobros'] end) x
      on conflict do nothing;
  end loop;
end;
$fn$;

-- =============================================================================
-- 4. usuarios.rol ↔ perfil: el perfil manda. Sin perfil (o si un script cambia el rol directo)
--    → perfil_de_rol(rol). Sin ningún perfil de ese nivel en la empresa → error claro.
-- =============================================================================
create or replace function :"schema".tg_usuarios_perfil()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_nivel text;
  v_emp uuid;
  v_rol text := upper(coalesce(new.rol, ''));
begin
  if v_rol not in ('ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR') then v_rol := 'VENDEDOR'; end if;
  if tg_op = 'UPDATE' and new.perfil_id is not distinct from old.perfil_id and new.rol is distinct from old.rol
     and new.perfil_id is not null
     and v_rol is distinct from (select nivel_base from perfiles where id = new.perfil_id) then
    new.perfil_id := null;
  end if;
  if new.perfil_id is null then
    new.perfil_id := perfil_de_rol(new.empresa_id, v_rol);
    if new.perfil_id is null then
      raise exception 'No hay ningún perfil con nivel % en esta empresa: creá uno en Configuración › Usuarios › Perfiles o asignale un perfil al usuario',
        case v_rol when 'ADMIN' then 'Administrador' when 'SUPERVISOR' then 'Supervisor' when 'CAJERO' then 'Cajero' else 'Vendedor' end
        using errcode = '23503';
    end if;
  end if;
  select nivel_base, empresa_id into v_nivel, v_emp from perfiles where id = new.perfil_id;
  if v_emp is distinct from new.empresa_id then raise exception 'El perfil no es de esta empresa'; end if;
  new.rol := v_nivel;
  return new;
end;
$fn$;

-- =============================================================================
-- 5. Sesión: el respaldo "sin perfil → el de su rol" usa perfil_de_rol (mismas firmas)
-- =============================================================================
create or replace function :"schema".perfil_sesion(
  out p_usuario uuid, out p_empresa uuid, out p_rol text, out p_perfil uuid, out p_codigo text,
  out p_alcance text, out p_tope numeric, out p_sucursal uuid, out p_nombre text)
language sql stable security definer set search_path = :"schema", public as $$
  select u.id, u.empresa_id, upper(u.rol), pf.id, pf.codigo, pf.alcance_sucursal, pf.tope_descuento_pct, u.sucursal_id, u.nombre
    from usuarios u
    left join perfiles pf on pf.id = coalesce(u.perfil_id, perfil_de_rol(u.empresa_id, u.rol))
   where u.auth_user_id = auth.uid() and u.activo
   limit 1
$$;

create or replace function :"schema".sesion_perfil(p_auth uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'usuario_id', u.id, 'empresa_id', u.empresa_id, 'rol', upper(u.rol), 'activo', u.activo, 'nombre', u.nombre,
    'sucursal_id', u.sucursal_id,
    'perfil_id', pf.id, 'perfil_nombre', pf.nombre, 'perfil_codigo', pf.codigo,
    'alcance_sucursal', coalesce(pf.alcance_sucursal, case when upper(u.rol) = 'ADMIN' then 'todas' else 'propia' end),
    'tope_descuento_pct', pf.tope_descuento_pct,
    'todo', coalesce(pf.codigo = 'ADMIN', false),
    'pantallas', coalesce((select jsonb_agg(pp.pantalla order by pp.pantalla) from perfil_pantallas pp where pp.perfil_id = pf.id), '[]'::jsonb),
    'permisos', case when pf.codigo = 'ADMIN' then (select jsonb_agg(c.codigo) from permisos_catalogo() c)
                     else coalesce((select jsonb_agg(pp.permiso order by pp.permiso) from perfil_permisos pp where pp.perfil_id = pf.id), '[]'::jsonb) end)
    from usuarios u
    left join perfiles pf on pf.id = coalesce(u.perfil_id, perfil_de_rol(u.empresa_id, u.rol))
   where u.auth_user_id = p_auth
   limit 1
$$;

-- =============================================================================
-- 6. Alta / edición de un perfil (misma firma). Solo el Administrador queda fijo.
--   p: { id?, nombre, descripcion?, nivel_base, alcance_sucursal, tope_descuento_pct?, pantallas[], permisos[] }
-- =============================================================================
create or replace function :"schema".admin_guardar_perfil(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old perfiles;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_desc text := nullif(left(btrim(coalesce(p->>'descripcion', '')), 300), '');
  v_nivel text := upper(coalesce(nullif(p->>'nivel_base', ''), 'VENDEDOR'));
  v_alcance text := coalesce(nullif(p->>'alcance_sucursal', ''), 'propia');
  v_tope numeric := nullif(p->>'tope_descuento_pct', '')::numeric;
  v_codigo text;
  v_pant text[];
  v_perm text[];
  v_pant_old text[] := '{}';
  v_perm_old text[] := '{}';
  v_invalidos text[];
  v_cambios jsonb := '{}'::jsonb;
begin
  select * into s from usr_admin_sesion();
  perform pg_advisory_xact_lock(hashtextextended('usuarios_admin:' || s.s_empresa::text, 0));
  if v_nombre is null then raise exception 'Escribí el nombre del perfil'; end if;
  if length(v_nombre) > 60 then raise exception 'El nombre es muy largo (máximo 60)'; end if;
  if v_nivel not in ('ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR') then raise exception 'Nivel base inválido'; end if;
  if v_alcance not in ('propia', 'todas') then raise exception 'Alcance inválido'; end if;
  if v_tope is not null and (v_tope < 0 or v_tope > 100) then raise exception 'El tope de descuento va de 0 a 100 %%'; end if;
  if v_nivel = 'ADMIN' then v_alcance := 'todas'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_pant
    from jsonb_array_elements_text(coalesce(p->'pantallas', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x), '{}') into v_perm
    from jsonb_array_elements_text(coalesce(p->'permisos', '[]'::jsonb)) x;
  select array_agg(x) into v_invalidos from unnest(v_pant) x where x !~ '^/[a-z0-9/_-]{0,120}$';
  if v_invalidos is not null then raise exception 'Pantalla inválida: %', v_invalidos[1]; end if;
  select array_agg(x) into v_invalidos from unnest(v_perm) x where x not in (select codigo from permisos_catalogo());
  if v_invalidos is not null then raise exception 'Permiso inválido: %', v_invalidos[1]; end if;
  if not ('descuentos_precio' = any (v_perm)) then v_tope := null; end if;

  if v_id is not null then
    select * into v_old from perfiles where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Perfil no encontrado'; end if;
    if v_old.codigo = 'ADMIN' then raise exception 'El perfil Administrador tiene todo y no se edita'; end if;
    -- El código de rol queda solo mientras el nivel base sea el de ese rol.
    v_codigo := case when v_old.codigo = v_nivel then v_old.codigo end;
  end if;
  if exists (select 1 from perfiles where empresa_id = s.s_empresa and lower(nombre) = lower(v_nombre) and id is distinct from v_id) then
    raise exception 'Ya hay un perfil que se llama "%"', v_nombre;
  end if;

  if v_id is null then
    insert into perfiles (empresa_id, nombre, descripcion, sistema, nivel_base, alcance_sucursal, tope_descuento_pct)
      values (s.s_empresa, v_nombre, v_desc, false, v_nivel, v_alcance, v_tope)
      returning id into v_id;
    v_cambios := jsonb_build_object('nivel_base', v_nivel, 'alcance_sucursal', v_alcance, 'tope_descuento_pct', v_tope,
                                    'pantallas', to_jsonb(v_pant), 'permisos', to_jsonb(v_perm));
  else
    select coalesce(array_agg(pantalla), '{}') into v_pant_old from perfil_pantallas where perfil_id = v_id;
    select coalesce(array_agg(permiso), '{}') into v_perm_old from perfil_permisos where perfil_id = v_id;
    if v_nombre is distinct from v_old.nombre then v_cambios := v_cambios || jsonb_build_object('nombre', jsonb_build_array(v_old.nombre, v_nombre)); end if;
    if v_desc is distinct from v_old.descripcion then v_cambios := v_cambios || jsonb_build_object('descripcion', jsonb_build_array(v_old.descripcion, v_desc)); end if;
    if v_nivel is distinct from v_old.nivel_base then v_cambios := v_cambios || jsonb_build_object('nivel_base', jsonb_build_array(v_old.nivel_base, v_nivel)); end if;
    if v_alcance is distinct from v_old.alcance_sucursal then v_cambios := v_cambios || jsonb_build_object('alcance_sucursal', jsonb_build_array(v_old.alcance_sucursal, v_alcance)); end if;
    if v_tope is distinct from v_old.tope_descuento_pct then v_cambios := v_cambios || jsonb_build_object('tope_descuento_pct', jsonb_build_array(v_old.tope_descuento_pct, v_tope)); end if;
    if exists (select unnest(v_pant) except select unnest(v_pant_old)) or exists (select unnest(v_pant_old) except select unnest(v_pant)) then
      v_cambios := v_cambios || jsonb_build_object('pantallas', jsonb_build_object(
        'agregadas', to_jsonb(array(select unnest(v_pant) except select unnest(v_pant_old))),
        'quitadas', to_jsonb(array(select unnest(v_pant_old) except select unnest(v_pant)))));
    end if;
    if exists (select unnest(v_perm) except select unnest(v_perm_old)) or exists (select unnest(v_perm_old) except select unnest(v_perm)) then
      v_cambios := v_cambios || jsonb_build_object('permisos', jsonb_build_object(
        'agregados', to_jsonb(array(select unnest(v_perm) except select unnest(v_perm_old))),
        'quitados', to_jsonb(array(select unnest(v_perm_old) except select unnest(v_perm)))));
    end if;
    if v_cambios = '{}'::jsonb then return jsonb_build_object('id', v_id, 'cambios', 0); end if;
    update perfiles
       set nombre = v_nombre, descripcion = v_desc, nivel_base = v_nivel, alcance_sucursal = v_alcance,
           tope_descuento_pct = v_tope, codigo = v_codigo, updated_at = now()
     where id = v_id;
    delete from perfil_pantallas where perfil_id = v_id and not (pantalla = any (v_pant));
    delete from perfil_permisos where perfil_id = v_id and not (permiso = any (v_perm));
  end if;
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla) select v_id, s.s_empresa, x from unnest(v_pant) x on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso) select v_id, s.s_empresa, x from unnest(v_perm) x on conflict do nothing;

  perform usr_historial(s.s_empresa, 'perfil', null, v_id, v_nombre, case when v_old.id is null then 'creado' else 'editado' end,
                        v_cambios, s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', v_id, 'cambios', (select count(*) from jsonb_object_keys(v_cambios)));
end;
$fn$;

-- Eliminar un perfil que nadie usa (ni usuarios inactivos). El Administrador no se elimina.
create or replace function :"schema".admin_eliminar_perfil(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v perfiles;
  v_n integer;
begin
  select * into s from usr_admin_sesion();
  perform pg_advisory_xact_lock(hashtextextended('usuarios_admin:' || s.s_empresa::text, 0));
  select * into v from perfiles where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Perfil no encontrado'; end if;
  if v.codigo = 'ADMIN' or v.sistema then raise exception 'El perfil Administrador no se elimina'; end if;
  select count(*) into v_n from usuarios where perfil_id = p_id;
  if v_n > 0 then raise exception 'El perfil "%" lo usan % usuario(s): cambiales el perfil antes de eliminarlo', v.nombre, v_n; end if;
  delete from perfiles where id = p_id;
  perform usr_historial(s.s_empresa, 'perfil', null, null, v.nombre, 'eliminado', jsonb_build_object('nivel_base', v.nivel_base), s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', p_id);
end;
$fn$;

-- =============================================================================
-- 7. Migración: solo el Administrador queda protegido (el trigger fija sistema = codigo ADMIN)
-- =============================================================================
update :"schema".perfiles
   set sistema = coalesce(codigo = 'ADMIN', false)
 where sistema is distinct from coalesce(codigo = 'ADMIN', false);

-- =============================================================================
-- 8. Permisos de funciones
-- =============================================================================
revoke all on function :"schema".perfil_de_rol(uuid, text) from public, anon, authenticated;
revoke all on function :"schema".tg_perfiles_protegidos() from public, anon, authenticated;

commit;
