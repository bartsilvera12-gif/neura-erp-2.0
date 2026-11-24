-- =============================================================================
-- 174 — Respuestas desde el celular + Análisis de conversaciones.
--
-- 1. Por QR, lo que el equipo responde desde el WhatsApp del celular (no desde la bandeja) se
--    descartaba: el ERP solo veía al cliente. Ahora se guarda como mensaje saliente con
--    desde_celular = true (sin autor: no se sabe quién del equipo fue). Para el bot vendedor cuenta
--    como una persona atendiendo (no se mete en ese chat). Lo que mandó el propio ERP vuelve del
--    puente como eco: no se duplica (mismo id del proveedor, o mismo texto en los últimos 3 minutos).
-- 2. chat_analisis: los informes de Omnicanal › Análisis de conversaciones. Claude lee los chats
--    atendidos por personas (anonimizados) y devuelve qué preguntan los clientes, cómo responde el
--    equipo y sugerencias para las instrucciones del bot. Solo lee: nunca manda mensajes.
--
-- Aditivo e IDEMPOTENTE. Va después de 173.
-- =============================================================================
begin;
set local search_path to :"schema", public;

alter table :"schema".chat_mensajes add column if not exists desde_celular boolean not null default false;

-- Mensaje que el equipo mandó desde el celular (solo service_role: el procesador del webhook).
create or replace function :"schema".chat_registrar_desde_celular(
  p_canal uuid, p_telefono text, p_nombre text, p_externo_id text, p_tipo text, p_contenido text, p_fecha timestamptz default null
) returns jsonb language plpgsql security definer set search_path = :"schema", public as $$
declare
  ca chat_canales; v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_contacto uuid; v_conv uuid; v_msg uuid;
begin
  select * into ca from chat_canales where id = p_canal and activo;
  if not found then raise exception 'Canal inexistente o inactivo'; end if;
  if length(v_tel) < 5 then raise exception 'Teléfono inválido'; end if;
  -- Ya está (el eco de algo que mandó el ERP, o el mismo aviso dos veces).
  if p_externo_id is not null then
    select id, conversacion_id into v_msg, v_conv from chat_mensajes where empresa_id = ca.empresa_id and externo_id = p_externo_id;
    if v_msg is not null then return jsonb_build_object('mensaje_id', v_msg, 'conversacion_id', v_conv, 'duplicado', true); end if;
  end if;
  insert into chat_contactos (empresa_id, telefono, nombre)
  values (ca.empresa_id, v_tel, nullif(trim(p_nombre), ''))
  on conflict (empresa_id, telefono) where telefono is not null do update set updated_at = now()
  returning id into v_contacto;
  insert into chat_conversaciones (empresa_id, canal_id, contacto_id)
  values (ca.empresa_id, ca.id, v_contacto)
  on conflict (canal_id, contacto_id) do update set updated_at = now()
  returning id into v_conv;
  -- Eco de un mensaje del ERP que todavía no tenía su id del proveedor anotado.
  select id into v_msg from chat_mensajes
   where conversacion_id = v_conv and from_me and contenido is not distinct from p_contenido and created_at > now() - interval '3 minutes'
   limit 1;
  if v_msg is not null then return jsonb_build_object('mensaje_id', v_msg, 'conversacion_id', v_conv, 'duplicado', true); end if;
  insert into chat_mensajes (empresa_id, conversacion_id, externo_id, from_me, tipo, contenido, estado_entrega, desde_celular, created_at)
  values (ca.empresa_id, v_conv, p_externo_id, true, coalesce(p_tipo, 'texto'), p_contenido, 'enviado', true, coalesce(p_fecha, now()))
  returning id into v_msg;
  return jsonb_build_object('mensaje_id', v_msg, 'conversacion_id', v_conv, 'duplicado', false);
end;
$$;
revoke all on function :"schema".chat_registrar_desde_celular(uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function :"schema".chat_registrar_desde_celular(uuid, text, text, text, text, text, timestamptz) to service_role;

-- Informes del análisis de conversaciones (solo servidor; pantalla de ADMIN).
create table if not exists :"schema".chat_analisis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  desde timestamptz not null,
  hasta timestamptz not null,
  -- 'procesando' | 'listo' | 'error'
  estado text not null default 'procesando' check (estado in ('procesando', 'listo', 'error')),
  conversaciones integer not null default 0,
  mensajes integer not null default 0,
  resultado jsonb,
  -- índices de resultado.sugerencias que ya se aplicaron a las instrucciones del bot
  aplicadas jsonb not null default '[]'::jsonb,
  costo_usd numeric,
  error text,
  creado_at timestamptz not null default now(),
  creado_por uuid references :"schema".usuarios(id) on delete set null,
  terminado_at timestamptz
);
create index if not exists chat_analisis_empresa_idx on :"schema".chat_analisis (empresa_id, creado_at desc);
alter table :"schema".chat_analisis enable row level security;
alter table :"schema".chat_analisis force row level security;
revoke all on :"schema".chat_analisis from anon, authenticated;
grant all on :"schema".chat_analisis to service_role;

commit;

notify pgrst, 'reload schema';
