-- =============================================================================
-- CONEXIONES DE USUARIOS: quién está conectado ahora y cuándo se conectó por última vez.
--
--   · usuarios_conexion: una fila por usuario. La app avisa cada 30 s mientras el sistema está a la
--     vista (marcar_conexion). Conectado = avisó en los últimos 90 s y no salió.
--   · Cerrar la pestaña o la sesión marca la salida al momento; si otra pestaña sigue abierta, la
--     conexión se repone en su próximo aviso. Si se corta internet, se apaga sola a los 90 s.
--   · admin_conexiones_usuarios: la lista para Configuración › Usuarios, con el mismo control que
--     admin_listar_usuarios. Quien no avisó nunca usa su último ingreso de la cuenta de acceso.
--   · La tabla no se lee ni se escribe directo: solo por estas dos funciones.
--
-- IDEMPOTENTE. Va después de 110.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create table if not exists :"schema".usuarios_conexion (
  usuario_id uuid primary key references :"schema".usuarios(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ultima_actividad timestamptz not null default now(),
  salio_at timestamptz
);
alter table :"schema".usuarios_conexion enable row level security;
alter table :"schema".usuarios_conexion force row level security;
revoke all on :"schema".usuarios_conexion from public, anon, authenticated;

create or replace function :"schema".marcar_conexion(p_salir boolean default false)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_usuario uuid;
  v_empresa uuid;
begin
  select id, empresa_id into v_usuario, v_empresa from usuarios where auth_user_id = auth.uid() and activo;
  if v_usuario is null then return; end if;
  insert into usuarios_conexion (usuario_id, empresa_id, ultima_actividad, salio_at)
  values (v_usuario, v_empresa, now(), case when p_salir then now() end)
  on conflict (usuario_id) do update set ultima_actividad = now(), salio_at = excluded.salio_at;
end;
$fn$;

create or replace function :"schema".admin_conexiones_usuarios()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from usr_admin_sesion();
  return coalesce((
    select jsonb_agg(f.fila order by f.conectado desc, f.activo desc, f.ultima desc nulls last, lower(f.nombre))
      from (
        select u.nombre, u.activo,
               coalesce(u.activo and c.salio_at is null and c.ultima_actividad > now() - interval '90 seconds', false) as conectado,
               greatest(c.ultima_actividad, au.last_sign_in_at) as ultima,
               jsonb_build_object(
                 'id', u.id, 'nombre', u.nombre, 'email', coalesce(u.email, au.email),
                 'perfil_nombre', pf.nombre, 'perfil_codigo', pf.codigo,
                 'activo', u.activo, 'es_yo', u.id = s.s_usuario,
                 'conectado', coalesce(u.activo and c.salio_at is null and c.ultima_actividad > now() - interval '90 seconds', false),
                 'ultima_conexion', greatest(c.ultima_actividad, au.last_sign_in_at)
               ) as fila
          from usuarios u
          left join usuarios_conexion c on c.usuario_id = u.id
          left join perfiles pf on pf.id = u.perfil_id
          left join auth.users au on au.id = u.auth_user_id
         where u.empresa_id = s.s_empresa
      ) f
  ), '[]'::jsonb);
end;
$fn$;

revoke all on function :"schema".marcar_conexion(boolean) from public, anon;
revoke all on function :"schema".admin_conexiones_usuarios() from public, anon;
grant execute on function :"schema".marcar_conexion(boolean) to authenticated;
grant execute on function :"schema".admin_conexiones_usuarios() to authenticated;

commit;

notify pgrst, 'reload schema';
