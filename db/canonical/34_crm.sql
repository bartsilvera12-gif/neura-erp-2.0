-- =============================================================================
-- CRM FUNNEL (como el del sistema actual), re-pensado para que sea rápido:
--   · crm_etapas configurables (LEAD, CONTACTADO, NEGOCIACION, GANADO, PERDIDO)
--   · crm_prospectos con numero_control CRM-000001, texto de búsqueda guardado + índice
--     de trigramas, índices (empresa, etapa, actualizado) y (empresa, responsable)
--   · crm_notas = el timeline (se cargan solo al abrir el prospecto)
--   · crm_tablero: UNA consulta devuelve cada columna con su cantidad, su total en Gs y
--     solo las primeras N tarjetas (el actual traía TODOS los prospectos + todas las notas)
--   · crm_columna: "cargar más" de una columna con cursor (keyset, sin OFFSET)
--   · crm_mover: mueve una tarjeta y deja la nota de cambio de etapa (sin recargar todo)
--   · crm_convertir_cliente: crea el cliente desde el prospecto y lo marca GANADO
--   · chat: crm_prospectos.first_conversation_id queda listo para Conversaciones
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;
do $$ begin perform extensions.similarity('a', 'b'); end $$;

create table if not exists :"schema".crm_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  color text not null default 'gray',
  orden integer not null default 0,
  es_ganado boolean not null default false,
  es_perdido boolean not null default false,
  activo boolean not null default true,
  unique (empresa_id, codigo)
);
alter table :"schema".crm_etapas enable row level security;
alter table :"schema".crm_etapas force row level security;
drop policy if exists crm_etapas_propias on :"schema".crm_etapas;
create policy crm_etapas_propias on :"schema".crm_etapas to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".crm_etapas to authenticated, service_role;

insert into :"schema".crm_etapas (empresa_id, codigo, nombre, color, orden, es_ganado, es_perdido)
select e.id, x.* from :"schema".empresas e cross join (values
  ('LEAD', 'Lead', 'gray', 1, false, false),
  ('CONTACTADO', 'Contactado', 'blue', 2, false, false),
  ('NEGOCIACION', 'Negociación', 'amber', 3, false, false),
  ('GANADO', 'Ganado', 'green', 4, true, false),
  ('PERDIDO', 'Perdido', 'red', 5, false, true)
) as x(codigo, nombre, color, orden, es_ganado, es_perdido)
on conflict (empresa_id, codigo) do nothing;

create table if not exists :"schema".crm_prospectos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero_control text not null,
  empresa text,                       -- nombre de la empresa del prospecto
  contacto text not null,
  email text,
  telefono text,
  servicio text,                      -- producto / servicio de interés
  valor_estimado numeric(18,2) not null default 0,
  etapa text not null default 'LEAD', -- crm_etapas.codigo
  proxima_accion text,
  fecha_proxima_accion date,
  origen_creacion text not null default 'manual'
    check (origen_creacion in ('manual', 'whatsapp', 'formulario_web', 'referido', 'campana', 'automatizacion', 'otro')),
  origen_detalle text,
  responsable_usuario_id uuid references :"schema".usuarios(id) on delete set null,
  observaciones text,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  first_conversation_id uuid,
  motivo_perdida text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  etapa_desde timestamptz not null default now(),   -- desde cuándo está en la etapa actual
  busqueda text,
  unique (empresa_id, numero_control)
);
create index if not exists crm_pros_etapa_idx on :"schema".crm_prospectos (empresa_id, etapa, updated_at desc, id desc);
create index if not exists crm_pros_resp_idx on :"schema".crm_prospectos (empresa_id, responsable_usuario_id, etapa);
create index if not exists crm_pros_tel_idx on :"schema".crm_prospectos (empresa_id, (regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')));
create index if not exists crm_pros_busqueda_trgm on :"schema".crm_prospectos using gin (busqueda extensions.gin_trgm_ops) with (fastupdate = off);
create index if not exists crm_pros_proxima_idx on :"schema".crm_prospectos (empresa_id, fecha_proxima_accion) where fecha_proxima_accion is not null;
alter table :"schema".crm_prospectos enable row level security;
alter table :"schema".crm_prospectos force row level security;
drop policy if exists crm_pros_propios on :"schema".crm_prospectos;
create policy crm_pros_propios on :"schema".crm_prospectos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".crm_prospectos to authenticated, service_role;

create table if not exists :"schema".crm_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  prospecto_id uuid not null references :"schema".crm_prospectos(id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('nota', 'llamada', 'whatsapp', 'email', 'reunion', 'cambio_etapa', 'sistema')),
  texto text not null,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists crm_notas_pros_idx on :"schema".crm_notas (prospecto_id, created_at desc);
alter table :"schema".crm_notas enable row level security;
alter table :"schema".crm_notas force row level security;
drop policy if exists crm_notas_propias on :"schema".crm_notas;
create policy crm_notas_propias on :"schema".crm_notas to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".crm_notas to authenticated, service_role;

-- Número CRM-000001 y texto de búsqueda (normalizado, sin tildes; teléfono solo dígitos).
create or replace function :"schema".tg_crm_prospectos()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  if tg_op = 'INSERT' and (new.numero_control is null or new.numero_control = '') then
    perform pg_advisory_xact_lock(hashtext('crm_numero_' || new.empresa_id::text));
    select 'CRM-' || lpad((coalesce(max(substring(numero_control from '[0-9]+$')::bigint), 0) + 1)::text, 6, '0')
      into new.numero_control from crm_prospectos where empresa_id = new.empresa_id;
  end if;
  if tg_op = 'UPDATE' and new.etapa is distinct from old.etapa then
    new.etapa_desde := now();
  end if;
  new.updated_at := now();
  new.busqueda := concat_ws(' ', norm(new.contacto), norm(new.empresa), norm(new.email), norm(new.servicio),
                            regexp_replace(coalesce(new.telefono, ''), '[^0-9]', '', 'g'), lower(new.numero_control),
                            regexp_replace(lower(new.numero_control), '[^a-z0-9]', '', 'g'));
  return new;
end;
$fn$;
drop trigger if exists trg_crm_prospectos on :"schema".crm_prospectos;
create trigger trg_crm_prospectos before insert or update on :"schema".crm_prospectos
  for each row execute function :"schema".tg_crm_prospectos();
alter table :"schema".crm_prospectos alter column numero_control set default '';

-- Ids que coinciden con TODAS las palabras (con índice; números tal cual, palabras con tolerancia).
create or replace function :"schema".crm_candidatos(p_q text)
returns setof uuid language plpgsql stable set search_path = :"schema", public, extensions as $fn$
declare v_cond text;
begin
  if coalesce(trim(p_q), '') = '' then return; end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.39', true);
  select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                         then format('(busqueda like %L or %L <%% busqueda)', '%' || t || '%', t)
                         else format('busqueda like %L', '%' || t || '%') end, ' and ')
    into v_cond from unnest(tokens_busqueda(p_q)) t;
  if v_cond is null then return; end if;
  return query execute format('select id from crm_prospectos where empresa_id = %L and %s', empresa_actual(), v_cond);
end;
$fn$;

-- ── Tablero: columnas con cantidad, total y primeras N tarjetas ─────────────
create or replace function :"schema".crm_tablero(
  p_q text default null, p_responsable uuid default null, p_solo_mios boolean default false,
  p_hoy boolean default false, p_por_columna integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $$
declare
  v_yo uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_lim integer := least(greatest(coalesce(p_por_columna, 25), 1), 100);
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;
  return (
  with filtro as (
    select p.* from crm_prospectos p
     where p.empresa_id = empresa_actual()
       and (p_responsable is null or p.responsable_usuario_id = p_responsable)
       and (not coalesce(p_solo_mios, false) or p.responsable_usuario_id = v_yo)
       and (not coalesce(p_hoy, false) or (p.created_at at time zone 'America/Asuncion')::date = v_hoy)
       and (coalesce(trim(p_q), '') = '' or p.id in (select crm_candidatos(p_q)))
  ),
  cols as (
    select e.codigo, e.nombre, e.color, e.orden, e.es_ganado, e.es_perdido,
           (select count(*) from filtro f where f.etapa = e.codigo) as cantidad,
           (select coalesce(sum(valor_estimado), 0) from filtro f where f.etapa = e.codigo) as total,
           coalesce((select jsonb_agg(t order by t.updated_at desc, t.id desc) from (
              select f.id, f.numero_control, f.empresa, f.contacto, f.telefono, f.email, f.servicio, f.valor_estimado,
                     f.etapa, f.proxima_accion, f.fecha_proxima_accion, f.origen_creacion, f.responsable_usuario_id,
                     u.nombre as responsable_nombre, f.cliente_id, f.updated_at, f.created_at, f.etapa_desde,
                     (f.fecha_proxima_accion is not null and f.fecha_proxima_accion < v_hoy) as accion_vencida
                from filtro f left join usuarios u on u.id = f.responsable_usuario_id
               where f.etapa = e.codigo
               order by f.updated_at desc, f.id desc
               limit v_lim) t), '[]'::jsonb) as tarjetas
      from crm_etapas e
     where e.empresa_id = empresa_actual() and e.activo
  )
  select jsonb_build_object(
    'columnas', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden) from cols c), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
        'leads_hoy', count(*) filter (where (created_at at time zone 'America/Asuncion')::date = v_hoy),
        'leads_mes', count(*) filter (where created_at >= date_trunc('month', v_hoy)::timestamp at time zone 'America/Asuncion'),
        'en_negociacion', coalesce(sum(valor_estimado) filter (where etapa in (select codigo from crm_etapas where empresa_id = empresa_actual() and not es_ganado and not es_perdido)), 0),
        'ganados_mes', count(*) filter (where etapa in (select codigo from crm_etapas where empresa_id = empresa_actual() and es_ganado)
                                          and etapa_desde >= date_trunc('month', v_hoy)::timestamp at time zone 'America/Asuncion'),
        'acciones_vencidas', count(*) filter (where fecha_proxima_accion < v_hoy and etapa in (select codigo from crm_etapas where empresa_id = empresa_actual() and not es_ganado and not es_perdido)))
      from filtro)
  ));
end;
$$;

-- ── "Cargar más" de una columna (cursor = updated_at + id de la última tarjeta) ─
create or replace function :"schema".crm_columna(
  p_etapa text, p_cursor_at timestamptz, p_cursor_id uuid,
  p_q text default null, p_responsable uuid default null, p_solo_mios boolean default false,
  p_hoy boolean default false, p_limite integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $$
declare
  v_yo uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;
  return coalesce((select jsonb_agg(t order by t.updated_at desc, t.id desc) from (
    select p.id, p.numero_control, p.empresa, p.contacto, p.telefono, p.email, p.servicio, p.valor_estimado,
           p.etapa, p.proxima_accion, p.fecha_proxima_accion, p.origen_creacion, p.responsable_usuario_id,
           u.nombre as responsable_nombre, p.cliente_id, p.updated_at, p.created_at, p.etapa_desde,
           (p.fecha_proxima_accion is not null and p.fecha_proxima_accion < v_hoy) as accion_vencida
      from crm_prospectos p left join usuarios u on u.id = p.responsable_usuario_id
     where p.empresa_id = empresa_actual() and p.etapa = p_etapa
       and (p_cursor_at is null or (p.updated_at, p.id) < (p_cursor_at, p_cursor_id))
       and (p_responsable is null or p.responsable_usuario_id = p_responsable)
       and (not coalesce(p_solo_mios, false) or p.responsable_usuario_id = v_yo)
       and (not coalesce(p_hoy, false) or (p.created_at at time zone 'America/Asuncion')::date = v_hoy)
       and (coalesce(trim(p_q), '') = '' or p.id in (select crm_candidatos(p_q)))
     order by p.updated_at desc, p.id desc
     limit least(greatest(coalesce(p_limite, 25), 1), 100)) t), '[]'::jsonb);
end;
$$;

-- ── Mover de etapa (drag & drop) ─────────────────────────────────────────────
create or replace function :"schema".crm_mover(p_prospecto uuid, p_etapa text, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  p crm_prospectos; e_old crm_etapas; e_new crm_etapas;
  v_usuario uuid; v_nombre text;
begin
  select * into p from crm_prospectos where id = p_prospecto and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Prospecto no encontrado'; end if;
  select * into e_new from crm_etapas where empresa_id = p.empresa_id and codigo = p_etapa and activo;
  if not found then raise exception 'Etapa inválida'; end if;
  if p.etapa = p_etapa then return jsonb_build_object('id', p.id, 'etapa', p.etapa, 'sin_cambios', true); end if;
  if e_new.es_perdido and coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la pérdida'; end if;
  select * into e_old from crm_etapas where empresa_id = p.empresa_id and codigo = p.etapa;
  select id, nombre into v_usuario, v_nombre from usuarios where auth_user_id = auth.uid() limit 1;
  update crm_prospectos set etapa = p_etapa,
         motivo_perdida = case when e_new.es_perdido then trim(p_motivo) else motivo_perdida end
   where id = p.id;
  insert into crm_notas (empresa_id, prospecto_id, tipo, texto, usuario_id, usuario_nombre)
  values (p.empresa_id, p.id, 'cambio_etapa',
          coalesce(e_old.nombre, p.etapa) || ' → ' || e_new.nombre || case when e_new.es_perdido then ' · ' || trim(p_motivo) else '' end,
          v_usuario, v_nombre);
  return jsonb_build_object('id', p.id, 'etapa', p_etapa, 'updated_at', now());
end;
$$;

-- ── Transformar a cliente ────────────────────────────────────────────────────
create or replace function :"schema".crm_convertir_cliente(p_prospecto uuid, p_cliente jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  p crm_prospectos; v_cliente uuid; v_ganado text; v_usuario uuid; v_nombre text;
begin
  select * into p from crm_prospectos where id = p_prospecto and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Prospecto no encontrado'; end if;
  if p.cliente_id is not null then raise exception 'Este prospecto ya es cliente'; end if;
  select id, nombre into v_usuario, v_nombre from usuarios where auth_user_id = auth.uid() limit 1;
  insert into clientes (empresa_id, nombre, tipo_cliente, razon_social, nombre_contacto, telefono, email, documento, ruc,
                        ciudad, direccion, origen, created_by)
  values (p.empresa_id,
          coalesce(nullif(trim(p_cliente->>'nombre'), ''), nullif(trim(p.empresa), ''), p.contacto),
          coalesce(nullif(p_cliente->>'tipo_cliente', ''), case when nullif(trim(p.empresa), '') is not null then 'empresa' else 'persona' end),
          nullif(trim(p_cliente->>'razon_social'), ''),
          case when nullif(trim(p.empresa), '') is not null then p.contacto end,
          coalesce(nullif(trim(p_cliente->>'telefono'), ''), p.telefono),
          coalesce(nullif(trim(p_cliente->>'email'), ''), p.email),
          nullif(trim(p_cliente->>'documento'), ''), nullif(trim(p_cliente->>'ruc'), ''),
          nullif(trim(p_cliente->>'ciudad'), ''), nullif(trim(p_cliente->>'direccion'), ''),
          'CRM', v_usuario)
  returning id into v_cliente;
  select codigo into v_ganado from crm_etapas where empresa_id = p.empresa_id and es_ganado and activo order by orden limit 1;
  update crm_prospectos set cliente_id = v_cliente, etapa = coalesce(v_ganado, etapa) where id = p.id;
  insert into crm_notas (empresa_id, prospecto_id, tipo, texto, usuario_id, usuario_nombre)
  values (p.empresa_id, p.id, 'sistema', 'Se creó el cliente a partir de este prospecto', v_usuario, v_nombre);
  return jsonb_build_object('cliente_id', v_cliente);
end;
$$;

grant execute on function :"schema".crm_tablero(text, uuid, boolean, boolean, integer),
  :"schema".crm_columna(text, timestamptz, uuid, text, uuid, boolean, boolean, integer),
  :"schema".crm_mover(uuid, text, text), :"schema".crm_convertir_cliente(uuid, jsonb)
  to authenticated, service_role;
revoke execute on function :"schema".crm_candidatos(text) from public, anon;
grant execute on function :"schema".crm_candidatos(text) to authenticated, service_role;
