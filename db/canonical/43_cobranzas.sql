-- =============================================================================
-- COBRANZAS (portado del sistema actual, genérico):
--   · Seguimiento: clientes con deuda agrupada por servicio (suscripción; sin suscripción
--     → "general"), tramos por cuotas vencidas (0 por vencer · 1 · 2 · ≥3), promesas de
--     pago, "cobranza enviada" del mes y "mensaje del mes" (último mensaje SALIENTE de
--     Conversaciones este mes). Todo en UNA función: cobranza_seguimiento(); el detalle
--     de un cliente en cobranza_detalle(id).
--   · Conciliación bancaria (maker-checker): una transferencia se REGISTRA como cobro
--     pendiente (no baja la deuda) y un ADMIN la APRUEBA (nace el cobro real con
--     registrar_cobro, medio transferencia, SIN caja), la RECHAZA (motivo) o, ya aprobada,
--     la ANULA (anula el cobro → la deuda vuelve). Avisos a los admins en la campanita
--     (usuario_notificaciones tipo cobro_pendiente) que se borran al resolverse.
--   · bancos: catálogo por empresa; `sin_referencia` = el banco no emite N° de operación
--     (ej. Familiar) y se genera una referencia PREFIJO-YYMMDD-HHMMSS-RR.
--   · Bucket privado "cobros-comprobantes" (8 MB, jpg/png/webp/pdf). Todo pasa por la API.
-- Sin contabilidad (el 2.0 no tiene asientos). Hoy = America/Asuncion. IDEMPOTENTE.
-- Requiere 26_saldo_favor (registrar_cobro con `sin_caja`).
-- =============================================================================
set search_path = :"schema", public, extensions;

-- ── Bancos ───────────────────────────────────────────────────────────────────
create table if not exists :"schema".bancos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  sin_referencia boolean not null default false,   -- no emite N° de operación: se genera
  prefijo text,                                     -- prefijo de la referencia generada (FAM)
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_bancos_nombre on :"schema".bancos (empresa_id, lower(nombre));

-- ── Promesas de pago ─────────────────────────────────────────────────────────
create table if not exists :"schema".cobranza_promesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  fecha_promesa date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'cumplida', 'cancelada')),
  observacion text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  cerrada_at timestamptz,
  cerrada_por_nombre text,
  cerrada_motivo text
);
create index if not exists cob_promesas_cliente_idx on :"schema".cobranza_promesas (empresa_id, cliente_id, created_at desc);
create index if not exists cob_promesas_pend_idx on :"schema".cobranza_promesas (empresa_id, cliente_id) where estado = 'pendiente';

-- ── "Cobranza enviada" del mes (marca manual) ───────────────────────────────
create table if not exists :"schema".cobranza_envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  periodo date not null,                 -- 1° del mes
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_cob_envios on :"schema".cobranza_envios (empresa_id, cliente_id, periodo);

-- ── Transferencias pendientes de aprobación ─────────────────────────────────
create table if not exists :"schema".cobros_pendientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cxc_id uuid not null references :"schema".cuentas_por_cobrar(id),
  cliente_id uuid not null references :"schema".clientes(id),
  monto numeric not null check (monto > 0),
  fecha date not null,                   -- fecha de la transferencia
  banco_id uuid references :"schema".bancos(id) on delete set null,
  banco_origen text not null,
  banco_origen_norm text not null,
  titular text not null,
  numero_operacion text not null,
  numero_operacion_norm text not null,
  referencia_generada boolean not null default false,
  grupo_id uuid,                         -- cobro múltiple: una transferencia → varias facturas
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'anulado')),
  motivo_rechazo text,
  motivo_anulacion text,
  idempotency_key uuid,
  comprobante_path text,
  comprobante_mime text,
  cobro_id uuid references :"schema".cobros_clientes(id) on delete set null,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aprobado_by uuid, aprobado_por_nombre text, aprobado_at timestamptz,
  rechazado_by uuid, rechazado_por_nombre text, rechazado_at timestamptz,
  anulado_by uuid, anulado_por_nombre text, anulado_at timestamptz
);
create unique index if not exists uq_cobros_pend_idem on :"schema".cobros_pendientes (empresa_id, idempotency_key)
  where idempotency_key is not null;
-- Anti-duplicado: el mismo banco + N° de operación no se carga dos veces a la misma factura
-- (salvo que la anterior se haya rechazado o anulado).
create unique index if not exists uq_cobros_pend_operacion on :"schema".cobros_pendientes (empresa_id, banco_origen_norm, numero_operacion_norm, cxc_id)
  where estado not in ('rechazado', 'anulado');
create index if not exists cobros_pend_estado_idx on :"schema".cobros_pendientes (empresa_id, estado, fecha desc);
create index if not exists cobros_pend_fecha_idx on :"schema".cobros_pendientes (empresa_id, fecha desc);
create index if not exists cobros_pend_cxc_idx on :"schema".cobros_pendientes (cxc_id) where estado = 'pendiente';
create index if not exists cobros_pend_cliente_idx on :"schema".cobros_pendientes (cliente_id, created_at desc);
create index if not exists cobros_pend_cobro_idx on :"schema".cobros_pendientes (cobro_id) where cobro_id is not null;

-- "Mensaje del mes": contactos de Conversaciones por los últimos 9 dígitos del teléfono.
create index if not exists chat_contacto_tel9_idx on :"schema".chat_contactos (empresa_id, right(telefono, 9)) where telefono is not null;
-- Avisos de la campanita de un cobro pendiente (se borran al aprobar/rechazar/anular).
create index if not exists unotif_tipo_url_idx on :"schema".usuario_notificaciones (empresa_id, tipo, url);

do $$
declare t text;
begin
  foreach t in array array['bancos', 'cobranza_promesas', 'cobranza_envios', 'cobros_pendientes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())', t || '_propias', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;

-- Catálogo inicial de bancos de Paraguay (cada empresa lo puede editar).
insert into :"schema".bancos (empresa_id, nombre, sin_referencia, prefijo, orden)
select e.id, b.nombre, b.sin_ref, b.prefijo, b.orden
  from :"schema".empresas e
 cross join (values
   ('Itaú', false, null, 1), ('Continental', false, null, 2), ('Familiar', true, 'FAM', 3), ('Visión', false, null, 4),
   ('GNB', false, null, 5), ('Atlas', false, null, 6), ('Basa', false, null, 7), ('Sudameris', false, null, 8),
   ('Ueno', false, null, 9), ('Interfisa', false, null, 10), ('BNF', false, null, 11), ('Río', false, null, 12),
   ('Zeta', false, null, 13), ('Solar', false, null, 14), ('Cooperativa', false, null, 15), ('Otro', false, null, 99)
 ) as b(nombre, sin_ref, prefijo, orden)
on conflict (empresa_id, lower(nombre)) do nothing;

-- Bucket privado de comprobantes (sin políticas para la sesión: todo pasa por la API).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cobros-comprobantes', 'cobros-comprobantes', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function :"schema".gs_texto(p numeric)
returns text language sql immutable as $$
  select replace(to_char(round(coalesce(p, 0)), 'FM999,999,999,999,999'), ',', '.')
$$;

create or replace function :"schema".norm_banco(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

create or replace function :"schema".norm_operacion(p text)
returns text language sql immutable as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
$$;

-- ¿N° de operación vacío o placeholder (solo ceros)?
create or replace function :"schema".operacion_placeholder(p text)
returns boolean language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g') ~ '^0*$'
$$;

-- Referencia para un banco sin comprobante: PREFIJO-YYMMDD-HHMMSS-RR (hora de Asunción).
create or replace function :"schema".generar_referencia_banco(p_prefijo text)
returns text language sql volatile as $$
  select coalesce(nullif(upper(btrim(p_prefijo)), ''), 'SR') || '-'
         || to_char(now() at time zone 'America/Asuncion', 'YYMMDD-HH24MISS') || '-'
         || upper(substr(md5(random()::text), 1, 2))
$$;

-- Aviso a cada ADMIN activo de que hay un cobro por aprobar. SECURITY DEFINER: la RLS de
-- usuario_notificaciones sólo deja tocar las propias. Acotado a la empresa de la sesión.
create or replace function :"schema".cobranza_notificar_pendiente(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into usuario_notificaciones (empresa_id, usuario_id, tipo, bandeja, titulo, cuerpo, url)
  select cp.empresa_id, u.id, 'cobro_pendiente', 'general', 'Nuevo cobro por aprobar',
         left(coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) || ' · ' || x.numero || ' · Gs. ' || gs_texto(cp.monto), 500),
         '/cobranzas/conciliacion?cobro=' || cp.id
    from cobros_pendientes cp
    join cuentas_por_cobrar x on x.id = cp.cxc_id
    join clientes cl on cl.id = cp.cliente_id
    join usuarios u on u.empresa_id = cp.empresa_id and u.rol = 'ADMIN' and u.activo
   where cp.id = p_id and cp.empresa_id = empresa_actual() and cp.estado = 'pendiente';
end;
$fn$;

create or replace function :"schema".cobranza_limpiar_notificacion(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  delete from usuario_notificaciones
   where empresa_id = empresa_actual() and tipo = 'cobro_pendiente' and url = '/cobranzas/conciliacion?cobro=' || p_id;
end;
$fn$;

-- ── Promesas que se cumplen solas ───────────────────────────────────────────
-- Al terminar la transacción de un cobro (por eso DEFERRED: las aplicaciones ya están
-- hechas): si el cliente quedó sin cuotas vencidas, sus promesas pendientes se cumplen.
create or replace function :"schema".tg_cobro_cierra_promesas()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.anulado_at is not null then return null; end if;
  if not exists (
    select 1 from cuentas_por_cobrar x
     where x.empresa_id = new.empresa_id and x.cliente_id = new.cliente_id and x.estado in ('pendiente', 'parcial')
       and x.saldo > 0 and x.vencimiento < (now() at time zone 'America/Asuncion')::date
  ) then
    update cobranza_promesas
       set estado = 'cumplida', cerrada_at = now(), cerrada_por_nombre = 'Sistema',
           cerrada_motivo = 'Pagó: quedó sin cuotas vencidas (' || new.numero_recibo || ')'
     where empresa_id = new.empresa_id and cliente_id = new.cliente_id and estado = 'pendiente';
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_cobro_cierra_promesas on :"schema".cobros_clientes;
create constraint trigger trg_cobro_cierra_promesas after insert on :"schema".cobros_clientes
  deferrable initially deferred for each row execute function :"schema".tg_cobro_cierra_promesas();

-- Si el cobro de una transferencia aprobada se anula desde otro lado (ficha del cliente),
-- la transferencia pasa a "anulado" (la deuda ya volvió con anular_cobro).
create or replace function :"schema".tg_cobro_anulado_pendiente()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.anulado_at is not null and old.anulado_at is null then
    update cobros_pendientes
       set estado = 'anulado', anulado_at = coalesce(anulado_at, now()), anulado_por_nombre = coalesce(anulado_por_nombre, new.anulado_por),
           motivo_anulacion = coalesce(motivo_anulacion, new.anulado_motivo), updated_at = now()
     where cobro_id = new.id and estado = 'aprobado';
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_cobro_anulado_pendiente on :"schema".cobros_clientes;
create trigger trg_cobro_anulado_pendiente after update of anulado_at on :"schema".cobros_clientes
  for each row execute function :"schema".tg_cobro_anulado_pendiente();

-- =============================================================================
-- Seguimiento: una fila por cliente con deuda, sus servicios agregados y lo de cobranza.
-- SECURITY DEFINER (los índices por empresa se usan directo) y TODO acotado a la empresa
-- de la sesión.
-- =============================================================================
create or replace function :"schema".cobranza_seguimiento()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion'))::date;
  v_mes_ts timestamptz := (date_trunc('month', (now() at time zone 'America/Asuncion')) at time zone 'America/Asuncion');
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  return (
    with deuda as (
      select x.cliente_id, x.vencimiento, x.saldo, v.suscripcion_id, coalesce(v.periodo, x.fecha_emision) as mes_ref
        from cuentas_por_cobrar x join ventas v on v.id = x.venta_id
       where x.empresa_id = v_emp and x.estado in ('pendiente', 'parcial') and x.saldo > 0
    ),
    serv as (
      select d.cliente_id, d.suscripcion_id, sum(d.saldo) as total,
             count(*) filter (where d.vencimiento < v_hoy)::int as vencidas,
             array_agg(distinct to_char(d.mes_ref, 'YYYY-MM')) filter (where d.vencimiento < v_hoy) as meses,
             min(d.vencimiento) filter (where d.vencimiento >= v_hoy) as proximo
        from deuda d group by d.cliente_id, d.suscripcion_id
    ),
    serv2 as (
      select s.*, su.plan_nombre, su.precio,
             case when s.vencidas >= 3 then 3 else s.vencidas end as peso
        from serv s left join suscripciones su on su.id = s.suscripcion_id and su.empresa_id = v_emp
    ),
    cli as (
      select s.cliente_id, sum(s.total) as total, max(s.peso) as peso,
             jsonb_agg(jsonb_build_object(
               'suscripcion_id', s.suscripcion_id, 'plan', s.plan_nombre, 'monto_mensual', s.precio,
               'total_adeudado', s.total, 'cuotas_vencidas', s.vencidas,
               'meses_adeudados', coalesce(to_jsonb(s.meses), '[]'::jsonb),
               'tramo', (array['por_vencer', 'tramo_1', 'tramo_2', 'tramo_3'])[s.peso + 1],
               'proximo_vencimiento', s.proximo
             ) order by s.peso desc, s.total desc) as servicios
        from serv2 s group by s.cliente_id
    ),
    filas as (
      select cli.peso, cli.total, jsonb_build_object(
               'cliente_id', c.id,
               'cliente_label', coalesce(nullif(btrim(c.razon_social), ''), c.nombre),
               'telefono', c.telefono,
               'categoria', cat.nombre,
               'categoria_color', cat.color,
               'servicios', cli.servicios,
               'ultimo_pago', (select (max(k.fecha) at time zone 'America/Asuncion')::date from cobros_clientes k
                                where k.cliente_id = c.id and k.empresa_id = v_emp and k.anulado_at is null),
               'promesa_fecha', (select p.fecha_promesa from cobranza_promesas p
                                  where p.empresa_id = v_emp and p.cliente_id = c.id and p.estado = 'pendiente'
                                  order by p.created_at desc limit 1),
               'cobranza_enviada', exists (select 1 from cobranza_envios e where e.empresa_id = v_emp and e.cliente_id = c.id and e.periodo = v_mes),
               'mensaje_mes_fecha', (msg.ultimo at time zone 'America/Asuncion')::date
             ) as fila
        from cli
        join clientes c on c.id = cli.cliente_id and c.empresa_id = v_emp and c.deleted_at is null
        left join cliente_categorias cat on cat.id = c.categoria_id
        left join lateral (select right(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g'), 9) as tel9) t on true
        left join lateral (
          select max(m.created_at) as ultimo
            from chat_contactos k
            join chat_conversaciones cv on cv.contacto_id = k.id
            join chat_mensajes m on m.conversacion_id = cv.id
           where k.empresa_id = v_emp
             and (k.cliente_id = c.id or (length(t.tel9) = 9 and right(k.telefono, 9) = t.tel9))
             and m.from_me and m.tipo not in ('nota', 'sistema') and m.estado_entrega <> 'fallido'
             and m.created_at >= v_mes_ts
        ) msg on true
    )
    select jsonb_build_object(
      'hoy', v_hoy,
      'mes', to_char(v_hoy, 'YYYY-MM'),
      'clientes', coalesce((select jsonb_agg(f.fila order by f.peso desc, f.total desc) from filas f), '[]'::jsonb)
    )
  );
end;
$fn$;

-- Detalle de un cliente para el panel lateral.
create or replace function :"schema".cobranza_detalle(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_mes_ts timestamptz := (date_trunc('month', (now() at time zone 'America/Asuncion')) at time zone 'America/Asuncion');
  c record;
  v_tel9 text;
  v_msg timestamptz;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select cl.id, coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as label, cl.telefono, cl.creado_at,
         cat.nombre as categoria, cat.color as categoria_color
    into c
    from clientes cl left join cliente_categorias cat on cat.id = cl.categoria_id
   where cl.id = p_cliente and cl.empresa_id = v_emp and cl.deleted_at is null;
  if not found then raise exception 'Cliente no encontrado'; end if;

  v_tel9 := right(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g'), 9);
  select max(m.created_at) into v_msg
    from chat_contactos k
    join chat_conversaciones cv on cv.contacto_id = k.id
    join chat_mensajes m on m.conversacion_id = cv.id
   where k.empresa_id = v_emp
     and (k.cliente_id = c.id or (length(v_tel9) = 9 and right(k.telefono, 9) = v_tel9))
     and m.from_me and m.tipo not in ('nota', 'sistema') and m.estado_entrega <> 'fallido'
     and m.created_at >= v_mes_ts;

  return (
    with cuotas as (
      select x.id, x.numero, x.fecha_emision, x.vencimiento, x.monto, x.saldo, v.suscripcion_id,
             coalesce(v.periodo, x.fecha_emision) as mes_ref, x.vencimiento < v_hoy as vencida,
             coalesce((select sum(cp.monto) from cobros_pendientes cp where cp.cxc_id = x.id and cp.estado = 'pendiente'), 0) as en_aprobacion
        from cuentas_por_cobrar x join ventas v on v.id = x.venta_id
       where x.empresa_id = v_emp and x.cliente_id = c.id and x.estado in ('pendiente', 'parcial') and x.saldo > 0
    ),
    mas_vieja as (select id, numero from cuotas order by vencimiento, fecha_emision, numero limit 1),
    serv as (
      select q.suscripcion_id, su.plan_nombre, su.precio, sum(q.saldo) as total,
             count(*) filter (where q.vencida)::int as vencidas,
             jsonb_agg(jsonb_build_object(
               'id', q.id, 'numero', q.numero, 'fecha_emision', q.fecha_emision, 'vencimiento', q.vencimiento,
               'monto', q.monto, 'saldo', q.saldo, 'vencida', q.vencida, 'en_aprobacion', q.en_aprobacion,
               'dias_atraso', greatest(v_hoy - q.vencimiento, 0)
             ) order by q.vencimiento, q.fecha_emision, q.numero) as cuotas
        from cuotas q left join suscripciones su on su.id = q.suscripcion_id and su.empresa_id = v_emp
       group by q.suscripcion_id, su.plan_nombre, su.precio
    ),
    ult as (
      select k.id, k.numero_recibo, (k.fecha at time zone 'America/Asuncion')::date as fecha, k.total,
             (select string_agg(distinct p.metodo, ', ') from cobros_pagos p where p.cobro_id = k.id) as metodos,
             (select string_agg(x.numero, ', ') from cobros_aplicaciones a join cuentas_por_cobrar x on x.id = a.cxc_id where a.cobro_id = k.id) as aplicado_a
        from cobros_clientes k
       where k.empresa_id = v_emp and k.cliente_id = c.id and k.anulado_at is null
       order by k.fecha desc limit 1
    )
    select jsonb_build_object(
      'hoy', v_hoy,
      'cliente', jsonb_build_object(
        'cliente_id', c.id, 'cliente_label', c.label, 'telefono', c.telefono, 'alta', (c.creado_at at time zone 'America/Asuncion')::date,
        'categoria', c.categoria, 'categoria_color', c.categoria_color,
        'mensaje_mes_fecha', (v_msg at time zone 'America/Asuncion')::date),
      'total_deuda', coalesce((select sum(saldo) from cuotas), 0),
      'cuotas_vencidas', (select count(*) from cuotas where vencida),
      'tramo', (array['por_vencer', 'tramo_1', 'tramo_2', 'tramo_3'])[least(coalesce((select max(vencidas) from serv), 0), 3) + 1],
      'meses_adeudados', coalesce((select jsonb_agg(m order by m) from (select distinct to_char(mes_ref, 'YYYY-MM') as m from cuotas where vencida) mm), '[]'::jsonb),
      'monto_mensual', (select sum(precio) from serv where suscripcion_id is not null),
      'mas_vieja', (select jsonb_build_object('id', id, 'numero', numero) from mas_vieja),
      'servicios', coalesce((select jsonb_agg(jsonb_build_object(
          'suscripcion_id', s.suscripcion_id, 'plan', s.plan_nombre, 'monto_mensual', s.precio, 'total_adeudado', s.total,
          'cuotas_vencidas', s.vencidas,
          'tramo', (array['por_vencer', 'tramo_1', 'tramo_2', 'tramo_3'])[least(s.vencidas, 3) + 1],
          'cuotas', s.cuotas
        ) order by s.vencidas desc, s.total desc) from serv s), '[]'::jsonb),
      'ultimo_pago', (select to_jsonb(u) from ult u),
      'promesas', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'fecha_promesa', p.fecha_promesa, 'estado', p.estado, 'creado_por', p.creado_por_nombre,
          'created_at', p.created_at, 'cerrada_motivo', p.cerrada_motivo, 'cerrada_por', p.cerrada_por_nombre
        ) order by p.created_at desc)
        from (select * from cobranza_promesas where empresa_id = v_emp and cliente_id = c.id order by created_at desc limit 30) p), '[]'::jsonb),
      'en_aprobacion', coalesce((select jsonb_agg(jsonb_build_object(
          'id', cp.id, 'numero', x.numero, 'monto', cp.monto, 'fecha', cp.fecha, 'banco_origen', cp.banco_origen,
          'numero_operacion', cp.numero_operacion
        ) order by cp.created_at desc)
        from cobros_pendientes cp join cuentas_por_cobrar x on x.id = cp.cxc_id
       where cp.empresa_id = v_emp and cp.cliente_id = c.id and cp.estado = 'pendiente'), '[]'::jsonb)
    )
  );
end;
$fn$;

-- =============================================================================
-- Conciliación: registrar transferencia(s) — simple (1 item) o múltiple (N facturas del
-- mismo cliente, misma transferencia) en UNA transacción.
--   p = { items: [{ cxc_id, monto, idempotency_key?, id? }], fecha, banco_id?, banco_origen,
--         titular, numero_operacion?, comprobante_path?, comprobante_mime?, grupo_id? }
--   → { cobros: [{ id, cxc_id, numero, monto, repetido }], numero_operacion, referencia_generada }
-- NO baja la deuda: queda pendiente de aprobación. Avisa a los admins.
-- =============================================================================
create or replace function :"schema".registrar_transferencia(p jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_usr record;
  v_bk bancos;
  v_banco text := btrim(coalesce(p->>'banco_origen', ''));
  v_titular text := upper(regexp_replace(btrim(coalesce(p->>'titular', '')), '\s+', ' ', 'g'));
  v_op text := btrim(coalesce(p->>'numero_operacion', ''));
  v_generada boolean := false;
  v_fecha date;
  v_items jsonb := p->'items';
  v_n integer;
  v_grupo uuid;
  v_cliente uuid;
  it jsonb;
  cx record;
  v_pend numeric;
  v_monto numeric;
  v_idem uuid;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_ex record;
  v_cons text;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if v_usr.rol is null or v_usr.rol not in ('ADMIN', 'SUPERVISOR', 'CAJERO') then
    raise exception 'No tenés permiso para registrar cobros por transferencia';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'Elegí la factura'; end if;
  v_n := jsonb_array_length(v_items);
  if v_n > 50 then raise exception 'Máximo 50 facturas por transferencia'; end if;
  if v_banco = '' then raise exception 'Falta el banco de origen'; end if;
  if v_titular = '' then raise exception 'Falta el titular de la cuenta que envía'; end if;
  v_fecha := coalesce(nullif(p->>'fecha', '')::date, v_hoy);
  if v_fecha > v_hoy then raise exception 'La fecha de la transferencia no puede ser futura'; end if;

  select * into v_bk from bancos
   where empresa_id = v_emp and (id = nullif(p->>'banco_id', '')::uuid or lower(nombre) = lower(v_banco))
   order by (id = nullif(p->>'banco_id', '')::uuid) desc nulls last limit 1;
  if found then v_banco := v_bk.nombre; end if;

  if operacion_placeholder(v_op) then
    if coalesce(v_bk.sin_referencia, false) then
      v_op := generar_referencia_banco(v_bk.prefijo);
      v_generada := true;
    else
      raise exception 'Falta el número de operación de la transferencia';
    end if;
  end if;
  if norm_operacion(v_op) = '' then raise exception 'El número de operación no es válido'; end if;
  if v_n > 1 then v_grupo := coalesce(nullif(p->>'grupo_id', '')::uuid, gen_random_uuid()); end if;

  for it in select * from jsonb_array_elements(v_items) loop
    v_idem := nullif(it->>'idempotency_key', '')::uuid;
    if v_idem is not null then
      select cp.id, cp.cxc_id, x.numero, cp.monto into v_ex
        from cobros_pendientes cp join cuentas_por_cobrar x on x.id = cp.cxc_id
       where cp.empresa_id = v_emp and cp.idempotency_key = v_idem;
      if found then
        v_out := v_out || jsonb_build_object('id', v_ex.id, 'cxc_id', v_ex.cxc_id, 'numero', v_ex.numero, 'monto', v_ex.monto, 'repetido', true);
        continue;
      end if;
    end if;
    v_monto := round(coalesce((it->>'monto')::numeric, 0));
    if v_monto <= 0 then raise exception 'El monto tiene que ser mayor a cero'; end if;
    select x.* into cx from cuentas_por_cobrar x
     where x.id = nullif(it->>'cxc_id', '')::uuid and x.empresa_id = v_emp for update;
    if not found then raise exception 'Factura no encontrada'; end if;
    if cx.estado not in ('pendiente', 'parcial') or cx.saldo <= 0 then
      raise exception 'La factura % ya está pagada o anulada', cx.numero;
    end if;
    if v_cliente is null then v_cliente := cx.cliente_id;
    elsif v_cliente <> cx.cliente_id then
      raise exception 'Todas las facturas de una misma transferencia tienen que ser del mismo cliente';
    end if;
    select coalesce(sum(monto), 0) into v_pend from cobros_pendientes where cxc_id = cx.id and estado = 'pendiente';
    if v_monto > cx.saldo - v_pend then
      if v_pend > 0 then
        raise exception 'El monto (Gs. %) supera lo que queda por cobrar de %: saldo Gs. % y ya hay Gs. % esperando aprobación',
          gs_texto(v_monto), cx.numero, gs_texto(cx.saldo), gs_texto(v_pend);
      end if;
      raise exception 'El monto (Gs. %) supera el saldo de % (Gs. %)', gs_texto(v_monto), cx.numero, gs_texto(cx.saldo);
    end if;
    v_id := coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid());
    begin
      insert into cobros_pendientes (id, empresa_id, cxc_id, cliente_id, monto, fecha, banco_id, banco_origen, banco_origen_norm,
                                     titular, numero_operacion, numero_operacion_norm, referencia_generada, grupo_id, estado,
                                     idempotency_key, comprobante_path, comprobante_mime, created_by, creado_por_nombre)
      values (v_id, v_emp, cx.id, cx.cliente_id, v_monto, v_fecha, v_bk.id, v_banco, norm_banco(v_banco),
              v_titular, v_op, norm_operacion(v_op), v_generada, v_grupo, 'pendiente',
              v_idem, nullif(p->>'comprobante_path', ''), nullif(p->>'comprobante_mime', ''), v_usr.id, v_usr.nombre);
    exception when unique_violation then
      get stacked diagnostics v_cons = constraint_name;
      if v_cons = 'uq_cobros_pend_idem' then
        raise exception using errcode = '23505', message = 'Esa transferencia ya se estaba registrando: actualizá la pantalla';
      end if;
      raise exception using errcode = '23505', message = case when v_n > 1
        then format('Ya existe una carga para la factura %s con ese banco de origen y número de operación.', cx.numero)
        else 'Ya existe una transferencia con ese banco de origen y número de operación.' end;
    end;
    perform cobranza_notificar_pendiente(v_id);
    v_out := v_out || jsonb_build_object('id', v_id, 'cxc_id', cx.id, 'numero', cx.numero, 'monto', v_monto, 'repetido', false);
  end loop;

  return jsonb_build_object('cobros', v_out, 'numero_operacion', v_op, 'referencia_generada', v_generada, 'banco_origen', v_banco);
end;
$fn$;

-- Aprobar (ADMIN): nace el cobro real (transferencia, sin caja) aplicado a ESA factura.
create or replace function :"schema".aprobar_cobro_pendiente(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_usr record;
  cp cobros_pendientes;
  cx cuentas_por_cobrar;
  v_cobro jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if v_usr.rol is distinct from 'ADMIN' then raise exception 'Solo un administrador puede aprobar cobros'; end if;
  select * into cp from cobros_pendientes where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if cp.estado <> 'pendiente' then raise exception 'Esta transferencia ya fue %', replace(cp.estado, 'ado', 'ada'); end if;
  select * into cx from cuentas_por_cobrar where id = cp.cxc_id and empresa_id = v_emp for update;
  if cx.estado not in ('pendiente', 'parcial') or cp.monto > cx.saldo then
    raise exception 'El monto (Gs. %) supera el saldo actual de % (Gs. %): rechazala y cargala de nuevo',
      gs_texto(cp.monto), cx.numero, gs_texto(cx.saldo);
  end if;

  v_cobro := registrar_cobro(jsonb_build_object(
    'cliente_id', cp.cliente_id,
    'pagos', jsonb_build_array(jsonb_build_object('metodo', 'transferencia', 'monto', cp.monto,
                                                  'referencia', left(cp.banco_origen || ' · Op ' || cp.numero_operacion, 120))),
    'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', cx.id, 'monto', cp.monto)),
    'observacion', left('Transferencia aprobada en Conciliación bancaria · ' || to_char(cp.fecha, 'DD/MM/YYYY') || ' · titular ' || cp.titular, 1000),
    'sin_caja', true));

  update cobros_pendientes
     set estado = 'aprobado', cobro_id = (v_cobro->>'id')::uuid, aprobado_by = v_usr.id, aprobado_por_nombre = v_usr.nombre,
         aprobado_at = now(), updated_at = now()
   where id = cp.id;
  -- El cliente pagó: sus promesas pendientes (todas anteriores a este cobro) se cumplen.
  update cobranza_promesas
     set estado = 'cumplida', cerrada_at = now(), cerrada_por_nombre = v_usr.nombre,
         cerrada_motivo = 'Cobro aprobado ' || (v_cobro->>'numero_recibo')
   where empresa_id = v_emp and cliente_id = cp.cliente_id and estado = 'pendiente' and created_at <= now();
  perform cobranza_limpiar_notificacion(cp.id);
  return jsonb_build_object('id', cp.id, 'cobro_id', v_cobro->>'id', 'numero_recibo', v_cobro->>'numero_recibo',
                            'saldo_restante', (select saldo from cuentas_por_cobrar where id = cx.id));
end;
$fn$;

-- Rechazar (ADMIN): sólo cambia el estado; la deuda no se tocó nunca.
create or replace function :"schema".rechazar_cobro_pendiente(p_id uuid, p_motivo text)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_usr record;
  cp cobros_pendientes;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if v_usr.rol is distinct from 'ADMIN' then raise exception 'Solo un administrador puede rechazar cobros'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo del rechazo'; end if;
  select * into cp from cobros_pendientes where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if cp.estado <> 'pendiente' then raise exception 'Esta transferencia ya fue %', replace(cp.estado, 'ado', 'ada'); end if;
  update cobros_pendientes
     set estado = 'rechazado', motivo_rechazo = left(btrim(p_motivo), 500), rechazado_by = v_usr.id,
         rechazado_por_nombre = v_usr.nombre, rechazado_at = now(), updated_at = now()
   where id = cp.id;
  perform cobranza_limpiar_notificacion(cp.id);
  return jsonb_build_object('id', cp.id, 'estado', 'rechazado');
end;
$fn$;

-- Anular (ADMIN) una transferencia APROBADA: se anula su cobro → la deuda vuelve.
create or replace function :"schema".anular_cobro_pendiente(p_id uuid, p_motivo text)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_usr record;
  cp cobros_pendientes;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if v_usr.rol is distinct from 'ADMIN' then raise exception 'Solo un administrador puede anular cobros'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into cp from cobros_pendientes where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if cp.estado <> 'aprobado' then raise exception 'Solo se anula una transferencia aprobada (esta está %)', replace(cp.estado, 'ado', 'ada'); end if;
  if cp.cobro_id is not null and exists (select 1 from cobros_clientes where id = cp.cobro_id and anulado_at is null) then
    perform anular_cobro(cp.cobro_id, left('Transferencia anulada en Conciliación: ' || btrim(p_motivo), 500));
  end if;
  update cobros_pendientes
     set estado = 'anulado', motivo_anulacion = left(btrim(p_motivo), 500), anulado_by = v_usr.id,
         anulado_por_nombre = v_usr.nombre, anulado_at = now(), updated_at = now()
   where id = cp.id;
  perform cobranza_limpiar_notificacion(cp.id);
  return jsonb_build_object('id', cp.id, 'estado', 'anulado');
end;
$fn$;

-- Lista de Conciliación (pestaña por estado, rango de fechas de la transferencia y
-- búsqueda) + cuántas hay por estado con los mismos filtros (para las pestañas).
create or replace function :"schema".listar_cobros_pendientes(
  p_estado text default null, p_desde date default null, p_hasta date default null, p_q text default null, p_limit integer default 500
) returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_q text := nullif(lower(btrim(coalesce(p_q, ''))), '');
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  return (
    with base as (
      select cp.*, x.numero as numero_factura, x.saldo as saldo_factura, x.vencimiento as vencimiento_factura,
             coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as cliente_nombre,
             su.plan_nombre as plan, cat.nombre as categoria
        from cobros_pendientes cp
        join cuentas_por_cobrar x on x.id = cp.cxc_id
        join ventas v on v.id = x.venta_id
        join clientes cl on cl.id = cp.cliente_id
        left join suscripciones su on su.id = v.suscripcion_id
        left join cliente_categorias cat on cat.id = cl.categoria_id
       where cp.empresa_id = v_emp
         and (p_desde is null or cp.fecha >= p_desde)
         and (p_hasta is null or cp.fecha <= p_hasta)
         and (v_q is null or lower(concat_ws(' ', cl.nombre, cl.razon_social, cp.banco_origen, cp.titular, cp.numero_operacion,
                                             x.numero, cp.monto::text, su.plan_nombre)) like '%' || v_q || '%'
              or cp.numero_operacion_norm like '%' || norm_operacion(v_q) || '%' and length(norm_operacion(v_q)) >= 3)
    )
    select jsonb_build_object(
      'conteos', (select jsonb_build_object(
          'pendiente', count(*) filter (where estado = 'pendiente'), 'aprobado', count(*) filter (where estado = 'aprobado'),
          'rechazado', count(*) filter (where estado = 'rechazado'), 'anulado', count(*) filter (where estado = 'anulado'),
          'todas', count(*)) from base),
      'total_monto', (select coalesce(sum(monto), 0) from base where p_estado is null or estado = p_estado),
      'cobros', coalesce((select jsonb_agg(to_jsonb(b) - 'banco_origen_norm' - 'numero_operacion_norm' - 'idempotency_key'
                                            order by b.fecha desc, b.created_at desc)
                            from (select * from base where p_estado is null or estado = p_estado
                                   order by fecha desc, created_at desc
                                   limit least(greatest(coalesce(p_limit, 500), 1), 2000)) b), '[]'::jsonb)
    )
  );
end;
$fn$;

grant execute on function :"schema".gs_texto(numeric), :"schema".norm_banco(text), :"schema".norm_operacion(text),
  :"schema".operacion_placeholder(text), :"schema".generar_referencia_banco(text),
  :"schema".cobranza_notificar_pendiente(uuid), :"schema".cobranza_limpiar_notificacion(uuid),
  :"schema".cobranza_seguimiento(), :"schema".cobranza_detalle(uuid),
  :"schema".registrar_transferencia(jsonb), :"schema".aprobar_cobro_pendiente(uuid),
  :"schema".rechazar_cobro_pendiente(uuid, text), :"schema".anular_cobro_pendiente(uuid, text),
  :"schema".listar_cobros_pendientes(text, date, date, text, integer)
  to authenticated, service_role;
