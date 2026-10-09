-- =============================================================================
-- Suscripciones GENÉRICAS (como las del sistema actual, sin lo propio de Neura):
--   · planes: lo que el comercio cobra todos los meses (cuota, abono, mantenimiento…)
--   · suscripciones: cliente + plan + precio + día de facturación / vencimiento + duración
--   · emitir_cuota_suscripcion: genera la cuota del mes como VENTA A CRÉDITO (sin caja,
--     sin stock) → nace su cuenta a cobrar con el vencimiento del día elegido; se cobra con
--     el flujo de cobros de siempre. Un mes no se emite dos veces (índice único).
--   · facturacion_suscripciones: los meses de cada suscripción (emitida / pagada /
--     vencida / proyectada) — la pantalla "Estado de facturación" del actual
--   · cambiar_plan_suscripcion: inmediato | proximo_mes | actualizar_cuota_pendiente
--   · todo deja rastro en cliente_historial (Actividad)
-- Botón visible para emitir (nunca se emite solo a escondidas). IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

-- ── Planes ───────────────────────────────────────────────────────────────────
create table if not exists :"schema".planes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  descripcion text,
  precio numeric(18,2) not null check (precio >= 0),
  moneda text not null default 'GS' check (moneda in ('GS', 'USD')),
  tipo_iva text not null default '10%' check (tipo_iva in ('10%', '5%', 'exenta')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_planes_nombre on :"schema".planes (empresa_id, lower(nombre));
alter table :"schema".planes enable row level security;
alter table :"schema".planes force row level security;
drop policy if exists planes_propios on :"schema".planes;
create policy planes_propios on :"schema".planes to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".planes to authenticated, service_role;

-- ── Suscripciones ────────────────────────────────────────────────────────────
create table if not exists :"schema".suscripciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  plan_id uuid references :"schema".planes(id) on delete set null,
  plan_nombre text not null,                 -- foto del nombre (si el plan se renombra, la cuota vieja no cambia)
  precio numeric(18,2) not null check (precio >= 0),
  moneda text not null default 'GS' check (moneda in ('GS', 'USD')),
  tipo_iva text not null default '10%' check (tipo_iva in ('10%', '5%', 'exenta')),
  fecha_inicio date not null,
  duracion_meses integer check (duracion_meses is null or duracion_meses between 1 and 600),  -- null = sin fin
  dia_facturacion integer not null default 1 check (dia_facturacion between 1 and 28),
  dia_vencimiento integer not null default 10 check (dia_vencimiento between 1 and 31),
  estado text not null default 'activa' check (estado in ('activa', 'pausada', 'cancelada')),
  observacion text,
  -- Cambio de plan programado (modo "próximo mes").
  plan_pendiente_id uuid references :"schema".planes(id) on delete set null,
  plan_pendiente_nombre text,
  precio_pendiente numeric(18,2),
  pendiente_desde date,
  cancelada_at timestamptz,
  cancelada_motivo text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists suscripciones_cliente_idx on :"schema".suscripciones (cliente_id);
create index if not exists suscripciones_empresa_estado_idx on :"schema".suscripciones (empresa_id, estado);
alter table :"schema".suscripciones enable row level security;
alter table :"schema".suscripciones force row level security;
drop policy if exists suscripciones_propias on :"schema".suscripciones;
create policy suscripciones_propias on :"schema".suscripciones to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".suscripciones to authenticated, service_role;
alter table :"schema".suscripciones add column if not exists moneda_pendiente text;
alter table :"schema".suscripciones add column if not exists tipo_iva_pendiente text;

-- La cuota de cada mes es una venta: se marca de qué suscripción y qué mes es.
alter table :"schema".ventas add column if not exists suscripcion_id uuid;
alter table :"schema".ventas add column if not exists periodo date;   -- 1° del mes facturado
do $$ begin
  alter table ventas add constraint ventas_suscripcion_fk foreign key (suscripcion_id) references suscripciones(id) on delete set null;
exception when duplicate_object then null; end $$;
create unique index if not exists uq_ventas_suscripcion_periodo on :"schema".ventas (suscripcion_id, periodo)
  where suscripcion_id is not null and estado <> 'anulada';

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function :"schema".nombre_mes(p date)
returns text language sql immutable as $$
  select (array['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int
$$;

-- Día d del mes de p, sin pasarse del último día (31 en febrero → 28/29).
create or replace function :"schema".dia_del_mes(p date, d integer)
returns date language sql immutable as $$
  select (date_trunc('month', p)::date + (least(d, extract(day from (date_trunc('month', p) + interval '1 month - 1 day'))::int) - 1))
$$;

create or replace function :"schema".registrar_historial_cliente(p_cliente uuid, p_accion text, p_detalle jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $$
declare
  v_usuario uuid; v_nombre text; v_empresa uuid;
begin
  select empresa_id into v_empresa from clientes where id = p_cliente;
  select u.id, u.nombre into v_usuario, v_nombre from usuarios u where u.auth_user_id = auth.uid() limit 1;
  insert into cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre)
  values (v_empresa, p_cliente, p_accion, coalesce(p_detalle, '{}'::jsonb), v_usuario, coalesce(v_nombre, 'Sistema'));
end;
$$;

-- ── Alta de suscripción ──────────────────────────────────────────────────────
create or replace function :"schema".crear_suscripcion(p jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  v_empresa uuid := empresa_actual();
  v_plan planes;
  v_cli clientes;
  v_id uuid;
  v_usuario uuid;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select * into v_cli from clientes where id = (p->>'cliente_id')::uuid and empresa_id = v_empresa and deleted_at is null;
  if not found then raise exception 'Cliente no encontrado'; end if;
  select * into v_plan from planes where id = (p->>'plan_id')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí un plan'; end if;
  if not v_plan.activo then raise exception 'El plan "%" está inactivo', v_plan.nombre; end if;
  if coalesce((p->>'dia_vencimiento')::int, 10) < coalesce((p->>'dia_facturacion')::int, 1) then
    raise exception 'El día de vencimiento no puede ser antes del día de facturación';
  end if;
  select id into v_usuario from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;

  insert into suscripciones (empresa_id, cliente_id, plan_id, plan_nombre, precio, moneda, tipo_iva, fecha_inicio,
                             duracion_meses, dia_facturacion, dia_vencimiento, observacion, created_by)
  values (v_empresa, v_cli.id, v_plan.id, v_plan.nombre,
          coalesce(nullif(p->>'precio', '')::numeric, v_plan.precio), v_plan.moneda, v_plan.tipo_iva,
          coalesce(nullif(p->>'fecha_inicio', '')::date, (now() at time zone 'America/Asuncion')::date),
          nullif(p->>'duracion_meses', '')::int,
          coalesce(nullif(p->>'dia_facturacion', '')::int, 1), coalesce(nullif(p->>'dia_vencimiento', '')::int, 10),
          nullif(trim(p->>'observacion'), ''), v_usuario)
  returning id into v_id;

  perform registrar_historial_cliente(v_cli.id, 'suscripcion',
    jsonb_build_object('evento', 'alta', 'plan', v_plan.nombre,
                       'precio', coalesce(nullif(p->>'precio', '')::numeric, v_plan.precio), 'moneda', v_plan.moneda));
  return jsonb_build_object('id', v_id);
end;
$$;

-- ── Emitir la cuota de un mes ────────────────────────────────────────────────
create or replace function :"schema".emitir_cuota_suscripcion(p_suscripcion uuid, p_periodo date default null)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  v_empresa uuid := empresa_actual();
  s suscripciones;
  v_periodo date;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_plan_nombre text;
  v_precio numeric;
  v_venc date;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario uuid;
  v_usuario_nombre text;
  v_tasa numeric;
  v_iva numeric;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select * into s from suscripciones where id = p_suscripcion and empresa_id = v_empresa for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;
  if s.estado <> 'activa' then raise exception 'La suscripción está %: no se emiten cuotas', s.estado; end if;

  v_periodo := date_trunc('month', coalesce(p_periodo, v_hoy))::date;
  if v_periodo < date_trunc('month', s.fecha_inicio)::date then
    raise exception 'Ese mes es anterior al inicio de la suscripción';
  end if;
  if s.duracion_meses is not null
     and v_periodo >= (date_trunc('month', s.fecha_inicio) + make_interval(months => s.duracion_meses))::date then
    raise exception 'Ese mes está fuera de la duración de la suscripción';
  end if;
  if exists (select 1 from ventas where suscripcion_id = s.id and periodo = v_periodo and estado <> 'anulada') then
    raise exception 'La cuota de % ya está emitida', nombre_mes(v_periodo);
  end if;

  -- Cambio de plan programado: desde su mes en adelante rige el plan nuevo.
  if s.plan_pendiente_id is not null and s.pendiente_desde is not null and v_periodo >= s.pendiente_desde then
    update suscripciones
       set plan_id = plan_pendiente_id, plan_nombre = plan_pendiente_nombre, precio = precio_pendiente,
           moneda = coalesce(moneda_pendiente, moneda), tipo_iva = coalesce(tipo_iva_pendiente, tipo_iva),
           plan_pendiente_id = null, plan_pendiente_nombre = null, precio_pendiente = null, pendiente_desde = null,
           moneda_pendiente = null, tipo_iva_pendiente = null,
           updated_at = now()
     where id = s.id
     returning * into s;
  end if;

  v_plan_nombre := s.plan_nombre;
  v_precio := round(s.precio);
  -- Vencimiento real del mes (una cuota atrasada que se emite hoy ya nace vencida).
  v_venc := dia_del_mes(v_periodo, s.dia_vencimiento);
  v_tasa := case s.tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0 else round(v_precio * v_tasa / (100 + v_tasa)) end;

  select id, nombre into v_usuario, v_usuario_nombre from usuarios where auth_user_id = auth.uid() and empresa_id = v_empresa limit 1;
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  select coalesce(max(case when numero_control ~ '^VTA-[0-9]+$'
           then substring(numero_control from '[0-9]+$')::bigint end), 0) + 1
    into v_next from ventas where empresa_id = v_empresa;
  v_numero := 'VTA-' || lpad(v_next::text, 6, '0');

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones,
                      suscripcion_id, periodo)
  values (v_empresa, s.cliente_id, v_numero, s.moneda, 1, 0, 0, 0, 'completada',
          'CREDITO', greatest(v_venc - v_hoy, 0), null, null, auth.uid(), v_usuario_nombre, now(),
          'Cuota ' || v_plan_nombre || ' — ' || nombre_mes(v_periodo), s.id, v_periodo)
  returning id into v_venta;

  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (v_empresa, v_venta, null, v_plan_nombre || ' — ' || nombre_mes(v_periodo), null, 1, v_precio, v_precio,
          'minorista', s.tipo_iva, v_precio - v_iva, v_iva, v_precio, true, 0);

  update ventas set subtotal = v_precio - v_iva, monto_iva = v_iva, total = v_precio, updated_at = now() where id = v_venta;
  -- El trigger de cuentas a cobrar calcula el vencimiento por plazo: lo fijamos al día exacto.
  update cuentas_por_cobrar set vencimiento = v_venc, updated_at = now() where venta_id = v_venta;

  perform registrar_historial_cliente(s.cliente_id, 'suscripcion',
    jsonb_build_object('evento', 'cuota', 'plan', v_plan_nombre, 'periodo', nombre_mes(v_periodo),
                       'numero', v_numero, 'monto', v_precio, 'moneda', s.moneda));
  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', v_precio, 'vencimiento', v_venc);
end;
$$;

-- ── Meses de cada suscripción (Estado de facturación) ───────────────────────
-- Desde el inicio hasta 3 meses adelante de hoy (o hasta el fin de la duración).
create or replace function :"schema".facturacion_suscripciones(p_cliente uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  subs as (
    select s.* from suscripciones s where s.cliente_id = p_cliente and s.empresa_id = empresa_actual()
  ),
  meses as (
    select s.id as suscripcion_id, m::date as periodo
      from subs s, hoy,
           generate_series(date_trunc('month', s.fecha_inicio),
                           least(date_trunc('month', hoy.d) + interval '3 months',
                                 case when s.duracion_meses is null then 'infinity'::timestamp
                                      else date_trunc('month', s.fecha_inicio) + make_interval(months => s.duracion_meses - 1) end,
                                 case when s.estado = 'cancelada' then date_trunc('month', coalesce(s.cancelada_at, now())) else 'infinity'::timestamp end),
                           interval '1 month') m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'suscripcion_id', s.id, 'plan', s.plan_nombre, 'precio', s.precio, 'moneda', s.moneda, 'estado', s.estado,
           'dia_facturacion', s.dia_facturacion, 'dia_vencimiento', s.dia_vencimiento, 'fecha_inicio', s.fecha_inicio,
           'duracion_meses', s.duracion_meses, 'plan_pendiente', s.plan_pendiente_nombre, 'precio_pendiente', s.precio_pendiente,
           'pendiente_desde', s.pendiente_desde,
           'meses', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'periodo', m.periodo, 'nombre', nombre_mes(m.periodo),
                      'venta_id', v.id, 'numero', v.numero_control, 'monto',
                      coalesce(v.total, case when s.pendiente_desde is not null and m.periodo >= s.pendiente_desde then s.precio_pendiente else s.precio end),
                      'saldo', x.saldo, 'vencimiento', coalesce(x.vencimiento, dia_del_mes(m.periodo, s.dia_vencimiento)),
                      'estado', case when v.id is null then 'proyectada'
                                     when x.estado = 'pagada' then 'pagada'
                                     when x.vencimiento < (select d from hoy) then 'vencida'
                                     else 'emitida' end)
                    order by m.periodo)
               from meses m
               left join ventas v on v.suscripcion_id = s.id and v.periodo = m.periodo and v.estado <> 'anulada'
               left join cuentas_por_cobrar x on x.venta_id = v.id
              where m.suscripcion_id = s.id), '[]'::jsonb)
         ) order by (s.estado = 'activa') desc, s.created_at desc), '[]'::jsonb)
    from subs s
$$;

-- ── Cambio de plan ───────────────────────────────────────────────────────────
--   inmediato                  → rige ya (solo si la cuota de este mes todavía no se emitió)
--   proximo_mes                → queda programado desde el 1° del mes que viene
--   actualizar_cuota_pendiente → rige ya y la cuota de este mes (emitida, sin cobros) se
--                                anula y se vuelve a emitir con el precio nuevo
create or replace function :"schema".cambiar_plan_suscripcion(p_suscripcion uuid, p_plan uuid, p_modo text, p_precio numeric default null)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  v_empresa uuid := empresa_actual();
  s suscripciones;
  v_plan planes;
  v_precio numeric;
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion'))::date;
  v_cuota ventas;
  v_cobrado numeric;
  v_res jsonb := '{}'::jsonb;
begin
  select * into s from suscripciones where id = p_suscripcion and empresa_id = v_empresa for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;
  if s.estado = 'cancelada' then raise exception 'La suscripción está cancelada'; end if;
  select * into v_plan from planes where id = p_plan and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el plan nuevo'; end if;
  v_precio := coalesce(p_precio, v_plan.precio);
  select * into v_cuota from ventas where suscripcion_id = s.id and periodo = v_mes and estado <> 'anulada';

  if p_modo = 'proximo_mes' then
    update suscripciones set plan_pendiente_id = v_plan.id, plan_pendiente_nombre = v_plan.nombre, precio_pendiente = v_precio,
                             moneda_pendiente = v_plan.moneda, tipo_iva_pendiente = v_plan.tipo_iva,
                             pendiente_desde = (v_mes + interval '1 month')::date, updated_at = now()
     where id = s.id;
  elsif p_modo = 'inmediato' then
    if v_cuota.id is not null then
      raise exception 'La cuota de este mes ya está emitida (%): elegí "próximo mes" o "actualizar la cuota pendiente"', v_cuota.numero_control;
    end if;
    update suscripciones set plan_id = v_plan.id, plan_nombre = v_plan.nombre, precio = v_precio, moneda = v_plan.moneda,
                             tipo_iva = v_plan.tipo_iva, plan_pendiente_id = null, plan_pendiente_nombre = null,
                             precio_pendiente = null, pendiente_desde = null, moneda_pendiente = null,
                             tipo_iva_pendiente = null, updated_at = now()
     where id = s.id;
  elsif p_modo = 'actualizar_cuota_pendiente' then
    if v_cuota.id is null then raise exception 'No hay cuota emitida este mes: usá "inmediato"'; end if;
    select cobrado into v_cobrado from cuentas_por_cobrar where venta_id = v_cuota.id;
    if coalesce(v_cobrado, 0) > 0 then
      raise exception 'La cuota % ya tiene cobros: no se puede rehacer', v_cuota.numero_control;
    end if;
    update ventas set estado = 'anulada', anulada_at = now(), anulada_motivo = 'Cambio de plan', updated_at = now()
     where id = v_cuota.id;
    update suscripciones set plan_id = v_plan.id, plan_nombre = v_plan.nombre, precio = v_precio, moneda = v_plan.moneda,
                             tipo_iva = v_plan.tipo_iva, plan_pendiente_id = null, plan_pendiente_nombre = null,
                             precio_pendiente = null, pendiente_desde = null, moneda_pendiente = null,
                             tipo_iva_pendiente = null, updated_at = now()
     where id = s.id;
    v_res := emitir_cuota_suscripcion(s.id, v_mes);
  else
    raise exception 'Modo de cambio inválido';
  end if;

  perform registrar_historial_cliente(s.cliente_id, 'suscripcion',
    jsonb_build_object('evento', 'cambio_plan', 'modo', p_modo, 'plan_anterior', s.plan_nombre,
                       'plan_nuevo', v_plan.nombre, 'precio', v_precio, 'moneda', v_plan.moneda));
  return v_res || jsonb_build_object('ok', true);
end;
$$;

-- ── Pausar / reactivar / cancelar ────────────────────────────────────────────
create or replace function :"schema".cambiar_estado_suscripcion(p_suscripcion uuid, p_estado text, p_motivo text default null)
returns void language plpgsql security invoker set search_path = :"schema", public as $$
declare
  s suscripciones;
begin
  select * into s from suscripciones where id = p_suscripcion and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;
  if p_estado not in ('activa', 'pausada', 'cancelada') then raise exception 'Estado inválido'; end if;
  if s.estado = 'cancelada' then raise exception 'Una suscripción cancelada no se reactiva: creá una nueva'; end if;
  if p_estado = 'cancelada' and coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la cancelación'; end if;
  update suscripciones
     set estado = p_estado, updated_at = now(),
         cancelada_at = case when p_estado = 'cancelada' then now() end,
         cancelada_motivo = case when p_estado = 'cancelada' then trim(p_motivo) end
   where id = s.id;
  perform registrar_historial_cliente(s.cliente_id, 'suscripcion',
    jsonb_build_object('evento', p_estado, 'plan', s.plan_nombre, 'motivo', nullif(trim(p_motivo), '')));
end;
$$;

-- ── Suscripción activa en la lista de clientes ──────────────────────────────
create or replace function :"schema".suscripcion_activa_cliente(p_cliente uuid)
returns text language sql stable security invoker set search_path = :"schema", public as $$
  select string_agg(plan_nombre, ', ' order by created_at)
    from suscripciones where cliente_id = p_cliente and estado = 'activa' and empresa_id = empresa_actual()
$$;

grant execute on function :"schema".nombre_mes(date), :"schema".dia_del_mes(date, integer),
  :"schema".crear_suscripcion(jsonb), :"schema".emitir_cuota_suscripcion(uuid, date),
  :"schema".facturacion_suscripciones(uuid), :"schema".cambiar_plan_suscripcion(uuid, uuid, text, numeric),
  :"schema".cambiar_estado_suscripcion(uuid, text, text), :"schema".suscripcion_activa_cliente(uuid)
  to authenticated, service_role;
revoke execute on function :"schema".registrar_historial_cliente(uuid, text, jsonb) from public, anon;
grant execute on function :"schema".registrar_historial_cliente(uuid, text, jsonb) to authenticated, service_role;

-- ── Emitir de una vez las cuotas de un mes (botón "Emitir cuotas del mes") ──
-- Solo suscripciones activas a las que les corresponde ese mes y todavía no la tienen.
create or replace function :"schema".emitir_cuotas_mes(p_periodo date default null)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $$
declare
  v_periodo date := date_trunc('month', coalesce(p_periodo, (now() at time zone 'America/Asuncion')::date))::date;
  r record;
  v_ok integer := 0;
  v_total numeric := 0;
  v_errores jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  for r in
    select s.id, c.nombre as cliente from suscripciones s join clientes c on c.id = s.cliente_id
     where s.empresa_id = empresa_actual() and s.estado = 'activa'
       and date_trunc('month', s.fecha_inicio)::date <= v_periodo
       and (s.duracion_meses is null or v_periodo < (date_trunc('month', s.fecha_inicio) + make_interval(months => s.duracion_meses))::date)
       and not exists (select 1 from ventas v where v.suscripcion_id = s.id and v.periodo = v_periodo and v.estado <> 'anulada')
     order by c.nombre
  loop
    begin
      v_res := emitir_cuota_suscripcion(r.id, v_periodo);
      v_ok := v_ok + 1;
      v_total := v_total + (v_res->>'total')::numeric;
    exception when others then
      v_errores := v_errores || jsonb_build_object('cliente', r.cliente, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('periodo', v_periodo, 'emitidas', v_ok, 'total', v_total, 'errores', v_errores);
end;
$$;

-- ── Listado de todas las suscripciones (pantalla Suscripciones) ─────────────
create or replace function :"schema".listar_suscripciones(p_estado text default null, p_q text default null, p_periodo date default null)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with par as (select date_trunc('month', coalesce(p_periodo, (now() at time zone 'America/Asuncion')::date))::date as mes,
                      tokens_busqueda(p_q) as tk),
  base as (
    select s.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
           v.id as cuota_venta_id, v.numero_control as cuota_numero, x.estado as cuota_estado, x.saldo as cuota_saldo,
           (s.estado = 'activa' and date_trunc('month', s.fecha_inicio)::date <= par.mes
            and (s.duracion_meses is null or par.mes < (date_trunc('month', s.fecha_inicio) + make_interval(months => s.duracion_meses))::date)) as corresponde_mes
      from suscripciones s
      join clientes c on c.id = s.cliente_id
      cross join par
      left join ventas v on v.suscripcion_id = s.id and v.periodo = par.mes and v.estado <> 'anulada'
      left join cuentas_por_cobrar x on x.venta_id = v.id
     where s.empresa_id = empresa_actual()
       and (p_estado is null or s.estado = p_estado)
       and (cardinality(par.tk) = 0 or coincide_busqueda(c.busqueda || ' ' || norm(s.plan_nombre), par.tk))
  )
  select jsonb_build_object(
    'periodo', (select mes from par),
    'rows', coalesce((select jsonb_agg(to_jsonb(b) - 'tk' - 'mes' order by (b.estado = 'activa') desc, b.cliente_nombre) from base b), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
        'activas', count(*) filter (where estado = 'activa'),
        'pausadas', count(*) filter (where estado = 'pausada'),
        'canceladas', count(*) filter (where estado = 'cancelada'),
        'mensual_gs', coalesce(sum(precio) filter (where estado = 'activa' and moneda = 'GS'), 0),
        'mensual_usd', coalesce(sum(precio) filter (where estado = 'activa' and moneda = 'USD'), 0),
        'por_emitir', count(*) filter (where corresponde_mes and cuota_venta_id is null),
        'emitidas_mes', count(*) filter (where cuota_venta_id is not null))
      from base)
  )
$$;

grant execute on function :"schema".emitir_cuotas_mes(date), :"schema".listar_suscripciones(text, text, date) to authenticated, service_role;
