-- =============================================================================
-- 87 · Búsqueda omnicanal inteligente (bandeja, "Todas las cerradas" del historial y
--      Finalizadas). Mismo criterio que buscar_productos (82):
--
--   · Busca en TODOS los mensajes de la conversación (texto, pie de imagen/video, nombre
--     del archivo, plantillas y notas internas; no las notas automáticas de cierre /
--     seguimiento / derivación, ni reacciones ni mensajes de sistema).
--     Rápido: tabla aparte chat_conversaciones_busqueda (UNA fila por conversación con el
--     texto normalizado de sus mensajes, los últimos 60.000 caracteres) que mantiene un
--     trigger de chat_mensajes, con índice de trigramas (GIN) para LIKE '%palabra%'.
--     Tabla aparte (no columna en chat_conversaciones) para no inflar cada UPDATE de la
--     conversación (último mensaje, no leídos…) ni lo que viaja por Realtime.
--   · Datos del cliente vinculado al contacto (chat_contactos.cliente_id → clientes):
--     nombre, razón social, RUC, CI, email, teléfonos (su columna `busqueda`); y del
--     prospecto vinculado (crm_prospectos.busqueda). RUC/CI con o sin DV/guion/puntos y
--     teléfono en cualquier forma → coincidencia exacta.
--   · TAL CUAL (cada palabra está, o su singular: "pedidos" → "pedido") esconde lo que solo
--     "se parece"; si nada coincide tal cual, los parecidos (errores de tipeo en nombre /
--     datos del cliente: "pedor gomez") siguen apareciendo. El parecido NO se aplica al
--     texto de los mensajes (en un chat largo cualquier palabra "se parece" a algo).
--   · Con búsqueda, orden por relevancia: nombre igual > empieza con > contiene > RUC / CI /
--     teléfono exacto > datos (teléfono parcial, cliente, etiquetas) > último mensaje >
--     mensajes anteriores > parecido; a igual relevancia, el más reciente. Paginado por
--     p_offset (el cursor por fecha queda para la lista sin búsqueda).
--   · chat_bandeja devuelve `coincidencia`: fragmento del mensaje que coincidió cuando el
--     resultado viene de un mensaje anterior (no del último, que ya se ve en la tarjeta).
--
-- Redefine chat_bandeja y chat_finalizadas (86) con un parámetro nuevo al final
-- (p_offset); se borra la firma anterior. Sin búsqueda, la consulta es la misma de la 86.
-- IDEMPOTENTE. Va después de la 86.
-- =============================================================================

set search_path to :"schema", public, extensions;
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Ayudantes ────────────────────────────────────────────────────────────────

-- Texto buscable de un mensaje (normalizado) o null si no cuenta.
create or replace function :"schema".chat_texto_busqueda_msg(p_tipo text, p_contenido text, p_media_nombre text)
returns text language sql immutable parallel safe set search_path = :"schema", public as $$
  select case
           when p_tipo in ('sistema', 'reaccion') then null
           -- Notas automáticas (cierre "✅ Conversación finalizada…", "📅 Seguimiento hecho",
           -- "🤖 Mensaje automático…"): repetidas en todas las conversaciones, no aportan.
           when p_tipo = 'nota' and coalesce(p_contenido, '') ~ '^\s*(✅|📅|🤖)' then null
           else nullif(btrim(regexp_replace(norm(concat_ws(' ', p_contenido, p_media_nombre)), '\s+', ' ', 'g')), '')
         end
$$;

-- Raíz de una palabra para "tal cual": plural simple → singular ("pedidos" → "pedido").
create or replace function :"schema".raiz_busqueda(t text)
returns text language sql immutable parallel safe as $$
  select case when t ~ '^[a-z]{4,}s$' then left(t, -1) else t end
$$;

-- ── Texto de los mensajes por conversación ───────────────────────────────────
create table if not exists :"schema".chat_conversaciones_busqueda (
  conversacion_id uuid primary key references :"schema".chat_conversaciones(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  texto text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists chat_conv_busq_empresa_idx on :"schema".chat_conversaciones_busqueda (empresa_id);
create index if not exists chat_conv_busq_trgm_idx on :"schema".chat_conversaciones_busqueda using gin (texto extensions.gin_trgm_ops);

alter table :"schema".chat_conversaciones_busqueda enable row level security;
drop policy if exists chat_conv_busq_propias on :"schema".chat_conversaciones_busqueda;
create policy chat_conv_busq_propias on :"schema".chat_conversaciones_busqueda
  for select to authenticated using (empresa_id = :"schema".empresa_actual());
-- Solo lectura desde la app: lo escribe el trigger (SECURITY DEFINER).
revoke all on :"schema".chat_conversaciones_busqueda from public, anon, authenticated;
grant select on :"schema".chat_conversaciones_busqueda to authenticated;
grant all on :"schema".chat_conversaciones_busqueda to service_role;

-- Recalcula el texto de una conversación desde sus mensajes (edición / borrado).
create or replace function :"schema".chat_busqueda_recalcular(p_conv uuid)
returns void language sql volatile security definer set search_path = :"schema", public as $$
  insert into chat_conversaciones_busqueda (conversacion_id, empresa_id, texto, updated_at)
  select c.id, c.empresa_id,
         coalesce(right((select string_agg(x.t, ' ' order by m.created_at, m.id)
                           from chat_mensajes m
                           cross join lateral (select chat_texto_busqueda_msg(m.tipo, m.contenido, m.media_nombre) as t) x
                          where m.conversacion_id = c.id and x.t is not null), 60000), ''),
         now()
    from chat_conversaciones c where c.id = p_conv
  on conflict (conversacion_id) do update set texto = excluded.texto, updated_at = now()
$$;
revoke execute on function :"schema".chat_busqueda_recalcular(uuid) from public, anon, authenticated;

create or replace function :"schema".tg_chat_mensajes_busqueda()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare v text;
begin
  if tg_op = 'INSERT' then
    v := chat_texto_busqueda_msg(new.tipo, new.contenido, new.media_nombre);
    if v is not null then
      insert into chat_conversaciones_busqueda (conversacion_id, empresa_id, texto, updated_at)
      values (new.conversacion_id, new.empresa_id, right(v, 60000), now())
      on conflict (conversacion_id) do update
        set texto = right(chat_conversaciones_busqueda.texto || ' ' || excluded.texto, 60000), updated_at = now();
    end if;
  elsif tg_op = 'UPDATE' then
    perform chat_busqueda_recalcular(new.conversacion_id);
    if old.conversacion_id is distinct from new.conversacion_id then perform chat_busqueda_recalcular(old.conversacion_id); end if;
  else
    perform chat_busqueda_recalcular(old.conversacion_id);
  end if;
  return null;
end;
$fn$;
revoke execute on function :"schema".tg_chat_mensajes_busqueda() from public, anon, authenticated;

drop trigger if exists trg_chat_mensajes_busqueda_ins on :"schema".chat_mensajes;
create trigger trg_chat_mensajes_busqueda_ins after insert on :"schema".chat_mensajes
  for each row execute function :"schema".tg_chat_mensajes_busqueda();
drop trigger if exists trg_chat_mensajes_busqueda_upd on :"schema".chat_mensajes;
create trigger trg_chat_mensajes_busqueda_upd after update of contenido, media_nombre, tipo, conversacion_id on :"schema".chat_mensajes
  for each row
  when (old.contenido is distinct from new.contenido or old.media_nombre is distinct from new.media_nombre
        or old.tipo is distinct from new.tipo or old.conversacion_id is distinct from new.conversacion_id)
  execute function :"schema".tg_chat_mensajes_busqueda();
drop trigger if exists trg_chat_mensajes_busqueda_del on :"schema".chat_mensajes;
create trigger trg_chat_mensajes_busqueda_del after delete on :"schema".chat_mensajes
  for each row execute function :"schema".tg_chat_mensajes_busqueda();

-- Completar las que ya existen (solo cambia si el texto es otro).
insert into :"schema".chat_conversaciones_busqueda (conversacion_id, empresa_id, texto, updated_at)
select c.id, c.empresa_id,
       coalesce(right((select string_agg(x.t, ' ' order by m.created_at, m.id)
                         from :"schema".chat_mensajes m
                         cross join lateral (select :"schema".chat_texto_busqueda_msg(m.tipo, m.contenido, m.media_nombre) as t) x
                        where m.conversacion_id = c.id and x.t is not null), 60000), ''),
       now()
  from :"schema".chat_conversaciones c
on conflict (conversacion_id) do update set texto = excluded.texto, updated_at = now()
  where chat_conversaciones_busqueda.texto is distinct from excluded.texto;

-- Conversaciones de la empresa cuyos mensajes contienen cada palabra (tal cual o su
-- singular). Por índice de trigramas; palabras de menos de 3 caracteres no se buscan acá
-- (se miran luego solo en las conversaciones que ya coinciden por otra palabra).
-- toks = números de palabra (1..n, como tokens_busqueda) que están en los mensajes.
create or replace function :"schema".chat_msg_tokens(p_tk text[])
returns table (conversacion_id uuid, toks integer[])
language sql stable set search_path = :"schema", public as $$
  select b.conversacion_id, array_agg(distinct u.o::integer)
    from unnest(p_tk) with ordinality u(t, o)
    join chat_conversaciones_busqueda b
      on b.empresa_id = empresa_actual() and b.texto like '%' || raiz_busqueda(u.t) || '%'
   where length(u.t) >= 3
   group by b.conversacion_id
$$;

-- Relevancia de una conversación para lo buscado:
--   7 nombre igual · 6 nombre empieza con · 5 nombre contiene · 4 RUC / CI / teléfono exacto ·
--   3 todo en los datos (nombre, teléfono, cliente, prospecto, etiquetas…) · 2 con el último
--   mensaje · 1 con mensajes anteriores · 0 solo parecido (error de tipeo) · -1 no coincide.
create or replace function :"schema".chat_rango_busqueda(p_nombres text[], p_datos text, p_preview text, p_texto_msg text,
  p_toks integer[], p_exacto boolean, p_q text, p_tk text[])
returns integer language sql immutable parallel safe set search_path = :"schema", public as $$
  with t as (
    select coalesce(p_datos, '') like '%' || raiz_busqueda(u.t) || '%' as en_datos,
           coalesce(p_preview, '') like '%' || raiz_busqueda(u.t) || '%' as en_preview,
           (u.o::integer = any(coalesce(p_toks, '{}'))
            or (length(u.t) < 3 and p_toks is not null and coalesce(p_texto_msg, '') like '%' || u.t || '%')) as en_msg,
           (length(u.t) >= 4 and u.t ~ '[a-z]' and extensions.word_similarity(u.t, coalesce(p_datos, '')) >= 0.4) as parecido
      from unnest(p_tk) with ordinality u(t, o)
  ),
  r as (
    select coalesce(bool_and(en_datos), true) as datos,
           coalesce(bool_and(en_datos or en_preview), true) as preview,
           coalesce(bool_and(en_datos or en_preview or en_msg), true) as real,
           coalesce(bool_and(en_datos or en_preview or en_msg or parecido), true) as alguno
      from t
  )
  select case
           when not (r.alguno or coalesce(p_exacto, false)) then -1
           when not (r.real or coalesce(p_exacto, false)) then 0
           when p_q <> '' and exists (select 1 from unnest(p_nombres) n where n = p_q) then 7
           when p_q <> '' and exists (select 1 from unnest(p_nombres) n where n like p_q || '%') then 6
           when p_q <> '' and exists (select 1 from unnest(p_nombres) n where n like '%' || p_q || '%') then 5
           when coalesce(p_exacto, false) then 4
           when r.datos then 3
           when r.preview then 2
           else 1
         end
    from r
$$;

-- Fragmento de un mensaje alrededor de la primera palabra buscada que aparece
-- ("…necesito ayuda con mi pedido de ayer…").
create or replace function :"schema".chat_fragmento(p_texto text, p_tk text[])
returns text language sql immutable parallel safe set search_path = :"schema", public as $$
  with x as (select regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g') as s),
  p as (
    select x.s, coalesce((select min(strpos(norm(x.s), raiz_busqueda(t))) from unnest(p_tk) t
                           where length(t) >= 2 and strpos(norm(x.s), raiz_busqueda(t)) > 0), 1) as pos
      from x
  ),
  c as (select p.s, greatest(1, p.pos - 30) as ini from p)
  select nullif(case when c.ini > 1 then '…' else '' end || substr(c.s, c.ini, 110)
                || case when length(c.s) > c.ini + 109 then '…' else '' end, '')
    from c
$$;

-- ── Bandeja (86 + búsqueda en mensajes / cliente, relevancia y p_offset) ─────
drop function if exists :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer, uuid, boolean);
create or replace function :"schema".chat_bandeja(p_vista text default 'mias', p_q text default null, p_asignado uuid default null,
  p_canal uuid default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limite integer default 40,
  p_cola uuid default null, p_sin_asignar boolean default false, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public, extensions
as $$
declare
  v_yo uuid;
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(regexp_replace(norm(p_q), '\s+', ' ', 'g'));
  v_qc text := compacto(p_q);
  v_tels text[] := case when compacto(p_q) ~ '^[0-9]{7,15}$' then string_to_array(tel_busqueda(compacto(p_q)), ' ') else '{}' end;
  v_lim integer := least(greatest(coalesce(p_limite, 40), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;

  if coalesce(cardinality(v_tk), 0) = 0 then
    -- Sin búsqueda: keyset por último mensaje (igual que la 86).
    select coalesce(jsonb_agg(b order by b.ultimo_mensaje_at desc nulls last, b.id desc), '[]'::jsonb) into v_rows
      from (
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
         order by c.ultimo_mensaje_at desc nulls last, c.id desc
         limit v_lim
      ) b;
  else
    -- Con búsqueda: relevancia, luego el más reciente; paginado por p_offset.
    with msg as materialized (select * from chat_msg_tokens(v_tk)),
    base as (
      select c.id, c.estado, c.asignado_id, c.canal_id, c.cola_id, c.prioridad, c.ultimo_mensaje_at, c.ultimo_preview, c.ultimo_from_me,
             c.ultimo_tipo, c.no_leidos, c.ventana_expira_at, c.etiquetas, c.sla_vence_at, c.primera_respuesta_at, c.espera_motivo,
             k.id as contacto_id, k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.avatar_url, k.cliente_id, k.prospecto_id,
             ca.tipo as canal_tipo, ca.nombre as canal_nombre, u.nombre as asignado_nombre, q.nombre as cola_nombre,
             chat_rango_busqueda(
               array[norm(k.nombre), norm(cl.nombre), norm(cl.razon_social), norm(pr.empresa), norm(pr.contacto)],
               concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), cl.busqueda, pr.busqueda, norm(array_to_string(c.etiquetas, ' '))),
               norm(c.ultimo_preview), cb.texto, m.toks,
               length(v_qc) >= 5 and (ruc_igual(cl.ruc, v_qc) or ruc_igual(cl.documento, v_qc)
                 or regexp_replace(coalesce(k.telefono, ''), '[^0-9]', '', 'g') = any(v_tels)
                 or regexp_replace(coalesce(cl.telefono, ''), '[^0-9]', '', 'g') = any(v_tels)),
               v_q, v_tk) as _r
        from chat_conversaciones c
        join chat_contactos k on k.id = c.contacto_id
        join chat_canales ca on ca.id = c.canal_id
        left join usuarios u on u.id = c.asignado_id
        left join chat_colas q on q.id = c.cola_id
        left join clientes cl on cl.id = k.cliente_id
        left join crm_prospectos pr on pr.id = k.prospecto_id
        left join msg m on m.conversacion_id = c.id
        left join chat_conversaciones_busqueda cb on cb.conversacion_id = m.conversacion_id
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
    ),
    -- Si algo coincide tal cual, lo que solo se parece no se muestra.
    hits as (select * from base where _r >= 0 and (_r > 0 or not exists (select 1 from base where _r > 0))),
    pag as (select * from hits order by _r desc, ultimo_mensaje_at desc nulls last, id desc limit v_lim offset v_off)
    select coalesce(jsonb_agg((to_jsonb(p) - '_r') || jsonb_build_object('coincidencia', s.frag)
                              order by p._r desc, p.ultimo_mensaje_at desc nulls last, p.id desc), '[]'::jsonb) into v_rows
      from pag p
      left join lateral (
        -- El mensaje (no automático) con más palabras buscadas; a igualdad, el más nuevo.
        select chat_fragmento(coalesce(mm.contenido, mm.media_nombre), v_tk) as frag
          from chat_mensajes mm
          cross join lateral (select chat_texto_busqueda_msg(mm.tipo, mm.contenido, mm.media_nombre) as t) x
         where p._r = 1 and mm.conversacion_id = p.id and x.t is not null
           and exists (select 1 from unnest(v_tk) w where length(w) >= 3 and x.t like '%' || raiz_busqueda(w) || '%')
         order by (select count(*) from unnest(v_tk) w where x.t like '%' || raiz_busqueda(w) || '%') desc, mm.created_at desc, mm.id desc
         limit 1
      ) s on true;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'contadores', (select jsonb_build_object(
        'mias', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada'),
        'mias_no_leidas', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada' and no_leidos > 0),
        'sin_asignar', count(*) filter (where asignado_id is null and estado <> 'cerrada'),
        'abiertas', count(*) filter (where estado <> 'cerrada'))
      from chat_conversaciones where empresa_id = empresa_actual() and estado <> 'cerrada')
  );
end;
$$;
revoke execute on function :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer, uuid, boolean, integer) from public, anon;
grant execute on function :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer, uuid, boolean, integer) to authenticated, service_role;

-- ── Finalizadas (86 + búsqueda en mensajes / cliente, relevancia y p_offset) ─
drop function if exists :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer, uuid, uuid, text, boolean, date, uuid[]);
create or replace function :"schema".chat_finalizadas(p_desde date default null, p_hasta date default null, p_asesor uuid default null,
  p_estado uuid default null, p_q text default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limite integer default 50, p_cola uuid default null, p_asignado uuid default null, p_semaforo text default null,
  p_seguimientos boolean default false, p_cursor_fecha date default null, p_alcance uuid[] default null, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public, extensions
as $$
declare
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(regexp_replace(norm(p_q), '\s+', ' ', 'g'));
  v_qc text := compacto(p_q);
  v_tels text[] := case when compacto(p_q) ~ '^[0-9]{7,15}$' then string_to_array(tel_busqueda(compacto(p_q)), ' ') else '{}' end;
  v_lim integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_seg boolean := coalesce(p_seguimientos, false);
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_rows jsonb;
begin
  if coalesce(cardinality(v_tk), 0) = 0 then
    -- Sin búsqueda: igual que la 86 (keyset por cierre o por próxima acción).
    select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('semaforo',
                 case when r.dias_asesor is null then 'sin' when r.dias_asesor <= 2 then 'verde' when r.dias_asesor <= 6 then 'ambar' else 'rojo' end)
               order by case when v_seg then r.proxima_accion_fecha end, case when v_seg then r.id end, r.cerrada_at desc, r.id desc), '[]'::jsonb)
      into v_rows
      from (
        select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
               k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
               u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal,
               c.asignado_id, ua.nombre as asignado_nombre, c.cola_id, q.nombre as cola,
               c.ultimo_msg_asesor_at, v_hoy - (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date as dias_asesor,
               c.proxima_accion_fecha, c.proxima_accion_nota, c.seguimiento_hecho_at
          from chat_conversaciones c
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
                  when 'verde' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date >= v_hoy - 2
                  when 'ambar' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date between v_hoy - 6 and v_hoy - 3
                  when 'rojo' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date <= v_hoy - 7
                  else true end)
           and (case when v_seg
                  then c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
                       and (p_desde is null or c.proxima_accion_fecha >= p_desde)
                       and (p_hasta is null or c.proxima_accion_fecha <= p_hasta)
                       and (p_cursor_fecha is null or (c.proxima_accion_fecha, c.id) > (p_cursor_fecha, p_cursor_id))
                  else (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
                       and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
                       and (p_cursor_at is null or (c.cerrada_at, c.id) < (p_cursor_at, p_cursor_id))
                end)
         order by case when v_seg then c.proxima_accion_fecha end, case when v_seg then c.id end, c.cerrada_at desc, c.id desc
         limit v_lim
      ) r;
  else
    with msg as materialized (select * from chat_msg_tokens(v_tk)),
    base as (
      select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
             k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
             u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal,
             c.asignado_id, ua.nombre as asignado_nombre, c.cola_id, q.nombre as cola,
             c.ultimo_msg_asesor_at, v_hoy - (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date as dias_asesor,
             c.proxima_accion_fecha, c.proxima_accion_nota, c.seguimiento_hecho_at,
             chat_rango_busqueda(
               array[norm(k.nombre), norm(cl.nombre), norm(cl.razon_social), norm(pr.empresa), norm(pr.contacto)],
               concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), cl.busqueda, pr.busqueda, norm(array_to_string(c.etiquetas, ' ')),
                         norm(c.cierre_observacion), norm(f.nombre), norm(e.nombre), norm(u.nombre), norm(c.proxima_accion_nota)),
               norm(c.ultimo_preview), cb.texto, m.toks,
               length(v_qc) >= 5 and (ruc_igual(cl.ruc, v_qc) or ruc_igual(cl.documento, v_qc)
                 or regexp_replace(coalesce(k.telefono, ''), '[^0-9]', '', 'g') = any(v_tels)
                 or regexp_replace(coalesce(cl.telefono, ''), '[^0-9]', '', 'g') = any(v_tels)),
               v_q, v_tk) as _r
        from chat_conversaciones c
        join chat_contactos k on k.id = c.contacto_id
        join chat_canales ca on ca.id = c.canal_id
        left join usuarios u on u.id = c.cerrada_por
        left join usuarios ua on ua.id = c.asignado_id
        left join chat_colas q on q.id = c.cola_id
        left join tipificacion_familias f on f.id = c.cierre_familia_id
        left join tipificacion_estados e on e.id = c.cierre_estado_id
        left join clientes cl on cl.id = k.cliente_id
        left join crm_prospectos pr on pr.id = k.prospecto_id
        left join msg m on m.conversacion_id = c.id
        left join chat_conversaciones_busqueda cb on cb.conversacion_id = m.conversacion_id
       where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
         and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
         and (p_asesor is null or c.cerrada_por = p_asesor)
         and (p_asignado is null or c.asignado_id = p_asignado)
         and (p_cola is null or c.cola_id = p_cola)
         and (p_estado is null or c.cierre_estado_id = p_estado)
         and (p_semaforo is null or case p_semaforo
                when 'sin' then c.ultimo_msg_asesor_at is null
                when 'verde' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date >= v_hoy - 2
                when 'ambar' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date between v_hoy - 6 and v_hoy - 3
                when 'rojo' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date <= v_hoy - 7
                else true end)
         and (case when v_seg
                then c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
                     and (p_desde is null or c.proxima_accion_fecha >= p_desde)
                     and (p_hasta is null or c.proxima_accion_fecha <= p_hasta)
                else (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
                     and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
              end)
    ),
    hits as (select * from base where _r >= 0 and (_r > 0 or not exists (select 1 from base where _r > 0))),
    pag as (
      select * from hits
       order by _r desc, case when v_seg then proxima_accion_fecha end, case when v_seg then id end, cerrada_at desc, id desc
       limit v_lim offset v_off
    )
    select coalesce(jsonb_agg((to_jsonb(r) - '_r') || jsonb_build_object('semaforo',
                 case when r.dias_asesor is null then 'sin' when r.dias_asesor <= 2 then 'verde' when r.dias_asesor <= 6 then 'ambar' else 'rojo' end)
               order by r._r desc, case when v_seg then r.proxima_accion_fecha end, case when v_seg then r.id end, r.cerrada_at desc, r.id desc), '[]'::jsonb)
      into v_rows
      from pag r;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    -- Para la pestaña Seguimientos: pendientes (y vencidos) en el alcance de quien mira.
    'seguimientos', (select jsonb_build_object('pendientes', count(*), 'vencidos', count(*) filter (where c.proxima_accion_fecha < v_hoy))
        from chat_conversaciones c
       where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
         and c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
         and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
         and (p_asesor is null or c.cerrada_por = p_asesor))
  );
end;
$$;
revoke execute on function :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer, uuid, uuid, text, boolean, date, uuid[], integer) from public, anon;
grant execute on function :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer, uuid, uuid, text, boolean, date, uuid[], integer)
  to authenticated, service_role;

reset search_path;
