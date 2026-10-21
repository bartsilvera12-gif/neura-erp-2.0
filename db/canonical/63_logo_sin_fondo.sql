-- =============================================================================
-- LOGO SIN FONDO (Configuración › Datos de la empresa › Logo de los documentos).
--
-- Para qué: al subir el logo, el servidor le quita el fondo liso automáticamente (relleno
-- desde los bordes con sharp, src/lib/empresa/logo-imagen.ts). Para poder deshacerlo se
-- guarda también el ORIGINAL normalizado en el bucket y se registra qué versión se usa.
--
--   · empresas: logo_original_path (ruta del original en `empresas-logos`:
--     {schema}/{empresa_id}/original-<marca>.{png|jpg}), logo_sin_fondo (la versión que usan
--     los PDF es la recortada) y logo_fondo (qué se detectó en el original: 'quitado' = había
--     un fondo liso y se puede quitar, 'no_detectado' = no había fondo liso, 'transparente' =
--     ya venía sin fondo).
--   · guardar_logo_empresa(p jsonb) se redefine (la de 62 + original/sin_fondo/fondo):
--     SECURITY DEFINER, solo Administrador con "configuracion". p = null → logo de la
--     instalación. Valida que las rutas sean de SU empresa. Devuelve datos_empresa() +
--     `logo_anterior` y `original_anterior` (rutas viejas, para que el servidor las borre).
--   · datos_empresa() (62) se redefine para sumar los campos nuevos.
--     Si se vuelve a correr 57 o 62, correr 63 después.
--
-- IDEMPOTENTE. Va después de 62.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columnas
-- =============================================================================
alter table :"schema".empresas
  add column if not exists logo_original_path text,
  add column if not exists logo_sin_fondo     boolean not null default false,
  add column if not exists logo_fondo         text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'empresas_logo_fondo_chk' and conrelid = 'empresas'::regclass
  ) then
    alter table empresas add constraint empresas_logo_fondo_chk
      check (logo_fondo is null or logo_fondo in ('quitado', 'no_detectado', 'transparente'));
  end if;
end $$;

-- =============================================================================
-- 2. Lectura (redefine la de 62: igual + original / sin fondo)
-- =============================================================================
create or replace function :"schema".datos_empresa()
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', e.id, 'nombre', e.nombre,
    'razon_social', e.razon_social, 'nombre_fantasia', e.nombre_fantasia, 'ruc', e.ruc,
    'actividad_economica', e.actividad_economica, 'direccion', e.direccion, 'ciudad', e.ciudad,
    'departamento', e.departamento, 'telefono', e.telefono, 'email', e.email, 'web', e.web,
    'logo_url', e.logo_url, 'logo_path', e.logo_path, 'logo_mime', e.logo_mime,
    'logo_ancho', e.logo_ancho, 'logo_alto', e.logo_alto, 'logo_actualizado', e.logo_actualizado,
    'logo_original_path', e.logo_original_path, 'logo_sin_fondo', e.logo_sin_fondo, 'logo_fondo', e.logo_fondo,
    'updated_at', e.updated_at,
    'updated_by_nombre', (select u.nombre from usuarios u where u.id = e.updated_by),
    'sucursal_principal', (select jsonb_build_object('nombre', s.nombre, 'direccion', s.direccion, 'ciudad', s.ciudad, 'telefono', s.telefono)
                             from sucursales s where s.empresa_id = e.id and s.activa
                            order by s.es_principal desc, s.created_at limit 1),
    'puede_editar', tiene_permiso('configuracion'))
    from empresas e
   where e.id = (select u.empresa_id from usuarios u where u.auth_user_id = auth.uid() and u.activo limit 1)
$$;

-- =============================================================================
-- 3. Escritura del logo (única vía; redefine la de 62)
--   p: { path, url, mime, ancho, alto, original_path?, sin_fondo?, fondo? }
--      | null → logo de la instalación
-- =============================================================================
create or replace function :"schema".guardar_logo_empresa(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_anterior text;
  v_orig_anterior text;
  v_path text;
  v_url text;
  v_mime text;
  v_ancho integer;
  v_alto integer;
  v_orig text;
  v_sin_fondo boolean;
  v_fondo text;
  v_prefijo text;
begin
  -- Sesión activa + Administrador + "configuracion" (mismo nivel que Datos de la empresa).
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if s.p_rol <> 'ADMIN' then raise exception 'Solo el Administrador puede cambiar el logo de los documentos' using errcode = '42501'; end if;
  perform exigir_permiso('configuracion');
  select logo_path, logo_original_path into v_anterior, v_orig_anterior from empresas where id = s.p_empresa for update;

  if p is null or jsonb_typeof(p) = 'null' then
    update empresas
       set logo_path = null, logo_url = null, logo_mime = null, logo_ancho = null, logo_alto = null,
           logo_original_path = null, logo_sin_fondo = false, logo_fondo = null,
           logo_actualizado = now(), updated_at = now(), updated_by = s.p_usuario
     where id = s.p_empresa;
    return datos_empresa() || jsonb_build_object('logo_anterior', v_anterior, 'original_anterior', v_orig_anterior);
  end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Datos del logo inválidos'; end if;

  v_path  := btrim(coalesce(p->>'path', ''));
  v_url   := btrim(coalesce(p->>'url', ''));
  v_mime  := lower(btrim(coalesce(p->>'mime', '')));
  v_ancho := nullif(p->>'ancho', '')::integer;
  v_alto  := nullif(p->>'alto', '')::integer;
  v_orig  := nullif(btrim(coalesce(p->>'original_path', '')), '');
  v_sin_fondo := coalesce((p->>'sin_fondo')::boolean, false);
  v_fondo := nullif(btrim(coalesce(p->>'fondo', '')), '');
  v_prefijo := current_schema() || '/' || s.p_empresa::text || '/';

  if left(v_path, length(v_prefijo)) <> v_prefijo or v_path !~ '^[a-z0-9_]+/[0-9a-f-]{36}/logo-[0-9a-z-]{6,60}\.(png|jpg)$' then
    raise exception 'Ruta del logo inválida' using errcode = '42501';
  end if;
  if v_orig is not null and (left(v_orig, length(v_prefijo)) <> v_prefijo
                             or v_orig !~ '^[a-z0-9_]+/[0-9a-f-]{36}/original-[0-9a-z-]{6,60}\.(png|jpg)$') then
    raise exception 'Ruta del logo original inválida' using errcode = '42501';
  end if;
  if v_mime not in ('image/png', 'image/jpeg') then raise exception 'El logo debe quedar en PNG o JPEG'; end if;
  if (v_mime = 'image/png') <> (v_path like '%.png') then raise exception 'El tipo del logo no coincide con el archivo'; end if;
  if v_sin_fondo and v_mime <> 'image/png' then raise exception 'El logo sin fondo debe quedar en PNG'; end if;
  if v_fondo is not null and v_fondo not in ('quitado', 'no_detectado', 'transparente') then raise exception 'Resultado del fondo inválido'; end if;
  if v_sin_fondo and v_fondo is distinct from 'quitado' then raise exception 'No se puede marcar sin fondo un logo al que no se le quitó'; end if;
  if v_url !~ '^https?://' or right(v_url, length(v_path) + 1) <> '/' || v_path or length(v_url) > 600 then
    raise exception 'URL del logo inválida';
  end if;
  if v_ancho is null or v_alto is null or v_ancho < 1 or v_alto < 1 or v_ancho > 2000 or v_alto > 2000 then
    raise exception 'Tamaño del logo inválido';
  end if;

  update empresas
     set logo_path = v_path, logo_url = v_url, logo_mime = v_mime, logo_ancho = v_ancho, logo_alto = v_alto,
         logo_original_path = v_orig, logo_sin_fondo = v_sin_fondo, logo_fondo = v_fondo,
         logo_actualizado = now(), updated_at = now(), updated_by = s.p_usuario
   where id = s.p_empresa;
  return datos_empresa() || jsonb_build_object(
    'logo_anterior', case when v_anterior is distinct from v_path then v_anterior end,
    'original_anterior', case when v_orig_anterior is distinct from v_orig then v_orig_anterior end);
end;
$fn$;

-- =============================================================================
-- 4. Permisos
-- =============================================================================
revoke all on function :"schema".datos_empresa() from public, anon;
revoke all on function :"schema".guardar_logo_empresa(jsonb) from public, anon;
grant execute on function :"schema".datos_empresa() to authenticated, service_role;
grant execute on function :"schema".guardar_logo_empresa(jsonb) to authenticated, service_role;

-- La escritura directa sigue cerrada (receta 55).
revoke insert, update, delete, truncate on :"schema".empresas from authenticated, anon;

commit;
