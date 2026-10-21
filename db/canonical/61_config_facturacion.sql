-- =============================================================================
-- CONFIGURACIÓN DE FACTURACIÓN (Configuración › Facturación y › Facturación electrónica).
-- Portada de sistemas-propio (/configuracion/facturacion y /configuracion/facturacion-electronica).
--
--   · facturacion_config (1 fila por empresa): modo de facturación (sin factura fiscal /
--     SIFEN / autoimpresor), tipo de impresión por defecto, "pedir datos del comprador al
--     confirmar venta", prefijo y numeración inicial de las ventas, días de vencimiento por
--     defecto para crédito, interés moratorio (% mensual) y el interruptor de la gestión
--     tributaria de clientes. Sin fila = valores por defecto (VTA-, 1, 30 días, 1,5 %).
--     En sistemas-propio prefijo/numeración/vencimiento/interés vivían en el localStorage del
--     navegador y nada los leía: acá se guardan en la base y el sistema los obedece:
--       - siguiente_numero_venta(): numeración de crear_venta (caja), emitir_factura_contado
--         (ficha del cliente) y emitir_cuota_suscripcion. Las tres funciones se REESCRIBEN acá
--         (se reemplaza solo su bloque de numeración, el resto queda igual). Si se vuelve a
--         correr 11 / 29 / 45 / 50 / 51 / 55, correr 61 después.
--       - tg_ventas_cxc (de 25): la venta a crédito sin plazo (ni en la venta ni en el cliente)
--         vence a los "días de vencimiento por defecto" (antes: 30 fijo).
--   · facturacion_autoimpresor: datos del timbrado de factura impresa (igual que el original).
--   · sifen_config: datos del emisor SIFEN (ambiente, RUC, razón social, dirección fiscal,
--     timbrado y su inicio de vigencia dFeIniT, actividad cActEco/dDesActEco, establecimiento,
--     punto de expedición, ID del CSC, plazo de cancelación, metadatos del certificado y
--     colores del KuDE). Sin secretos.
--   · sifen_secretos: el .p12 (bytea), su contraseña y el CSC CIFRADOS (AES-256-GCM del lado
--     del servidor con SIFEN_SECRETS_KEY) y el logo del KuDE. SIN ningún privilegio para
--     anon/authenticated (ni SELECT): solo se escribe por las funciones de acá y solo lo lee
--     el servidor con service_role. Ninguna función devuelve su contenido: solo "cargado" /
--     "configurada".
--   · obligaciones_tributarias_catalogo + cliente_perfil_tributario: perfil tributario
--     opcional por cliente (obligaciones, DV, razón social fiscal, clave tributaria cifrada,
--     día de vencimiento, honorarios, notas). La columna de la clave no tiene SELECT.
--
-- Escritura: SOLO por funciones SECURITY DEFINER (search_path fijo) que validan la empresa de
-- la sesión, el nivel ADMIN y el permiso "configuracion" (perfil tributario: ADMIN/VENDEDOR).
-- Las tablas nuevas tienen solo SELECT para authenticated (y la de secretos, nada).
--
-- IDEMPOTENTE. Va después de 25, 29, 45, 55, 57.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
create table if not exists :"schema".facturacion_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  modo text not null default 'sin_factura_fiscal'
    check (modo in ('sin_factura_fiscal', 'sifen', 'autoimpresor')),
  impresion_tipo_default text not null default 'ticket_80mm'
    check (impresion_tipo_default in ('pdf_a4', 'pdf_media_hoja', 'ticket_80mm', 'ticket_58mm')),
  preguntar_datos_al_confirmar boolean not null default false,
  prefijo_factura text not null default 'VTA-' check (prefijo_factura ~ '^[A-Z0-9][A-Z0-9/_.-]{0,11}$'),
  numeracion_inicial bigint not null default 1 check (numeracion_inicial between 1 and 999999999),
  dias_vencimiento_default integer not null default 30 check (dias_vencimiento_default between 0 and 365),
  interes_moratorio numeric(6,2) not null default 1.5 check (interes_moratorio between 0 and 100),
  gestion_tributaria_clientes boolean not null default false,
  updated_at timestamptz,
  updated_by uuid
);

create table if not exists :"schema".facturacion_autoimpresor (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  activo boolean not null default false,
  ruc_emisor text,
  razon_social_emisor text,
  nombre_fantasia text,
  direccion_matriz text,
  telefono text,
  timbrado_numero text,
  timbrado_inicio_vigencia date,
  timbrado_fin_vigencia date,
  establecimiento_codigo text,
  punto_expedicion_codigo text,
  numero_actual bigint,
  numero_inicial bigint,
  numero_final bigint,
  tipo_documento_default text not null default 'factura' check (tipo_documento_default in ('factura', 'ticket', 'nota_venta', 'otro')),
  formato_impresion_default text not null default 'pdf_a4'
    check (formato_impresion_default in ('pdf_a4', 'pdf_media_hoja', 'ticket_80mm', 'ticket_58mm')),
  leyenda_papel_termico text,
  observaciones text,
  updated_at timestamptz,
  updated_by uuid
);

create table if not exists :"schema".sifen_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  ambiente text not null default 'test' check (ambiente in ('test', 'produccion')),
  activo boolean not null default false,
  ruc text not null,
  razon_social text not null,
  direccion_fiscal text,
  timbrado_numero text not null,
  timbrado_fecha_inicio_vigencia date not null,
  actividad_economica_codigo text not null,
  actividad_economica_descripcion text not null,
  establecimiento text not null,
  punto_expedicion text not null,
  csc_id text,
  plazo_cancelacion_horas integer not null default 48 check (plazo_cancelacion_horas between 1 and 8760),
  certificado_nombre text,
  certificado_titular text,
  certificado_vencimiento date,
  certificado_subido_at timestamptz,
  kude_color_primario text check (kude_color_primario is null or kude_color_primario ~ '^#[0-9a-f]{6}$'),
  kude_color_primario_fill text check (kude_color_primario_fill is null or kude_color_primario_fill ~ '^#[0-9a-f]{6}$'),
  kude_logo_subido_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid
);

-- Secretos: nadie salvo el servidor (service_role) y las funciones de escritura de acá.
create table if not exists :"schema".sifen_secretos (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  certificado_p12 bytea,
  certificado_password_cifrada text,
  csc_cifrado text,
  kude_logo_png bytea,
  updated_at timestamptz not null default now()
);

create table if not exists :"schema".obligaciones_tributarias_catalogo (
  slug text primary key,
  nombre text not null,
  requiere_detalle_otro boolean not null default false,
  orden smallint not null default 0
);
insert into :"schema".obligaciones_tributarias_catalogo (slug, nombre, requiere_detalle_otro, orden) values
  ('iva_general', 'IVA General', false, 10),
  ('ire_simple', 'IRE Simple', false, 20),
  ('ire_general', 'IRE General', false, 30),
  ('resimple', 'RESIMPLE', false, 40),
  ('ips', 'IPS', false, 50),
  ('sin_obligacion', 'Sin obligación', false, 60),
  ('otro', 'Otro', true, 70)
on conflict (slug) do nothing;

create table if not exists :"schema".cliente_perfil_tributario (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  perfil_activo boolean not null default false,
  dv text,
  razon_social_fiscal text,
  clave_tributaria_cifrada text,
  dia_vencimiento_tributario smallint check (dia_vencimiento_tributario between 1 and 31),
  honorario_mensual numeric check (honorario_mensual >= 0),
  honorario_anual numeric check (honorario_anual >= 0),
  notas_tributarias text,
  obligaciones text[] not null default '{}',
  obligacion_otro_detalle text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (empresa_id, cliente_id)
);

-- =============================================================================
-- 2. RLS y privilegios: solo SELECT (los secretos y la clave tributaria, ni eso)
-- =============================================================================
alter table :"schema".facturacion_config enable row level security;
alter table :"schema".facturacion_config force row level security;
alter table :"schema".facturacion_autoimpresor enable row level security;
alter table :"schema".facturacion_autoimpresor force row level security;
alter table :"schema".sifen_config enable row level security;
alter table :"schema".sifen_config force row level security;
alter table :"schema".sifen_secretos enable row level security;
alter table :"schema".sifen_secretos force row level security;
alter table :"schema".obligaciones_tributarias_catalogo enable row level security;
alter table :"schema".cliente_perfil_tributario enable row level security;
alter table :"schema".cliente_perfil_tributario force row level security;

drop policy if exists facturacion_config_propia on :"schema".facturacion_config;
create policy facturacion_config_propia on :"schema".facturacion_config for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists facturacion_autoimpresor_propio on :"schema".facturacion_autoimpresor;
create policy facturacion_autoimpresor_propio on :"schema".facturacion_autoimpresor for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists sifen_config_propia on :"schema".sifen_config;
create policy sifen_config_propia on :"schema".sifen_config for select to authenticated
  using (empresa_id = :"schema".empresa_actual() and :"schema".tiene_permiso('configuracion'));
drop policy if exists obligaciones_catalogo_lectura on :"schema".obligaciones_tributarias_catalogo;
create policy obligaciones_catalogo_lectura on :"schema".obligaciones_tributarias_catalogo for select to authenticated
  using (true);
drop policy if exists cliente_perfil_tributario_propio on :"schema".cliente_perfil_tributario;
create policy cliente_perfil_tributario_propio on :"schema".cliente_perfil_tributario for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
-- sifen_secretos: SIN políticas → con RLS forzada, nadie que no sea service_role ve una fila.

-- Los default privileges del core dan insert/update/delete a authenticated: acá NO.
revoke all on :"schema".facturacion_config, :"schema".facturacion_autoimpresor, :"schema".sifen_config,
              :"schema".sifen_secretos, :"schema".obligaciones_tributarias_catalogo, :"schema".cliente_perfil_tributario
  from anon, authenticated;
grant select on :"schema".facturacion_config, :"schema".facturacion_autoimpresor, :"schema".sifen_config,
                :"schema".obligaciones_tributarias_catalogo
  to authenticated;
-- Perfil tributario: todas las columnas menos la clave cifrada.
grant select (empresa_id, cliente_id, perfil_activo, dv, razon_social_fiscal, dia_vencimiento_tributario,
              honorario_mensual, honorario_anual, notas_tributarias, obligaciones, obligacion_otro_detalle,
              updated_at, updated_by)
  on :"schema".cliente_perfil_tributario to authenticated;
grant all on :"schema".facturacion_config, :"schema".facturacion_autoimpresor, :"schema".sifen_config,
             :"schema".sifen_secretos, :"schema".obligaciones_tributarias_catalogo, :"schema".cliente_perfil_tributario
  to service_role;

-- =============================================================================
-- 3. Helpers
-- =============================================================================

-- Sesión de un ADMIN con "Configuración del sistema" (corta con mensaje claro si no).
create or replace function :"schema".fac_sesion_admin(out p_empresa uuid, out p_usuario uuid)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if s.p_rol <> 'ADMIN' then
    raise exception 'Solo el Administrador puede cambiar la configuración de facturación' using errcode = '42501';
  end if;
  perform exigir_permiso('configuracion');
  p_empresa := s.p_empresa;
  p_usuario := s.p_usuario;
end;
$fn$;

-- Texto limpio: espacios de más fuera, vacío = null.
create or replace function :"schema".fac_txt(p text)
returns text language sql immutable set search_path = :"schema", public as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

-- Próximo número de venta según la configuración (prefijo + 6 dígitos, nunca repite):
-- el mayor de "el último con ese prefijo + 1" y la numeración inicial. SIN lock: el que
-- emite ya tiene pg_advisory_xact_lock('ventas_numero_<empresa>') (misma llave en las 3).
create or replace function :"schema".siguiente_numero_venta(p_empresa uuid)
returns text language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_pref text := 'VTA-';
  v_ini bigint := 1;
  v_max bigint;
  v_n text;
begin
  select c.prefijo_factura, c.numeracion_inicial into v_pref, v_ini from facturacion_config c where c.empresa_id = p_empresa;
  v_pref := coalesce(v_pref, 'VTA-');
  v_ini := coalesce(v_ini, 1);
  select max(substring(v.numero_control from length(v_pref) + 1)::bigint) into v_max
    from ventas v
   where v.empresa_id = p_empresa
     and left(v.numero_control, length(v_pref)) = v_pref
     and substring(v.numero_control from length(v_pref) + 1) ~ '^[0-9]{1,18}$';
  v_n := greatest(coalesce(v_max, 0) + 1, v_ini)::text;
  return v_pref || case when length(v_n) >= 6 then v_n else lpad(v_n, 6, '0') end;
end;
$fn$;

-- Días por defecto para una venta a crédito sin plazo (ni en la venta ni en el cliente).
create or replace function :"schema".dias_vencimiento_default(p_empresa uuid)
returns integer language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((select c.dias_vencimiento_default from facturacion_config c where c.empresa_id = p_empresa), 30)
$$;

-- =============================================================================
-- 4. La configuración obedecida por el resto del sistema
-- =============================================================================

-- 4.a Numeración: las 3 funciones que emiten ventas pasan a usar siguiente_numero_venta.
--     Se reemplaza solo el bloque "max(VTA-…)+1" (el lock queda). Idempotente: si ya no está
--     el bloque viejo, no hace nada.
do $do$
declare
  r record;
  v_def text;
  v_nueva text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.prokind = 'f'
       and p.proname in ('crear_venta', 'emitir_factura_contado', 'emitir_cuota_suscripcion')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_nueva := regexp_replace(v_def,
      'select coalesce\(max\(case when numero_control ~ ''\^VTA-\[0-9\]\+\$''\s+then substring\(numero_control from ''\[0-9\]\+\$''\)::bigint end\), 0\) \+ 1\s+into v_next from ventas where empresa_id = v_empresa;\s+v_numero := ''VTA-'' \|\| lpad\(v_next::text, 6, ''0''\);',
      'v_numero := siguiente_numero_venta(v_empresa);  -- 61: prefijo y numeración de Configuración › Facturación');
    if v_nueva <> v_def then
      execute v_nueva;
      raise notice 'numeración configurable: %', r.oid::regprocedure;
    end if;
  end loop;
end;
$do$;

-- 4.b Cuenta a cobrar de la venta a crédito (de 25): igual, con el plazo por defecto configurable.
create or replace function :"schema".tg_ventas_cxc()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare
  v_plazo integer;
  v_cobrado numeric;
begin
  if new.tipo_venta <> 'CREDITO' or new.cliente_id is null then
    return null;
  end if;
  if new.estado = 'anulada' then
    select cobrado into v_cobrado from cuentas_por_cobrar where venta_id = new.id;
    if coalesce(v_cobrado, 0) > 0 then
      raise exception 'La venta % ya tiene cobros: anulá primero los recibos de ese cliente', new.numero_control;
    end if;
    update cuentas_por_cobrar set estado = 'anulada', updated_at = now() where venta_id = new.id;
    return null;
  end if;
  -- 61: sin plazo en la venta ni en el cliente → "Días de vencimiento por defecto" (antes 30 fijo).
  select coalesce(new.plazo_dias, c.plazo_dias, dias_vencimiento_default(new.empresa_id)) into v_plazo
    from clientes c where c.id = new.cliente_id;
  v_plazo := coalesce(v_plazo, dias_vencimiento_default(new.empresa_id));
  insert into cuentas_por_cobrar (empresa_id, venta_id, cliente_id, numero, fecha_emision, vencimiento, monto)
    values (new.empresa_id, new.id, new.cliente_id, new.numero_control,
            (new.fecha at time zone 'America/Asuncion')::date,
            (new.fecha at time zone 'America/Asuncion')::date + v_plazo, new.total)
  on conflict (venta_id) do update
     set monto = excluded.monto, cliente_id = excluded.cliente_id, numero = excluded.numero,
         estado = estado_cxc(excluded.monto, cuentas_por_cobrar.cobrado, false), updated_at = now();
  return null;
end;
$fn$;

-- =============================================================================
-- 5. Lectura de la configuración (cualquier usuario activo: la caja la necesita)
-- =============================================================================
create or replace function :"schema".config_facturacion()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c facturacion_config;
  a facturacion_autoimpresor;
  e empresas;
  sc sifen_config;
  v_sec record;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  select * into c from facturacion_config where empresa_id = s.p_empresa;
  select * into a from facturacion_autoimpresor where empresa_id = s.p_empresa;
  select * into e from empresas where id = s.p_empresa;
  select * into sc from sifen_config where empresa_id = s.p_empresa;
  select (x.certificado_p12 is not null) as cert, (x.certificado_password_cifrada is not null) as pw
    into v_sec from sifen_secretos x where x.empresa_id = s.p_empresa;

  return jsonb_build_object(
    'modo', coalesce(c.modo, 'sin_factura_fiscal'),
    'impresion_tipo_default', coalesce(c.impresion_tipo_default, 'ticket_80mm'),
    'preguntar_datos_al_confirmar', coalesce(c.preguntar_datos_al_confirmar, false),
    'prefijo_factura', coalesce(c.prefijo_factura, 'VTA-'),
    'numeracion_inicial', coalesce(c.numeracion_inicial, 1),
    'dias_vencimiento_default', coalesce(c.dias_vencimiento_default, 30),
    'interes_moratorio', coalesce(c.interes_moratorio, 1.5),
    'gestion_tributaria_clientes', coalesce(c.gestion_tributaria_clientes, false),
    'updated_at', c.updated_at,
    'updated_by_nombre', (select u.nombre from usuarios u where u.id = c.updated_by),
    'proximo_numero', siguiente_numero_venta(s.p_empresa),
    'ultimo_numero', (select v.numero_control from ventas v where v.empresa_id = s.p_empresa order by v.created_at desc limit 1),
    'sifen', jsonb_build_object(
      'configurada', sc.empresa_id is not null,
      'activo', coalesce(sc.activo, false),
      'ambiente', sc.ambiente,
      'completa', coalesce(sc.empresa_id is not null and sc.activo and sc.direccion_fiscal is not null
                  and coalesce(v_sec.cert, false) and coalesce(v_sec.pw, false), false)),
    -- Autoimpresor: lo guardado; lo vacío se precarga de Datos de la empresa (como sugerencia).
    'autoimpresor', jsonb_build_object(
      'guardado', a.empresa_id is not null,
      'activo', coalesce(a.activo, false),
      'ruc_emisor', coalesce(a.ruc_emisor, e.ruc),
      'razon_social_emisor', coalesce(a.razon_social_emisor, upper(e.razon_social)),
      'nombre_fantasia', coalesce(a.nombre_fantasia, upper(e.nombre_fantasia)),
      'direccion_matriz', coalesce(a.direccion_matriz, upper(e.direccion)),
      'telefono', coalesce(a.telefono, e.telefono),
      'timbrado_numero', a.timbrado_numero,
      'timbrado_inicio_vigencia', a.timbrado_inicio_vigencia,
      'timbrado_fin_vigencia', a.timbrado_fin_vigencia,
      'establecimiento_codigo', a.establecimiento_codigo,
      'punto_expedicion_codigo', a.punto_expedicion_codigo,
      'numero_actual', a.numero_actual,
      'numero_inicial', a.numero_inicial,
      'numero_final', a.numero_final,
      'tipo_documento_default', coalesce(a.tipo_documento_default, 'factura'),
      'formato_impresion_default', coalesce(a.formato_impresion_default, 'pdf_a4'),
      'leyenda_papel_termico', a.leyenda_papel_termico,
      'observaciones', a.observaciones),
    'puede_editar', s.p_rol = 'ADMIN' and tiene_permiso('configuracion'));
end;
$fn$;

-- =============================================================================
-- 6. Escritura de la configuración general (parcial: solo las claves que vienen)
--   p: { modo?, impresion_tipo_default?, preguntar_datos_al_confirmar?, prefijo_factura?,
--        numeracion_inicial?, dias_vencimiento_default?, interes_moratorio?,
--        gestion_tributaria_clientes? } → config_facturacion()
-- =============================================================================
create or replace function :"schema".guardar_config_facturacion(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c facturacion_config;
  v_txt text;
  v_num numeric;
begin
  select * into s from fac_sesion_admin();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos de la configuración'; end if;

  insert into facturacion_config (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  select * into c from facturacion_config where empresa_id = s.p_empresa for update;

  if p ? 'modo' then
    if coalesce(p->>'modo', '') not in ('sin_factura_fiscal', 'sifen', 'autoimpresor') then raise exception 'Modo de facturación inválido'; end if;
    c.modo := p->>'modo';
  end if;
  if p ? 'impresion_tipo_default' then
    if coalesce(p->>'impresion_tipo_default', '') not in ('pdf_a4', 'pdf_media_hoja', 'ticket_80mm', 'ticket_58mm') then
      raise exception 'Tipo de impresión inválido';
    end if;
    c.impresion_tipo_default := p->>'impresion_tipo_default';
  end if;
  if p ? 'preguntar_datos_al_confirmar' then
    if jsonb_typeof(p->'preguntar_datos_al_confirmar') <> 'boolean' then raise exception '"Pedir datos del comprador" debe ser sí o no'; end if;
    c.preguntar_datos_al_confirmar := (p->>'preguntar_datos_al_confirmar')::boolean;
  end if;
  if p ? 'gestion_tributaria_clientes' then
    if jsonb_typeof(p->'gestion_tributaria_clientes') <> 'boolean' then raise exception 'La gestión tributaria debe ser sí o no'; end if;
    c.gestion_tributaria_clientes := (p->>'gestion_tributaria_clientes')::boolean;
  end if;
  if p ? 'prefijo_factura' then
    v_txt := upper(regexp_replace(coalesce(p->>'prefijo_factura', ''), '\s+', '', 'g'));
    if v_txt = '' then raise exception 'Escribí el prefijo de factura (ej. FAC-, FT-, VTA-)'; end if;
    if v_txt !~ '^[A-Z0-9][A-Z0-9/_.-]{0,11}$' then
      raise exception 'Prefijo inválido: hasta 12 letras o números y - / _ . (ej. FAC-, 001-001-)';
    end if;
    c.prefijo_factura := v_txt;
  end if;
  if p ? 'numeracion_inicial' then
    v_num := nullif(p->>'numeracion_inicial', '')::numeric;
    if v_num is null or v_num <> trunc(v_num) or v_num < 1 or v_num > 999999999 then
      raise exception 'La numeración inicial debe ser un número entero desde 1';
    end if;
    c.numeracion_inicial := v_num::bigint;
  end if;
  if p ? 'dias_vencimiento_default' then
    v_num := nullif(p->>'dias_vencimiento_default', '')::numeric;
    if v_num is null or v_num <> trunc(v_num) or v_num < 0 or v_num > 365 then
      raise exception 'Los días de vencimiento deben ser un número entero entre 0 y 365';
    end if;
    c.dias_vencimiento_default := v_num::integer;
  end if;
  if p ? 'interes_moratorio' then
    v_num := nullif(p->>'interes_moratorio', '')::numeric;
    if v_num is null or v_num < 0 or v_num > 100 then raise exception 'El interés moratorio debe estar entre 0 y 100 %% mensual'; end if;
    c.interes_moratorio := round(v_num, 2);
  end if;

  update facturacion_config
     set modo = c.modo, impresion_tipo_default = c.impresion_tipo_default,
         preguntar_datos_al_confirmar = c.preguntar_datos_al_confirmar, gestion_tributaria_clientes = c.gestion_tributaria_clientes,
         prefijo_factura = c.prefijo_factura, numeracion_inicial = c.numeracion_inicial,
         dias_vencimiento_default = c.dias_vencimiento_default, interes_moratorio = c.interes_moratorio,
         updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return config_facturacion();
end;
$fn$;

-- =============================================================================
-- 7. Autoimpresor (formulario completo, igual que el original) → config_facturacion()
-- =============================================================================
create or replace function :"schema".guardar_autoimpresor(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a facturacion_autoimpresor;
  v_err text[] := '{}';
  v_ini_txt text;
  v_fin_txt text;
begin
  select * into s from fac_sesion_admin();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos del autoimpresor'; end if;

  a.activo := coalesce((p->>'activo')::boolean, false);
  a.ruc_emisor := fac_txt(p->>'ruc_emisor');
  a.razon_social_emisor := upper(fac_txt(p->>'razon_social_emisor'));
  a.nombre_fantasia := upper(fac_txt(p->>'nombre_fantasia'));
  a.direccion_matriz := upper(fac_txt(p->>'direccion_matriz'));
  a.telefono := fac_txt(p->>'telefono');
  a.timbrado_numero := fac_txt(p->>'timbrado_numero');
  v_ini_txt := fac_txt(p->>'timbrado_inicio_vigencia');
  v_fin_txt := fac_txt(p->>'timbrado_fin_vigencia');
  if v_ini_txt is not null and v_ini_txt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Inicio de vigencia inválido'; end if;
  if v_fin_txt is not null and v_fin_txt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fin de vigencia inválido'; end if;
  a.timbrado_inicio_vigencia := v_ini_txt::date;
  a.timbrado_fin_vigencia := v_fin_txt::date;
  a.establecimiento_codigo := fac_txt(p->>'establecimiento_codigo');
  a.punto_expedicion_codigo := fac_txt(p->>'punto_expedicion_codigo');
  a.numero_actual := nullif(p->>'numero_actual', '')::bigint;
  a.numero_inicial := nullif(p->>'numero_inicial', '')::bigint;
  a.numero_final := nullif(p->>'numero_final', '')::bigint;
  a.tipo_documento_default := coalesce(nullif(p->>'tipo_documento_default', ''), 'factura');
  if a.tipo_documento_default not in ('factura', 'ticket', 'nota_venta', 'otro') then a.tipo_documento_default := 'factura'; end if;
  a.formato_impresion_default := coalesce(nullif(p->>'formato_impresion_default', ''), 'pdf_a4');
  if a.formato_impresion_default not in ('pdf_a4', 'pdf_media_hoja', 'ticket_80mm', 'ticket_58mm') then a.formato_impresion_default := 'pdf_a4'; end if;
  a.leyenda_papel_termico := upper(fac_txt(p->>'leyenda_papel_termico'));
  a.observaciones := upper(fac_txt(p->>'observaciones'));

  if a.ruc_emisor is not null and a.ruc_emisor !~ '^\d{3,8}-\d$' then
    raise exception 'RUC emisor inválido: escribilo con el dígito verificador, ej. 80012345-0';
  end if;
  if a.numero_actual < 1 or a.numero_inicial < 1 or a.numero_final < 1 then raise exception 'Los números del rango deben ser desde 1'; end if;

  -- Activo: mínimos para poder emitir (mismas reglas que el original).
  if a.activo then
    if a.timbrado_numero is null then v_err := v_err || 'Timbrado obligatorio.'; end if;
    if a.establecimiento_codigo is null then v_err := v_err || 'Establecimiento obligatorio.'; end if;
    if a.punto_expedicion_codigo is null then v_err := v_err || 'Punto de expedición obligatorio.'; end if;
    if a.numero_actual is null then v_err := v_err || 'Número actual obligatorio.'; end if;
    if a.numero_inicial is null then v_err := v_err || 'Número inicial obligatorio.'; end if;
    if a.numero_final is null then v_err := v_err || 'Número final obligatorio.'; end if;
    if a.numero_inicial > a.numero_final then v_err := v_err || 'Número inicial debe ser ≤ número final.'; end if;
    if a.numero_actual < a.numero_inicial then v_err := v_err || 'Número actual no puede ser menor al inicial.'; end if;
    if a.numero_actual > a.numero_final then v_err := v_err || 'Número actual no puede ser mayor al final.'; end if;
    if a.timbrado_fin_vigencia is null then v_err := v_err || 'Fin de vigencia del timbrado obligatorio.'; end if;
    if array_length(v_err, 1) > 0 then raise exception '%', array_to_string(v_err, ' · '); end if;
  end if;
  if a.timbrado_inicio_vigencia is not null and a.timbrado_fin_vigencia is not null and a.timbrado_fin_vigencia < a.timbrado_inicio_vigencia then
    raise exception 'El fin de vigencia del timbrado no puede ser anterior al inicio';
  end if;

  insert into facturacion_autoimpresor (
    empresa_id, activo, ruc_emisor, razon_social_emisor, nombre_fantasia, direccion_matriz, telefono,
    timbrado_numero, timbrado_inicio_vigencia, timbrado_fin_vigencia, establecimiento_codigo, punto_expedicion_codigo,
    numero_actual, numero_inicial, numero_final, tipo_documento_default, formato_impresion_default,
    leyenda_papel_termico, observaciones, updated_at, updated_by)
  values (
    s.p_empresa, a.activo, a.ruc_emisor, a.razon_social_emisor, a.nombre_fantasia, a.direccion_matriz, a.telefono,
    a.timbrado_numero, a.timbrado_inicio_vigencia, a.timbrado_fin_vigencia, a.establecimiento_codigo, a.punto_expedicion_codigo,
    a.numero_actual, a.numero_inicial, a.numero_final, a.tipo_documento_default, a.formato_impresion_default,
    a.leyenda_papel_termico, a.observaciones, now(), s.p_usuario)
  on conflict (empresa_id) do update set
    activo = excluded.activo, ruc_emisor = excluded.ruc_emisor, razon_social_emisor = excluded.razon_social_emisor,
    nombre_fantasia = excluded.nombre_fantasia, direccion_matriz = excluded.direccion_matriz, telefono = excluded.telefono,
    timbrado_numero = excluded.timbrado_numero, timbrado_inicio_vigencia = excluded.timbrado_inicio_vigencia,
    timbrado_fin_vigencia = excluded.timbrado_fin_vigencia, establecimiento_codigo = excluded.establecimiento_codigo,
    punto_expedicion_codigo = excluded.punto_expedicion_codigo, numero_actual = excluded.numero_actual,
    numero_inicial = excluded.numero_inicial, numero_final = excluded.numero_final,
    tipo_documento_default = excluded.tipo_documento_default, formato_impresion_default = excluded.formato_impresion_default,
    leyenda_papel_termico = excluded.leyenda_papel_termico, observaciones = excluded.observaciones,
    updated_at = now(), updated_by = s.p_usuario;
  return config_facturacion();
end;
$fn$;

-- =============================================================================
-- 8. SIFEN: lectura (sin secretos: solo si están cargados)
-- =============================================================================
create or replace function :"schema".sifen_config_leer()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c sifen_config;
  e empresas;
  x record;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  perform exigir_permiso('configuracion');
  select * into c from sifen_config where empresa_id = s.p_empresa;
  select * into e from empresas where id = s.p_empresa;
  select (k.certificado_p12 is not null) as cert, coalesce(octet_length(k.certificado_p12), 0) as cert_bytes,
         (k.certificado_password_cifrada is not null) as pw, (k.csc_cifrado is not null) as csc,
         (k.kude_logo_png is not null) as logo
    into x from sifen_secretos k where k.empresa_id = s.p_empresa;

  return jsonb_build_object(
    'config', case when c.empresa_id is null then null else jsonb_build_object(
      'ambiente', c.ambiente, 'activo', c.activo, 'ruc', c.ruc, 'razon_social', c.razon_social,
      'direccion_fiscal', c.direccion_fiscal, 'timbrado_numero', c.timbrado_numero,
      'timbrado_fecha_inicio_vigencia', c.timbrado_fecha_inicio_vigencia,
      'actividad_economica_codigo', c.actividad_economica_codigo,
      'actividad_economica_descripcion', c.actividad_economica_descripcion,
      'establecimiento', c.establecimiento, 'punto_expedicion', c.punto_expedicion, 'csc_id', c.csc_id,
      'plazo_cancelacion_horas', c.plazo_cancelacion_horas,
      'certificado_nombre', c.certificado_nombre, 'certificado_titular', c.certificado_titular,
      'certificado_vencimiento', c.certificado_vencimiento, 'certificado_subido_at', c.certificado_subido_at,
      'kude_color_primario', c.kude_color_primario, 'kude_color_primario_fill', c.kude_color_primario_fill,
      'kude_logo_subido_at', c.kude_logo_subido_at,
      'updated_at', coalesce(c.updated_at, c.created_at),
      'updated_by_nombre', (select u.nombre from usuarios u where u.id = c.updated_by)) end,
    'secretos', jsonb_build_object(
      'certificado', coalesce(x.cert, false), 'certificado_bytes', coalesce(x.cert_bytes, 0),
      'password', coalesce(x.pw, false), 'csc', coalesce(x.csc, false), 'kude_logo', coalesce(x.logo, false)),
    -- Datos de la empresa: precarga del emisor y link a editarlos.
    'empresa', jsonb_build_object(
      'razon_social', e.razon_social, 'nombre_fantasia', e.nombre_fantasia, 'ruc', e.ruc,
      'actividad_economica', e.actividad_economica, 'direccion', e.direccion, 'ciudad', e.ciudad),
    'puede_editar', s.p_rol = 'ADMIN' and tiene_permiso('configuracion'));
end;
$fn$;

-- =============================================================================
-- 9. SIFEN: crear / actualizar datos del emisor (sin secretos)
--   Sin fila: exige todos los obligatorios (como el POST del original). Con fila: actualiza
--   solo las claves que vienen (como el PATCH). → sifen_config_leer()
-- =============================================================================
create or replace function :"schema".sifen_config_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c sifen_config;
  v_existe boolean;
  v_txt text;
  v_num numeric;
  v_dv integer;
  v_tiene_cert boolean;
begin
  select * into s from fac_sesion_admin();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos de SIFEN'; end if;

  select * into c from sifen_config where empresa_id = s.p_empresa for update;
  v_existe := found;
  if not v_existe then
    c.empresa_id := s.p_empresa;
    c.ambiente := 'test';
    c.activo := true;
    c.plazo_cancelacion_horas := 48;
    -- Crear: todos los obligatorios tienen que venir.
    foreach v_txt in array array['ambiente', 'ruc', 'razon_social', 'timbrado_numero', 'timbrado_fecha_inicio_vigencia',
                                 'actividad_economica_codigo', 'actividad_economica_descripcion', 'establecimiento', 'punto_expedicion'] loop
      if fac_txt(p->>v_txt) is null then
        raise exception 'Para crear la configuración SIFEN completá: %', case v_txt
          when 'ambiente' then 'el ambiente' when 'ruc' then 'el RUC' when 'razon_social' then 'la razón social'
          when 'timbrado_numero' then 'el número de timbrado' when 'timbrado_fecha_inicio_vigencia' then 'el inicio de vigencia del timbrado'
          when 'actividad_economica_codigo' then 'el código de actividad económica' when 'actividad_economica_descripcion' then 'la descripción de la actividad económica'
          when 'establecimiento' then 'el establecimiento' else 'el punto de expedición' end;
      end if;
    end loop;
  end if;

  if p ? 'ambiente' then
    if coalesce(p->>'ambiente', '') not in ('test', 'produccion') then raise exception 'El ambiente debe ser Test o Producción'; end if;
    c.ambiente := p->>'ambiente';
  end if;
  if p ? 'activo' then
    if jsonb_typeof(p->'activo') <> 'boolean' then raise exception '"SIFEN activo" debe ser sí o no'; end if;
    c.activo := (p->>'activo')::boolean;
  end if;
  if p ? 'ruc' then
    v_txt := upper(regexp_replace(coalesce(p->>'ruc', ''), '[\s.]', '', 'g'));
    if v_txt = '' then raise exception 'El RUC no puede quedar vacío'; end if;
    if v_txt !~ '^\d{3,8}-\d$' then raise exception 'RUC inválido: escribilo con el dígito verificador, ej. 80012345-0'; end if;
    v_dv := ruc_dv(split_part(v_txt, '-', 1));
    if v_dv <> split_part(v_txt, '-', 2)::integer then
      raise exception 'El dígito verificador del RUC no coincide: para % debería ser %-%', split_part(v_txt, '-', 1), split_part(v_txt, '-', 1), v_dv;
    end if;
    c.ruc := v_txt;
  end if;
  if p ? 'razon_social' then
    v_txt := fac_txt(p->>'razon_social');
    if v_txt is null then raise exception 'La razón social no puede quedar vacía'; end if;
    if length(v_txt) > 160 then raise exception 'La razón social no puede pasar de 160 caracteres'; end if;
    c.razon_social := v_txt;
  end if;
  if p ? 'direccion_fiscal' then
    v_txt := fac_txt(p->>'direccion_fiscal');
    if length(coalesce(v_txt, '')) > 255 then raise exception 'La dirección fiscal no puede pasar de 255 caracteres'; end if;
    c.direccion_fiscal := v_txt;
  end if;
  if p ? 'timbrado_numero' then
    v_txt := regexp_replace(coalesce(p->>'timbrado_numero', ''), '\s', '', 'g');
    if v_txt = '' then raise exception 'El número de timbrado no puede quedar vacío'; end if;
    if v_txt !~ '^\d{1,15}$' then raise exception 'El timbrado tiene que ser solo números'; end if;
    c.timbrado_numero := v_txt;
  end if;
  if p ? 'timbrado_fecha_inicio_vigencia' then
    v_txt := fac_txt(p->>'timbrado_fecha_inicio_vigencia');
    if v_txt is null then raise exception 'El inicio de vigencia del timbrado es obligatorio: usá la «Fecha inicio vigencia» del timbrado en la DNIT'; end if;
    if v_txt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Inicio de vigencia del timbrado inválido'; end if;
    c.timbrado_fecha_inicio_vigencia := v_txt::date;
  end if;
  if p ? 'actividad_economica_codigo' or p ? 'actividad_economica_descripcion' then
    v_txt := regexp_replace(coalesce(p->>'actividad_economica_codigo', ''), '\D', '', 'g');
    if v_txt = '' then raise exception 'El código de actividad económica (cActEco) es obligatorio'; end if;
    if v_txt !~ '^\d{4,8}$' then raise exception 'El código de actividad económica debe tener de 4 a 8 números (catálogo SET)'; end if;
    c.actividad_economica_codigo := v_txt;
    v_txt := fac_txt(p->>'actividad_economica_descripcion');
    if v_txt is null then raise exception 'La descripción de la actividad económica (dDesActEco) es obligatoria'; end if;
    if length(v_txt) > 600 then raise exception 'La descripción de la actividad económica es demasiado larga'; end if;
    c.actividad_economica_descripcion := v_txt;
  end if;
  if p ? 'establecimiento' then
    v_txt := btrim(coalesce(p->>'establecimiento', ''));
    if v_txt = '' then raise exception 'El establecimiento no puede quedar vacío'; end if;
    if v_txt !~ '^\d{1,3}$' then raise exception 'El establecimiento son hasta 3 números (ej. 001)'; end if;
    c.establecimiento := lpad(v_txt, 3, '0');
  end if;
  if p ? 'punto_expedicion' then
    v_txt := btrim(coalesce(p->>'punto_expedicion', ''));
    if v_txt = '' then raise exception 'El punto de expedición no puede quedar vacío'; end if;
    if v_txt !~ '^\d{1,3}$' then raise exception 'El punto de expedición son hasta 3 números (ej. 001)'; end if;
    c.punto_expedicion := lpad(v_txt, 3, '0');
  end if;
  if p ? 'csc_id' then
    v_txt := btrim(coalesce(p->>'csc_id', ''));
    if v_txt <> '' and v_txt !~ '^\d{1,4}$' then raise exception 'El ID del CSC son hasta 4 números (ej. 0001)'; end if;
    c.csc_id := case when v_txt = '' then null else lpad(v_txt, 4, '0') end;
  end if;
  if p ? 'plazo_cancelacion_horas' then
    v_num := nullif(p->>'plazo_cancelacion_horas', '')::numeric;
    if v_num is null then raise exception 'El plazo de cancelación no puede quedar vacío'; end if;
    c.plazo_cancelacion_horas := least(8760, greatest(1, floor(v_num)))::integer;
  end if;
  if p ? 'certificado_vencimiento' then
    v_txt := fac_txt(p->>'certificado_vencimiento');
    if v_txt is not null and v_txt !~ '^\d{4}-\d{2}-\d{2}' then raise exception 'Fecha de vencimiento del certificado no válida'; end if;
    c.certificado_vencimiento := left(v_txt, 10)::date;
  end if;
  if p ? 'kude_color_primario' then
    v_txt := lower(btrim(coalesce(p->>'kude_color_primario', '')));
    if v_txt ~ '^#[0-9a-f]{3}$' then v_txt := '#' || repeat(substr(v_txt, 2, 1), 2) || repeat(substr(v_txt, 3, 1), 2) || repeat(substr(v_txt, 4, 1), 2); end if;
    if v_txt <> '' and v_txt !~ '^#[0-9a-f]{6}$' then raise exception 'Color primario inválido. Formato esperado: #RRGGBB (ej. #0ea5e9)'; end if;
    c.kude_color_primario := nullif(v_txt, '');
  end if;
  if p ? 'kude_color_primario_fill' then
    v_txt := lower(btrim(coalesce(p->>'kude_color_primario_fill', '')));
    if v_txt ~ '^#[0-9a-f]{3}$' then v_txt := '#' || repeat(substr(v_txt, 2, 1), 2) || repeat(substr(v_txt, 3, 1), 2) || repeat(substr(v_txt, 4, 1), 2); end if;
    if v_txt <> '' and v_txt !~ '^#[0-9a-f]{6}$' then raise exception 'Color de acento inválido. Formato esperado: #RRGGBB'; end if;
    c.kude_color_primario_fill := nullif(v_txt, '');
  end if;

  -- Con un .p12 cargado, el vencimiento es obligatorio (regla del original).
  select k.certificado_p12 is not null into v_tiene_cert from sifen_secretos k where k.empresa_id = s.p_empresa;
  if coalesce(v_tiene_cert, false) and c.certificado_vencimiento is null then
    raise exception 'Indicá la fecha de vencimiento del certificado .p12 cargado';
  end if;

  if v_existe then
    update sifen_config set
      ambiente = c.ambiente, activo = c.activo, ruc = c.ruc, razon_social = c.razon_social, direccion_fiscal = c.direccion_fiscal,
      timbrado_numero = c.timbrado_numero, timbrado_fecha_inicio_vigencia = c.timbrado_fecha_inicio_vigencia,
      actividad_economica_codigo = c.actividad_economica_codigo, actividad_economica_descripcion = c.actividad_economica_descripcion,
      establecimiento = c.establecimiento, punto_expedicion = c.punto_expedicion, csc_id = c.csc_id,
      plazo_cancelacion_horas = c.plazo_cancelacion_horas, certificado_vencimiento = c.certificado_vencimiento,
      kude_color_primario = c.kude_color_primario, kude_color_primario_fill = c.kude_color_primario_fill,
      updated_at = now(), updated_by = s.p_usuario
     where empresa_id = s.p_empresa;
  else
    insert into sifen_config (empresa_id, ambiente, activo, ruc, razon_social, direccion_fiscal, timbrado_numero,
                              timbrado_fecha_inicio_vigencia, actividad_economica_codigo, actividad_economica_descripcion,
                              establecimiento, punto_expedicion, csc_id, plazo_cancelacion_horas, certificado_vencimiento,
                              kude_color_primario, kude_color_primario_fill, updated_at, updated_by)
    values (s.p_empresa, c.ambiente, c.activo, c.ruc, c.razon_social, c.direccion_fiscal, c.timbrado_numero,
            c.timbrado_fecha_inicio_vigencia, c.actividad_economica_codigo, c.actividad_economica_descripcion,
            c.establecimiento, c.punto_expedicion, c.csc_id, c.plazo_cancelacion_horas, c.certificado_vencimiento,
            c.kude_color_primario, c.kude_color_primario_fill, now(), s.p_usuario);
  end if;
  return sifen_config_leer();
end;
$fn$;

-- =============================================================================
-- 10. SIFEN: secretos (llegan YA cifrados por el servidor; nunca se devuelven)
-- =============================================================================

-- p: { password_cifrada?, limpiar_password?, csc_cifrado?, limpiar_csc? } → sifen_config_leer()
create or replace function :"schema".sifen_guardar_secretos(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from fac_sesion_admin();
  if not exists (select 1 from sifen_config where empresa_id = s.p_empresa) then
    raise exception 'Guardá primero la configuración SIFEN base';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos'; end if;
  if coalesce(p->>'password_cifrada', '') <> '' and p->>'password_cifrada' !~ '^neura:v1:' then raise exception 'Contraseña sin cifrar: no se guarda'; end if;
  if coalesce(p->>'csc_cifrado', '') <> '' and p->>'csc_cifrado' !~ '^neura:v1:' then raise exception 'CSC sin cifrar: no se guarda'; end if;

  insert into sifen_secretos (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  update sifen_secretos set
    certificado_password_cifrada = case when coalesce((p->>'limpiar_password')::boolean, false) then null
                                        when coalesce(p->>'password_cifrada', '') <> '' then p->>'password_cifrada'
                                        else certificado_password_cifrada end,
    csc_cifrado = case when coalesce((p->>'limpiar_csc')::boolean, false) then null
                       when coalesce(p->>'csc_cifrado', '') <> '' then p->>'csc_cifrado'
                       else csc_cifrado end,
    updated_at = now()
   where empresa_id = s.p_empresa;
  update sifen_config set updated_at = now(), updated_by = s.p_usuario where empresa_id = s.p_empresa;
  return sifen_config_leer();
end;
$fn$;

-- Certificado .p12 (base64; el servidor ya lo validó y leyó titular / vencimiento si tenía
-- la contraseña). p_password_cifrada: la contraseña con que se validó (opcional).
create or replace function :"schema".sifen_guardar_certificado(
  p_p12_b64 text, p_nombre text, p_titular text default null, p_vencimiento date default null, p_password_cifrada text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_bin bytea;
begin
  select * into s from fac_sesion_admin();
  if not exists (select 1 from sifen_config where empresa_id = s.p_empresa) then
    raise exception 'Guardá primero la configuración SIFEN base para habilitar la subida del certificado';
  end if;
  if coalesce(p_p12_b64, '') = '' then raise exception 'Falta el archivo .p12'; end if;
  v_bin := decode(p_p12_b64, 'base64');
  if octet_length(v_bin) > 5 * 1024 * 1024 then raise exception 'El certificado supera el tamaño máximo permitido (5 MB)'; end if;
  if get_byte(v_bin, 0) <> 48 then raise exception 'El archivo no parece un certificado .p12 / .pfx'; end if; -- 0x30: SEQUENCE DER
  if coalesce(p_password_cifrada, '') <> '' and p_password_cifrada !~ '^neura:v1:' then raise exception 'Contraseña sin cifrar: no se guarda'; end if;

  insert into sifen_secretos (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  update sifen_secretos set
    certificado_p12 = v_bin,
    certificado_password_cifrada = coalesce(nullif(p_password_cifrada, ''), certificado_password_cifrada),
    updated_at = now()
   where empresa_id = s.p_empresa;
  update sifen_config set
    certificado_nombre = left(fac_txt(p_nombre), 160),
    certificado_titular = left(fac_txt(p_titular), 300),
    certificado_vencimiento = coalesce(p_vencimiento, certificado_vencimiento),
    certificado_subido_at = now(), updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return sifen_config_leer();
end;
$fn$;

-- Logo del KuDE (PNG base64, ≤ 1 MB). null = volver al logo por defecto. Solo afecta el PDF.
create or replace function :"schema".sifen_guardar_kude_logo(p_png_b64 text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_bin bytea;
begin
  select * into s from fac_sesion_admin();
  if not exists (select 1 from sifen_config where empresa_id = s.p_empresa) then
    raise exception 'Guardá primero la configuración SIFEN base para habilitar la subida del logo';
  end if;
  if coalesce(p_png_b64, '') <> '' then
    v_bin := decode(p_png_b64, 'base64');
    if octet_length(v_bin) > 1024 * 1024 then raise exception 'El logo supera el máximo permitido (1 MB)'; end if;
    if substring(v_bin from 1 for 8) <> '\x89504e470d0a1a0a'::bytea then raise exception 'Solo se acepta logo en formato PNG'; end if;
  end if;
  insert into sifen_secretos (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  update sifen_secretos set kude_logo_png = v_bin, updated_at = now() where empresa_id = s.p_empresa;
  update sifen_config set kude_logo_subido_at = case when v_bin is null then null else now() end,
                          updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return sifen_config_leer();
end;
$fn$;

-- =============================================================================
-- 11. Perfil tributario de clientes (solo con la gestión tributaria activada)
-- =============================================================================
create or replace function :"schema".perfil_tributario_cliente(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  t cliente_perfil_tributario;
  v_on boolean;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = s.p_empresa) then raise exception 'Cliente no encontrado'; end if;
  select coalesce(c.gestion_tributaria_clientes, false) into v_on from facturacion_config c where c.empresa_id = s.p_empresa;
  select * into t from cliente_perfil_tributario where empresa_id = s.p_empresa and cliente_id = p_cliente;
  return jsonb_build_object(
    'gestion_tributaria_clientes', coalesce(v_on, false),
    'puede_editar', coalesce(v_on, false) and s.p_rol in ('ADMIN', 'VENDEDOR'),
    'catalogo', (select coalesce(jsonb_agg(jsonb_build_object('slug', o.slug, 'nombre', o.nombre, 'requiere_detalle_otro', o.requiere_detalle_otro) order by o.orden), '[]'::jsonb)
                   from obligaciones_tributarias_catalogo o),
    'perfil', case when t.cliente_id is null then null else jsonb_build_object(
      'perfil_activo', t.perfil_activo, 'dv', t.dv, 'razon_social_fiscal', t.razon_social_fiscal,
      'dia_vencimiento_tributario', t.dia_vencimiento_tributario,
      'honorario_mensual', t.honorario_mensual, 'honorario_anual', t.honorario_anual,
      'notas_tributarias', t.notas_tributarias, 'obligacion_otro_detalle', t.obligacion_otro_detalle,
      'obligaciones', to_jsonb(t.obligaciones),
      'clave_tributaria_configurada', t.clave_tributaria_cifrada is not null,
      'updated_at', t.updated_at,
      'updated_by_nombre', (select u.nombre from usuarios u where u.id = t.updated_by)) end);
end;
$fn$;

-- p: { perfil_activo, dv?, razon_social_fiscal?, dia_vencimiento_tributario?, honorario_mensual?,
--      honorario_anual?, notas_tributarias?, obligaciones: text[], obligacion_otro_detalle?,
--      clave_cifrada? (ya cifrada por el servidor), limpiar_clave? } → perfil_tributario_cliente()
create or replace function :"schema".guardar_perfil_tributario(p_cliente uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_on boolean;
  v_activo boolean;
  v_obl text[];
  v_otro text;
  v_dia numeric;
  v_hm numeric;
  v_ha numeric;
  o text;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if s.p_rol not in ('ADMIN', 'VENDEDOR') then raise exception 'Tu perfil no puede editar clientes' using errcode = '42501'; end if;
  select coalesce(c.gestion_tributaria_clientes, false) into v_on from facturacion_config c where c.empresa_id = s.p_empresa;
  if not coalesce(v_on, false) then raise exception 'La empresa no tiene activa la gestión tributaria de clientes' using errcode = '42501'; end if;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = s.p_empresa) then raise exception 'Cliente no encontrado'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos del perfil'; end if;

  v_activo := coalesce((p->>'perfil_activo')::boolean, false);
  v_obl := coalesce(array(select distinct jsonb_array_elements_text(case when jsonb_typeof(p->'obligaciones') = 'array' then p->'obligaciones' else '[]'::jsonb end)), '{}');
  foreach o in array v_obl loop
    if not exists (select 1 from obligaciones_tributarias_catalogo where slug = o) then raise exception 'Obligación inválida o desconocida'; end if;
  end loop;
  v_otro := fac_txt(p->>'obligacion_otro_detalle');
  if v_activo and 'otro' = any (v_obl) and v_otro is null then raise exception 'Indicá el detalle cuando seleccionás la obligación "Otro".'; end if;
  v_dia := nullif(p->>'dia_vencimiento_tributario', '')::numeric;
  if v_dia is not null and (v_dia <> trunc(v_dia) or v_dia < 1 or v_dia > 31) then raise exception 'El día de vencimiento tributario debe estar entre 1 y 31'; end if;
  v_hm := nullif(p->>'honorario_mensual', '')::numeric;
  v_ha := nullif(p->>'honorario_anual', '')::numeric;
  if v_hm < 0 or v_ha < 0 then raise exception 'Los honorarios no pueden ser negativos'; end if;
  if coalesce(p->>'clave_cifrada', '') <> '' and p->>'clave_cifrada' !~ '^neura:v1:' then raise exception 'Clave sin cifrar: no se guarda'; end if;

  insert into cliente_perfil_tributario (empresa_id, cliente_id) values (s.p_empresa, p_cliente)
  on conflict (empresa_id, cliente_id) do nothing;
  update cliente_perfil_tributario set
    perfil_activo = v_activo,
    dv = left(fac_txt(p->>'dv'), 2),
    razon_social_fiscal = left(upper(fac_txt(p->>'razon_social_fiscal')), 160),
    dia_vencimiento_tributario = v_dia::smallint,
    honorario_mensual = round(v_hm), honorario_anual = round(v_ha),
    notas_tributarias = left(fac_txt(p->>'notas_tributarias'), 2000),
    obligaciones = case when v_activo then v_obl else '{}' end,
    obligacion_otro_detalle = case when v_activo and 'otro' = any (v_obl) then left(v_otro, 300) else null end,
    clave_tributaria_cifrada = case when coalesce((p->>'limpiar_clave')::boolean, false) then null
                                    when coalesce(p->>'clave_cifrada', '') <> '' then p->>'clave_cifrada'
                                    else clave_tributaria_cifrada end,
    updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa and cliente_id = p_cliente;
  return perfil_tributario_cliente(p_cliente);
end;
$fn$;

-- =============================================================================
-- 12. Permisos de las funciones
-- =============================================================================
revoke all on function :"schema".fac_sesion_admin() from public, anon;
revoke all on function :"schema".fac_txt(text) from public, anon;
revoke all on function :"schema".siguiente_numero_venta(uuid) from public, anon;
revoke all on function :"schema".dias_vencimiento_default(uuid) from public, anon;
revoke all on function :"schema".config_facturacion() from public, anon;
revoke all on function :"schema".guardar_config_facturacion(jsonb) from public, anon;
revoke all on function :"schema".guardar_autoimpresor(jsonb) from public, anon;
revoke all on function :"schema".sifen_config_leer() from public, anon;
revoke all on function :"schema".sifen_config_guardar(jsonb) from public, anon;
revoke all on function :"schema".sifen_guardar_secretos(jsonb) from public, anon;
revoke all on function :"schema".sifen_guardar_certificado(text, text, text, date, text) from public, anon;
revoke all on function :"schema".sifen_guardar_kude_logo(text) from public, anon;
revoke all on function :"schema".perfil_tributario_cliente(uuid) from public, anon;
revoke all on function :"schema".guardar_perfil_tributario(uuid, jsonb) from public, anon;

grant execute on function :"schema".fac_sesion_admin() to authenticated, service_role;
grant execute on function :"schema".fac_txt(text) to authenticated, service_role;
grant execute on function :"schema".siguiente_numero_venta(uuid) to authenticated, service_role;
grant execute on function :"schema".dias_vencimiento_default(uuid) to authenticated, service_role;
grant execute on function :"schema".config_facturacion() to authenticated, service_role;
grant execute on function :"schema".guardar_config_facturacion(jsonb) to authenticated, service_role;
grant execute on function :"schema".guardar_autoimpresor(jsonb) to authenticated, service_role;
grant execute on function :"schema".sifen_config_leer() to authenticated, service_role;
grant execute on function :"schema".sifen_config_guardar(jsonb) to authenticated, service_role;
grant execute on function :"schema".sifen_guardar_secretos(jsonb) to authenticated, service_role;
grant execute on function :"schema".sifen_guardar_certificado(text, text, text, date, text) to authenticated, service_role;
grant execute on function :"schema".sifen_guardar_kude_logo(text) to authenticated, service_role;
grant execute on function :"schema".perfil_tributario_cliente(uuid) to authenticated, service_role;
grant execute on function :"schema".guardar_perfil_tributario(uuid, jsonb) to authenticated, service_role;

commit;
