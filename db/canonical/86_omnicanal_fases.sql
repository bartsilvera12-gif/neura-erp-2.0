-- =============================================================================
-- OMNICANAL · fases 6-8 (porte de lo que NO necesita proveedor externo)
--   F6 Finalizadas: último mensaje del asesor (columna + trigger + backfill) para el
--      semáforo (verde ≤ 2 días, ámbar 3-6, rojo ≥ 7), filtros por cola / asignado /
--      semáforo, "próxima acción" (fecha + nota) del cierre y modo Seguimientos.
--   F7 Bandeja: filtro por cola y "sin asignar" (modo historial de cerradas).
--   F8 Colas: estrategias circular (turno fijo) y menor carga, cola "solo transferencia"
--      (no recibe entrantes automáticos), mensaje automático al derivar (queda como nota
--      en el hilo hasta que haya envío real) y supervisor → asesores (a quién ve un
--      supervisor en Monitoreo y Finalizadas).
-- Redefine: chat_bandeja (58), chat_finalizadas (58), chat_asignar (38).
-- IDEMPOTENTE.
-- =============================================================================
set search_path to :"schema", public, extensions;

-- ── F6 · columnas ────────────────────────────────────────────────────────────
alter table :"schema".chat_conversaciones add column if not exists ultimo_msg_asesor_at timestamptz;
alter table :"schema".chat_conversaciones add column if not exists proxima_accion_fecha date;
alter table :"schema".chat_conversaciones add column if not exists proxima_accion_nota text;
alter table :"schema".chat_conversaciones add column if not exists seguimiento_hecho_at timestamptz;
alter table :"schema".chat_conversaciones add column if not exists seguimiento_hecho_por uuid references :"schema".usuarios(id) on delete set null;
create index if not exists chat_conv_seguimientos_idx on :"schema".chat_conversaciones (empresa_id, proxima_accion_fecha, id)
  where proxima_accion_fecha is not null and seguimiento_hecho_at is null and estado = 'cerrada';

-- Último mensaje HUMANO saliente (no notas ni mensajes del sistema).
create or replace function :"schema".tg_chat_msg_asesor()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  update chat_conversaciones set ultimo_msg_asesor_at = new.created_at
   where id = new.conversacion_id and (ultimo_msg_asesor_at is null or ultimo_msg_asesor_at < new.created_at);
  return null;
end;
$fn$;
drop trigger if exists trg_chat_msg_asesor on :"schema".chat_mensajes;
create trigger trg_chat_msg_asesor after insert on :"schema".chat_mensajes
  for each row when (new.from_me and new.autor_usuario_id is not null and new.tipo not in ('nota', 'sistema'))
  execute function :"schema".tg_chat_msg_asesor();

-- Backfill (solo las que todavía no lo tienen; sin disparar avisos).
set session_replication_role = replica;
update :"schema".chat_conversaciones c
   set ultimo_msg_asesor_at = m.at
  from (select conversacion_id, max(created_at) as at from :"schema".chat_mensajes
         where from_me and autor_usuario_id is not null and tipo not in ('nota', 'sistema')
         group by conversacion_id) m
 where m.conversacion_id = c.id and c.ultimo_msg_asesor_at is null;
set session_replication_role = default;

-- ── F8 · colas ───────────────────────────────────────────────────────────────
alter table :"schema".chat_colas add column if not exists solo_transferencia boolean not null default false;
alter table :"schema".chat_colas add column if not exists mensaje_derivacion text;
alter table :"schema".chat_colas add column if not exists rr_ultimo_usuario uuid;   -- estado de la estrategia circular
alter table :"schema".chat_colas drop constraint if exists chat_colas_estrategia_check;
alter table :"schema".chat_colas add constraint chat_colas_estrategia_check
  check (estrategia in ('equitativa', 'circular', 'menor_carga', 'manual'));

-- Supervisor → asesores: si un supervisor tiene asesores cargados, en Monitoreo y
-- Finalizadas ve solo a ellos (y a sí mismo). Sin filas, ve a todos (como antes).
create table if not exists :"schema".chat_supervisor_asesores (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  supervisor_id uuid not null references :"schema".usuarios(id) on delete cascade,
  asesor_id uuid not null references :"schema".usuarios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (supervisor_id, asesor_id),
  constraint chat_supervisor_asesores_distintos check (supervisor_id <> asesor_id)
);
alter table :"schema".chat_supervisor_asesores enable row level security;
alter table :"schema".chat_supervisor_asesores force row level security;
drop policy if exists chat_supervisor_asesores_propias on :"schema".chat_supervisor_asesores;
create policy chat_supervisor_asesores_propias on :"schema".chat_supervisor_asesores to authenticated
  using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual());
grant select, insert, update, delete on :"schema".chat_supervisor_asesores to authenticated, service_role;

-- ── Asignación (38) + estrategias, solo transferencia y derivación a una cola ─
-- p_cola: DERIVAR a esa cola (la conversación sale del asesor actual y se reparte con la
-- estrategia de esa cola; si tiene mensaje automático, queda como nota en el hilo).
-- Cola: la forzada; si no, la que ya tiene la conversación (activa); si no, la del canal
-- o la de mayor prioridad — nunca una "solo transferencia".
drop function if exists :"schema".chat_asignar(uuid, uuid, boolean);
create or replace function :"schema".chat_asignar(p_conversacion uuid, p_excluir uuid default null, p_es_reasignacion boolean default false, p_cola uuid default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c chat_conversaciones; q chat_colas; v_contacto chat_contactos;
  v_dia date := (now() at time zone 'America/Asuncion')::date;
  v_mejor uuid; v_mismo uuid; v_derivar boolean := p_cola is not null; v_previo uuid; v_rr text;
begin
  select * into c from chat_conversaciones where id = p_conversacion for update;
  if not found then return jsonb_build_object('asignada', false, 'motivo', 'no_existe'); end if;
  -- Desde la API (hay usuario): solo conversaciones de su empresa. El trigger del webhook y
  -- el barrido de SLA corren sin usuario.
  if auth.uid() is not null and c.empresa_id is distinct from empresa_actual() then
    return jsonb_build_object('asignada', false, 'motivo', 'no_existe');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(c.empresa_id::text, 7777));
  if c.asignado_id is not null and not p_es_reasignacion and not v_derivar then
    return jsonb_build_object('asignada', false, 'motivo', 'ya_asignada', 'usuario_id', c.asignado_id);
  end if;
  v_previo := c.asignado_id;

  if v_derivar then
    select * into q from chat_colas x where x.id = p_cola and x.empresa_id = c.empresa_id and x.activo;
    if q.id is null then return jsonb_build_object('asignada', false, 'motivo', 'cola_inexistente'); end if;
  elsif c.cola_id is not null then
    select * into q from chat_colas x where x.id = c.cola_id and x.activo;
  end if;
  if q.id is null then
    select * into q from chat_colas x
     where x.empresa_id = c.empresa_id and x.activo and not x.solo_transferencia
       and (x.id in (select cola_id from chat_cola_canales where canal_id = c.canal_id)
            or not exists (select 1 from chat_cola_canales cc where cc.cola_id = x.id))
     order by (x.id in (select cola_id from chat_cola_canales where canal_id = c.canal_id)) desc, x.prioridad desc, x.nombre
     limit 1;
  end if;
  if q.id is null then
    update chat_conversaciones set espera_motivo = 'sin_cola' where id = c.id;
    return jsonb_build_object('asignada', false, 'motivo', 'sin_cola');
  end if;

  if v_derivar then
    update chat_conversaciones set cola_id = q.id, asignado_id = null, sla_vence_at = null, reasignaciones = 0, espera_motivo = null where id = c.id;
    insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento, de_usuario, detalle)
    values (c.empresa_id, c.id, q.id, 'derivada', v_previo, jsonb_build_object('cola', q.nombre));
    if nullif(trim(coalesce(q.mensaje_derivacion, '')), '') is not null then
      insert into chat_mensajes (empresa_id, conversacion_id, from_me, tipo, contenido, estado_entrega)
      values (c.empresa_id, c.id, true, 'nota',
              '🤖 Mensaje automático al derivar a ' || q.nombre || ' (se envía al cliente cuando el canal esté conectado):' || E'\n' || trim(q.mensaje_derivacion),
              'enviado');
    end if;
  end if;

  if q.estrategia = 'manual' then
    update chat_conversaciones set cola_id = q.id, espera_motivo = 'cola_manual' where id = c.id;
    insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento) values (c.empresa_id, c.id, q.id, 'cola_manual');
    return jsonb_build_object('asignada', false, 'motivo', 'cola_manual', 'cola_id', q.id, 'cola', q.nombre);
  end if;

  -- Circular: turno fijo por nombre; arranca después del último que recibió.
  if q.estrategia = 'circular' and q.rr_ultimo_usuario is not null then
    select lower(coalesce(nombre, '')) || '|' || id into v_rr from usuarios where id = q.rr_ultimo_usuario;
  end if;

  with elig as (
    select a.usuario_id, a.max_conversaciones,
           coalesce(e.ultimo_latido_at >= now() - interval '90 seconds', false) as online,
           e.ultima_asignacion_at,
           lower(coalesce(u.nombre, '')) || '|' || u.id as clave
      from chat_cola_agentes a
      join usuarios u on u.id = a.usuario_id and u.activo
      left join chat_agentes_estado e on e.usuario_id = a.usuario_id
     where a.cola_id = q.id and a.recibe_nuevos
       and coalesce(e.estado, 'disponible') = 'disponible'
       and (p_excluir is null or a.usuario_id <> p_excluir)
  ),
  carga as (
    select asignado_id, count(*) as n from chat_conversaciones
     where empresa_id = c.empresa_id and asignado_id is not null and estado in ('abierta', 'pendiente')
     group by asignado_id
  )
  select el.usuario_id into v_mejor
    from elig el
    left join carga ca on ca.asignado_id = el.usuario_id
    left join chat_asignaciones_dia d on d.cola_id = q.id and d.usuario_id = el.usuario_id and d.dia = v_dia
   where coalesce(ca.n, 0) < el.max_conversaciones
   order by
     case when q.estrategia = 'circular' then el.clave > coalesce(v_rr, '') end desc nulls last,
     case when q.estrategia = 'circular' then el.clave end,
     case when q.estrategia = 'menor_carga' then coalesce(ca.n, 0) end,
     el.online desc, coalesce(d.cantidad, 0), coalesce(ca.n, 0), el.ultima_asignacion_at nulls first, el.usuario_id
   limit 1;

  -- Mismo asesor (solo en la asignación inicial de un entrante).
  if not p_es_reasignacion and not v_derivar and q.mismo_asesor_horas > 0 then
    select * into v_contacto from chat_contactos where id = c.contacto_id;
    if v_contacto.ultimo_asesor_id is not null and v_contacto.ultimo_asesor_at >= now() - make_interval(hours => q.mismo_asesor_horas) then
      select a.usuario_id into v_mismo
        from chat_cola_agentes a
        left join chat_agentes_estado e on e.usuario_id = a.usuario_id
       where a.cola_id = q.id and a.usuario_id = v_contacto.ultimo_asesor_id and a.recibe_nuevos
         and coalesce(e.estado, 'disponible') = 'disponible'
         and (select count(*) from chat_conversaciones x where x.empresa_id = c.empresa_id and x.asignado_id = a.usuario_id
               and x.estado in ('abierta', 'pendiente')) < a.max_conversaciones;
      if v_mismo is not null then v_mejor := v_mismo; end if;
    end if;
  end if;

  if v_mejor is null then
    -- Reasignación por SLA sin otro asesor: cuenta como intento (antes se reintentaba cada
    -- minuto para siempre); al llegar al tope, el barrido la deja con su asesor (sla_tope).
    update chat_conversaciones set cola_id = q.id, espera_motivo = 'sin_agente',
           asignado_id = case when p_es_reasignacion and not v_derivar then asignado_id else null end,
           reasignaciones = case when p_es_reasignacion and not v_derivar then reasignaciones + 1 else reasignaciones end
     where id = c.id;
    insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento) values (c.empresa_id, c.id, q.id, 'sin_agente');
    return jsonb_build_object('asignada', false, 'motivo', 'sin_agente', 'cola_id', q.id, 'cola', q.nombre);
  end if;

  update chat_conversaciones
     set cola_id = q.id, asignado_id = v_mejor, asignada_at = now(), espera_motivo = null,
         sla_vence_at = case when primera_respuesta_at is null then now() + make_interval(mins => q.sla_minutos) end,
         reasignaciones = case when p_es_reasignacion then reasignaciones + 1 else 0 end
   where id = c.id;
  if q.estrategia = 'circular' then
    update chat_colas set rr_ultimo_usuario = v_mejor where id = q.id;
  end if;
  insert into chat_asignaciones_dia (empresa_id, cola_id, usuario_id, dia, cantidad)
  values (c.empresa_id, q.id, v_mejor, v_dia, 1)
  on conflict (cola_id, usuario_id, dia) do update set cantidad = chat_asignaciones_dia.cantidad + 1;
  if p_es_reasignacion and p_excluir is not null then
    update chat_asignaciones_dia set cantidad = greatest(cantidad - 1, 0)
     where cola_id = q.id and usuario_id = p_excluir and dia = v_dia;
  end if;
  insert into chat_agentes_estado (usuario_id, empresa_id, ultima_asignacion_at) values (v_mejor, c.empresa_id, now())
  on conflict (usuario_id) do update set ultima_asignacion_at = now(), updated_at = now();
  update chat_contactos set ultimo_asesor_id = v_mejor, ultimo_asesor_at = now() where id = c.contacto_id;
  insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento, de_usuario, a_usuario, detalle)
  values (c.empresa_id, c.id, q.id, case when p_es_reasignacion then 'reasignada_sla' else 'asignada_auto' end,
          case when v_derivar then null else p_excluir end, v_mejor,
          jsonb_build_object('mismo_asesor', v_mismo is not null, 'estrategia', q.estrategia));
  insert into usuario_notificaciones (empresa_id, usuario_id, tipo, bandeja, titulo, cuerpo, url)
  select c.empresa_id, v_mejor, 'chat_asignado', 'general',
         case when v_derivar then 'Te derivaron un chat' when p_es_reasignacion then 'Te reasignaron un chat' else 'Nuevo chat asignado' end,
         coalesce(k.nombre, k.telefono), '/conversaciones?c=' || c.id
    from chat_contactos k where k.id = c.contacto_id;
  return jsonb_build_object('asignada', true, 'usuario_id', v_mejor, 'cola_id', q.id, 'cola', q.nombre, 'mismo_asesor', v_mismo is not null);
end;
$fn$;
revoke execute on function :"schema".chat_asignar(uuid, uuid, boolean, uuid) from public, anon;
grant execute on function :"schema".chat_asignar(uuid, uuid, boolean, uuid) to authenticated, service_role;

-- Historial de un contacto (38): el ruteo trae la cola (derivaciones) y cada conversación,
-- su cola actual.
create or replace function :"schema".chat_historial_contacto(p_contacto uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'contacto', (select to_jsonb(k) from chat_contactos k where k.id = p_contacto and k.empresa_id = empresa_actual()),
    'conversaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canal', ca.nombre, 'estado', c.estado, 'created_at', c.created_at, 'cerrada_at', c.cerrada_at,
        'asignado', u.nombre, 'cierre_estado', e.nombre, 'cierre_observacion', c.cierre_observacion,
        'ultimo_preview', c.ultimo_preview, 'ultimo_mensaje_at', c.ultimo_mensaje_at, 'cola', q.nombre) order by c.created_at desc)
       from chat_conversaciones c join chat_canales ca on ca.id = c.canal_id
       left join usuarios u on u.id = c.asignado_id
       left join chat_colas q on q.id = c.cola_id
       left join tipificacion_estados e on e.id = c.cierre_estado_id
      where c.contacto_id = p_contacto and c.empresa_id = empresa_actual()), '[]'::jsonb),
    'ruteo', coalesce((select jsonb_agg(jsonb_build_object('evento', r.evento, 'a', ua.nombre, 'de', ud.nombre, 'cola', q.nombre,
                         'created_at', r.created_at) order by r.created_at desc)
       from chat_ruteo_eventos r join chat_conversaciones c on c.id = r.conversacion_id
       left join usuarios ua on ua.id = r.a_usuario left join usuarios ud on ud.id = r.de_usuario
       left join chat_colas q on q.id = r.cola_id
      where c.contacto_id = p_contacto and r.empresa_id = empresa_actual()), '[]'::jsonb)
  )
$$;

-- ── F7 · bandeja (58) + filtro por cola y "sin asignar" ──────────────────────
drop function if exists :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer);
create or replace function :"schema".chat_bandeja(p_vista text default 'mias', p_q text default null, p_asignado uuid default null,
  p_canal uuid default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limite integer default 40,
  p_cola uuid default null, p_sin_asignar boolean default false)
returns jsonb
language plpgsql stable
set search_path = :"schema", public, extensions
as $$
declare v_yo uuid;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;
  return (
  with base as (
    select c.id, c.estado, c.asignado_id, c.canal_id, c.cola_id, c.prioridad, c.ultimo_mensaje_at, c.ultimo_preview, c.ultimo_from_me,
           c.ultimo_tipo, c.no_leidos, c.ventana_expira_at, c.etiquetas, c.sla_vence_at, c.primera_respuesta_at, c.espera_motivo,
           k.id as contacto_id, k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.avatar_url, k.cliente_id, k.prospecto_id,
           ca.tipo as canal_tipo, ca.nombre as canal_nombre, u.nombre as asignado_nombre, q.nombre as cola_nombre
      from chat_conversaciones c
      join chat_contactos k on k.id = c.contacto_id
      join chat_canales ca on ca.id = c.canal_id
      left join usuarios u on u.id = c.asignado_id
      left join chat_colas q on q.id = c.cola_id
     where c.empresa_id = empresa_actual()
       and case coalesce(p_vista, 'mias')
             when 'mias' then c.asignado_id = v_yo and c.estado <> 'cerrada'
             when 'sin_asignar' then c.asignado_id is null and c.estado <> 'cerrada'
             when 'cerradas' then c.estado = 'cerrada'
             else c.estado <> 'cerrada' end
       and (p_asignado is null or c.asignado_id = p_asignado)
       and (not coalesce(p_sin_asignar, false) or c.asignado_id is null)
       and (p_canal is null or c.canal_id = p_canal)
       and (p_cola is null or c.cola_id = p_cola)
       and (p_cursor_at is null or (c.ultimo_mensaje_at, c.id) < (p_cursor_at, p_cursor_id))
       and (coalesce(trim(p_q), '') = '' or coincide_busqueda(
              concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), norm(c.ultimo_preview), array_to_string(c.etiquetas, ' ')),
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
grant execute on function :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer, uuid, boolean) to authenticated, service_role;

-- ── F6 · finalizadas (58) + cola, asignado, semáforo, seguimientos y alcance ─
-- p_alcance: supervisor con equipo → solo lo que cerraron o tienen asignado esas personas.
-- p_seguimientos: próximas acciones pendientes, de la más próxima a la más lejana; el
-- rango de fechas pasa a ser el de la próxima acción y el cursor va por p_cursor_fecha.
drop function if exists :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer);
create or replace function :"schema".chat_finalizadas(p_desde date default null, p_hasta date default null, p_asesor uuid default null,
  p_estado uuid default null, p_q text default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limite integer default 50, p_cola uuid default null, p_asignado uuid default null, p_semaforo text default null,
  p_seguimientos boolean default false, p_cursor_fecha date default null, p_alcance uuid[] default null)
returns jsonb
language sql stable
set search_path = :"schema", public
as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  filas as (
    select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
           k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
           u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal,
           c.asignado_id, ua.nombre as asignado_nombre, c.cola_id, q.nombre as cola,
           c.ultimo_msg_asesor_at, hoy.d - (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date as dias_asesor,
           c.proxima_accion_fecha, c.proxima_accion_nota, c.seguimiento_hecho_at
      from chat_conversaciones c
      cross join hoy
      join chat_contactos k on k.id = c.contacto_id
      join chat_canales ca on ca.id = c.canal_id
      left join usuarios u on u.id = c.cerrada_por
      left join usuarios ua on ua.id = c.asignado_id
      left join chat_colas q on q.id = c.cola_id
      left join tipificacion_familias f on f.id = c.cierre_familia_id
      left join tipificacion_estados e on e.id = c.cierre_estado_id
     where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
       and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
       and (p_asesor is null or c.cerrada_por = p_asesor)
       and (p_asignado is null or c.asignado_id = p_asignado)
       and (p_cola is null or c.cola_id = p_cola)
       and (p_estado is null or c.cierre_estado_id = p_estado)
       and (p_semaforo is null or case p_semaforo
              when 'sin' then c.ultimo_msg_asesor_at is null
              when 'verde' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date >= hoy.d - 2
              when 'ambar' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date between hoy.d - 6 and hoy.d - 3
              when 'rojo' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date <= hoy.d - 7
              else true end)
       and (case when coalesce(p_seguimientos, false)
              then c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
                   and (p_desde is null or c.proxima_accion_fecha >= p_desde)
                   and (p_hasta is null or c.proxima_accion_fecha <= p_hasta)
                   and (p_cursor_fecha is null or (c.proxima_accion_fecha, c.id) > (p_cursor_fecha, p_cursor_id))
              else (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
                   and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
                   and (p_cursor_at is null or (c.cerrada_at, c.id) < (p_cursor_at, p_cursor_id))
            end)
       and (coalesce(trim(p_q), '') = '' or coincide_busqueda(
              concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), norm(c.cierre_observacion), norm(f.nombre), norm(e.nombre),
                        norm(u.nombre), norm(c.proxima_accion_nota), array_to_string(c.etiquetas, ' ')),
              tokens_busqueda(p_q)))
     order by
       case when coalesce(p_seguimientos, false) then c.proxima_accion_fecha end,
       case when coalesce(p_seguimientos, false) then c.id end,
       c.cerrada_at desc, c.id desc
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('semaforo',
                 case when r.dias_asesor is null then 'sin' when r.dias_asesor <= 2 then 'verde' when r.dias_asesor <= 6 then 'ambar' else 'rojo' end)
               order by case when coalesce(p_seguimientos, false) then r.proxima_accion_fecha end,
                        case when coalesce(p_seguimientos, false) then r.id end,
                        r.cerrada_at desc, r.id desc)
             from filas r), '[]'::jsonb),
    -- Para la pestaña Seguimientos: pendientes (y vencidos) en el alcance de quien mira.
    'seguimientos', (select jsonb_build_object('pendientes', count(*), 'vencidos', count(*) filter (where c.proxima_accion_fecha < hoy.d))
        from chat_conversaciones c cross join hoy
       where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
         and c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
         and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
         and (p_asesor is null or c.cerrada_por = p_asesor))
  )
$$;
grant execute on function :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer, uuid, uuid, text, boolean, date, uuid[])
  to authenticated, service_role;
