-- =============================================================================
-- LÍMITE DE USUARIOS POR EMPRESA (pedido del dueño, 27-oct-2026).
--
-- Cada empresa tiene como máximo `empresas.limite_usuarios` usuarios (por defecto 5). Para tener
-- más, el cliente habla con el soporte de Neura y Neura lo sube POR BASE DE DATOS: no hay pantalla
-- ni RPC ni API que lo cambie (un trigger lo impide en cualquier pedido que llegue por PostgREST,
-- incluso con service role).
--
-- ── Cómo subir (o bajar) el límite de una empresa (Neura, psql como postgres) ──────────────────
--   update <schema>.empresas set limite_usuarios = 8 where id = '<empresa_id>';
--   -- ej. demo:  update erp_demo.empresas set limite_usuarios = 8 where id = 'e10b45b1-fc68-4c60-a741-ea63788bba71';
--   -- ver cómo está:  select id, nombre, limite_usuarios,
--   --   (select count(*) from <schema>.usuarios u where u.empresa_id = e.id and u.activo) as usados
--   --   from <schema>.empresas e;
--   Bajarlo por debajo de los usados no desactiva a nadie: solo bloquea agregar nuevos.
--
-- ── Qué cuenta como usuario usado ───────────────────────────────────────────────────────────────
--   · Cada fila ACTIVA de usuarios de la empresa (usuarios.activo = true). Eso incluye las
--     invitaciones pendientes: en este modelo invitar CREA la fila del usuario (activa, sin
--     ingreso todavía); no hay tabla aparte de invitaciones. La fila no vence aunque venza el
--     link de GoTrue (el admin puede reenviarlo), así que la invitación pendiente ocupa su lugar
--     hasta que se la desactive.
--   · Los desactivados NO cuentan: desactivar a alguien libera un lugar.
--   · No hay usuario técnico / superusuario de Neura en el modelo (Neura opera por SQL), así que
--     no hay excepciones.
--
-- ── Control ─────────────────────────────────────────────────────────────────────────────────────
--   · Trigger tg_usuarios_cupo (BEFORE INSERT / UPDATE OF activo, empresa_id en usuarios): al
--     dar de alta (crear, invitar, vincular una cuenta existente) o REACTIVAR, toma el bloqueo de
--     la empresa (el mismo advisory lock que admin_actualizar_usuario / admin_guardar_perfil:
--     dos altas a la vez no pasan las dos) y, si ya hay `limite` activos, corta con:
--       "Llegaste al límite de N usuarios de tu plan. Para sumar más, hablá con el soporte de Neura."
--     Vale para admin_crear_usuario, admin_actualizar_usuario y cualquier escritura directa.
--   · La API (POST /api/configuracion/usuarios) consulta usuarios_cupo() ANTES de crear la cuenta
--     de acceso o mandar la invitación (no deja cuentas sueltas ni emails mandados de más).
--   · usuarios_cupo() → { limite, usados, disponibles, excedido } para quien administra usuarios.
--     admin_listar_usuarios (redefinida desde la 55) trae además `cupo` con lo mismo.
-- IDEMPOTENTE. SECURITY DEFINER + search_path fijo.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columna del límite (solo SQL)
-- =============================================================================
alter table :"schema".empresas add column if not exists limite_usuarios integer not null default 5;
alter table :"schema".empresas drop constraint if exists empresas_limite_usuarios_chk;
alter table :"schema".empresas add constraint empresas_limite_usuarios_chk check (limite_usuarios between 0 and 1000);

-- ¿El pedido viene de la app (PostgREST: anon / authenticated / service role)? Neura lo cambia
-- por psql (postgres / supabase_admin): ahí no hay rol de PostgREST ni claims de JWT.
create or replace function :"schema".tg_empresas_limite_usuarios()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_desde_app boolean := session_user::text = 'authenticator'
                         or coalesce(current_setting('request.jwt.claims', true), '') <> ''
                         or coalesce(current_setting('role', true), '') in ('anon', 'authenticated', 'service_role');
begin
  if not v_desde_app then return new; end if;
  if tg_op = 'INSERT' then
    new.limite_usuarios := 5;
  elsif new.limite_usuarios is distinct from old.limite_usuarios then
    raise exception 'El límite de usuarios lo cambia solo el soporte de Neura' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_empresas_limite_usuarios on :"schema".empresas;
create trigger trg_empresas_limite_usuarios before insert or update on :"schema".empresas
  for each row execute function :"schema".tg_empresas_limite_usuarios();

-- =============================================================================
-- 2. Cupo
-- =============================================================================
-- Interno (no se le da a nadie): cupo de una empresa.
create or replace function :"schema".usr_cupo(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'limite', x.limite, 'usados', x.usados,
    'disponibles', greatest(x.limite - x.usados, 0),
    'excedido', x.usados > x.limite)
    from (select coalesce((select e.limite_usuarios from empresas e where e.id = p_empresa), 5) as limite,
                 (select count(*)::integer from usuarios u where u.empresa_id = p_empresa and u.activo) as usados) x
$$;

-- Para la pantalla de Usuarios (nivel ADMIN + administrar_usuarios, como el resto de admin_*).
create or replace function :"schema".usuarios_cupo()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from usr_admin_sesion();
  return usr_cupo(s.s_empresa);
end;
$fn$;

-- =============================================================================
-- 3. Control en la base: alta / reactivación con el cupo lleno → error
-- =============================================================================
create or replace function :"schema".tg_usuarios_cupo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_limite integer;
  v_usados integer;
begin
  -- Solo cuando la fila pasa a ocupar un lugar: alta activa, reactivación o cambio de empresa.
  if not new.activo then return new; end if;
  if tg_op = 'UPDATE' and old.activo and new.empresa_id is not distinct from old.empresa_id then return new; end if;

  -- Bloqueo por empresa (mismo que admin_actualizar_usuario): altas simultáneas se serializan y
  -- el conteo de abajo ya ve lo que confirmó la otra.
  perform pg_advisory_xact_lock(hashtextextended('usuarios_admin:' || new.empresa_id::text, 0));
  select coalesce(limite_usuarios, 5) into v_limite from empresas where id = new.empresa_id;
  v_limite := coalesce(v_limite, 5);
  select count(*)::integer into v_usados from usuarios u
   where u.empresa_id = new.empresa_id and u.activo and u.id is distinct from new.id;
  if v_usados >= v_limite then
    raise exception 'Llegaste al límite de % usuarios de tu plan. Para sumar más, hablá con el soporte de Neura.', v_limite
      using errcode = 'P0001', hint = 'limite_usuarios';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_usuarios_cupo on :"schema".usuarios;
create trigger trg_usuarios_cupo before insert or update of activo, empresa_id on :"schema".usuarios
  for each row execute function :"schema".tg_usuarios_cupo();

-- =============================================================================
-- 4. admin_listar_usuarios (redefinida desde la 55): + cupo
-- =============================================================================
create or replace function :"schema".admin_listar_usuarios()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from usr_admin_sesion();
  return jsonb_build_object(
    'mi_usuario_id', s.s_usuario,
    'cupo', usr_cupo(s.s_empresa),
    'usuarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre, 'nombres', coalesce(u.nombres, u.nombre), 'apellidos', u.apellidos,
        'ci', u.ci, 'telefono', u.telefono, 'email', coalesce(u.email, au.email),
        'rol', upper(u.rol), 'perfil_id', u.perfil_id, 'perfil_nombre', pf.nombre, 'perfil_codigo', pf.codigo,
        'sucursal_id', u.sucursal_id, 'sucursal_nombre', su.nombre, 'activo', u.activo,
        'es_tecnico', u.es_tecnico, 'es_qa', u.es_qa, 'usa_soporte', u.usa_soporte,
        'origen', u.origen, 'creado_at', u.creado_at, 'invitado_at', u.invitado_at, 'updated_at', u.updated_at,
        'ultimo_ingreso', au.last_sign_in_at, 'email_confirmado', au.email_confirmed_at is not null,
        'pendiente', au.id is not null and au.last_sign_in_at is null,
        'sin_cuenta', au.id is null,
        'es_yo', u.id = s.s_usuario
      ) order by u.activo desc, lower(u.nombre))
        from usuarios u
        left join perfiles pf on pf.id = u.perfil_id
        left join sucursales su on su.id = u.sucursal_id
        left join auth.users au on au.id = u.auth_user_id
       where u.empresa_id = s.s_empresa), '[]'::jsonb),
    'perfiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', pf.id, 'nombre', pf.nombre, 'codigo', pf.codigo, 'sistema', pf.sistema,
                                          'nivel_base', pf.nivel_base, 'alcance_sucursal', pf.alcance_sucursal)
                       order by pf.sistema desc, case pf.codigo when 'ADMIN' then 1 when 'SUPERVISOR' then 2 when 'CAJERO' then 3 when 'VENDEDOR' then 4 else 5 end, lower(pf.nombre))
        from perfiles pf where pf.empresa_id = s.s_empresa), '[]'::jsonb),
    'sucursales', coalesce((
      select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre, 'activa', su.activa, 'es_principal', su.es_principal)
                       order by su.es_principal desc, su.nombre)
        from sucursales su where su.empresa_id = s.s_empresa), '[]'::jsonb)
  );
end;
$fn$;

-- =============================================================================
-- 5. Permisos
-- =============================================================================
revoke all on function :"schema".usr_cupo(uuid) from public, anon, authenticated, service_role;
revoke all on function :"schema".tg_usuarios_cupo() from public, anon, authenticated, service_role;
revoke all on function :"schema".tg_empresas_limite_usuarios() from public, anon, authenticated, service_role;
revoke all on function :"schema".usuarios_cupo() from public, anon;
revoke all on function :"schema".admin_listar_usuarios() from public, anon;
grant execute on function :"schema".usuarios_cupo() to authenticated, service_role;
grant execute on function :"schema".admin_listar_usuarios() to authenticated, service_role;
-- empresas: authenticated solo tiene SELECT; service role tiene UPDATE de tabla, pero el trigger
-- trg_empresas_limite_usuarios rechaza cualquier cambio de limite_usuarios que llegue por PostgREST.

commit;
