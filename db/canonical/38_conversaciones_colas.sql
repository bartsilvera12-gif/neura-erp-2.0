-- =============================================================================
-- CONVERSACIONES · Colas, asignación automática, SLA y monitoreo
-- Porte de cc_assign_conversation / cc_reassign_on_sla del sistema actual, en un solo
-- schema (sin SQL dinámico por tenant) y con las mismas reglas:
--   · cola: la vinculada al canal; si no, la de mayor prioridad
--   · agente elegible: activo en la cola, recibe chats, estado "disponible", con lugar
--     (carga abierta+pendiente < máximo); prefiere ONLINE (latido < 90 s), después el
--     de MENOR conteo del día, MENOR carga y el que hace más que no recibe
--   · "mismo asesor": si el contacto habló hace poco con un asesor elegible, vuelve a él
--   · estrategia manual: la conversación queda en la cola para que alguien la tome
--   · sin agente: queda sin asignar (visible en Monitoreo), nunca se pierde
--   · SLA: vence a los N minutos de asignada sin primera respuesta → se reasigna a otro
--     (hasta max_reasignaciones), barrido cada minuto con pg_cron
-- Auditoría en chat_ruteo_eventos. IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

create table if not exists :"schema".chat_colas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  estrategia text not null default 'equitativa' check (estrategia in ('equitativa', 'manual')),
  prioridad integer not null default 0,
  sla_minutos integer not null default 5 check (sla_minutos between 1 and 1440),
  max_reasignaciones integer not null default 2 check (max_reasignaciones between 0 and 20),
  mismo_asesor_horas integer not null default 24 check (mismo_asesor_horas between 0 and 720),  -- 0 = apagado
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists :"schema".chat_cola_canales (
  cola_id uuid not null references :"schema".chat_colas(id) on delete cascade,
  canal_id uuid not null references :"schema".chat_canales(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  primary key (cola_id, canal_id)
);
create table if not exists :"schema".chat_cola_agentes (
  cola_id uuid not null references :"schema".chat_colas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  recibe_nuevos boolean not null default true,
  max_conversaciones integer not null default 20 check (max_conversaciones between 1 and 500),
  es_supervisor boolean not null default false,
  primary key (cola_id, usuario_id)
);
-- Estado de cada asesor (presencia).
create table if not exists :"schema".chat_agentes_estado (
  usuario_id uuid primary key references :"schema".usuarios(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  estado text not null default 'disponible' check (estado in ('disponible', 'ocupado', 'pausa', 'desconectado')),
  ultimo_latido_at timestamptz,
  ultima_asignacion_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists :"schema".chat_asignaciones_dia (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cola_id uuid not null references :"schema".chat_colas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  dia date not null,
  cantidad integer not null default 0,
  primary key (cola_id, usuario_id, dia)
);
create table if not exists :"schema".chat_ruteo_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  conversacion_id uuid not null references :"schema".chat_conversaciones(id) on delete cascade,
  cola_id uuid,
  evento text not null,        -- asignada_auto | sin_agente | cola_manual | reasignada_sla | sla_tope | tomada | transferida
  de_usuario uuid, a_usuario uuid,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_ruteo_conv_idx on :"schema".chat_ruteo_eventos (conversacion_id, created_at desc);
create index if not exists chat_ruteo_empresa_idx on :"schema".chat_ruteo_eventos (empresa_id, created_at desc);

alter table :"schema".chat_conversaciones add column if not exists asignada_at timestamptz;
alter table :"schema".chat_conversaciones add column if not exists sla_vence_at timestamptz;
alter table :"schema".chat_conversaciones add column if not exists reasignaciones integer not null default 0;
alter table :"schema".chat_conversaciones add column if not exists espera_motivo text;   -- sin_cola | sin_agente | cola_manual
alter table :"schema".chat_contactos add column if not exists ultimo_asesor_id uuid;
alter table :"schema".chat_contactos add column if not exists ultimo_asesor_at timestamptz;
do $$ begin
  alter table chat_conversaciones add constraint chat_conv_cola_fk foreign key (cola_id) references chat_colas(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists chat_conv_sla_idx on :"schema".chat_conversaciones (sla_vence_at) where sla_vence_at is not null and primera_respuesta_at is null and estado <> 'cerrada';

do $$
declare t text;
begin
  foreach t in array array['chat_colas', 'chat_cola_canales', 'chat_cola_agentes', 'chat_agentes_estado', 'chat_asignaciones_dia', 'chat_ruteo_eventos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())', t || '_propias', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;

-- ── Asignación automática ────────────────────────────────────────────────────
create or replace function :"schema".chat_asignar(p_conversacion uuid, p_excluir uuid default null, p_es_reasignacion boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c chat_conversaciones; q chat_colas; v_contacto chat_contactos;
  v_dia date := (now() at time zone 'America/Asuncion')::date;
  v_mejor uuid; v_mismo uuid;
begin
  select * into c from chat_conversaciones where id = p_conversacion for update;
  if not found then return jsonb_build_object('asignada', false, 'motivo', 'no_existe'); end if;
  perform pg_advisory_xact_lock(hashtextextended(c.empresa_id::text, 7777));
  if c.asignado_id is not null and not p_es_reasignacion then
    return jsonb_build_object('asignada', false, 'motivo', 'ya_asignada', 'usuario_id', c.asignado_id);
  end if;

  select * into q from chat_colas x
   where x.empresa_id = c.empresa_id and x.activo
     and (x.id in (select cola_id from chat_cola_canales where canal_id = c.canal_id)
          or not exists (select 1 from chat_cola_canales cc where cc.cola_id = x.id))
   order by (x.id in (select cola_id from chat_cola_canales where canal_id = c.canal_id)) desc, x.prioridad desc, x.nombre
   limit 1;
  if not found then
    update chat_conversaciones set espera_motivo = 'sin_cola' where id = c.id;
    return jsonb_build_object('asignada', false, 'motivo', 'sin_cola');
  end if;
  if q.estrategia = 'manual' then
    update chat_conversaciones set cola_id = q.id, espera_motivo = 'cola_manual' where id = c.id;
    insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento) values (c.empresa_id, c.id, q.id, 'cola_manual');
    return jsonb_build_object('asignada', false, 'motivo', 'cola_manual', 'cola_id', q.id);
  end if;

  with elig as (
    select a.usuario_id, a.max_conversaciones,
           coalesce(e.ultimo_latido_at >= now() - interval '90 seconds', false) as online,
           e.ultima_asignacion_at
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
   order by el.online desc, coalesce(d.cantidad, 0), coalesce(ca.n, 0), el.ultima_asignacion_at nulls first, el.usuario_id
   limit 1;

  -- Mismo asesor (solo en la asignación inicial).
  if not p_es_reasignacion and q.mismo_asesor_horas > 0 then
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
    update chat_conversaciones set cola_id = q.id, espera_motivo = 'sin_agente',
           asignado_id = case when p_es_reasignacion then asignado_id else null end
     where id = c.id;
    insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento) values (c.empresa_id, c.id, q.id, 'sin_agente');
    return jsonb_build_object('asignada', false, 'motivo', 'sin_agente', 'cola_id', q.id);
  end if;

  update chat_conversaciones
     set cola_id = q.id, asignado_id = v_mejor, asignada_at = now(), espera_motivo = null,
         sla_vence_at = case when primera_respuesta_at is null then now() + make_interval(mins => q.sla_minutos) end,
         reasignaciones = case when p_es_reasignacion then reasignaciones + 1 else 0 end
   where id = c.id;
  insert into chat_asignaciones_dia (empresa_id, cola_id, usuario_id, dia, cantidad)
  values (c.empresa_id, q.id, v_mejor, v_dia, 1)
  on conflict (cola_id, usuario_id, dia) do update set cantidad = chat_asignaciones_dia.cantidad + 1;
  -- Si fue reasignación, el conteo del día pasa del anterior al nuevo.
  if p_es_reasignacion and p_excluir is not null then
    update chat_asignaciones_dia set cantidad = greatest(cantidad - 1, 0)
     where cola_id = q.id and usuario_id = p_excluir and dia = v_dia;
  end if;
  insert into chat_agentes_estado (usuario_id, empresa_id, ultima_asignacion_at) values (v_mejor, c.empresa_id, now())
  on conflict (usuario_id) do update set ultima_asignacion_at = now(), updated_at = now();
  update chat_contactos set ultimo_asesor_id = v_mejor, ultimo_asesor_at = now() where id = c.contacto_id;
  insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento, de_usuario, a_usuario, detalle)
  values (c.empresa_id, c.id, q.id, case when p_es_reasignacion then 'reasignada_sla' else 'asignada_auto' end,
          p_excluir, v_mejor, jsonb_build_object('mismo_asesor', v_mismo is not null));
  -- Aviso en la campanita del asesor (con sonido, como todo aviso nuevo).
  insert into usuario_notificaciones (empresa_id, usuario_id, tipo, bandeja, titulo, cuerpo, url)
  select c.empresa_id, v_mejor, 'chat_asignado', 'general',
         case when p_es_reasignacion then 'Te reasignaron un chat' else 'Nuevo chat asignado' end,
         coalesce(k.nombre, k.telefono), '/conversaciones?c=' || c.id
    from chat_contactos k where k.id = c.contacto_id;
  return jsonb_build_object('asignada', true, 'usuario_id', v_mejor, 'cola_id', q.id, 'mismo_asesor', v_mismo is not null);
end;
$fn$;
revoke execute on function :"schema".chat_asignar(uuid, uuid, boolean) from public, anon;
grant execute on function :"schema".chat_asignar(uuid, uuid, boolean) to authenticated, service_role;

-- Mensaje entrante en una conversación sin asignar → asignación automática.
-- Respuesta del asesor → se cumple el SLA (se limpia el vencimiento).
create or replace function :"schema".tg_chat_mensaje_ruteo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare c chat_conversaciones;
begin
  if new.tipo = 'nota' then return null; end if;
  select * into c from chat_conversaciones where id = new.conversacion_id;
  if not new.from_me then
    if c.asignado_id is null and c.estado <> 'cerrada' then
      perform chat_asignar(c.id);
    end if;
  elsif new.autor_usuario_id is not null and c.sla_vence_at is not null then
    update chat_conversaciones set sla_vence_at = null where id = c.id;
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_chat_mensaje_ruteo on :"schema".chat_mensajes;
create trigger trg_chat_mensaje_ruteo after insert on :"schema".chat_mensajes
  for each row execute function :"schema".tg_chat_mensaje_ruteo();

-- ── Barrido de SLA (cada minuto con pg_cron) ─────────────────────────────────
create or replace function :"schema".chat_sla_barrer()
returns integer language plpgsql security definer set search_path = :"schema", public as $fn$
declare r record; n integer := 0; q chat_colas;
begin
  for r in
    select c.id, c.asignado_id, c.cola_id, c.reasignaciones, c.empresa_id from chat_conversaciones c
     where c.sla_vence_at < now() and c.primera_respuesta_at is null and c.estado <> 'cerrada'
     order by c.sla_vence_at limit 200
  loop
    select * into q from chat_colas where id = r.cola_id;
    if q.id is null or r.reasignaciones >= q.max_reasignaciones then
      update chat_conversaciones set sla_vence_at = null where id = r.id;   -- tope: queda con el asesor, se ve vencido en Monitoreo
      insert into chat_ruteo_eventos (empresa_id, conversacion_id, cola_id, evento, de_usuario)
      values (r.empresa_id, r.id, r.cola_id, 'sla_tope', r.asignado_id);
    else
      perform chat_asignar(r.id, r.asignado_id, true);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$fn$;

-- ── Presencia del asesor (latido cada 30 s desde la bandeja) ────────────────
create or replace function :"schema".chat_latido(p_estado text default null)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare v_yo uuid; v_estado text;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() and empresa_id = empresa_actual() limit 1;
  if v_yo is null then raise exception 'Sin usuario'; end if;
  if p_estado is not null and p_estado not in ('disponible', 'ocupado', 'pausa', 'desconectado') then raise exception 'Estado inválido'; end if;
  insert into chat_agentes_estado (usuario_id, empresa_id, estado, ultimo_latido_at)
  values (v_yo, empresa_actual(), coalesce(p_estado, 'disponible'), now())
  on conflict (usuario_id) do update
     set ultimo_latido_at = now(), estado = coalesce(p_estado, chat_agentes_estado.estado), updated_at = now()
  returning estado into v_estado;
  return jsonb_build_object('estado', v_estado);
end;
$fn$;

-- ── Monitoreo (una consulta) ─────────────────────────────────────────────────
create or replace function :"schema".chat_monitoreo()
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  abiertas as (
    select c.*, k.nombre as contacto_nombre, k.telefono as contacto_telefono
      from chat_conversaciones c join chat_contactos k on k.id = c.contacto_id
     where c.empresa_id = empresa_actual() and c.estado <> 'cerrada'
  ),
  agentes as (
    select u.id, u.nombre, coalesce(e.estado, 'desconectado') as estado,
           coalesce(e.ultimo_latido_at >= now() - interval '90 seconds', false) as online, e.ultimo_latido_at,
           (select count(*) from abiertas a where a.asignado_id = u.id) as carga,
           (select count(*) from abiertas a where a.asignado_id = u.id and a.ultimo_from_me is false) as esperando_respuesta,
           (select count(*) from abiertas a where a.asignado_id = u.id and a.sla_vence_at < now()) as sla_vencidos,
           (select coalesce(sum(cantidad), 0) from chat_asignaciones_dia d, hoy where d.usuario_id = u.id and d.dia = hoy.d) as asignadas_hoy,
           (select count(*) from chat_conversaciones x, hoy where x.cerrada_por = u.id and (x.cerrada_at at time zone 'America/Asuncion')::date = hoy.d) as cerradas_hoy,
           (select array_agg(distinct q.nombre) from chat_cola_agentes ca join chat_colas q on q.id = ca.cola_id where ca.usuario_id = u.id) as colas
      from usuarios u
      left join chat_agentes_estado e on e.usuario_id = u.id
     where u.empresa_id = empresa_actual() and u.activo
       and (exists (select 1 from chat_cola_agentes ca where ca.usuario_id = u.id) or exists (select 1 from abiertas a where a.asignado_id = u.id))
  )
  select jsonb_build_object(
    'resumen', (select jsonb_build_object(
        'abiertas', count(*), 'sin_asignar', count(*) filter (where asignado_id is null),
        'esperando_respuesta', count(*) filter (where ultimo_from_me is false),
        'sla_vencidos', count(*) filter (where sla_vence_at < now()),
        'fuera_de_ventana', count(*) filter (where ventana_expira_at < now()),
        'agentes_online', (select count(*) from agentes where online),
        'nuevos_hoy', (select count(*) from chat_conversaciones x, hoy where x.empresa_id = empresa_actual() and (x.created_at at time zone 'America/Asuncion')::date = hoy.d),
        'cerradas_hoy', (select count(*) from chat_conversaciones x, hoy where x.empresa_id = empresa_actual() and (x.cerrada_at at time zone 'America/Asuncion')::date = hoy.d))
      from abiertas),
    'sin_asignar', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'contacto', coalesce(contacto_nombre, contacto_telefono),
                                'ultimo_mensaje_at', ultimo_mensaje_at, 'preview', ultimo_preview, 'motivo', espera_motivo) order by ultimo_mensaje_at)
                             from (select * from abiertas where asignado_id is null order by ultimo_mensaje_at limit 100) s), '[]'::jsonb),
    'esperando', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'contacto', coalesce(contacto_nombre, contacto_telefono),
                                'asignado_id', asignado_id, 'desde', ultimo_cliente_at, 'preview', ultimo_preview,
                                'sla_vence_at', sla_vence_at) order by ultimo_cliente_at)
                             from (select * from abiertas where asignado_id is not null and ultimo_from_me is false order by ultimo_cliente_at limit 200) s), '[]'::jsonb),
    'agentes', coalesce((select jsonb_agg(to_jsonb(a) order by a.online desc, a.carga desc, a.nombre) from agentes a), '[]'::jsonb)
  )
$$;

-- ── Finalizadas (una consulta, cursor) ───────────────────────────────────────
create or replace function :"schema".chat_finalizadas(
  p_desde date default null, p_hasta date default null, p_asesor uuid default null, p_estado uuid default null,
  p_q text default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limite integer default 50
) returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(r order by r.cerrada_at desc, r.id desc), '[]'::jsonb))
    from (select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
                 k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
                 u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal
            from chat_conversaciones c
            join chat_contactos k on k.id = c.contacto_id
            join chat_canales ca on ca.id = c.canal_id
            left join usuarios u on u.id = c.cerrada_por
            left join tipificacion_familias f on f.id = c.cierre_familia_id
            left join tipificacion_estados e on e.id = c.cierre_estado_id
           where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
             and (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
             and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
             and (p_asesor is null or c.cerrada_por = p_asesor)
             and (p_estado is null or c.cierre_estado_id = p_estado)
             and (p_cursor_at is null or (c.cerrada_at, c.id) < (p_cursor_at, p_cursor_id))
             and (coalesce(trim(p_q), '') = '' or coincide_busqueda(
                    concat_ws(' ', norm(k.nombre), regexp_replace(coalesce(k.telefono, ''), '[^0-9]', '', 'g'), norm(c.cierre_observacion)),
                    tokens_busqueda(p_q)))
           order by c.cerrada_at desc, c.id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 200)) r
$$;
create index if not exists chat_conv_cerradas_idx on :"schema".chat_conversaciones (empresa_id, cerrada_at desc, id desc) where estado = 'cerrada';

-- ── Historial omnicanal de un contacto (todas sus conversaciones) ───────────
create or replace function :"schema".chat_historial_contacto(p_contacto uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'contacto', (select to_jsonb(k) from chat_contactos k where k.id = p_contacto and k.empresa_id = empresa_actual()),
    'conversaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canal', ca.nombre, 'estado', c.estado, 'created_at', c.created_at, 'cerrada_at', c.cerrada_at,
        'asignado', u.nombre, 'cierre_estado', e.nombre, 'cierre_observacion', c.cierre_observacion,
        'ultimo_preview', c.ultimo_preview, 'ultimo_mensaje_at', c.ultimo_mensaje_at) order by c.created_at desc)
       from chat_conversaciones c join chat_canales ca on ca.id = c.canal_id
       left join usuarios u on u.id = c.asignado_id
       left join tipificacion_estados e on e.id = c.cierre_estado_id
      where c.contacto_id = p_contacto and c.empresa_id = empresa_actual()), '[]'::jsonb),
    'ruteo', coalesce((select jsonb_agg(jsonb_build_object('evento', r.evento, 'a', ua.nombre, 'de', ud.nombre, 'created_at', r.created_at) order by r.created_at desc)
       from chat_ruteo_eventos r join chat_conversaciones c on c.id = r.conversacion_id
       left join usuarios ua on ua.id = r.a_usuario left join usuarios ud on ud.id = r.de_usuario
      where c.contacto_id = p_contacto and r.empresa_id = empresa_actual()), '[]'::jsonb)
  )
$$;

grant execute on function :"schema".chat_latido(text), :"schema".chat_monitoreo(),
  :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer),
  :"schema".chat_historial_contacto(uuid) to authenticated, service_role;
revoke execute on function :"schema".chat_sla_barrer() from public, anon, authenticated;

-- Cola por defecto para cada empresa (todos los usuarios activos, estrategia equitativa).
insert into :"schema".chat_colas (empresa_id, nombre)
select e.id, 'Atención general' from :"schema".empresas e
 where not exists (select 1 from :"schema".chat_colas q where q.empresa_id = e.id);
insert into :"schema".chat_cola_agentes (cola_id, usuario_id, empresa_id)
select q.id, u.id, q.empresa_id from :"schema".chat_colas q join :"schema".usuarios u on u.empresa_id = q.empresa_id and u.activo
 where q.nombre = 'Atención general'
on conflict do nothing;
