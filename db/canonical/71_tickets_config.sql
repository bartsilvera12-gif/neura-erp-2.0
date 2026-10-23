-- =============================================================================
-- TICKETS Y FACTURACIÓN: el ticket imprimible y la comanda de cocina se configuran desde
-- Configuración › Tickets y facturación (ruta /configuracion/facturacion, solo ADMIN).
--
--   · facturacion_config.ticket_venta / ticket_comanda (jsonb, default '{}'): solo lo que el
--     administrador cambió. Lo que falta sale de los defaults de acá (iguales a los de
--     src/modules/facturacion/tickets.ts), que reproducen el ticket de siempre.
--   · fac_ticket_efectivo(tipo, guardado, impresion): guardado + defaults. El ancho del ticket
--     de venta, si nunca se tocó, sale del "Tipo de impresión por defecto" (receta 61).
--   · fac_ticket_merge(tipo, actual, cambios): valida cada clave y la mezcla (las desconocidas
--     dan error: nada raro queda guardado).
--   · config_facturacion() (67 + 'ticket_venta' / 'ticket_comanda') y config_tickets()
--     (solo los dos tickets, para la caja / la cocina: cualquier usuario con sesión).
--   · guardar_config_facturacion(p) (67 + p.ticket_venta / p.ticket_comanda). El ancho del
--     ticket y el tipo de impresión "ticket 58/80 mm" se mantienen iguales entre sí.
--
-- IDEMPOTENTE. Va después de 67. Si se vuelve a correr 61 / 67, correr 71 después.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columnas
-- =============================================================================
alter table :"schema".facturacion_config add column if not exists ticket_venta jsonb not null default '{}'::jsonb;
alter table :"schema".facturacion_config add column if not exists ticket_comanda jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturacion_config_tickets_chk' and conrelid = 'facturacion_config'::regclass) then
    alter table facturacion_config add constraint facturacion_config_tickets_chk
      check (jsonb_typeof(ticket_venta) = 'object' and jsonb_typeof(ticket_comanda) = 'object');
  end if;
end $$;

-- =============================================================================
-- 2. Defaults + guardado
-- =============================================================================
create or replace function :"schema".fac_ticket_efectivo(p_tipo text, p_guardado jsonb, p_impresion text)
returns jsonb language sql immutable set search_path = :"schema", public as $$
  select case when p_tipo = 'venta' then
    jsonb_build_object(
      'ancho_mm', case when p_impresion = 'ticket_58mm' then 58 else 80 end,
      'logo', false,
      'enc_nombre_fantasia', true, 'enc_razon_social', true, 'enc_ruc', true,
      'enc_direccion', true, 'enc_telefono', true, 'enc_sucursal', true,
      'encabezado_texto', '',
      'pie_texto', '¡Gracias por su compra!',
      'mostrar_cajero', true, 'mostrar_cliente', true, 'mostrar_cliente_doc', true,
      'mostrar_iva', true, 'mostrar_pago', true,
      'letra', 'normal', 'copias', 1, 'imprimir_al_cobrar', true)
    || coalesce(p_guardado, '{}'::jsonb)
  else
    jsonb_build_object(
      'ancho_mm', 80, 'letra', 'grande',
      'mostrar_cliente', true, 'mostrar_notas', true, 'mostrar_precios', false,
      'copias', 1, 'pie_texto', '')
    || coalesce(p_guardado, '{}'::jsonb)
  end
$$;

create or replace function :"schema".fac_ticket_merge(p_tipo text, p_actual jsonb, p_cambios jsonb)
returns jsonb language plpgsql immutable set search_path = :"schema", public as $fn$
declare
  r jsonb := coalesce(p_actual, '{}'::jsonb);
  k text;
  v jsonb;
  n numeric;
  t text;
  v_nombre text := case when p_tipo = 'venta' then 'Ticket de venta' else 'Comanda de cocina' end;
  v_bool text[] := case when p_tipo = 'venta' then
      array['logo', 'enc_nombre_fantasia', 'enc_razon_social', 'enc_ruc', 'enc_direccion', 'enc_telefono', 'enc_sucursal',
            'mostrar_cajero', 'mostrar_cliente', 'mostrar_cliente_doc', 'mostrar_iva', 'mostrar_pago', 'imprimir_al_cobrar']
    else array['mostrar_cliente', 'mostrar_notas', 'mostrar_precios'] end;
  v_textos text[] := case when p_tipo = 'venta' then array['encabezado_texto', 'pie_texto'] else array['pie_texto'] end;
  v_letras text[] := case when p_tipo = 'venta' then array['chica', 'normal', 'grande'] else array['normal', 'grande', 'muy_grande'] end;
begin
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception '%: la configuración no es válida', v_nombre;
  end if;
  for k, v in select * from jsonb_each(p_cambios) loop
    if k = any (v_bool) then
      if jsonb_typeof(v) <> 'boolean' then raise exception '%: "%" debe ser sí o no', v_nombre, k; end if;
      r := r || jsonb_build_object(k, v);
    elsif k = any (v_textos) then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '%: "%" debe ser un texto', v_nombre, k; end if;
      t := btrim(coalesce(v #>> '{}', ''));
      if length(t) > 300 then raise exception '%: los textos pueden tener hasta 300 caracteres', v_nombre; end if;
      r := r || jsonb_build_object(k, t);
    elsif k = 'ancho_mm' then
      n := case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end;
      if n is null or n not in (58, 80) then raise exception '%: el ancho de papel es 58 u 80 mm', v_nombre; end if;
      r := r || jsonb_build_object(k, n::integer);
    elsif k = 'copias' then
      n := case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end;
      if n is null or n <> trunc(n) or n < 1 or n > 5 then raise exception '%: las copias van de 1 a 5', v_nombre; end if;
      r := r || jsonb_build_object(k, n::integer);
    elsif k = 'letra' then
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (v_letras)) then
        raise exception '%: tamaño de letra inválido', v_nombre;
      end if;
      r := r || jsonb_build_object(k, v);
    else
      raise exception '%: opción desconocida (%)', v_nombre, k;
    end if;
  end loop;
  return r;
end;
$fn$;

-- =============================================================================
-- 3. Lectura: config_facturacion() (67 + tickets) y config_tickets()
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
    -- 67: cliente ocasional (X)
    'ocasional_nombre', coalesce(nullif(btrim(c.ocasional_nombre), ''), 'X'),
    'ocasional_ruc', coalesce(nullif(btrim(c.ocasional_ruc), ''), 'X'),
    'ocasional_tope', c.ocasional_tope,
    -- 71: ticket de venta y comanda de cocina (guardado + defaults)
    'ticket_venta', fac_ticket_efectivo('venta', c.ticket_venta, coalesce(c.impresion_tipo_default, 'ticket_80mm')),
    'ticket_comanda', fac_ticket_efectivo('comanda', c.ticket_comanda, null),
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

-- Solo los tickets (para la caja / la cocina / la comanda): cualquier usuario con sesión.
create or replace function :"schema".config_tickets()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c facturacion_config;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  select * into c from facturacion_config where empresa_id = s.p_empresa;
  return jsonb_build_object(
    'ticket_venta', fac_ticket_efectivo('venta', c.ticket_venta, coalesce(c.impresion_tipo_default, 'ticket_80mm')),
    'ticket_comanda', fac_ticket_efectivo('comanda', c.ticket_comanda, null));
end;
$fn$;

-- =============================================================================
-- 4. Escritura: guardar_config_facturacion (67 + ticket_venta / ticket_comanda)
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
    -- 71: ticket 58/80 mm → el ancho del ticket de venta acompaña
    if c.impresion_tipo_default in ('ticket_58mm', 'ticket_80mm') then
      c.ticket_venta := coalesce(c.ticket_venta, '{}'::jsonb)
        || jsonb_build_object('ancho_mm', case when c.impresion_tipo_default = 'ticket_58mm' then 58 else 80 end);
    end if;
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
  -- 67: cliente ocasional (X). Vacío = vuelve a "X".
  if p ? 'ocasional_nombre' then
    v_txt := coalesce(fac_txt(p->>'ocasional_nombre'), 'X');
    if length(v_txt) > 160 then raise exception 'El nombre del cliente ocasional no puede pasar de 160 caracteres'; end if;
    c.ocasional_nombre := v_txt;
  end if;
  if p ? 'ocasional_ruc' then
    v_txt := coalesce(upper(regexp_replace(coalesce(p->>'ocasional_ruc', ''), '\s+', '', 'g')), '');
    if v_txt = '' then v_txt := 'X'; end if;
    if length(v_txt) > 20 then raise exception 'El RUC del cliente ocasional no puede pasar de 20 caracteres'; end if;
    c.ocasional_ruc := v_txt;
  end if;
  if p ? 'ocasional_tope' then
    v_num := nullif(btrim(coalesce(p->>'ocasional_tope', '')), '')::numeric;
    if v_num is not null and (v_num <> trunc(v_num) or v_num <= 0 or v_num > 999999999999) then
      raise exception 'El tope para cliente ocasional tiene que ser un monto en guaraníes mayor a 0 (o vacío: sin tope)';
    end if;
    c.ocasional_tope := v_num;
  end if;
  -- 71: ticket de venta y comanda de cocina
  if p ? 'ticket_venta' then
    c.ticket_venta := fac_ticket_merge('venta', c.ticket_venta, p->'ticket_venta');
    -- el ancho del ticket manda sobre "Tipo de impresión" cuando este es un ticket
    if p->'ticket_venta' ? 'ancho_mm' and c.impresion_tipo_default in ('ticket_58mm', 'ticket_80mm') then
      c.impresion_tipo_default := case when (c.ticket_venta->>'ancho_mm')::int = 58 then 'ticket_58mm' else 'ticket_80mm' end;
    end if;
  end if;
  if p ? 'ticket_comanda' then
    c.ticket_comanda := fac_ticket_merge('comanda', c.ticket_comanda, p->'ticket_comanda');
  end if;

  update facturacion_config
     set modo = c.modo, impresion_tipo_default = c.impresion_tipo_default,
         preguntar_datos_al_confirmar = c.preguntar_datos_al_confirmar, gestion_tributaria_clientes = c.gestion_tributaria_clientes,
         prefijo_factura = c.prefijo_factura, numeracion_inicial = c.numeracion_inicial,
         dias_vencimiento_default = c.dias_vencimiento_default, interes_moratorio = c.interes_moratorio,
         ocasional_nombre = c.ocasional_nombre, ocasional_ruc = c.ocasional_ruc, ocasional_tope = c.ocasional_tope,
         ticket_venta = coalesce(c.ticket_venta, '{}'::jsonb), ticket_comanda = coalesce(c.ticket_comanda, '{}'::jsonb),
         updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return config_facturacion();
end;
$fn$;

-- =============================================================================
-- 5. Permisos
-- =============================================================================
revoke all on function :"schema".fac_ticket_efectivo(text, jsonb, text) from public, anon;
revoke all on function :"schema".fac_ticket_merge(text, jsonb, jsonb) from public, anon;
revoke all on function :"schema".config_tickets() from public, anon;
revoke all on function :"schema".config_facturacion() from public, anon;
revoke all on function :"schema".guardar_config_facturacion(jsonb) from public, anon;
grant execute on function :"schema".fac_ticket_efectivo(text, jsonb, text) to authenticated, service_role;
grant execute on function :"schema".fac_ticket_merge(text, jsonb, jsonb) to authenticated, service_role;
grant execute on function :"schema".config_tickets() to authenticated, service_role;
grant execute on function :"schema".config_facturacion() to authenticated, service_role;
grant execute on function :"schema".guardar_config_facturacion(jsonb) to authenticated, service_role;

commit;
