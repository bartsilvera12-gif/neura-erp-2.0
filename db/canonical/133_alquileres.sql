-- =============================================================================
-- ALQUILERES (rubro Inmobiliaria, fase 2 — 4-nov-2026): contratos, la cuota de cada mes y la
-- liquidación al dueño.
--
--   · Contrato (alquiler_contratos): propiedad, inquilino (cliente), alquiler mensual, día de
--     vencimiento, inicio y duración en meses (sin duración = hasta que se termine), garantía, aumento
--     (% cada N meses), IVA. Al firmarlo la propiedad queda "alquilada"; al terminarlo o rescindirlo
--     vuelve a "disponible". Si la propiedad es de un dueño, el contrato copia el dueño y la comisión.
--   · Cuota del mes: como las suscripciones (receta 29), una venta a crédito sin caja con un renglón
--     manual ("Alquiler … — noviembre 2026"), así entra a Cuentas a cobrar, cobranza, estado de cuenta y
--     reportes sin cambios. La emisión es a mano (un botón por contrato o "emitir el mes" para todos):
--     no hay cron. Un mes no se emite dos veces. El aumento se aplica solo según los meses corridos.
--   · Liquidación al dueño: de cada cuota COBRADA de una propiedad de un dueño, la inmobiliaria se
--     queda la comisión y le debe el resto. alquiler_liquidar paga lo pendiente (sale de la caja
--     abierta como egreso) y marca esas cuotas como liquidadas.
--   · Todo solo por funciones (RLS forzada). Contratos y emisión: vender_credito. Liquidar: pagar_proveedores.
--
-- IDEMPOTENTE. Va después de 132.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
create table if not exists :"schema".alquiler_contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,
  propiedad_id uuid not null references :"schema".propiedades(id) on delete restrict,
  inquilino_id uuid not null references :"schema".clientes(id) on delete restrict,
  propietario_id uuid references :"schema".clientes(id) on delete restrict,
  comision_pct numeric(5,2) not null default 0 check (comision_pct between 0 and 100),
  monto numeric(16,0) not null check (monto > 0),
  tipo_iva text not null default '5%' check (tipo_iva in ('EXENTA', '5%', '10%')),
  dia_vencimiento smallint not null default 10 check (dia_vencimiento between 1 and 28),
  fecha_inicio date not null,
  meses smallint check (meses is null or meses between 1 and 240),
  garantia numeric(16,0) not null default 0 check (garantia >= 0),
  ajuste_pct numeric(5,2) not null default 0 check (ajuste_pct between 0 and 100),
  ajuste_cada_meses smallint not null default 12 check (ajuste_cada_meses between 1 and 60),
  estado text not null default 'vigente' check (estado in ('vigente', 'finalizado', 'rescindido')),
  fecha_fin date,
  notas text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists alquiler_contratos_numero_uq on :"schema".alquiler_contratos (empresa_id, numero);
create unique index if not exists alquiler_contratos_vigente_uq on :"schema".alquiler_contratos (propiedad_id) where estado = 'vigente';
create index if not exists alquiler_contratos_inquilino_idx on :"schema".alquiler_contratos (inquilino_id);

create table if not exists :"schema".alquiler_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,
  propietario_id uuid not null references :"schema".clientes(id) on delete restrict,
  cobrado numeric(16,0) not null,
  comision numeric(16,0) not null,
  neto numeric(16,0) not null,
  medio text not null check (medio in ('efectivo', 'transferencia', 'cheque', 'otro')),
  referencia text,
  caja_id uuid,
  caja_movimiento_id uuid,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists alquiler_liquidaciones_numero_uq on :"schema".alquiler_liquidaciones (empresa_id, numero);

create table if not exists :"schema".alquiler_cuotas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  contrato_id uuid not null references :"schema".alquiler_contratos(id) on delete cascade,
  periodo date not null,
  venta_id uuid not null references :"schema".ventas(id) on delete restrict,
  monto numeric(16,0) not null,
  comision_pct numeric(5,2) not null default 0,
  liquidacion_id uuid references :"schema".alquiler_liquidaciones(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists alquiler_cuotas_periodo_uq on :"schema".alquiler_cuotas (contrato_id, periodo);

do $do$
declare
  t text;
begin
  foreach t in array array['alquiler_contratos', 'alquiler_cuotas', 'alquiler_liquidaciones'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- =============================================================================
-- 2. Ayudantes
-- =============================================================================
-- Monto de un mes con el aumento: monto × (1 + ajuste)^(meses corridos / cada N meses).
create or replace function :"schema".alquiler_monto_mes(c alquiler_contratos, p_periodo date)
returns numeric language sql immutable as $$
  select round(c.monto * power(1 + c.ajuste_pct / 100.0,
           greatest(0, floor(((extract(year from p_periodo) * 12 + extract(month from p_periodo))
                              - (extract(year from c.fecha_inicio) * 12 + extract(month from c.fecha_inicio))) / c.ajuste_cada_meses))))
$$;

-- Cuotas de un contrato con lo cobrado (de su cuenta a cobrar).
create or replace function :"schema".alquiler_cuotas_json(p_contrato uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'periodo', q.periodo, 'mes', nombre_mes(q.periodo), 'monto', q.monto, 'numero', v.numero_control,
      'venta_id', q.venta_id, 'vencimiento', x.vencimiento, 'cobrado', x.cobrado, 'saldo', x.saldo,
      'estado', case when v.estado = 'anulada' then 'anulada' else x.estado end,
      'comision_pct', q.comision_pct, 'liquidada', q.liquidacion_id is not null) order by q.periodo desc), '[]'::jsonb)
    from alquiler_cuotas q
    join ventas v on v.id = q.venta_id
    left join lateral (select min(c.vencimiento) vencimiento, sum(c.cobrado) cobrado, sum(c.saldo) saldo,
                              case when bool_and(c.estado in ('pagada', 'anulada')) then 'pagada'
                                   when sum(c.cobrado) > 0 then 'parcial' else 'pendiente' end estado
                         from cuentas_por_cobrar c where c.venta_id = q.venta_id) x on true
   where q.contrato_id = p_contrato
$$;

create or replace function :"schema".alquiler_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'estado', a.estado,
    'propiedad_id', a.propiedad_id, 'propiedad', p.nombre, 'propiedad_codigo', pr.codigo, 'direccion', concat_ws(', ', pr.direccion, pr.barrio, pr.ciudad),
    'inquilino_id', a.inquilino_id, 'inquilino', i.nombre, 'inquilino_documento', i.documento, 'inquilino_telefono', i.telefono,
    'propietario_id', a.propietario_id, 'propietario', o.nombre, 'comision_pct', a.comision_pct,
    'monto', a.monto, 'monto_actual', alquiler_monto_mes(a, (now() at time zone 'America/Asuncion')::date), 'tipo_iva', a.tipo_iva,
    'dia_vencimiento', a.dia_vencimiento, 'fecha_inicio', a.fecha_inicio, 'meses', a.meses,
    'fecha_termina', case when a.meses is not null then (a.fecha_inicio + make_interval(months => a.meses) - interval '1 day')::date end,
    'garantia', a.garantia, 'ajuste_pct', a.ajuste_pct, 'ajuste_cada_meses', a.ajuste_cada_meses,
    'fecha_fin', a.fecha_fin, 'notas', a.notas, 'created_at', a.created_at,
    'cuotas', alquiler_cuotas_json(a.id),
    'deuda', (select coalesce(sum(c.saldo), 0) from alquiler_cuotas q join cuentas_por_cobrar c on c.venta_id = q.venta_id
               where q.contrato_id = a.id and c.estado in ('pendiente', 'parcial')))
    from alquiler_contratos a
    join propiedades pr on pr.id = a.propiedad_id
    join productos p on p.id = pr.producto_id
    join clientes i on i.id = a.inquilino_id
    left join clientes o on o.id = a.propietario_id
   where a.id = p_id
$$;

-- =============================================================================
-- 3. Contratos
-- =============================================================================
-- p: estado?, q?, propiedad_id?, inquilino_id?
create or replace function :"schema".alquileres_lista(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_q text := nullif(norm(btrim(coalesce(p->>'q', ''))), '');
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion')::date)::date;
begin
  select * into s from inmo_sesion();
  return coalesce((select jsonb_agg(x order by (x->>'estado') = 'vigente' desc, x->>'numero' desc) from (
    select jsonb_build_object(
      'id', a.id, 'numero', a.numero, 'estado', a.estado, 'propiedad', pd.nombre, 'propiedad_codigo', pr.codigo,
      'propiedad_id', a.propiedad_id, 'inquilino', i.nombre, 'inquilino_id', a.inquilino_id, 'propietario', o.nombre,
      'monto_actual', alquiler_monto_mes(a, v_mes), 'dia_vencimiento', a.dia_vencimiento, 'fecha_inicio', a.fecha_inicio, 'meses', a.meses,
      'emitido_mes', exists (select 1 from alquiler_cuotas q join ventas v on v.id = q.venta_id where q.contrato_id = a.id and q.periodo = v_mes and v.estado <> 'anulada'),
      'deuda', (select coalesce(sum(c.saldo), 0) from alquiler_cuotas q join cuentas_por_cobrar c on c.venta_id = q.venta_id
                 where q.contrato_id = a.id and c.estado in ('pendiente', 'parcial'))) x
      from alquiler_contratos a
      join propiedades pr on pr.id = a.propiedad_id
      join productos pd on pd.id = pr.producto_id
      join clientes i on i.id = a.inquilino_id
      left join clientes o on o.id = a.propietario_id
     where a.empresa_id = s.s_empresa
       and (nullif(p->>'estado', '') is null or a.estado = p->>'estado')
       and (nullif(p->>'propiedad_id', '') is null or a.propiedad_id = (p->>'propiedad_id')::uuid)
       and (nullif(p->>'inquilino_id', '') is null or a.inquilino_id = (p->>'inquilino_id')::uuid
            or a.propietario_id = (p->>'inquilino_id')::uuid)
       and (v_q is null or norm(concat_ws(' ', a.numero, pd.nombre, pr.codigo, i.nombre, o.nombre)) like '%' || v_q || '%')) t), '[]'::jsonb);
end;
$fn$;

create or replace function :"schema".alquiler_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  if not exists (select 1 from alquiler_contratos where id = p_id and empresa_id = s.s_empresa) then raise exception 'No existe ese contrato'; end if;
  return alquiler_json(p_id);
end;
$fn$;

-- p: id?, propiedad_id, inquilino_id, monto, tipo_iva, dia_vencimiento, fecha_inicio, meses, garantia,
--    ajuste_pct, ajuste_cada_meses, comision_pct?, notas. Con cuotas emitidas no cambian ni la propiedad,
--    ni el inquilino, ni el inicio.
create or replace function :"schema".alquiler_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a alquiler_contratos;
  pr propiedades;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_n integer;
  v_numero text;
  v_emitidas integer := 0;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('vender_credito');
  select * into pr from propiedades where id = nullif(p->>'propiedad_id', '')::uuid and empresa_id = s.s_empresa for update;
  if pr.id is null then raise exception 'Elegí la propiedad'; end if;
  if pr.gestion = 'venta' then raise exception 'Esta propiedad es solo para venta: cambiala a alquiler en su ficha'; end if;
  if nullif(p->>'inquilino_id', '') is null
     or not exists (select 1 from clientes where id = (p->>'inquilino_id')::uuid and empresa_id = s.s_empresa and deleted_at is null) then
    raise exception 'Elegí el inquilino';
  end if;
  if pr.propietario_id is not null and pr.propietario_id = (p->>'inquilino_id')::uuid then
    raise exception 'El inquilino no puede ser el dueño de la propiedad';
  end if;
  if coalesce((p->>'monto')::numeric, 0) <= 0 then raise exception 'Poné el alquiler mensual'; end if;
  if nullif(p->>'fecha_inicio', '') is null then raise exception 'Poné la fecha de inicio'; end if;

  if v_id is not null then
    select * into a from alquiler_contratos where id = v_id and empresa_id = s.s_empresa for update;
    if a.id is null then raise exception 'No existe ese contrato'; end if;
    if a.estado <> 'vigente' then raise exception 'El contrato está %: no se edita', a.estado; end if;
    select count(*) into v_emitidas from alquiler_cuotas q join ventas v on v.id = q.venta_id where q.contrato_id = a.id and v.estado <> 'anulada';
    if v_emitidas > 0 and (a.propiedad_id <> pr.id or a.inquilino_id <> (p->>'inquilino_id')::uuid or a.fecha_inicio <> (p->>'fecha_inicio')::date) then
      raise exception 'El contrato ya tiene cuotas: no se cambian la propiedad, el inquilino ni el inicio';
    end if;
    if a.propiedad_id <> pr.id then
      if pr.estado not in ('disponible', 'reservada') then raise exception 'La propiedad está %: no se puede alquilar', pr.estado; end if;
      update propiedades set estado = 'disponible', updated_at = now() where id = a.propiedad_id and estado = 'alquilada';
    end if;
  else
    if pr.estado not in ('disponible', 'reservada') then raise exception 'La propiedad está %: no se puede alquilar', pr.estado; end if;
    select coalesce(max(substring(numero from '^ALQ-(\d+)$')::integer), 0) + 1 into v_n from alquiler_contratos where empresa_id = s.s_empresa;
    v_numero := 'ALQ-' || lpad(v_n::text, 4, '0');
    insert into alquiler_contratos (empresa_id, numero, propiedad_id, inquilino_id, monto, fecha_inicio, created_by)
      values (s.s_empresa, v_numero, pr.id, (p->>'inquilino_id')::uuid, (p->>'monto')::numeric, (p->>'fecha_inicio')::date, s.s_usuario)
      returning id into v_id;
  end if;

  update alquiler_contratos set
    propiedad_id = pr.id,
    inquilino_id = (p->>'inquilino_id')::uuid,
    propietario_id = pr.propietario_id,
    comision_pct = case when pr.propietario_id is null then 0
                        else coalesce(nullif(p->>'comision_pct', '')::numeric, pr.comision_alquiler_pct, 0) end,
    monto = round((p->>'monto')::numeric),
    tipo_iva = coalesce(nullif(p->>'tipo_iva', ''), '5%'),
    dia_vencimiento = coalesce(nullif(p->>'dia_vencimiento', '')::integer, 10),
    fecha_inicio = (p->>'fecha_inicio')::date,
    meses = nullif(p->>'meses', '')::integer,
    garantia = round(coalesce(nullif(p->>'garantia', '')::numeric, 0)),
    ajuste_pct = coalesce(nullif(p->>'ajuste_pct', '')::numeric, 0),
    ajuste_cada_meses = coalesce(nullif(p->>'ajuste_cada_meses', '')::integer, 12),
    notas = nullif(btrim(coalesce(p->>'notas', '')), ''),
    updated_at = now()
  where id = v_id;

  update propiedades set estado = 'alquilada', updated_at = now() where id = pr.id;
  perform registrar_historial_cliente((p->>'inquilino_id')::uuid, 'alquiler',
    jsonb_build_object('evento', case when p ? 'id' and nullif(p->>'id', '') is not null then 'editado' else 'contrato' end,
                       'propiedad', pr.codigo, 'monto', round((p->>'monto')::numeric)));
  return alquiler_json(v_id);
end;
$fn$;

-- Terminar (finalizado) o rescindir: la propiedad vuelve a disponible. No borra cuotas ni deuda.
create or replace function :"schema".alquiler_estado(p_id uuid, p_estado text, p_fecha date default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a alquiler_contratos;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('vender_credito');
  if p_estado not in ('finalizado', 'rescindido') then raise exception 'Estado inválido'; end if;
  select * into a from alquiler_contratos where id = p_id and empresa_id = s.s_empresa for update;
  if a.id is null then raise exception 'No existe ese contrato'; end if;
  if a.estado <> 'vigente' then raise exception 'El contrato ya está %', a.estado; end if;
  update alquiler_contratos set estado = p_estado, fecha_fin = coalesce(p_fecha, (now() at time zone 'America/Asuncion')::date), updated_at = now()
   where id = p_id;
  update propiedades set estado = 'disponible', updated_at = now() where id = a.propiedad_id and estado = 'alquilada';
  return alquiler_json(p_id);
end;
$fn$;

-- =============================================================================
-- 4. La cuota del mes
-- =============================================================================
-- Emite el mes (por defecto el actual) de un contrato vigente: venta a crédito sin caja.
create or replace function :"schema".alquiler_emitir(p_id uuid, p_periodo date default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a alquiler_contratos;
  v_periodo date;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_monto numeric;
  v_venc date;
  v_tasa numeric;
  v_iva numeric;
  v_venta uuid;
  v_numero text;
  v_nombre text;
  v_titulo text;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('vender_credito');
  select * into a from alquiler_contratos where id = p_id and empresa_id = s.s_empresa for update;
  if a.id is null then raise exception 'No existe ese contrato'; end if;
  if a.estado <> 'vigente' then raise exception 'El contrato está %: no se emiten cuotas', a.estado; end if;
  v_periodo := date_trunc('month', coalesce(p_periodo, v_hoy))::date;
  if v_periodo < date_trunc('month', a.fecha_inicio)::date then raise exception 'Ese mes es anterior al inicio del contrato'; end if;
  if a.meses is not null and v_periodo >= (date_trunc('month', a.fecha_inicio) + make_interval(months => a.meses))::date then
    raise exception 'Ese mes está fuera de la duración del contrato';
  end if;
  if exists (select 1 from alquiler_cuotas q join ventas v on v.id = q.venta_id where q.contrato_id = a.id and q.periodo = v_periodo and v.estado <> 'anulada') then
    raise exception 'El alquiler de % ya está emitido', nombre_mes(v_periodo);
  end if;
  delete from alquiler_cuotas q using ventas v where q.contrato_id = a.id and q.periodo = v_periodo and v.id = q.venta_id and v.estado = 'anulada';

  v_monto := alquiler_monto_mes(a, v_periodo);
  v_venc := dia_del_mes(v_periodo, a.dia_vencimiento);
  v_tasa := case a.tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0 else round(v_monto * v_tasa / (100 + v_tasa)) end;
  select pd.nombre into v_titulo from propiedades pr join productos pd on pd.id = pr.producto_id where pr.id = a.propiedad_id;
  v_nombre := left('Alquiler ' || v_titulo || ' — ' || nombre_mes(v_periodo), 200);

  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || s.s_empresa::text));
  v_numero := siguiente_numero_venta(s.s_empresa);
  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones, tipo_documento)
  values (s.s_empresa, a.inquilino_id, v_numero, 'GS', 1, 0, 0, 0, 'completada',
          'CREDITO', greatest(v_venc - v_hoy, 0), null, null, auth.uid(),
          (select nombre from usuarios where id = s.s_usuario), now(), a.numero || ' · ' || v_nombre, 'ticket')
  returning id into v_venta;
  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (s.s_empresa, v_venta, null, v_nombre, null, 1, v_monto, v_monto, 'minorista', a.tipo_iva, v_monto - v_iva, v_iva, v_monto, true, 0);
  update ventas set subtotal = v_monto - v_iva, monto_iva = v_iva, total = v_monto, updated_at = now() where id = v_venta;
  update cuentas_por_cobrar set vencimiento = v_venc, updated_at = now() where venta_id = v_venta;

  insert into alquiler_cuotas (empresa_id, contrato_id, periodo, venta_id, monto, comision_pct)
    values (s.s_empresa, a.id, v_periodo, v_venta, v_monto, a.comision_pct);
  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'monto', v_monto, 'vencimiento', v_venc, 'mes', nombre_mes(v_periodo));
end;
$fn$;

-- Emite el mes de TODOS los contratos vigentes que no lo tengan (los que no corresponden se saltean).
create or replace function :"schema".alquileres_emitir_mes(p_periodo date default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r record;
  v_periodo date := date_trunc('month', coalesce(p_periodo, (now() at time zone 'America/Asuncion')::date))::date;
  v_ok integer := 0;
  v_total numeric := 0;
  v_r jsonb;
  v_saltados jsonb := '[]'::jsonb;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('vender_credito');
  for r in select a.id, a.numero from alquiler_contratos a where a.empresa_id = s.s_empresa and a.estado = 'vigente' order by a.numero loop
    begin
      v_r := alquiler_emitir(r.id, v_periodo);
      v_ok := v_ok + 1;
      v_total := v_total + (v_r->>'monto')::numeric;
    exception when others then
      v_saltados := v_saltados || jsonb_build_object('numero', r.numero, 'motivo', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('mes', nombre_mes(v_periodo), 'emitidas', v_ok, 'total', v_total, 'saltados', v_saltados);
end;
$fn$;

-- =============================================================================
-- 5. Liquidación al dueño
-- =============================================================================
-- Lo cobrado y no liquidado, por dueño (o de uno). Cada cuota: cobrado, comisión y neto.
create or replace function :"schema".alquiler_pendiente_duenos(p_propietario uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  return coalesce((select jsonb_agg(d order by d->>'propietario') from (
    select jsonb_build_object(
      'propietario_id', o.id, 'propietario', o.nombre, 'propietario_documento', o.documento,
      'cobrado', sum(x.cobrado), 'comision', sum(x.comision), 'neto', sum(x.cobrado - x.comision),
      'cuotas', jsonb_agg(jsonb_build_object('id', x.id, 'contrato', x.numero, 'propiedad', x.propiedad, 'mes', nombre_mes(x.periodo),
                                             'cobrado', x.cobrado, 'comision', x.comision, 'neto', x.cobrado - x.comision) order by x.periodo, x.numero)) d
      from (select q.id, q.periodo, a.numero, a.propietario_id, pd.nombre propiedad,
                   c.cobrado, round(c.cobrado * q.comision_pct / 100) comision
              from alquiler_cuotas q
              join alquiler_contratos a on a.id = q.contrato_id
              join propiedades pr on pr.id = a.propiedad_id
              join productos pd on pd.id = pr.producto_id
              join lateral (select sum(cc.cobrado) cobrado, bool_and(cc.estado in ('pagada', 'anulada')) pagada
                              from cuentas_por_cobrar cc where cc.venta_id = q.venta_id) c on true
             where q.empresa_id = s.s_empresa and a.propietario_id is not null and q.liquidacion_id is null
               and c.pagada and c.cobrado > 0
               and (p_propietario is null or a.propietario_id = p_propietario)) x
      join clientes o on o.id = x.propietario_id
     group by o.id, o.nombre, o.documento) t), '[]'::jsonb);
end;
$fn$;

-- p: propietario_id, cuotas[] (ids; vacío = todo lo pendiente), medio, referencia, caja_id?
-- Le paga al dueño lo cobrado menos la comisión: sale de la caja abierta como egreso.
create or replace function :"schema".alquiler_liquidar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_prop uuid := nullif(p->>'propietario_id', '')::uuid;
  v_medio text := coalesce(nullif(p->>'medio', ''), 'transferencia');
  v_ids uuid[];
  v_cobrado numeric;
  v_comision numeric;
  v_n integer;
  v_numero text;
  v_caja uuid;
  v_mov uuid;
  v_liq uuid;
  v_nombre text;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('pagar_proveedores');
  if v_medio not in ('efectivo', 'transferencia', 'cheque', 'otro') then raise exception 'Medio de pago inválido'; end if;
  select nombre into v_nombre from clientes where id = v_prop and empresa_id = s.s_empresa;
  if v_nombre is null then raise exception 'Elegí el dueño'; end if;

  select array_agg(q.id), sum(c.cobrado), sum(round(c.cobrado * q.comision_pct / 100))
    into v_ids, v_cobrado, v_comision
    from alquiler_cuotas q
    join alquiler_contratos a on a.id = q.contrato_id
    join lateral (select sum(cc.cobrado) cobrado, bool_and(cc.estado in ('pagada', 'anulada')) pagada
                    from cuentas_por_cobrar cc where cc.venta_id = q.venta_id) c on true
   where q.empresa_id = s.s_empresa and a.propietario_id = v_prop and q.liquidacion_id is null and c.pagada and c.cobrado > 0
     and (coalesce(jsonb_typeof(p->'cuotas'), '') <> 'array' or jsonb_array_length(p->'cuotas') = 0
          or q.id in (select (x #>> '{}')::uuid from jsonb_array_elements(p->'cuotas') x));
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Ese dueño no tiene alquileres cobrados sin liquidar'; end if;

  perform pg_advisory_xact_lock(hashtext('alquiler_liquidacion_' || s.s_empresa::text));
  select coalesce(max(substring(numero from '^LIQ-(\d+)$')::integer), 0) + 1 into v_n from alquiler_liquidaciones where empresa_id = s.s_empresa;
  v_numero := 'LIQ-' || lpad(v_n::text, 5, '0');

  v_caja := caja_abierta_para(null, null, nullif(p->>'caja_id', '')::uuid);
  if v_caja is null and v_medio = 'efectivo' then raise exception 'Para pagar en efectivo abrí la caja primero'; end if;
  if v_caja is not null then
    insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, referencia)
      values (s.s_empresa, v_caja, 'egreso', left('Liquidación ' || v_numero || ' · ' || v_nombre, 200), v_cobrado - v_comision,
              v_medio, 'liquidacion_alquiler', s.s_usuario, (now() at time zone 'America/Asuncion')::date, nullif(btrim(coalesce(p->>'referencia', '')), ''))
      returning id into v_mov;
  end if;

  insert into alquiler_liquidaciones (empresa_id, numero, propietario_id, cobrado, comision, neto, medio, referencia, caja_id, caja_movimiento_id, usuario_id)
    values (s.s_empresa, v_numero, v_prop, v_cobrado, v_comision, v_cobrado - v_comision, v_medio,
            nullif(btrim(coalesce(p->>'referencia', '')), ''), v_caja, v_mov, s.s_usuario)
    returning id into v_liq;
  update alquiler_cuotas set liquidacion_id = v_liq where id = any (v_ids);
  return jsonb_build_object('id', v_liq, 'numero', v_numero, 'propietario', v_nombre, 'cobrado', v_cobrado, 'comision', v_comision,
                            'neto', v_cobrado - v_comision, 'cuotas', cardinality(v_ids), 'desde_caja', v_caja is not null);
end;
$fn$;

create or replace function :"schema".alquiler_liquidaciones_lista(p_propietario uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'numero', l.numero, 'fecha', l.created_at, 'propietario', o.nombre,
                                                       'cobrado', l.cobrado, 'comision', l.comision, 'neto', l.neto, 'medio', l.medio,
                                                       'referencia', l.referencia,
                                                       'cuotas', (select count(*) from alquiler_cuotas q where q.liquidacion_id = l.id))
                                    order by l.created_at desc)
                     from alquiler_liquidaciones l join clientes o on o.id = l.propietario_id
                    where l.empresa_id = s.s_empresa and (p_propietario is null or l.propietario_id = p_propietario)), '[]'::jsonb);
end;
$fn$;

-- =============================================================================
-- 6. Permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  foreach f in array array['alquiler_monto_mes(alquiler_contratos,date)', 'alquiler_cuotas_json(uuid)', 'alquiler_json(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['alquileres_lista(jsonb)', 'alquiler_detalle(uuid)', 'alquiler_guardar(jsonb)', 'alquiler_estado(uuid,text,date)',
                           'alquiler_emitir(uuid,date)', 'alquileres_emitir_mes(date)', 'alquiler_pendiente_duenos(uuid)',
                           'alquiler_liquidar(jsonb)', 'alquiler_liquidaciones_lista(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

-- Pantallas: Alquileres para los que ven Propiedades (re-aplicación incluida).
create or replace function :"schema".rubro_dar_inmobiliaria(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(array['/inmobiliaria', '/inmobiliaria/alquileres']) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
end;
$fn$;
revoke all on function :"schema".rubro_dar_inmobiliaria(uuid) from public, anon, authenticated;

do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where inmobiliaria loop
    perform rubro_dar_inmobiliaria(r.empresa_id);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
