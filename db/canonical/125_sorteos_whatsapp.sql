-- =============================================================================
-- SORTEOS: venta por WhatsApp (fase 4, 4-nov-2026).
--   · Un bot atiende los chats de WhatsApp de la bandeja (Conversaciones): ofrece los sorteos a la venta,
--     toma cantidad, nombre, cédula y ciudad, reserva los números (sorteo_orden_registrar, canal
--     'whatsapp', pendiente_pago) y pide la foto del comprobante.
--   · El comprobante se lee automáticamente (servidor) y se chequea ACÁ: monto, fecha, cuenta de destino
--     y número de operación no repetido. Si todo coincide y el sorteo tiene "confirmación automática",
--     se confirma solo; si no, queda "Por revisar" con el motivo.
--   · El bot se prende por empresa (sorteo_bot_config, Administrador). Si alguien de la empresa escribe
--     en el chat o el cliente pide un asesor, el bot se calla (12 h).
-- Todo lo del bot es del servidor (service_role); la configuración, con sesión y sorteos_administrar.
-- IDEMPOTENTE. Va después de 124.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

create table if not exists :"schema".sorteo_bot_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  activo boolean not null default false,
  canal_id uuid references :"schema".chat_canales(id) on delete set null,   -- null = todos los de WhatsApp
  bienvenida text,
  updated_by uuid references :"schema".usuarios(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint chk_sorteo_bot_bienvenida check (bienvenida is null or length(bienvenida) <= 1000)
);

create table if not exists :"schema".sorteo_bot_sesiones (
  conversacion_id uuid primary key references :"schema".chat_conversaciones(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sorteo_id uuid references :"schema".sorteos(id) on delete set null,
  paso text not null default 'inicio',
  datos jsonb not null default '{}'::jsonb,
  orden_id uuid references :"schema".sorteo_ordenes(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint chk_sorteo_bot_paso check (paso in ('inicio', 'sorteo', 'cantidad', 'nombre', 'documento', 'ciudad', 'confirmar',
                                                 'pago', 'revision', 'humano'))
);
create index if not exists sorteo_bot_sesiones_orden_idx on :"schema".sorteo_bot_sesiones (orden_id) where orden_id is not null;

do $do$
declare
  t text;
begin
  foreach t in array array['sorteo_bot_config', 'sorteo_bot_sesiones'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- Texto para comparar nombres: minúsculas, sin acentos ni signos.
create or replace function :"schema".sorteo_texto_plano(p text) returns text
language sql stable set search_path = :"schema", public, extensions as $$
  select regexp_replace(lower(norm(coalesce(p, ''))), '[^a-z0-9]', '', 'g')
$$;

-- =============================================================================
-- Comprobante recibido por WhatsApp (el servidor ya lo guardó en erp-sorteos y lo leyó).
-- p_lectura: {es_comprobante, monto, fecha (AAAA-MM-DD), referencia, cuenta_destino, titular_destino,
--             documento_destino, banco_origen, ...} o null si no se pudo leer.
-- Devuelve la compra + resultado: confirmada | revision | repetido | vencida | estado.
-- =============================================================================
create or replace function :"schema".sorteo_bot_comprobante(p_empresa uuid, p_orden uuid, p_path text, p_lectura jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public, extensions as $fn$
declare
  o sorteo_ordenes;
  s sorteos;
  l jsonb := coalesce(p_lectura, '{}'::jsonb);
  v_ref text := nullif(upper(regexp_replace(coalesce(l->>'referencia', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_monto numeric;
  v_fecha date;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date;
  v_repetida boolean := false;
  v_destino boolean := false;
  v_legible boolean := coalesce(l->>'es_comprobante', 'false') = 'true';
  v_monto_ok boolean;
  v_fecha_ok boolean;
  v_auto boolean;
  v_motivos text[] := '{}';
  v_cta text := sorteo_digitos(l->>'cuenta_destino');
  v_doc text := sorteo_digitos(l->>'documento_destino');
  v_tit text := sorteo_texto_plano(l->>'titular_destino');
  d jsonb;
  dc text; dd text; dt text;
begin
  select * into o from sorteo_ordenes where id = p_orden and empresa_id = p_empresa for update;
  if o.id is null then raise exception 'No existe esa compra'; end if;
  if p_path is null or p_path !~ ('^' || current_schema() || '/' || o.empresa_id || '/' || o.id || '/[a-z0-9-]+\.(jpg|png|webp|pdf)$') then
    raise exception 'Archivo inválido';
  end if;
  -- Casos del flujo: se informan, no se cortan (para que la liberación de vencidas quede hecha).
  if o.estado = 'pendiente_pago' and o.vence_at < now() then
    perform sorteo_liberar_vencidas(o.sorteo_id);
    return sorteo_orden_json(o.id) || jsonb_build_object('resultado', 'vencida');
  end if;
  if o.estado not in ('pendiente_pago', 'en_revision') then
    return sorteo_orden_json(o.id) || jsonb_build_object('resultado', 'estado');
  end if;
  select * into s from sorteos where id = o.sorteo_id;

  begin v_monto := nullif(regexp_replace(coalesce(l->>'monto', ''), '[^0-9.]', '', 'g'), '')::numeric; exception when others then v_monto := null; end;
  begin v_fecha := nullif(l->>'fecha', '')::date; exception when others then v_fecha := null; end;
  v_desde := (o.created_at at time zone 'America/Asuncion')::date - 1;

  if v_ref is not null and exists (
       select 1 from sorteo_ordenes where sorteo_id = o.sorteo_id and referencia_pago = v_ref and id <> o.id
          and estado in ('pendiente_pago', 'en_revision', 'confirmada')) then
    v_repetida := true;
  end if;

  -- La plata fue a una cuenta del sorteo: últimos 4 dígitos de la cuenta, RUC/CI del titular o el nombre.
  for d in select * from jsonb_array_elements(coalesce(s.datos_pago, '[]'::jsonb)) loop
    dc := sorteo_digitos(d->>'cuenta');
    dd := sorteo_digitos(d->>'documento');
    dt := sorteo_texto_plano(d->>'titular');
    if (length(v_cta) >= 4 and length(dc) >= 4 and right(v_cta, 4) = right(dc, 4))
       or (length(v_doc) >= 6 and length(dd) >= 6 and (v_doc like dd || '%' or dd like v_doc || '%'))
       or (length(v_tit) >= 5 and length(dt) >= 5 and (position(dt in v_tit) > 0 or position(v_tit in dt) > 0)) then
      v_destino := true;
    end if;
  end loop;

  v_monto_ok := v_monto is not null and v_monto >= o.monto;
  v_fecha_ok := v_fecha is not null and v_fecha between v_desde and v_hoy;
  if not v_legible then v_motivos := v_motivos || 'No se pudo leer como comprobante'::text; end if;
  if v_legible and not v_monto_ok then
    v_motivos := v_motivos || case when v_monto is null then 'No se leyó el monto'
                                   else format('Monto leído Gs %s, corresponde Gs %s', to_char(v_monto, 'FM999G999G999G999'), to_char(o.monto, 'FM999G999G999G999')) end;
  end if;
  if v_legible and not v_fecha_ok then v_motivos := v_motivos || coalesce('La fecha ' || to_char(v_fecha, 'DD/MM/YYYY') || ' no corresponde', 'No se leyó la fecha'); end if;
  if v_legible and not v_destino then v_motivos := v_motivos || 'La cuenta de destino no coincide con las del sorteo'::text; end if;
  if v_legible and v_ref is null then v_motivos := v_motivos || 'No se leyó el número de operación'::text; end if;
  if v_repetida then v_motivos := v_motivos || format('El número de operación %s ya se usó en otra compra', v_ref); end if;
  if not s.confirmacion_auto then v_motivos := v_motivos || 'El sorteo no confirma solo'::text; end if;

  v_auto := s.confirmacion_auto and v_legible and v_monto_ok and v_fecha_ok and v_destino and v_ref is not null and not v_repetida;

  update sorteo_ordenes set
    comprobante_path = p_path,
    comprobante = l || jsonb_build_object('chequeo', jsonb_build_object(
      'legible', v_legible, 'monto', v_monto_ok, 'fecha', v_fecha_ok, 'destino', v_destino,
      'referencia', v_ref is not null and not v_repetida, 'repetida', v_repetida, 'motivos', to_jsonb(v_motivos))),
    referencia_pago = case when v_repetida then referencia_pago else coalesce(v_ref, referencia_pago) end,
    estado = 'en_revision', vence_at = null, updated_at = now()
   where id = o.id;

  if v_auto then
    perform sorteo_orden_confirmar_interna(p_empresa, o.id, null, 'auto');
  end if;
  return sorteo_orden_json(o.id) || jsonb_build_object(
    'resultado', case when v_auto then 'confirmada' when v_repetida then 'repetido' else 'revision' end,
    'motivos', to_jsonb(v_motivos), 'mensaje_ticket', s.mensaje_ticket, 'slug', s.slug);
end;
$fn$;

-- Las compras del teléfono en sorteos que todavía importan ("mis números" del bot).
create or replace function :"schema".sorteo_bot_mis_compras(p_empresa uuid, p_telefono text)
returns jsonb language sql stable security definer set search_path = :"schema", public as $fn$
  select coalesce(jsonb_agg(sorteo_orden_json(x.id) order by x.created_at desc), '[]'::jsonb)
    from (select o.id, o.created_at from sorteo_ordenes o join sorteos s on s.id = o.sorteo_id
           where o.empresa_id = p_empresa and o.comprador_telefono = sorteo_digitos(p_telefono)
             and length(sorteo_digitos(p_telefono)) >= 8
             and o.estado in ('confirmada', 'en_revision', 'pendiente_pago')
             and s.estado in ('activo', 'pausado', 'cerrado', 'sorteado')
           order by o.created_at desc limit 5) x
$fn$;

-- =============================================================================
-- Configuración (Administrador): prender el bot, canal y bienvenida.
-- =============================================================================
create or replace function :"schema".sorteo_bot_config_leer()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c sorteo_bot_config;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  select * into c from sorteo_bot_config where empresa_id = s.s_empresa;
  return jsonb_build_object(
    'activo', coalesce(c.activo, false), 'canal_id', c.canal_id, 'bienvenida', c.bienvenida, 'updated_at', c.updated_at,
    'canales', coalesce((select jsonb_agg(jsonb_build_object('id', ca.id, 'nombre', ca.nombre, 'proveedor', ca.proveedor, 'activo', ca.activo)
                                          order by ca.created_at)
                           from chat_canales ca where ca.empresa_id = s.s_empresa and ca.tipo = 'whatsapp'), '[]'::jsonb),
    'sorteos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'slug', x.slug,
                                                             'confirmacion_auto', x.confirmacion_auto, 'precio', x.precio)
                                          order by x.activado_at desc nulls last)
                           from sorteos x where x.empresa_id = s.s_empresa and x.estado = 'activo'), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".sorteo_bot_config_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_canal uuid := nullif(p->>'canal_id', '')::uuid;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  if v_canal is not null and not exists (select 1 from chat_canales where id = v_canal and empresa_id = s.s_empresa and tipo = 'whatsapp') then
    raise exception 'Ese canal no es de WhatsApp de tu empresa';
  end if;
  if length(coalesce(p->>'bienvenida', '')) > 1000 then raise exception 'La bienvenida es muy larga (máximo 1000 letras)'; end if;
  insert into sorteo_bot_config (empresa_id, activo, canal_id, bienvenida, updated_by, updated_at)
  values (s.s_empresa, coalesce((p->>'activo')::boolean, false), v_canal, nullif(btrim(coalesce(p->>'bienvenida', '')), ''), s.s_usuario, now())
  on conflict (empresa_id) do update set activo = excluded.activo, canal_id = excluded.canal_id, bienvenida = excluded.bienvenida,
     updated_by = excluded.updated_by, updated_at = now();
  return sorteo_bot_config_leer();
end;
$fn$;

do $do$
declare
  f text;
begin
  foreach f in array array['sorteo_texto_plano(text)', 'sorteo_bot_comprobante(uuid,uuid,text,jsonb)', 'sorteo_bot_mis_compras(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['sorteo_bot_config_leer()', 'sorteo_bot_config_guardar(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
