-- =============================================================================
-- DATOS DE LA EMPRESA (Configuración › Datos de la empresa).
--
-- Para qué: el encabezado de los documentos (presupuesto con diseño de factura A4, recibos,
-- estados de cuenta, remisiones, órdenes de compra y de pago, cierres de caja, reportes)
-- necesita la identificación fiscal del emisor. Hasta acá `empresas` solo tenía `nombre`.
--
--   · empresas: razon_social, nombre_fantasia, ruc (con DV), actividad_economica, direccion,
--     ciudad, departamento, telefono, email, web (+ updated_at / updated_by).
--     Sin timbrado: todavía no se factura (cuando llegue SIFEN va en su propia receta).
--     Sin logo_url: el logo de los documentos ya tiene su mecanismo (public/brand/logo-doc.png,
--     lo pone la instalación del cliente) y se respeta.
--   · empresas.nombre queda sincronizado con el nombre que se muestra (nombre de fantasía o,
--     si no hay, la razón social): lo usan pies de PDF y pantallas que ya existían.
--   · ruc_dv(base) / ruc_valido(ruc): dígito verificador módulo 11 de la SET (factores 2..11
--     desde la derecha; resto > 1 → 11 − resto, si no 0).
--     Decisión: un RUC con DV que no coincide se RECHAZA con un mensaje que dice cuál sería el
--     DV correcto. Un DV mal es casi siempre un error de tipeo y saldría impreso en cada
--     documento que se manda a los clientes; no hay caso legítimo para guardarlo así.
--   · datos_empresa(): lectura (cualquier usuario activo de la empresa: son los datos públicos
--     del membrete) + la sucursal principal como respaldo + si la sesión puede editar.
--   · guardar_datos_empresa(p jsonb): SECURITY DEFINER, search_path fijo, exige el permiso
--     "configuracion" (el Administrador lo tiene implícito). Es la ÚNICA vía de escritura:
--     `empresas` tiene INSERT/UPDATE/DELETE revocados a authenticated (receta 55).
--   · presupuesto_json (receta 53) se redefine para sumar al membrete razón social, nombre de
--     fantasía, RUC, actividad, email y web, con respaldo a sucursal / nombre como antes.
--     Si se vuelve a correr 53, correr 57 después.
--
-- IDEMPOTENTE. Va después de 53, 55 y 56.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columnas
-- =============================================================================
alter table :"schema".empresas
  add column if not exists razon_social        text,
  add column if not exists nombre_fantasia     text,
  add column if not exists ruc                 text,
  add column if not exists actividad_economica text,
  add column if not exists direccion           text,
  add column if not exists ciudad              text,
  add column if not exists departamento        text,
  add column if not exists telefono            text,
  add column if not exists email               text,
  add column if not exists web                 text,
  add column if not exists updated_at          timestamptz,
  add column if not exists updated_by          uuid;

-- =============================================================================
-- 2. RUC paraguayo: dígito verificador (módulo 11, algoritmo de la SET)
-- =============================================================================
create or replace function :"schema".ruc_dv(p_base text)
returns integer language plpgsql immutable set search_path = :"schema", public as $fn$
declare
  v_total integer := 0;
  v_k integer := 2;
  v_resto integer;
  i integer;
begin
  if p_base is null or p_base !~ '^\d+$' then return null; end if;
  for i in reverse length(p_base)..1 loop
    if v_k > 11 then v_k := 2; end if;
    v_total := v_total + substr(p_base, i, 1)::integer * v_k;
    v_k := v_k + 1;
  end loop;
  v_resto := v_total % 11;
  return case when v_resto > 1 then 11 - v_resto else 0 end;
end;
$fn$;

-- '80012345-0' → true. Formato: 3 a 8 dígitos, guion, 1 dígito (el DV).
create or replace function :"schema".ruc_valido(p_ruc text)
returns boolean language sql immutable set search_path = :"schema", public as $$
  select coalesce(p_ruc ~ '^\d{3,8}-\d$' and ruc_dv(split_part(p_ruc, '-', 1)) = split_part(p_ruc, '-', 2)::integer, false)
$$;

-- Departamentos de Paraguay (+ Capital) para el selector y la validación.
create or replace function :"schema".departamentos_py()
returns text[] language sql immutable set search_path = :"schema", public as $$
  select array['Capital', 'Concepción', 'San Pedro', 'Cordillera', 'Guairá', 'Caaguazú', 'Caazapá', 'Itapúa',
               'Misiones', 'Paraguarí', 'Alto Paraná', 'Central', 'Ñeembucú', 'Amambay', 'Canindeyú',
               'Presidente Hayes', 'Boquerón', 'Alto Paraguay']
$$;

-- =============================================================================
-- 3. Lectura
-- =============================================================================
create or replace function :"schema".datos_empresa()
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', e.id, 'nombre', e.nombre,
    'razon_social', e.razon_social, 'nombre_fantasia', e.nombre_fantasia, 'ruc', e.ruc,
    'actividad_economica', e.actividad_economica, 'direccion', e.direccion, 'ciudad', e.ciudad,
    'departamento', e.departamento, 'telefono', e.telefono, 'email', e.email, 'web', e.web,
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
-- 4. Escritura (única vía)
--   p: { razon_social, nombre_fantasia?, ruc?, actividad_economica?, direccion?, ciudad?,
--        departamento?, telefono?, email?, web? }   → datos_empresa()
-- =============================================================================
create or replace function :"schema".guardar_datos_empresa(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_razon text;
  v_fantasia text;
  v_ruc text;
  v_act text;
  v_dir text;
  v_ciudad text;
  v_depto text;
  v_tel text;
  v_email text;
  v_web text;
  v_dv integer;
begin
  select * into s from inv_sesion(null);
  perform exigir_permiso('configuracion');
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos de la empresa'; end if;

  -- Texto limpio: espacios de más fuera, vacío = null.
  v_razon    := nullif(regexp_replace(btrim(coalesce(p->>'razon_social', '')), '\s+', ' ', 'g'), '');
  v_fantasia := nullif(regexp_replace(btrim(coalesce(p->>'nombre_fantasia', '')), '\s+', ' ', 'g'), '');
  v_act      := nullif(regexp_replace(btrim(coalesce(p->>'actividad_economica', '')), '\s+', ' ', 'g'), '');
  v_dir      := nullif(regexp_replace(btrim(coalesce(p->>'direccion', '')), '\s+', ' ', 'g'), '');
  v_ciudad   := nullif(regexp_replace(btrim(coalesce(p->>'ciudad', '')), '\s+', ' ', 'g'), '');
  v_depto    := nullif(btrim(coalesce(p->>'departamento', '')), '');
  v_tel      := nullif(regexp_replace(btrim(coalesce(p->>'telefono', '')), '\s+', ' ', 'g'), '');
  v_email    := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_web      := nullif(regexp_replace(regexp_replace(lower(btrim(coalesce(p->>'web', ''))), '^https?://', ''), '/+$', ''), '');
  v_ruc      := nullif(upper(regexp_replace(coalesce(p->>'ruc', ''), '[\s.]', '', 'g')), '');

  if v_razon is null then raise exception 'Escribí la razón social (el nombre legal registrado en la SET)'; end if;
  if length(v_razon) < 2 or length(v_razon) > 160 then raise exception 'La razón social debe tener entre 2 y 160 caracteres'; end if;
  if length(coalesce(v_fantasia, '')) > 120 then raise exception 'El nombre de fantasía no puede pasar de 120 caracteres'; end if;
  if length(coalesce(v_act, '')) > 200 then raise exception 'La actividad económica no puede pasar de 200 caracteres'; end if;
  if length(coalesce(v_dir, '')) > 200 then raise exception 'La dirección no puede pasar de 200 caracteres'; end if;
  if length(coalesce(v_ciudad, '')) > 80 then raise exception 'La ciudad no puede pasar de 80 caracteres'; end if;

  if v_ruc is not null then
    if v_ruc !~ '^\d{3,8}-\d$' then
      raise exception 'RUC inválido: escribilo con el dígito verificador, por ejemplo 80012345-0 (de 3 a 8 números, guion y 1 número)';
    end if;
    v_dv := ruc_dv(split_part(v_ruc, '-', 1));
    if v_dv <> split_part(v_ruc, '-', 2)::integer then
      raise exception 'El dígito verificador del RUC no coincide: para % debería ser %-% (cálculo módulo 11 de la SET). Revisá el número',
        split_part(v_ruc, '-', 1), split_part(v_ruc, '-', 1), v_dv;
    end if;
  end if;
  if v_depto is not null and not (v_depto = any (departamentos_py())) then raise exception 'Elegí un departamento de la lista'; end if;
  if v_tel is not null and v_tel !~ '^[0-9 +()/-]{6,40}$' then raise exception 'Teléfono inválido: solo números, espacios y + ( ) - /'; end if;
  if v_email is not null and (length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$') then raise exception 'Email inválido'; end if;
  if v_web is not null and (length(v_web) > 160 or v_web !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/\S*)?$') then
    raise exception 'Sitio web inválido: escribilo como www.tuempresa.com.py';
  end if;

  update empresas
     set razon_social = v_razon, nombre_fantasia = v_fantasia, ruc = v_ruc, actividad_economica = v_act,
         direccion = v_dir, ciudad = v_ciudad, departamento = v_depto, telefono = v_tel, email = v_email, web = v_web,
         nombre = coalesce(v_fantasia, v_razon),
         updated_at = now(), updated_by = s.s_usuario
   where id = s.s_empresa;
  return datos_empresa();
end;
$fn$;

-- =============================================================================
-- 5. Membrete del presupuesto (redefine presupuesto_json de 53: igual + datos de la empresa)
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
revoke all on function :"schema".ruc_dv(text) from public, anon;
revoke all on function :"schema".ruc_valido(text) from public, anon;
revoke all on function :"schema".departamentos_py() from public, anon;
revoke all on function :"schema".datos_empresa() from public, anon;
revoke all on function :"schema".guardar_datos_empresa(jsonb) from public, anon;
grant execute on function :"schema".ruc_dv(text) to authenticated, service_role;
grant execute on function :"schema".ruc_valido(text) to authenticated, service_role;
grant execute on function :"schema".departamentos_py() to authenticated, service_role;
grant execute on function :"schema".datos_empresa() to authenticated, service_role;
grant execute on function :"schema".guardar_datos_empresa(jsonb) to authenticated, service_role;

-- Por las dudas: la escritura directa sigue cerrada (receta 55).
revoke insert, update, delete, truncate on :"schema".empresas from authenticated, anon;

commit;
