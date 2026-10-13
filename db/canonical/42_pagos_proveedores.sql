-- =============================================================================
-- PAGOS A PROVEEDORES (cuentas a pagar) — espejo de las cuentas a cobrar (25_cobros):
--   · cuentas_por_pagar: nace sola de cada compra a CRÉDITO (trigger); si la compra se
--     anula, se anula la cuenta (bloqueado si ya tiene pagos)
--   · pagos_proveedores + pagos_proveedores_medios + pagos_proveedores_aplicaciones:
--     un pago (orden de pago OP-000001) con uno o varios medios, aplicado a las facturas
--     elegidas o a lo más viejo primero
--   · lo pagado en EFECTIVO sale de la caja abierta (caja_movimientos egreso)
--   · anular_pago_proveedor devuelve la deuda (no si salió efectivo de una caja cerrada)
--   · listar_cuentas_pagar: lista con antigüedad de deuda (por vencer / vencido por tramo)
--   · estado_cuenta_proveedor: facturas a crédito + pagos del proveedor
-- NOTA: 48_pagos_gastos redefine listar_cuentas_pagar y estado_cuenta_proveedor para incluir
-- las cuentas a pagar de los gastos a crédito (compra_id pasa a opcional, se suma gasto_id).
-- Moneda: cada cuenta en la moneda de su compra; el pago es en esa moneda.
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

create table if not exists :"schema".cuentas_por_pagar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  compra_id uuid not null references :"schema".compras(id) on delete cascade,
  proveedor_id uuid not null references :"schema".proveedores(id),
  numero text not null,                 -- número de la factura del proveedor
  fecha_emision date not null,
  vencimiento date not null,
  moneda text not null default 'GS' check (moneda in ('GS', 'USD')),
  monto numeric not null default 0,
  pagado numeric not null default 0 check (pagado >= 0),
  saldo numeric generated always as (greatest(monto - pagado, 0)) stored,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'parcial', 'pagada', 'anulada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_cxp_compra on :"schema".cuentas_por_pagar (compra_id);
create index if not exists cxp_proveedor_idx on :"schema".cuentas_por_pagar (proveedor_id, vencimiento);
create index if not exists cxp_empresa_estado_idx on :"schema".cuentas_por_pagar (empresa_id, estado, vencimiento);

create table if not exists :"schema".pagos_proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,                 -- OP-000001
  proveedor_id uuid not null references :"schema".proveedores(id),
  proveedor_nombre text not null,
  fecha timestamptz not null default now(),
  moneda text not null default 'GS' check (moneda in ('GS', 'USD')),
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
create unique index if not exists uq_pagos_prov_numero on :"schema".pagos_proveedores (empresa_id, numero);
create index if not exists pagos_prov_proveedor_idx on :"schema".pagos_proveedores (proveedor_id, fecha desc);
create index if not exists pagos_prov_empresa_idx on :"schema".pagos_proveedores (empresa_id, fecha desc);

create table if not exists :"schema".pagos_proveedores_medios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  pago_id uuid not null references :"schema".pagos_proveedores(id) on delete cascade,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  monto numeric not null check (monto > 0),
  referencia text                         -- nro de transferencia, de cheque, banco…
);
create index if not exists pagos_prov_medios_idx on :"schema".pagos_proveedores_medios (pago_id);

create table if not exists :"schema".pagos_proveedores_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  pago_id uuid not null references :"schema".pagos_proveedores(id) on delete cascade,
  cxp_id uuid not null references :"schema".cuentas_por_pagar(id),
  monto numeric not null check (monto > 0)
);
create index if not exists pagos_prov_apl_pago_idx on :"schema".pagos_proveedores_aplicaciones (pago_id);
create index if not exists pagos_prov_apl_cxp_idx on :"schema".pagos_proveedores_aplicaciones (cxp_id);

alter table :"schema".caja_movimientos add column if not exists pago_proveedor_id uuid references :"schema".pagos_proveedores(id) on delete set null;
create index if not exists caja_mov_pago_prov_idx on :"schema".caja_movimientos (pago_proveedor_id) where pago_proveedor_id is not null;

do $$
declare t text;
begin
  foreach t in array array['cuentas_por_pagar', 'pagos_proveedores', 'pagos_proveedores_medios', 'pagos_proveedores_aplicaciones'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())', t || '_propias', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;

-- ── La compra a crédito genera su cuenta a pagar ────────────────────────────
create or replace function :"schema".tg_compras_cxp()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare v_pagado numeric;
begin
  if new.tipo_pago <> 'credito' then return null; end if;
  if new.estado = 'anulada' then
    select pagado into v_pagado from cuentas_por_pagar where compra_id = new.id;
    if coalesce(v_pagado, 0) > 0 then
      raise exception 'La compra % ya tiene pagos al proveedor: anulá primero esos pagos', new.numero_control;
    end if;
    update cuentas_por_pagar set estado = 'anulada', updated_at = now() where compra_id = new.id;
    return null;
  end if;
  insert into cuentas_por_pagar (empresa_id, compra_id, proveedor_id, numero, fecha_emision, vencimiento, moneda, monto)
  values (new.empresa_id, new.id, new.proveedor_id, new.numero_factura,
          coalesce(new.fecha_factura, (new.fecha at time zone 'America/Asuncion')::date),
          coalesce(new.vencimiento, coalesce(new.fecha_factura, (new.fecha at time zone 'America/Asuncion')::date) + coalesce(new.plazo_dias, 30)),
          new.moneda,
          -- compras.total está siempre en Gs (registrar_compra convierte): la deuda en USD va en dólares.
          case when new.moneda = 'USD' then round(new.total / nullif(new.tipo_cambio, 0), 2) else new.total end)
  on conflict (compra_id) do update
     set monto = excluded.monto, proveedor_id = excluded.proveedor_id, numero = excluded.numero,
         vencimiento = excluded.vencimiento, moneda = excluded.moneda,
         estado = case when cuentas_por_pagar.pagado >= excluded.monto then 'pagada'
                       when cuentas_por_pagar.pagado > 0 then 'parcial' else 'pendiente' end,
         updated_at = now();
  return null;
end;
$fn$;
drop trigger if exists trg_compras_cxp on :"schema".compras;
create trigger trg_compras_cxp after insert or update of total, estado, tipo_pago, proveedor_id, vencimiento on :"schema".compras
  for each row execute function :"schema".tg_compras_cxp();

-- Compras a crédito que ya existían: su cuenta a pagar.
insert into :"schema".cuentas_por_pagar (empresa_id, compra_id, proveedor_id, numero, fecha_emision, vencimiento, moneda, monto)
select c.empresa_id, c.id, c.proveedor_id, c.numero_factura,
       coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date),
       coalesce(c.vencimiento, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) + coalesce(c.plazo_dias, 30)),
       c.moneda, case when c.moneda = 'USD' then round(c.total / nullif(c.tipo_cambio, 0), 2) else c.total end
  from :"schema".compras c
 where c.tipo_pago = 'credito' and c.estado <> 'anulada'
on conflict (compra_id) do nothing;

create or replace function :"schema".estado_cxp(p_monto numeric, p_pagado numeric, p_anulada boolean)
returns text language sql immutable as $$
  select case when p_anulada then 'anulada' when p_pagado >= p_monto then 'pagada' when p_pagado > 0 then 'parcial' else 'pendiente' end
$$;

-- ── Registrar un pago ────────────────────────────────────────────────────────
-- p = { proveedor_id, moneda?, medios: [{metodo, monto, referencia?}], aplicaciones?: [{cxp_id, monto}], observacion? }
create or replace function :"schema".registrar_pago_proveedor(p jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_empresa uuid := empresa_actual();
  v_prov record; v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_total numeric := 0; v_deuda numeric; v_caja uuid; v_pago uuid; v_numero text;
  v_restante numeric; v_aplicar numeric; v_usuario uuid; v_usuario_nombre text;
  md jsonb; ap jsonb; cx record; v_hay_efectivo boolean := false; v_efectivo numeric := 0; v_saldo_caja numeric;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre into v_prov
    from proveedores where id = (p->>'proveedor_id')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  if jsonb_typeof(p->'medios') <> 'array' or jsonb_array_length(p->'medios') = 0 then
    raise exception 'Cargá cómo le pagás';
  end if;
  for md in select * from jsonb_array_elements(p->'medios') loop
    if coalesce((md->>'monto')::numeric, 0) <= 0 then raise exception 'Hay un monto en cero'; end if;
    if md->>'metodo' not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then raise exception 'Medio de pago inválido'; end if;
    v_total := v_total + case when v_moneda = 'USD' then round((md->>'monto')::numeric, 2) else round((md->>'monto')::numeric) end;
    if md->>'metodo' = 'efectivo' then
      v_hay_efectivo := true;
      v_efectivo := v_efectivo + (md->>'monto')::numeric;
    end if;
  end loop;

  select coalesce(sum(saldo), 0) into v_deuda from cuentas_por_pagar
   where proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda and estado in ('pendiente', 'parcial');
  if v_deuda <= 0 then raise exception 'No le debés nada a este proveedor en %', v_moneda; end if;
  if v_total > v_deuda then
    raise exception 'El pago (% %) es mayor que la deuda (% %)', v_moneda,
      replace(to_char(v_total, 'FM999,999,999,999'), ',', '.'), v_moneda, replace(to_char(v_deuda, 'FM999,999,999,999'), ',', '.');
  end if;

  select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta' order by fecha_apertura desc limit 1;
  if v_hay_efectivo then
    if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
    if v_moneda <> 'GS' then raise exception 'El efectivo de la caja es en guaraníes: un pago en USD va por transferencia u otro medio'; end if;
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;
  v_numero := 'OP-' || lpad(reservar_secuencia('orden_pago', coalesce((
                select max(substring(numero from '[0-9]+$')::bigint) from pagos_proveedores where empresa_id = v_empresa), 0))::text, 6, '0');

  insert into pagos_proveedores (empresa_id, numero, proveedor_id, proveedor_nombre, moneda, total, caja_id, observacion, created_by, usuario_nombre)
  values (v_empresa, v_numero, v_prov.id, v_prov.nombre, v_moneda, v_total, case when v_hay_efectivo then v_caja end,
          nullif(btrim(p->>'observacion'), ''), auth.uid(), v_usuario_nombre)
  returning id into v_pago;

  for md in select * from jsonb_array_elements(p->'medios') loop
    insert into pagos_proveedores_medios (empresa_id, pago_id, metodo, monto, referencia)
    values (v_empresa, v_pago, md->>'metodo', (md->>'monto')::numeric, nullif(btrim(md->>'referencia'), ''));
    if md->>'metodo' = 'efectivo' then
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, pago_proveedor_id)
      values (v_empresa, v_caja, 'egreso', left('Pago ' || v_numero || ' · ' || v_prov.nombre, 200), round((md->>'monto')::numeric),
              'efectivo', 'pago_proveedor', v_usuario, (now() at time zone 'America/Asuncion')::date, v_pago);
    end if;
  end loop;

  -- Aplicación: las facturas elegidas, o lo que vence primero.
  v_restante := v_total;
  if jsonb_typeof(p->'aplicaciones') = 'array' and jsonb_array_length(p->'aplicaciones') > 0 then
    for ap in select * from jsonb_array_elements(p->'aplicaciones') loop
      select * into cx from cuentas_por_pagar
       where id = (ap->>'cxp_id')::uuid and proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda
         and estado in ('pendiente', 'parcial') for update;
      if not found then raise exception 'Una de las facturas elegidas no es de este proveedor o ya está pagada'; end if;
      v_aplicar := least((ap->>'monto')::numeric, cx.saldo, v_restante);
      if v_aplicar <= 0 then continue; end if;
      insert into pagos_proveedores_aplicaciones (empresa_id, pago_id, cxp_id, monto) values (v_empresa, v_pago, cx.id, v_aplicar);
      update cuentas_por_pagar set pagado = pagado + v_aplicar, estado = estado_cxp(monto, pagado + v_aplicar, false), updated_at = now() where id = cx.id;
      v_restante := v_restante - v_aplicar;
    end loop;
  end if;
  for cx in select * from cuentas_por_pagar
             where proveedor_id = v_prov.id and empresa_id = v_empresa and moneda = v_moneda
               and estado in ('pendiente', 'parcial') and saldo > 0
             order by vencimiento, fecha_emision, numero for update loop
    exit when v_restante <= 0;
    v_aplicar := least(cx.saldo, v_restante);
    insert into pagos_proveedores_aplicaciones (empresa_id, pago_id, cxp_id, monto) values (v_empresa, v_pago, cx.id, v_aplicar);
    update cuentas_por_pagar set pagado = pagado + v_aplicar, estado = estado_cxp(monto, pagado + v_aplicar, false), updated_at = now() where id = cx.id;
    v_restante := v_restante - v_aplicar;
  end loop;

  return jsonb_build_object('id', v_pago, 'numero', v_numero, 'total', v_total, 'moneda', v_moneda);
end;
$fn$;

-- ── Anular un pago ───────────────────────────────────────────────────────────
create or replace function :"schema".anular_pago_proveedor(p_id uuid, p_motivo text)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare pg record; ap record; v_caja_estado text; v_usuario uuid; v_usuario_nombre text;
begin
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo'; end if;
  select * into pg from pagos_proveedores where id = p_id and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if pg.anulado_at is not null then raise exception 'El pago ya está anulado'; end if;
  if pg.caja_id is not null then
    select estado into v_caja_estado from cajas where id = pg.caja_id;
    if v_caja_estado <> 'abierta' then raise exception 'El efectivo salió de una caja que ya se cerró: no se puede anular'; end if;
  end if;
  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = empresa_actual() limit 1;
  for ap in select * from pagos_proveedores_aplicaciones where pago_id = pg.id loop
    update cuentas_por_pagar set pagado = greatest(pagado - ap.monto, 0),
           estado = estado_cxp(monto, greatest(pagado - ap.monto, 0), estado = 'anulada'), updated_at = now()
     where id = ap.cxp_id;
  end loop;
  update caja_movimientos set anulado_at = now(), anulado_por = v_usuario, anulado_motivo = left('Pago anulado: ' || btrim(p_motivo), 200)
   where pago_proveedor_id = pg.id and anulado_at is null;
  update pagos_proveedores set anulado_at = now(), anulado_por = v_usuario_nombre, anulado_motivo = left(btrim(p_motivo), 500)
   where id = pg.id;
  return jsonb_build_object('id', pg.id, 'numero', pg.numero);
end;
$fn$;

-- ── Lista de cuentas a pagar con antigüedad ─────────────────────────────────
create or replace function :"schema".listar_cuentas_pagar(
  p_q text default null, p_filtro text default null, p_moneda text default 'GS', p_proveedor uuid default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
begin
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  par as (select tokens_busqueda(p_q) as tk),
  vivas as (
    select x.*, pr.nombre as proveedor_nombre, pr.ruc as proveedor_ruc, pr.telefono as proveedor_telefono,
           c.numero_control as compra_numero,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           x.vencimiento - (select d from hoy) as dias_para_vencer,
           concat_ws(' ', norm(pr.nombre), norm(pr.nombre_comercial), regexp_replace(lower(coalesce(pr.ruc, '')), '[^a-z0-9]', '', 'g'),
                     lower(x.numero), regexp_replace(lower(x.numero), '[^a-z0-9]', '', 'g'), lower(c.numero_control)) as _t
      from cuentas_por_pagar x
      join proveedores pr on pr.id = x.proveedor_id
      join compras c on c.id = x.compra_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and x.moneda = coalesce(p_moneda, 'GS')
       and (p_proveedor is null or x.proveedor_id = p_proveedor)
  ),
  filtradas as (
    select v.* from vivas v, par, hoy
     where (cardinality(par.tk) = 0 or coincide_busqueda(v._t, par.tk))
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
        'vence_semana', coalesce(sum(saldo) filter (where dias_atraso = 0 and dias_para_vencer <= 7), 0),
        'd1_30', coalesce(sum(saldo) filter (where dias_atraso between 1 and 30), 0),
        'd31_60', coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        'd61_90', coalesce(sum(saldo) filter (where dias_atraso between 61 and 90), 0),
        'd90', coalesce(sum(saldo) filter (where dias_atraso > 90), 0),
        'proveedores', count(distinct proveedor_id),
        'total', coalesce(sum(saldo), 0),
        'pagado_mes', (select coalesce(sum(total), 0) from pagos_proveedores, hoy
                        where empresa_id = empresa_actual() and anulado_at is null and moneda = coalesce(p_moneda, 'GS')
                          and fecha >= (date_trunc('month', hoy.d)::timestamp at time zone 'America/Asuncion')))
      from vivas)
  ));
end;
$$;

-- ── Estado de cuenta de un proveedor ────────────────────────────────────────
create or replace function :"schema".estado_cuenta_proveedor(p_proveedor uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d)
  select jsonb_build_object(
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'compra_id', x.compra_id, 'compra_numero', c.numero_control, 'numero', x.numero,
        'fecha_emision', x.fecha_emision, 'vencimiento', x.vencimiento, 'moneda', x.moneda,
        'monto', x.monto, 'pagado', x.pagado, 'saldo', x.saldo, 'estado', x.estado,
        'dias_atraso', case when x.estado in ('pendiente', 'parcial') then greatest((select d from hoy) - x.vencimiento, 0) else 0 end
      ) order by x.vencimiento desc, x.numero desc)
      from cuentas_por_pagar x join compras c on c.id = x.compra_id
     where x.proveedor_id = p_proveedor and x.empresa_id = empresa_actual()), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'numero', k.numero, 'fecha', k.fecha, 'moneda', k.moneda, 'total', k.total, 'observacion', k.observacion,
        'usuario', k.usuario_nombre, 'anulado_at', k.anulado_at, 'anulado_motivo', k.anulado_motivo,
        'medios', (select jsonb_agg(jsonb_build_object('metodo', m.metodo, 'monto', m.monto, 'referencia', m.referencia)) from pagos_proveedores_medios m where m.pago_id = k.id),
        'aplicado_a', (select jsonb_agg(jsonb_build_object('numero', x.numero, 'monto', a.monto))
                         from pagos_proveedores_aplicaciones a join cuentas_por_pagar x on x.id = a.cxp_id where a.pago_id = k.id)
      ) order by k.fecha desc)
      from pagos_proveedores k where k.proveedor_id = p_proveedor and k.empresa_id = empresa_actual()), '[]'::jsonb),
    'deuda_gs', (select coalesce(sum(saldo), 0) from cuentas_por_pagar where proveedor_id = p_proveedor and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and moneda = 'GS'),
    'deuda_usd', (select coalesce(sum(saldo), 0) from cuentas_por_pagar where proveedor_id = p_proveedor and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and moneda = 'USD'),
    'vencido_gs', (select coalesce(sum(saldo), 0) from cuentas_por_pagar, hoy where proveedor_id = p_proveedor and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and moneda = 'GS' and vencimiento < hoy.d)
  )
$$;

grant execute on function :"schema".estado_cxp(numeric, numeric, boolean), :"schema".registrar_pago_proveedor(jsonb),
  :"schema".anular_pago_proveedor(uuid, text), :"schema".listar_cuentas_pagar(text, text, text, uuid, integer, integer),
  :"schema".estado_cuenta_proveedor(uuid) to authenticated, service_role;
