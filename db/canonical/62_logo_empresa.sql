-- =============================================================================
-- LOGO DE LA EMPRESA (Configuración › Datos de la empresa › Logo de los documentos).
--
-- Para qué: hasta acá el logo de los PDF era un archivo fijo de la instalación
-- (public/brand/logo-doc.png). Ahora cada empresa puede cargar el suyo.
--
--   · empresas: logo_path (ruta en el bucket), logo_url (URL pública), logo_mime,
--     logo_ancho / logo_alto (px, ya normalizado) y logo_actualizado (versión: los PDF
--     cachean por empresa + esta fecha, así un cambio se ve en el próximo PDF).
--   · Bucket `empresas-logos` PÚBLICO (un logo no es sensible; lo usa también el link
--     público del presupuesto). 1 MB, solo PNG / JPEG: el servidor de Next normaliza lo que
--     sube el usuario (PNG/JPG/WEBP ≤ 2 MB → PNG, o JPEG si no tiene transparencia, lado
--     mayor ≤ 600 px). Sin políticas para authenticated/anon en storage.objects: solo el
--     servidor (service role) escribe. Ruta: {schema}/{empresa_id}/logo-<marca>.{png|jpg}.
--   · guardar_logo_empresa(p jsonb): SECURITY DEFINER, solo Administrador con
--     "configuracion" (como guardar_datos_empresa + nivel ADMIN). p = null → vuelve al logo de la
--     instalación. Valida que la ruta sea de SU empresa. Devuelve datos_empresa() +
--     `logo_anterior` (ruta vieja, para que el servidor la borre del bucket).
--   · datos_empresa() (57) y presupuesto_json() (57) se redefinen para sumar el logo.
--     Si se vuelve a correr 57, correr 62 después.
--
-- IDEMPOTENTE. Va después de 56 y 57.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columnas
-- =============================================================================
alter table :"schema".empresas
  add column if not exists logo_path        text,
  add column if not exists logo_url         text,
  add column if not exists logo_mime        text,
  add column if not exists logo_ancho       integer,
  add column if not exists logo_alto        integer,
  add column if not exists logo_actualizado timestamptz;

-- =============================================================================
-- 2. Bucket (global del Supabase; público, escritura solo con service role)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('empresas-logos', 'empresas-logos', true, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================================
-- 3. Lectura (redefine la de 57: igual + logo)
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
-- 4. Escritura del logo (única vía)
--   p: { path, url, mime, ancho, alto }  |  null → logo de la instalación
-- =============================================================================
create or replace function :"schema".guardar_logo_empresa(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_anterior text;
  v_path text;
  v_url text;
  v_mime text;
  v_ancho integer;
  v_alto integer;
  v_prefijo text;
begin
  -- Sesión activa + Administrador + "configuracion" (mismo nivel que Datos de la empresa).
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if s.p_rol <> 'ADMIN' then raise exception 'Solo el Administrador puede cambiar el logo de los documentos' using errcode = '42501'; end if;
  perform exigir_permiso('configuracion');
  select logo_path into v_anterior from empresas where id = s.p_empresa for update;

  if p is null or jsonb_typeof(p) = 'null' then
    update empresas
       set logo_path = null, logo_url = null, logo_mime = null, logo_ancho = null, logo_alto = null,
           logo_actualizado = now(), updated_at = now(), updated_by = s.p_usuario
     where id = s.p_empresa;
    return datos_empresa() || jsonb_build_object('logo_anterior', v_anterior);
  end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Datos del logo inválidos'; end if;

  v_path  := btrim(coalesce(p->>'path', ''));
  v_url   := btrim(coalesce(p->>'url', ''));
  v_mime  := lower(btrim(coalesce(p->>'mime', '')));
  v_ancho := nullif(p->>'ancho', '')::integer;
  v_alto  := nullif(p->>'alto', '')::integer;
  v_prefijo := current_schema() || '/' || s.p_empresa::text || '/';

  if left(v_path, length(v_prefijo)) <> v_prefijo or v_path !~ '^[a-z0-9_]+/[0-9a-f-]{36}/logo-[0-9a-z-]{6,60}\.(png|jpg)$' then
    raise exception 'Ruta del logo inválida' using errcode = '42501';
  end if;
  if v_mime not in ('image/png', 'image/jpeg') then raise exception 'El logo debe quedar en PNG o JPEG'; end if;
  if (v_mime = 'image/png') <> (v_path like '%.png') then raise exception 'El tipo del logo no coincide con el archivo'; end if;
  if v_url !~ '^https?://' or right(v_url, length(v_path) + 1) <> '/' || v_path or length(v_url) > 600 then
    raise exception 'URL del logo inválida';
  end if;
  if v_ancho is null or v_alto is null or v_ancho < 1 or v_alto < 1 or v_ancho > 2000 or v_alto > 2000 then
    raise exception 'Tamaño del logo inválido';
  end if;

  update empresas
     set logo_path = v_path, logo_url = v_url, logo_mime = v_mime, logo_ancho = v_ancho, logo_alto = v_alto,
         logo_actualizado = now(), updated_at = now(), updated_by = s.p_usuario
   where id = s.p_empresa;
  return datos_empresa() || jsonb_build_object('logo_anterior', case when v_anterior is distinct from v_path then v_anterior end);
end;
$fn$;

-- =============================================================================
-- 5. Membrete del presupuesto (redefine presupuesto_json de 57: igual + logo)
-- =============================================================================
create or replace function :"schema".presupuesto_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'numero', p.numero, 'revision', p.revision, 'fecha', p.fecha, 'valido_hasta', p.valido_hasta,
    'validez_dias', p.validez_dias, 'estado', presupuesto_estado_efectivo(p.estado, p.valido_hasta),
    'moneda', p.moneda, 'tipo_cambio', p.tipo_cambio, 'condicion', p.condicion, 'plazo_dias', p.plazo_dias,
    'vendedor_nombre', p.vendedor_nombre,
    'cliente', jsonb_build_object('nombre', p.cliente_nombre, 'ruc', p.cliente_ruc, 'telefono', p.cliente_telefono,
                                  'email', p.cliente_email, 'direccion', p.cliente_direccion),
    'condiciones', p.condiciones, 'descuento_pct', p.descuento_pct,
    'subtotal_bruto', p.subtotal_bruto, 'descuento_lineas', p.descuento_lineas, 'descuento_global', p.descuento_global,
    'total', p.total, 'total_10', p.total_10, 'iva_10', p.iva_10, 'total_5', p.total_5, 'iva_5', p.iva_5,
    'total_exenta', p.total_exenta, 'total_iva', p.total_iva,
    'aceptado_at', p.aceptado_at, 'rechazado_at', p.rechazado_at, 'rechazo_motivo', p.rechazo_motivo,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'descripcion', i.descripcion, 'detalle', i.detalle, 'sku', i.sku, 'unidad', i.unidad,
                         'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario, 'descuento_pct', i.descuento_pct,
                         'tipo_iva', i.tipo_iva, 'total', i.total) order by i.orden)
                         from presupuestos_items i where i.presupuesto_id = p.id), '[]'::jsonb),
    -- Membrete del PDF: datos de la empresa (Configuración › Datos de la empresa) + sucursal
    -- del vendedor (o de quien lo cargó, o la principal) y el contacto del vendedor.
    -- Dirección / ciudad / teléfono: los de la sucursal si no es la principal (es donde atienden
    -- al cliente); en la principal, los de la empresa (casa matriz). Siempre con respaldo al otro.
    'emisor', (select jsonb_build_object(
                  'empresa', coalesce(nullif(e.nombre_fantasia, ''), nullif(e.razon_social, ''), e.nombre),
                  'razon_social', e.razon_social, 'nombre_fantasia', e.nombre_fantasia,
                  'ruc', e.ruc, 'actividad', e.actividad_economica,
                  'sucursal', s.nombre, 'sucursal_principal', coalesce(s.es_principal, true),
                  'direccion', case when coalesce(s.es_principal, true) then coalesce(nullif(e.direccion, ''), s.direccion)
                                    else coalesce(nullif(s.direccion, ''), e.direccion) end,
                  'ciudad', case when coalesce(s.es_principal, true) then coalesce(nullif(e.ciudad, ''), s.ciudad)
                                 else coalesce(nullif(s.ciudad, ''), e.ciudad) end,
                  'departamento', e.departamento,
                  'telefono', case when coalesce(s.es_principal, true) then coalesce(nullif(e.telefono, ''), s.telefono)
                                   else coalesce(nullif(s.telefono, ''), e.telefono) end,
                  'email', e.email, 'web', e.web,
                  -- Logo propio (receta 62): URL pública + tamaño + versión. null → el de la instalación.
                  'logo_url', e.logo_url, 'logo_mime', e.logo_mime, 'logo_ancho', e.logo_ancho, 'logo_alto', e.logo_alto,
                  'logo_actualizado', e.logo_actualizado,
                  'vendedor_telefono', v.telefono, 'vendedor_email', v.email,
                  'respuesta_online', coalesce(cfg.respuesta_online, true))
                 from empresas e
                 left join usuarios v on v.id = p.vendedor_id and v.empresa_id = p.empresa_id
                 left join usuarios c on c.id = p.created_by and c.empresa_id = p.empresa_id
                 left join lateral (
                   select s1.* from sucursales s1
                    where s1.empresa_id = p.empresa_id and s1.activa
                    order by (s1.id = v.sucursal_id) desc, (s1.id = c.sucursal_id) desc, s1.es_principal desc, s1.created_at
                    limit 1) s on true
                 left join presupuestos_config cfg on cfg.empresa_id = p.empresa_id
                where e.id = p.empresa_id))
    from presupuestos p where p.id = p_id
$fn$;

-- =============================================================================
-- 6. Permisos
-- =============================================================================
revoke all on function :"schema".presupuesto_json(uuid) from public;
revoke all on function :"schema".datos_empresa() from public, anon;
revoke all on function :"schema".guardar_logo_empresa(jsonb) from public, anon;
grant execute on function :"schema".datos_empresa() to authenticated, service_role;
grant execute on function :"schema".guardar_logo_empresa(jsonb) to authenticated, service_role;

-- La escritura directa sigue cerrada (receta 55).
revoke insert, update, delete, truncate on :"schema".empresas from authenticated, anon;

commit;
