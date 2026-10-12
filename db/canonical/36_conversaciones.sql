-- =============================================================================
-- CONVERSACIONES (bandeja omnicanal) — base re-pensada para que sea rápida.
-- Lecciones del sistema actual (sistemas-propio):
--   · Realtime "postgres_changes" sin filtro: cada pestaña recibía TODOS los mensajes del
--     tenant y la base evaluaba RLS por suscriptor (llegó a 1 núcleo entero). Acá la base
--     AVISA por broadcast a tópicos chicos (realtime.send):
--        chat:<empresa>            → cambios de la lista (una conversación se movió)
--        chat:conv:<conversacion>  → mensaje nuevo / estado de entrega del chat abierto
--     con payload mínimo; el cliente pide lo que le falta.
--   · Mensajes sin paginar y con raw_payload pesado: acá el hilo va por cursor (últimos 50,
--     "ver anteriores") y el payload crudo vive aparte (chat_eventos), nunca en la lista.
--   · Lista con varias consultas por refresco: acá la conversación guarda desnormalizado
--     lo que muestra la lista (último mensaje, no leídos, ventana 24 h) → UNA consulta keyset.
--   · Webhook que procesaba todo antes de responder: acá el webhook guarda el evento crudo
--     (chat_eventos) y responde; chat_registrar_entrante es idempotente por id externo.
-- El CONECTOR queda abierto (todavía no hay proveedor): chat_canales.proveedor admite
-- meta | ycloud | baileys | simulador. "simulador" permite probar todo sin WhatsApp.
-- Colas, asignación automática y SLA van en una receta aparte (siguiente fase).
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Canales ──────────────────────────────────────────────────────────────────
create table if not exists :"schema".chat_canales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  tipo text not null default 'whatsapp' check (tipo in ('whatsapp', 'instagram', 'messenger', 'web')),
  proveedor text not null default 'simulador' check (proveedor in ('meta', 'ycloud', 'baileys', 'simulador')),
  identificador text,                 -- phone_number_id de Meta, número, page id… (para rutear el webhook)
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_chat_canal_ident on :"schema".chat_canales (proveedor, identificador) where identificador is not null;
-- Secretos del conector (tokens, api keys) en tabla aparte, SOLO para el servidor.
create table if not exists :"schema".chat_canal_secretos (
  canal_id uuid primary key references :"schema".chat_canales(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table :"schema".chat_canal_secretos enable row level security;
alter table :"schema".chat_canal_secretos force row level security;
revoke all on :"schema".chat_canal_secretos from anon, authenticated;
grant select, insert, update, delete on :"schema".chat_canal_secretos to service_role;

-- ── Contactos ────────────────────────────────────────────────────────────────
create table if not exists :"schema".chat_contactos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  telefono text,                      -- solo dígitos, con código de país (595…)
  externo_id text,                    -- id del usuario en IG/Messenger
  nombre text,
  avatar_url text,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  prospecto_id uuid references :"schema".crm_prospectos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_chat_contacto_tel on :"schema".chat_contactos (empresa_id, telefono) where telefono is not null;
create unique index if not exists uq_chat_contacto_ext on :"schema".chat_contactos (empresa_id, externo_id) where externo_id is not null;
create index if not exists chat_contacto_cliente_idx on :"schema".chat_contactos (cliente_id) where cliente_id is not null;

-- ── Conversaciones ───────────────────────────────────────────────────────────
create table if not exists :"schema".chat_conversaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  canal_id uuid not null references :"schema".chat_canales(id) on delete cascade,
  contacto_id uuid not null references :"schema".chat_contactos(id) on delete cascade,
  estado text not null default 'abierta' check (estado in ('abierta', 'pendiente', 'cerrada')),
  asignado_id uuid references :"schema".usuarios(id) on delete set null,
  cola_id uuid,
  prioridad smallint not null default 0,
  -- Desnormalizado para la lista (lo mantiene el trigger de mensajes):
  ultimo_mensaje_at timestamptz,
  ultimo_preview text,
  ultimo_from_me boolean,
  ultimo_tipo text,
  no_leidos integer not null default 0,
  ultimo_cliente_at timestamptz,      -- último mensaje del cliente (abre la ventana de 24 h)
  ventana_expira_at timestamptz,      -- WhatsApp: fuera de la ventana solo plantillas
  primera_respuesta_at timestamptz,
  etiquetas text[] not null default '{}',
  -- Cierre (tipificación de la conversación):
  cerrada_at timestamptz,
  cerrada_por uuid references :"schema".usuarios(id) on delete set null,
  cierre_familia_id uuid,
  cierre_estado_id uuid,
  cierre_observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canal_id, contacto_id)
);
create index if not exists chat_conv_lista_idx on :"schema".chat_conversaciones (empresa_id, estado, ultimo_mensaje_at desc, id desc);
create index if not exists chat_conv_asignado_idx on :"schema".chat_conversaciones (empresa_id, asignado_id, estado, ultimo_mensaje_at desc, id desc);
create index if not exists chat_conv_sin_asignar_idx on :"schema".chat_conversaciones (empresa_id, ultimo_mensaje_at desc) where asignado_id is null and estado <> 'cerrada';

-- ── Mensajes ─────────────────────────────────────────────────────────────────
create table if not exists :"schema".chat_mensajes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  conversacion_id uuid not null references :"schema".chat_conversaciones(id) on delete cascade,
  externo_id text,                    -- wamid / id del proveedor (idempotencia)
  from_me boolean not null,
  tipo text not null default 'texto' check (tipo in ('texto', 'imagen', 'audio', 'video', 'documento', 'sticker', 'ubicacion', 'plantilla', 'reaccion', 'sistema', 'nota')),
  contenido text,
  media_path text, media_mime text, media_nombre text, media_size bigint,
  responde_a uuid references :"schema".chat_mensajes(id) on delete set null,
  estado_entrega text not null default 'enviado' check (estado_entrega in ('pendiente', 'enviado', 'entregado', 'leido', 'fallido', 'recibido')),
  error text,
  autor_usuario_id uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chat_msg_hilo_idx on :"schema".chat_mensajes (conversacion_id, created_at desc, id desc);
create unique index if not exists uq_chat_msg_externo on :"schema".chat_mensajes (empresa_id, externo_id) where externo_id is not null;

-- ── Eventos crudos del webhook (cola) ────────────────────────────────────────
create table if not exists :"schema".chat_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid references :"schema".empresas(id) on delete cascade,
  canal_id uuid references :"schema".chat_canales(id) on delete cascade,
  proveedor text not null,
  payload jsonb not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'procesado', 'error', 'ignorado')),
  intentos smallint not null default 0,
  error text,
  created_at timestamptz not null default now(),
  procesado_at timestamptz
);
create index if not exists chat_eventos_pend_idx on :"schema".chat_eventos (created_at) where estado = 'pendiente';
alter table :"schema".chat_eventos enable row level security;
alter table :"schema".chat_eventos force row level security;
revoke all on :"schema".chat_eventos from anon, authenticated;
grant select, insert, update, delete on :"schema".chat_eventos to service_role;

-- ── Respuestas rápidas ───────────────────────────────────────────────────────
create table if not exists :"schema".chat_respuestas_rapidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  canal_id uuid references :"schema".chat_canales(id) on delete cascade,   -- null = todos
  atajo text not null,                -- "/hola"
  texto text not null,
  orden integer not null default 0,
  activo boolean not null default true
);

-- RLS: solo mi empresa (las tablas de secretos y eventos son solo del servidor).
do $$
declare t text;
begin
  foreach t in array array['chat_canales', 'chat_contactos', 'chat_conversaciones', 'chat_mensajes', 'chat_respuestas_rapidas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())', t || '_propias', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;

-- ── Aviso por broadcast (payload mínimo) ─────────────────────────────────────
create or replace function :"schema".chat_avisar(p_topic text, p_evento text, p_payload jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform realtime.send(p_payload, p_evento, p_topic, true);
exception when others then
  null;   -- el aviso nunca rompe la escritura (si Realtime no está, la pantalla refresca sola)
end;
$fn$;

-- Mensaje nuevo → actualiza la conversación (lo que muestra la lista) y avisa.
create or replace function :"schema".tg_chat_mensaje_nuevo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare c chat_conversaciones;
begin
  if new.tipo in ('nota') then
    perform chat_avisar('chat:conv:' || new.conversacion_id, 'mensaje', jsonb_build_object('id', new.id));
    return null;
  end if;
  update chat_conversaciones set
    ultimo_mensaje_at = new.created_at,
    ultimo_preview = left(coalesce(new.contenido, case new.tipo when 'imagen' then '📷 Imagen' when 'audio' then '🎤 Audio'
                       when 'video' then '🎬 Video' when 'documento' then '📎 ' || coalesce(new.media_nombre, 'Documento')
                       when 'sticker' then 'Sticker' when 'ubicacion' then '📍 Ubicación' else '' end), 140),
    ultimo_from_me = new.from_me,
    ultimo_tipo = new.tipo,
    no_leidos = case when new.from_me then no_leidos else no_leidos + 1 end,
    ultimo_cliente_at = case when new.from_me then ultimo_cliente_at else new.created_at end,
    ventana_expira_at = case when new.from_me then ventana_expira_at else new.created_at + interval '24 hours' end,
    primera_respuesta_at = case when new.from_me and new.autor_usuario_id is not null and primera_respuesta_at is null then new.created_at else primera_respuesta_at end,
    estado = case when not new.from_me and estado = 'cerrada' then 'abierta' else estado end,
    cerrada_at = case when not new.from_me and estado = 'cerrada' then null else cerrada_at end,
    updated_at = now()
  where id = new.conversacion_id
  returning * into c;
  perform chat_avisar('chat:conv:' || new.conversacion_id, 'mensaje', jsonb_build_object('id', new.id));
  perform chat_avisar('chat:' || c.empresa_id, 'conversacion',
    jsonb_build_object('id', c.id, 'asignado_id', c.asignado_id, 'estado', c.estado, 'ultimo_mensaje_at', c.ultimo_mensaje_at,
                       'no_leidos', c.no_leidos, 'from_me', new.from_me));
  return null;
end;
$fn$;
drop trigger if exists trg_chat_mensaje_nuevo on :"schema".chat_mensajes;
create trigger trg_chat_mensaje_nuevo after insert on :"schema".chat_mensajes
  for each row execute function :"schema".tg_chat_mensaje_nuevo();

-- Estado de entrega (enviado → entregado → leído) → avisa al chat abierto.
create or replace function :"schema".tg_chat_mensaje_estado()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.estado_entrega is distinct from old.estado_entrega then
    perform chat_avisar('chat:conv:' || new.conversacion_id, 'estado', jsonb_build_object('id', new.id, 'estado', new.estado_entrega));
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_chat_mensaje_estado on :"schema".chat_mensajes;
create trigger trg_chat_mensaje_estado after update of estado_entrega on :"schema".chat_mensajes
  for each row execute function :"schema".tg_chat_mensaje_estado();

-- Asignación / estado / etiquetas de la conversación → avisa a la lista.
create or replace function :"schema".tg_chat_conversacion_cambio()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if (new.asignado_id, new.estado, new.etiquetas, new.prioridad) is distinct from (old.asignado_id, old.estado, old.etiquetas, old.prioridad)
     and new.ultimo_mensaje_at is not distinct from old.ultimo_mensaje_at then
    perform chat_avisar('chat:' || new.empresa_id, 'conversacion',
      jsonb_build_object('id', new.id, 'asignado_id', new.asignado_id, 'estado', new.estado, 'ultimo_mensaje_at', new.ultimo_mensaje_at, 'no_leidos', new.no_leidos));
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_chat_conversacion_cambio on :"schema".chat_conversaciones;
create trigger trg_chat_conversacion_cambio after update on :"schema".chat_conversaciones
  for each row execute function :"schema".tg_chat_conversacion_cambio();

-- La política de los tópicos privados (realtime.messages) va en 36b_conversaciones_realtime.sql: se aplica como supabase_admin (dueño de la tabla).

-- ── Lista de la bandeja (UNA consulta, keyset) ──────────────────────────────
create or replace function :"schema".chat_bandeja(
  p_vista text default 'mias',        -- mias | sin_asignar | todas | cerradas
  p_q text default null,
  p_asignado uuid default null,
  p_canal uuid default null,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limite integer default 40
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public, extensions as $$
declare v_yo uuid;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;
  return (
  with base as (
    select c.id, c.estado, c.asignado_id, c.canal_id, c.prioridad, c.ultimo_mensaje_at, c.ultimo_preview, c.ultimo_from_me,
           c.ultimo_tipo, c.no_leidos, c.ventana_expira_at, c.etiquetas, c.sla_vence_at, c.primera_respuesta_at, c.espera_motivo,
           k.id as contacto_id, k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.avatar_url, k.cliente_id, k.prospecto_id,
           ca.tipo as canal_tipo, ca.nombre as canal_nombre, u.nombre as asignado_nombre
      from chat_conversaciones c
      join chat_contactos k on k.id = c.contacto_id
      join chat_canales ca on ca.id = c.canal_id
      left join usuarios u on u.id = c.asignado_id
     where c.empresa_id = empresa_actual()
       and case coalesce(p_vista, 'mias')
             when 'mias' then c.asignado_id = v_yo and c.estado <> 'cerrada'
             when 'sin_asignar' then c.asignado_id is null and c.estado <> 'cerrada'
             when 'cerradas' then c.estado = 'cerrada'
             else c.estado <> 'cerrada' end
       and (p_asignado is null or c.asignado_id = p_asignado)
       and (p_canal is null or c.canal_id = p_canal)
       and (p_cursor_at is null or (c.ultimo_mensaje_at, c.id) < (p_cursor_at, p_cursor_id))
       and (coalesce(trim(p_q), '') = '' or coincide_busqueda(
              concat_ws(' ', norm(k.nombre), regexp_replace(coalesce(k.telefono, ''), '[^0-9]', '', 'g'), norm(c.ultimo_preview)),
              tokens_busqueda(p_q)))
     order by c.ultimo_mensaje_at desc nulls last, c.id desc
     limit least(greatest(coalesce(p_limite, 40), 1), 100)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(b order by b.ultimo_mensaje_at desc nulls last, b.id desc) from base b), '[]'::jsonb),
    'contadores', (select jsonb_build_object(
        'mias', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada'),
        'mias_no_leidas', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada' and no_leidos > 0),
        'sin_asignar', count(*) filter (where asignado_id is null and estado <> 'cerrada'),
        'abiertas', count(*) filter (where estado <> 'cerrada'))
      from chat_conversaciones where empresa_id = empresa_actual() and estado <> 'cerrada')
  ));
end;
$$;

-- ── Hilo (últimos N, "ver anteriores" con cursor) ───────────────────────────
create or replace function :"schema".chat_hilo(p_conversacion uuid, p_antes_at timestamptz default null, p_antes_id uuid default null, p_limite integer default 50)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(m order by m.created_at, m.id), '[]'::jsonb)
    from (select id, from_me, tipo, contenido, media_path, media_mime, media_nombre, media_size, responde_a, estado_entrega,
                 error, autor_usuario_id, created_at,
                 (select nombre from usuarios u where u.id = x.autor_usuario_id) as autor_nombre
            from chat_mensajes x
           where x.conversacion_id = p_conversacion and x.empresa_id = empresa_actual()
             and (p_antes_at is null or (x.created_at, x.id) < (p_antes_at, p_antes_id))
           order by x.created_at desc, x.id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 200)) m
$$;

-- ── Mensaje entrante (lo llama el procesador del webhook o el simulador) ────
-- Idempotente por externo_id. Crea contacto y conversación si no existen.
create or replace function :"schema".chat_registrar_entrante(
  p_canal uuid, p_telefono text, p_nombre text, p_externo_id text, p_tipo text, p_contenido text,
  p_media_path text default null, p_media_mime text default null, p_media_nombre text default null,
  p_fecha timestamptz default null
) returns jsonb language plpgsql security definer set search_path = :"schema", public as $$
declare
  ca chat_canales; v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_contacto uuid; v_conv uuid; v_msg uuid; v_cliente uuid;
begin
  select * into ca from chat_canales where id = p_canal and activo;
  if not found then raise exception 'Canal inexistente o inactivo'; end if;
  if p_externo_id is not null then
    select id, conversacion_id into v_msg, v_conv from chat_mensajes where empresa_id = ca.empresa_id and externo_id = p_externo_id;
    if v_msg is not null then return jsonb_build_object('mensaje_id', v_msg, 'conversacion_id', v_conv, 'duplicado', true); end if;
  end if;
  insert into chat_contactos (empresa_id, telefono, nombre)
  values (ca.empresa_id, nullif(v_tel, ''), nullif(trim(p_nombre), ''))
  on conflict (empresa_id, telefono) where telefono is not null do update
     set nombre = coalesce(chat_contactos.nombre, excluded.nombre), updated_at = now()
  returning id into v_contacto;
  -- Vincular con el cliente del ERP por teléfono (últimos 9 dígitos), una sola vez.
  update chat_contactos k set cliente_id = (
      select c.id from clientes c where c.empresa_id = ca.empresa_id and c.deleted_at is null
         and right(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g'), 9) = right(v_tel, 9) and length(v_tel) >= 9
       limit 1)
   where k.id = v_contacto and k.cliente_id is null;
  insert into chat_conversaciones (empresa_id, canal_id, contacto_id)
  values (ca.empresa_id, ca.id, v_contacto)
  on conflict (canal_id, contacto_id) do update set updated_at = now()
  returning id into v_conv;
  insert into chat_mensajes (empresa_id, conversacion_id, externo_id, from_me, tipo, contenido, media_path, media_mime, media_nombre, estado_entrega, created_at)
  values (ca.empresa_id, v_conv, p_externo_id, false, coalesce(p_tipo, 'texto'), p_contenido, p_media_path, p_media_mime, p_media_nombre, 'recibido',
          coalesce(p_fecha, now()))
  returning id into v_msg;
  return jsonb_build_object('mensaje_id', v_msg, 'conversacion_id', v_conv, 'contacto_id', v_contacto, 'duplicado', false);
end;
$$;
revoke execute on function :"schema".chat_registrar_entrante(uuid, text, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function :"schema".chat_registrar_entrante(uuid, text, text, text, text, text, text, text, text, timestamptz) to service_role;

-- Marcar leída (al abrir el chat).
create or replace function :"schema".chat_marcar_leida(p_conversacion uuid)
returns void language sql security invoker set search_path = :"schema", public as $$
  update chat_conversaciones set no_leidos = 0 where id = p_conversacion and empresa_id = empresa_actual() and no_leidos > 0
$$;

grant execute on function :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer),
  :"schema".chat_hilo(uuid, timestamptz, uuid, integer), :"schema".chat_marcar_leida(uuid) to authenticated, service_role;
revoke execute on function :"schema".chat_avisar(text, text, jsonb) from public, anon, authenticated;

-- Bucket privado para adjuntos del chat.
insert into storage.buckets (id, name, public, file_size_limit) values ('chat', 'chat', false, 104857600)
on conflict (id) do nothing;

-- Canal de prueba (simulador) para cada empresa que no tenga ninguno.
insert into :"schema".chat_canales (empresa_id, nombre, tipo, proveedor)
select e.id, 'WhatsApp (simulador)', 'whatsapp', 'simulador' from :"schema".empresas e
 where not exists (select 1 from :"schema".chat_canales c where c.empresa_id = e.id);
