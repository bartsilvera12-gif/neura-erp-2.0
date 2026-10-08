-- =============================================================================
-- Clientes Fase 2: cuentas por cobrar y cobros.
--   · cuentas_por_cobrar   una por venta a CRÉDITO con cliente: monto, cobrado, saldo,
--                          vencimiento (fecha + plazo de la venta / del cliente / 30 días),
--                          estado pendiente | parcial | pagada | anulada. La mantiene un
--                          trigger sobre ventas (alta, total, anulación).
--   · cobros_clientes      el cobro (recibo REC-000001), con sus medios de pago y a qué
--     cobros_pagos         cuentas se aplicó. El efectivo (y los demás medios) entra a la
--     cobros_aplicaciones  CAJA ABIERTA como ingreso 'cobro' → el arqueo cuadra solo.
--   · registrar_cobro(p) / anular_cobro(id, motivo) / estado_cuenta_cliente(id)
--   · listar_cuentas_cobrar(...) pantalla "Cuentas a cobrar" con antigüedad de deuda
--   · cliente_saldo y cifras_clientes pasan a usar la cuenta corriente
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create table if not exists :"schema".cuentas_por_cobrar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  venta_id uuid not null references :"schema".ventas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id),
  numero text not null,
  fecha_emision date not null,
  vencimiento date not null,
  monto numeric not null default 0,
  cobrado numeric not null default 0,
  saldo numeric generated always as (greatest(monto - cobrado, 0)) stored,
  estado text not null default 'pendiente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_cxc_estado check (estado in ('pendiente', 'parcial', 'pagada', 'anulada')),
  constraint chk_cxc_cobrado check (cobrado >= 0)
);
create unique index if not exists uq_cxc_venta on :"schema".cuentas_por_cobrar(venta_id);
create index if not exists cxc_cliente_idx on :"schema".cuentas_por_cobrar(cliente_id, vencimiento);
create index if not exists cxc_empresa_estado_idx on :"schema".cuentas_por_cobrar(empresa_id, estado, vencimiento);

create table if not exists :"schema".cobros_clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero_recibo text not null,
  cliente_id uuid not null references :"schema".clientes(id),
  cliente_nombre text not null,
  fecha timestamptz not null default now(),
  total numeric not null check (total > 0),
  caja_id uuid references :"schema".cajas(id),
  observacion text,
  created_by uuid,
  usuario_nombre text,
  anulado_at timestamptz,
  anulado_por text,
  anulado_motivo text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_cobros_recibo on :"schema".cobros_clientes(empresa_id, numero_recibo);
create index if not exists cobros_cliente_idx on :"schema".cobros_clientes(cliente_id, fecha desc);

create table if not exists :"schema".cobros_pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cobro_id uuid not null references :"schema".cobros_clientes(id) on delete cascade,
  metodo text not null,
  monto numeric not null check (monto > 0),
  referencia text,
  constraint chk_cobro_metodo check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro'))
);
create index if not exists cobros_pagos_cobro_idx on :"schema".cobros_pagos(cobro_id);

create table if not exists :"schema".cobros_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cobro_id uuid not null references :"schema".cobros_clientes(id) on delete cascade,
  cxc_id uuid not null references :"schema".cuentas_por_cobrar(id),
  monto numeric not null check (monto > 0)
);
create index if not exists cobros_apl_cobro_idx on :"schema".cobros_aplicaciones(cobro_id);
create index if not exists cobros_apl_cxc_idx on :"schema".cobros_aplicaciones(cxc_id);

-- El movimiento de caja sabe de qué cobro viene.
alter table :"schema".caja_movimientos add column if not exists cobro_id uuid references :"schema".cobros_clientes(id) on delete set null;

-- --- RLS ---
alter table :"schema".cuentas_por_cobrar enable row level security;
alter table :"schema".cuentas_por_cobrar force row level security;
alter table :"schema".cobros_clientes enable row level security;
alter table :"schema".cobros_clientes force row level security;
alter table :"schema".cobros_pagos enable row level security;
alter table :"schema".cobros_pagos force row level security;
alter table :"schema".cobros_aplicaciones enable row level security;
alter table :"schema".cobros_aplicaciones force row level security;
drop policy if exists cxc_propias on :"schema".cuentas_por_cobrar;
create policy cxc_propias on :"schema".cuentas_por_cobrar to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists cobros_propios on :"schema".cobros_clientes;
create policy cobros_propios on :"schema".cobros_clientes to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists cobros_pagos_propios on :"schema".cobros_pagos;
create policy cobros_pagos_propios on :"schema".cobros_pagos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists cobros_apl_propias on :"schema".cobros_aplicaciones;
create policy cobros_apl_propias on :"schema".cobros_aplicaciones to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".cuentas_por_cobrar, :"schema".cobros_clientes,
  :"schema".cobros_pagos, :"schema".cobros_aplicaciones to authenticated, service_role;

-- Estado de una cuenta según lo cobrado.
create or replace function :"schema".estado_cxc(p_monto numeric, p_cobrado numeric, p_anulada boolean)
returns text language sql immutable as $$
  select case when p_anulada then 'anulada'
              when p_cobrado <= 0 then 'pendiente'
              when p_cobrado >= p_monto then 'pagada'
              else 'parcial' end
$$;

-- =============================================================================
-- Trigger: cada venta a CRÉDITO con cliente tiene su cuenta por cobrar.
-- Anular una venta que ya tiene cobros no se permite (primero se anulan los cobros).
-- =============================================================================
create or replace function :"schema".tg_ventas_cxc()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_plazo integer;
  v_cobrado numeric;
begin
  if new.tipo_venta <> 'CREDITO' or new.cliente_id is null then
    return null;
  end if;
  if new.estado = 'anulada' then
    select cobrado into v_cobrado from cuentas_por_cobrar where venta_id = new.id;
    if coalesce(v_cobrado, 0) > 0 then
      raise exception 'La venta % ya tiene cobros: anulá primero los recibos de ese cliente', new.numero_control;
    end if;
    update cuentas_por_cobrar set estado = 'anulada', updated_at = now() where venta_id = new.id;
    return null;
  end if;
  select coalesce(new.plazo_dias, c.plazo_dias, 30) into v_plazo from clientes c where c.id = new.cliente_id;
  insert into cuentas_por_cobrar (empresa_id, venta_id, cliente_id, numero, fecha_emision, vencimiento, monto)
    values (new.empresa_id, new.id, new.cliente_id, new.numero_control,
            (new.fecha at time zone 'America/Asuncion')::date,
            (new.fecha at time zone 'America/Asuncion')::date + coalesce(v_plazo, 30), new.total)
  on conflict (venta_id) do update
     set monto = excluded.monto, cliente_id = excluded.cliente_id, numero = excluded.numero,
         estado = estado_cxc(excluded.monto, cuentas_por_cobrar.cobrado, false), updated_at = now();
  return null;
end;
$fn$;

drop trigger if exists trg_ventas_cxc on :"schema".ventas;
create trigger trg_ventas_cxc after insert or update of total, estado, cliente_id, tipo_venta, plazo_dias
  on :"schema".ventas for each row execute function :"schema".tg_ventas_cxc();

-- Las ventas a crédito que ya existían.
insert into :"schema".cuentas_por_cobrar (empresa_id, venta_id, cliente_id, numero, fecha_emision, vencimiento, monto, estado)
select v.empresa_id, v.id, v.cliente_id, v.numero_control, (v.fecha at time zone 'America/Asuncion')::date,
       (v.fecha at time zone 'America/Asuncion')::date + coalesce(v.plazo_dias, c.plazo_dias, 30), v.total,
       case when v.estado = 'anulada' then 'anulada' else 'pendiente' end
  from :"schema".ventas v join :"schema".clientes c on c.id = v.cliente_id
 where v.tipo_venta = 'CREDITO'
on conflict (venta_id) do nothing;

-- =============================================================================
-- registrar_cobro(p jsonb)
--   { cliente_id, pagos: [{ metodo, monto, referencia? }], aplicaciones?: [{ cxc_id, monto }],
--     observacion? }  Sin aplicaciones: se paga lo más viejo primero (por vencimiento).
--   El total de los pagos no puede superar la deuda. Efectivo sin caja abierta: error.
-- → { id, numero_recibo, total }
-- =============================================================================
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
    if pg->>'metodo' not in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro') then raise exception 'Medio de pago inválido'; end if;
    v_total := v_total + round((pg->>'monto')::numeric);
    if pg->>'metodo' = 'efectivo' then v_hay_efectivo := true; end if;
  end loop;

  select coalesce(sum(saldo), 0) into v_deuda from cuentas_por_cobrar
   where cliente_id = v_cli.id and empresa_id = v_empresa and estado in ('pendiente', 'parcial');
  if v_deuda <= 0 then raise exception 'Este cliente no tiene deuda'; end if;
  if v_total > v_deuda then
    raise exception 'El cobro (Gs. %) es mayor que la deuda (Gs. %)',
      replace(to_char(v_total, 'FM999,999,999,999'), ',', '.'), replace(to_char(v_deuda, 'FM999,999,999,999'), ',', '.');
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
    if v_caja is not null then
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

  return jsonb_build_object('id', v_cobro, 'numero_recibo', v_numero, 'total', v_total);
end;
$fn$;

-- Anular un cobro: la deuda vuelve. Si entró a una caja que ya se cerró, no se anula
-- (el arqueo de esa caja ya está cerrado): se registra como un movimiento aparte.
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
  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = empresa_actual() limit 1;

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

-- Estado de cuenta: cuentas (con días de atraso) y cobros del cliente.
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
    'deuda', (select coalesce(sum(saldo), 0) from cuentas_por_cobrar where cliente_id = p_cliente and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial')),
    'vencido', (select coalesce(sum(saldo), 0) from cuentas_por_cobrar, hoy where cliente_id = p_cliente and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and vencimiento < hoy.d)
  )
$$;

-- Cuentas a cobrar de todos los clientes, con antigüedad de deuda.
create or replace function :"schema".listar_cuentas_cobrar(
  p_q text default null, p_filtro text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  par as (select tokens_busqueda(p_q) as tk),
  vivas as (
    select x.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, c.documento as cliente_documento,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           norm(c.nombre) || ' ' || norm(coalesce(c.razon_social, '')) || ' ' || compacto(c.documento) || ' ' || norm(x.numero) || ' ' || compacto(x.numero) as _t
      from cuentas_por_cobrar x join clientes c on c.id = x.cliente_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
  ),
  filtradas as (
    select v.* from vivas v, par, hoy
     where coincide_busqueda(v._t, par.tk)
       and (p_filtro is null
            or (p_filtro = 'vencidas' and v.vencimiento < hoy.d)
            or (p_filtro = 'por_vencer' and v.vencimiento >= hoy.d)
            or (p_filtro = 'semana' and v.vencimiento between hoy.d and hoy.d + 7))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_saldo', (select coalesce(sum(saldo), 0) from filtradas),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' order by f.vencimiento, f.numero)
                        from (select * from filtradas order by vencimiento, numero
                               limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb),
    'antiguedad', (select jsonb_build_object(
        'por_vencer', coalesce(sum(saldo) filter (where dias_atraso = 0), 0),
        'd1_30', coalesce(sum(saldo) filter (where dias_atraso between 1 and 30), 0),
        'd31_60', coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        'd61_90', coalesce(sum(saldo) filter (where dias_atraso between 61 and 90), 0),
        'd90', coalesce(sum(saldo) filter (where dias_atraso > 90), 0),
        'clientes', count(distinct cliente_id),
        'total', coalesce(sum(saldo), 0),
        'cobrado_mes', (select coalesce(sum(total), 0) from cobros_clientes, hoy
                         where empresa_id = empresa_actual() and anulado_at is null
                           and (fecha at time zone 'America/Asuncion')::date >= date_trunc('month', hoy.d)::date))
      from vivas)
  )
$$;

-- La deuda del cliente ahora sale de su cuenta corriente.
create or replace function :"schema".cliente_saldo(p_cliente_id uuid)
returns numeric language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(sum(saldo), 0) from cuentas_por_cobrar
   where cliente_id = p_cliente_id and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial')
$$;

create or replace function :"schema".cifras_clientes(p_cliente uuid default null)
returns table (cliente_id uuid, total_comprado numeric, compras bigint, ultima_compra timestamptz, deuda numeric, vencido numeric)
language sql stable security invoker set search_path = :"schema", public as $$
  with v as (
    select cliente_id, sum(total) as total_comprado, count(*) as compras, max(fecha) as ultima_compra
      from ventas where empresa_id = empresa_actual() and cliente_id is not null and estado <> 'anulada'
       and (p_cliente is null or cliente_id = p_cliente)
     group by cliente_id
  ),
  d as (
    select cliente_id, sum(saldo) as deuda,
           sum(saldo) filter (where vencimiento < (now() at time zone 'America/Asuncion')::date) as vencido
      from cuentas_por_cobrar where empresa_id = empresa_actual() and estado in ('pendiente', 'parcial')
       and (p_cliente is null or cliente_id = p_cliente)
     group by cliente_id
  )
  select coalesce(v.cliente_id, d.cliente_id), coalesce(v.total_comprado, 0), coalesce(v.compras, 0), v.ultima_compra,
         coalesce(d.deuda, 0), coalesce(d.vencido, 0)
    from v full join d on d.cliente_id = v.cliente_id
$$;

grant execute on function :"schema".estado_cxc(numeric, numeric, boolean) to authenticated, service_role;
grant execute on function :"schema".registrar_cobro(jsonb) to authenticated, service_role;
grant execute on function :"schema".anular_cobro(uuid, text) to authenticated, service_role;
grant execute on function :"schema".estado_cuenta_cliente(uuid) to authenticated, service_role;
grant execute on function :"schema".listar_cuentas_cobrar(text, text, integer, integer) to authenticated, service_role;
