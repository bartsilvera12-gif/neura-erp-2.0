-- =============================================================================
-- Clientes Fase 3: saldo a favor (anticipos) y reporte de deudores.
--   · saldo_favor_movimientos  + anticipo (lo cobrado de más o sin deuda) / − uso
--                              (pagar deuda con ese saldo). Saldo = suma no anulada.
--   · registrar_cobro          el excedente queda a favor; acepta el medio
--                              'saldo_favor' (no entra a la caja: esa plata ya entró)
--   · anular_cobro             no deja anular un cobro cuyo saldo a favor ya se usó
--   · usar_saldo_favor(cliente) paga la deuda (lo más viejo primero) con el saldo
--   · reporte_deudores()       una fila por cliente que debe, con antigüedad
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create table if not exists :"schema".saldo_favor_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id),
  cobro_id uuid references :"schema".cobros_clientes(id) on delete set null,
  tipo text not null,
  monto numeric not null,
  observacion text,
  fecha timestamptz not null default now(),
  anulado_at timestamptz,
  constraint chk_sf_tipo check (tipo in ('anticipo', 'uso', 'ajuste'))
);
create index if not exists sf_cliente_idx on :"schema".saldo_favor_movimientos(cliente_id);
alter table :"schema".saldo_favor_movimientos enable row level security;
alter table :"schema".saldo_favor_movimientos force row level security;
drop policy if exists sf_propios on :"schema".saldo_favor_movimientos;
create policy sf_propios on :"schema".saldo_favor_movimientos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".saldo_favor_movimientos to authenticated, service_role;

alter table :"schema".cobros_pagos drop constraint if exists chk_cobro_metodo;
alter table :"schema".cobros_pagos add constraint chk_cobro_metodo
  check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro', 'saldo_favor'));

create or replace function :"schema".saldo_favor_cliente(p_cliente uuid)
returns numeric language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(sum(monto), 0) from saldo_favor_movimientos
   where cliente_id = p_cliente and empresa_id = empresa_actual() and anulado_at is null
$$;

create or replace function :"schema".registrar_cobro(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_cli record;
  v_total numeric := 0;
  v_deuda numeric;
  v_caja uuid;
  v_cobro uuid;
  v_numero text;
  v_restante numeric;
  v_aplicar numeric;
  v_usuario uuid;
  v_usuario_nombre text;
  pg jsonb;
  ap jsonb;
  cx record;
  v_hay_efectivo boolean := false;
  v_con_saldo numeric := 0;      -- parte pagada con saldo a favor (no entra a la caja)
  v_saldo_favor numeric;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select id, coalesce(nullif(btrim(razon_social), ''), nombre) as nombre into v_cli
    from clientes where id = (p->>'cliente_id')::uuid and empresa_id = v_empresa and deleted_at is null;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if jsonb_typeof(p->'pagos') <> 'array' or jsonb_array_length(p->'pagos') = 0 then
    raise exception 'Cargá cómo te pagó';
  end if;
  for pg in select * from jsonb_array_elements(p->'pagos') loop
    if coalesce((pg->>'monto')::numeric, 0) <= 0 then raise exception 'Hay un monto de pago en cero'; end if;
    if pg->>'metodo' not in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro', 'saldo_favor') then raise exception 'Medio de pago inválido'; end if;
    v_total := v_total + round((pg->>'monto')::numeric);
    if pg->>'metodo' = 'efectivo' then v_hay_efectivo := true; end if;
    if pg->>'metodo' = 'saldo_favor' then v_con_saldo := v_con_saldo + round((pg->>'monto')::numeric); end if;
  end loop;

  select coalesce(sum(saldo), 0) into v_deuda from cuentas_por_cobrar
   where cliente_id = v_cli.id and empresa_id = v_empresa and estado in ('pendiente', 'parcial');
  -- Lo que se paga de más (o sin deuda) queda como SALDO A FAVOR del cliente. Pero el
  -- saldo a favor solo sirve para pagar deuda: no puede generar más saldo.
  if v_con_saldo > 0 then
    v_saldo_favor := saldo_favor_cliente(v_cli.id);
    if v_con_saldo > v_saldo_favor then
      raise exception 'El cliente tiene Gs. % a favor, no alcanza', replace(to_char(v_saldo_favor, 'FM999,999,999,999'), ',', '.');
    end if;
    if v_total > v_deuda then raise exception 'Con saldo a favor solo se puede pagar hasta la deuda'; end if;
  end if;

  select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta' order by fecha_apertura desc limit 1;
  if v_hay_efectivo and v_caja is null then
    raise exception 'Para cobrar en efectivo abrí la caja primero (el efectivo entra a la caja)';
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;
  v_numero := 'REC-' || lpad(reservar_secuencia('recibo_cobro', coalesce((
                select max(substring(numero_recibo from '[0-9]+$')::bigint) from cobros_clientes where empresa_id = v_empresa), 0))::text, 6, '0');

  insert into cobros_clientes (empresa_id, numero_recibo, cliente_id, cliente_nombre, total, caja_id, observacion, created_by, usuario_nombre)
    values (v_empresa, v_numero, v_cli.id, v_cli.nombre, v_total, v_caja, nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre)
    returning id into v_cobro;

  for pg in select * from jsonb_array_elements(p->'pagos') loop
    insert into cobros_pagos (empresa_id, cobro_id, metodo, monto, referencia)
      values (v_empresa, v_cobro, pg->>'metodo', round((pg->>'monto')::numeric), nullif(btrim(pg->>'referencia'), ''));
    if pg->>'metodo' = 'saldo_favor' then
      insert into saldo_favor_movimientos (empresa_id, cliente_id, cobro_id, tipo, monto, observacion)
        values (v_empresa, v_cli.id, v_cobro, 'uso', -round((pg->>'monto')::numeric), 'Pago con saldo a favor ' || v_numero);
    elsif v_caja is not null then
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, cobro_id)
        values (v_empresa, v_caja, 'ingreso', left('Cobro ' || v_numero || ' · ' || v_cli.nombre, 200), round((pg->>'monto')::numeric),
                pg->>'metodo', 'cobro', v_usuario, (now() at time zone 'America/Asuncion')::date, v_cobro);
    end if;
  end loop;

  -- Aplicación: la elegida, o lo más viejo primero.
  v_restante := v_total;
  if jsonb_typeof(p->'aplicaciones') = 'array' and jsonb_array_length(p->'aplicaciones') > 0 then
    for ap in select * from jsonb_array_elements(p->'aplicaciones') loop
      select * into cx from cuentas_por_cobrar
       where id = (ap->>'cxc_id')::uuid and cliente_id = v_cli.id and empresa_id = v_empresa and estado in ('pendiente', 'parcial') for update;
      if not found then raise exception 'Una de las cuentas elegidas no es de este cliente o ya está pagada'; end if;
      v_aplicar := least(round((ap->>'monto')::numeric), cx.saldo, v_restante);
      if v_aplicar <= 0 then continue; end if;
      insert into cobros_aplicaciones (empresa_id, cobro_id, cxc_id, monto) values (v_empresa, v_cobro, cx.id, v_aplicar);
      update cuentas_por_cobrar set cobrado = cobrado + v_aplicar, estado = estado_cxc(monto, cobrado + v_aplicar, false), updated_at = now() where id = cx.id;
      v_restante := v_restante - v_aplicar;
    end loop;
  end if;
  for cx in select * from cuentas_por_cobrar
             where cliente_id = v_cli.id and empresa_id = v_empresa and estado in ('pendiente', 'parcial') and saldo > 0
             order by vencimiento, fecha_emision, numero for update loop
    exit when v_restante <= 0;
    v_aplicar := least(cx.saldo, v_restante);
    insert into cobros_aplicaciones (empresa_id, cobro_id, cxc_id, monto) values (v_empresa, v_cobro, cx.id, v_aplicar);
    update cuentas_por_cobrar set cobrado = cobrado + v_aplicar, estado = estado_cxc(monto, cobrado + v_aplicar, false), updated_at = now() where id = cx.id;
    v_restante := v_restante - v_aplicar;
  end loop;

  -- Excedente → saldo a favor (anticipo).
  if v_restante > 0 then
    insert into saldo_favor_movimientos (empresa_id, cliente_id, cobro_id, tipo, monto, observacion)
      values (v_empresa, v_cli.id, v_cobro, 'anticipo', v_restante, 'Anticipo / pago de más ' || v_numero);
  end if;
  return jsonb_build_object('id', v_cobro, 'numero_recibo', v_numero, 'total', v_total, 'a_favor', greatest(v_restante, 0));
end;
$fn$;

create or replace function :"schema".anular_cobro(p_id uuid, p_motivo text)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  c record;
  ap record;
  v_caja_estado text;
  v_usuario uuid;
  v_usuario_nombre text;
begin
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo'; end if;
  select * into c from cobros_clientes where id = p_id and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Cobro no encontrado'; end if;
  if c.anulado_at is not null then raise exception 'El cobro ya está anulado'; end if;
  if c.caja_id is not null then
    select estado into v_caja_estado from cajas where id = c.caja_id;
    if v_caja_estado <> 'abierta' and exists (select 1 from cobros_pagos where cobro_id = c.id and metodo = 'efectivo') then
      raise exception 'El cobro entró a una caja que ya se cerró: no se puede anular';
    end if;
  end if;
  -- Si este cobro dejó saldo a favor y ese saldo ya se usó, no se puede anular.
  if coalesce((select sum(monto) from saldo_favor_movimientos where cobro_id = c.id and tipo = 'anticipo' and anulado_at is null), 0)
     > saldo_favor_cliente(c.cliente_id) then
    raise exception 'Este cobro dejó saldo a favor y ya se usó: anulá primero el cobro que lo usó';
  end if;
  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = empresa_actual() limit 1;
  update saldo_favor_movimientos set anulado_at = now() where cobro_id = c.id and anulado_at is null;

  for ap in select * from cobros_aplicaciones where cobro_id = c.id loop
    update cuentas_por_cobrar set cobrado = greatest(cobrado - ap.monto, 0),
           estado = estado_cxc(monto, greatest(cobrado - ap.monto, 0), estado = 'anulada'), updated_at = now()
     where id = ap.cxc_id;
  end loop;
  update caja_movimientos set anulado_at = now(), anulado_por = v_usuario, anulado_motivo = left('Cobro anulado: ' || btrim(p_motivo), 200)
   where cobro_id = c.id and anulado_at is null;
  update cobros_clientes set anulado_at = now(), anulado_por = v_usuario_nombre, anulado_motivo = left(btrim(p_motivo), 500)
   where id = c.id;
  return jsonb_build_object('id', c.id, 'numero_recibo', c.numero_recibo);
end;
$fn$;

-- Pagar la deuda con el saldo a favor (lo más viejo primero).
create or replace function :"schema".usar_saldo_favor(p_cliente uuid)
returns jsonb
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_saldo numeric := saldo_favor_cliente(p_cliente);
  v_deuda numeric := cliente_saldo(p_cliente);
begin
  if v_saldo <= 0 then raise exception 'El cliente no tiene saldo a favor'; end if;
  if v_deuda <= 0 then raise exception 'El cliente no tiene deuda para pagar'; end if;
  return registrar_cobro(jsonb_build_object(
    'cliente_id', p_cliente,
    'pagos', jsonb_build_array(jsonb_build_object('metodo', 'saldo_favor', 'monto', least(v_saldo, v_deuda))),
    'observacion', 'Pagado con saldo a favor'));
end;
$fn$;

-- Estado de cuenta y ficha: con el saldo a favor.
create or replace function :"schema".resumen_cliente(p_cliente uuid)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'total_comprado', coalesce(f.total_comprado, 0), 'compras', coalesce(f.compras, 0),
    'ultima_compra', f.ultima_compra, 'deuda', coalesce(f.deuda, 0), 'vencido', coalesce(f.vencido, 0),
    'ticket_promedio', case when coalesce(f.compras, 0) > 0 then round(f.total_comprado / f.compras) else 0 end,
    'saldo_favor', saldo_favor_cliente(p_cliente))
    from (select 1) x left join cifras_clientes(p_cliente) f on true
$$;

-- Reporte de deudores: una fila por cliente que debe, lo más grave primero.
create or replace function :"schema".reporte_deudores(p_solo_vencidos boolean default false)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  cx as (
    select x.cliente_id, x.saldo, greatest((select d from hoy) - x.vencimiento, 0) as atraso
      from cuentas_por_cobrar x where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
  ),
  por_cliente as (
    select cliente_id, sum(saldo) as deuda,
           sum(saldo) filter (where atraso > 0) as vencido,
           sum(saldo) filter (where atraso = 0) as por_vencer,
           sum(saldo) filter (where atraso between 1 and 30) as d1_30,
           sum(saldo) filter (where atraso between 31 and 60) as d31_60,
           sum(saldo) filter (where atraso between 61 and 90) as d61_90,
           sum(saldo) filter (where atraso > 90) as d90,
           max(atraso) as max_atraso, count(*) as cuentas
      from cx group by cliente_id
  ),
  filas as (
    select c.id, c.nombre, c.razon_social, c.documento, c.telefono, c.ciudad, c.limite_credito,
           p.deuda, coalesce(p.vencido, 0) as vencido, coalesce(p.por_vencer, 0) as por_vencer,
           coalesce(p.d1_30, 0) as d1_30, coalesce(p.d31_60, 0) as d31_60, coalesce(p.d61_90, 0) as d61_90,
           coalesce(p.d90, 0) as d90, p.max_atraso, p.cuentas,
           (select max(k.fecha) from cobros_clientes k where k.cliente_id = c.id and k.anulado_at is null) as ultimo_cobro,
           (select k.total from cobros_clientes k where k.cliente_id = c.id and k.anulado_at is null order by k.fecha desc limit 1) as ultimo_cobro_monto,
           saldo_favor_cliente(c.id) as saldo_favor
      from por_cliente p join clientes c on c.id = p.cliente_id
     where not coalesce(p_solo_vencidos, false) or coalesce(p.vencido, 0) > 0
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.vencido desc, f.deuda desc, f.nombre) from filas f), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'clientes', count(*), 'deuda', coalesce(sum(deuda), 0), 'vencido', coalesce(sum(vencido), 0),
        'por_vencer', coalesce(sum(por_vencer), 0), 'd1_30', coalesce(sum(d1_30), 0), 'd31_60', coalesce(sum(d31_60), 0),
        'd61_90', coalesce(sum(d61_90), 0), 'd90', coalesce(sum(d90), 0)) from filas)
  )
$$;

grant execute on function :"schema".saldo_favor_cliente(uuid) to authenticated, service_role;
grant execute on function :"schema".registrar_cobro(jsonb) to authenticated, service_role;
grant execute on function :"schema".anular_cobro(uuid, text) to authenticated, service_role;
grant execute on function :"schema".usar_saldo_favor(uuid) to authenticated, service_role;
grant execute on function :"schema".resumen_cliente(uuid) to authenticated, service_role;
grant execute on function :"schema".reporte_deudores(boolean) to authenticated, service_role;

create or replace function :"schema".estado_cuenta_cliente(p_cliente uuid)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d)
  select jsonb_build_object(
    'cuentas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'venta_id', x.venta_id, 'numero', x.numero, 'fecha_emision', x.fecha_emision,
               'vencimiento', x.vencimiento, 'monto', x.monto, 'cobrado', x.cobrado, 'saldo', x.saldo, 'estado', x.estado,
               'dias_atraso', case when x.estado in ('pendiente', 'parcial') then greatest((select d from hoy) - x.vencimiento, 0) else 0 end
             ) order by x.vencimiento desc, x.numero desc)
        from cuentas_por_cobrar x where x.cliente_id = p_cliente and x.empresa_id = empresa_actual()), '[]'::jsonb),
    'cobros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'numero_recibo', k.numero_recibo, 'fecha', k.fecha, 'total', k.total, 'observacion', k.observacion,
               'usuario', k.usuario_nombre, 'anulado_at', k.anulado_at, 'anulado_motivo', k.anulado_motivo,
               'pagos', (select jsonb_agg(jsonb_build_object('metodo', p.metodo, 'monto', p.monto, 'referencia', p.referencia)) from cobros_pagos p where p.cobro_id = k.id),
               'aplicado_a', (select jsonb_agg(jsonb_build_object('numero', x.numero, 'monto', a.monto)) from cobros_aplicaciones a join cuentas_por_cobrar x on x.id = a.cxc_id where a.cobro_id = k.id)
             ) order by k.fecha desc)
        from cobros_clientes k where k.cliente_id = p_cliente and k.empresa_id = empresa_actual()), '[]'::jsonb),
    'saldo_favor', saldo_favor_cliente(p_cliente),
    'deuda', (select coalesce(sum(saldo), 0) from cuentas_por_cobrar where cliente_id = p_cliente and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial')),
    'vencido', (select coalesce(sum(saldo), 0) from cuentas_por_cobrar, hoy where cliente_id = p_cliente and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and vencimiento < hoy.d)
  )
$$;
