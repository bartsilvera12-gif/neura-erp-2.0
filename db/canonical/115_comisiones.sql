-- =============================================================================
-- COMISIONES (traído de sistemas-propio, pedido del dueño, 2-nov-2026).
--
--   · Una política por empresa: base de cálculo (pago registrado, factura emitida o factura pagada) y
--     escalas por monto (desde, hasta, % y premio fijo). Cada guardado deja una versión.
--   · La comisión no se liquida ni se guarda: se calcula al consultar el mes. La cuenta está en
--     src/modules/comisiones/calculo.ts; acá salen los datos.
--   · Vendedor de un movimiento: el de la venta y, si no tiene, el del cliente.
--   · Comisiona, en este orden: excluir/incluir manual del pago en ese mes → marca de la venta → regla
--     automática (venta sin suscripción de un cliente sin ventas válidas anteriores).
--   · Quien no es Administrador recibe solo lo suyo: el filtro va acá, no en la pantalla.
--
--   Equivalencias con sistemas-propio: factura = venta; pago = forma de pago de una venta o cobro
--   aplicado a su cuenta. Las ventas sin cliente no comisionan (no hay a quién atribuirlas).
--   Recurrencia nueva: clientes dados de alta en el mes con suscripción vigente (el 2.0 no clasifica
--   clientes en SaaS/Mixto). No suma a la base ni paga comisión.
--
-- IDEMPOTENTE. Va después de 114.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table :"schema".ventas
  add column if not exists comisionable boolean,
  add column if not exists vendedor_usuario_id uuid references :"schema".usuarios(id) on delete set null;
create index if not exists ventas_vendedor_comision_idx on :"schema".ventas (empresa_id, vendedor_usuario_id) where vendedor_usuario_id is not null;
create index if not exists ventas_cliente_fecha_idx on :"schema".ventas (empresa_id, cliente_id, fecha) where cliente_id is not null;

create table if not exists :"schema".comision_politicas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references :"schema".empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) > 0),
  activo boolean not null default true,
  base_calculo text not null default 'pago_registrado' check (base_calculo in ('pago_registrado', 'factura_emitida', 'factura_pagada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);

create table if not exists :"schema".comision_politica_versiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  politica_id uuid not null references :"schema".comision_politicas(id) on delete cascade,
  version_no integer not null,
  nombre text not null,
  activo boolean not null,
  base_calculo text not null,
  escalas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references :"schema".usuarios(id) on delete set null,
  unique (politica_id, version_no)
);

create table if not exists :"schema".comision_escalas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  politica_id uuid not null references :"schema".comision_politicas(id) on delete cascade,
  orden integer not null default 0,
  desde_monto numeric(18, 2) not null check (desde_monto >= 0),
  hasta_monto numeric(18, 2),
  porcentaje_comision numeric(9, 4) not null check (porcentaje_comision between 0 and 100),
  premio_fijo numeric(18, 2)
);
create index if not exists comision_escalas_politica_idx on :"schema".comision_escalas (politica_id, orden);

create table if not exists :"schema".comision_overrides (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  periodo_ym text not null check (periodo_ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  pago_id uuid not null,
  venta_id uuid,
  decision text not null check (decision in ('incluir', 'excluir')),
  motivo text not null check (length(btrim(motivo)) > 0),
  decidido_por uuid references :"schema".usuarios(id) on delete set null,
  decidido_por_nombre text,
  decidido_at timestamptz not null default now(),
  unique (empresa_id, periodo_ym, pago_id)
);

-- Solo por funciones: ni lectura ni escritura directa.
do $do$
declare
  t text;
begin
  foreach t in array array['comision_politicas', 'comision_politica_versiones', 'comision_escalas', 'comision_overrides'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
  end loop;
end;
$do$;

-- Una fila por venta válida con cliente, con todo lo que el cálculo mira. Montos en guaraníes.
create or replace function :"schema".comision_ventas_base(p_empresa uuid)
returns table (id uuid, cliente_id uuid, cliente text, alta date, numero text, fecha date, factor numeric, monto numeric, neto numeric,
               saldo numeric, tiene_suscripcion boolean, comisionable boolean, vendedor uuid, recurrente boolean, monto_suscripcion numeric, cxc_id uuid)
language sql stable security definer set search_path = :"schema", public as $fn$
  select v.id, v.cliente_id, c.nombre, (c.creado_at at time zone 'America/Asuncion')::date,
         coalesce(v.fiscal_numero, v.numero_control), (v.fecha at time zone 'America/Asuncion')::date,
         x.factor, v.total * x.factor,
         greatest(v.total - coalesce((select sum(n.total) from notas_credito n where n.venta_id = v.id and n.estado <> 'anulada'), 0), 0) * x.factor,
         coalesce((select sum(q.saldo) from cuentas_por_cobrar q where q.venta_id = v.id), 0) * x.factor,
         v.suscripcion_id is not null, v.comisionable, coalesce(v.vendedor_usuario_id, c.vendedor_usuario_id),
         exists (select 1 from ventas o
                  where o.empresa_id = p_empresa and o.cliente_id = v.cliente_id and o.estado <> 'anulada' and o.id <> v.id
                    and (o.fecha at time zone 'America/Asuncion')::date < (v.fecha at time zone 'America/Asuncion')::date),
         (select nullif(sum(s.precio), 0) from suscripciones s where s.cliente_id = v.cliente_id and s.empresa_id = p_empresa and s.estado <> 'cancelada'),
         (select q.id from cuentas_por_cobrar q where q.venta_id = v.id and q.saldo > 0 order by q.vencimiento, q.created_at limit 1)
    from ventas v
    join clientes c on c.id = v.cliente_id
   cross join lateral (select case when v.moneda = 'USD' then coalesce(nullif(v.tipo_cambio, 0), 1) else 1 end as factor) x
   where v.empresa_id = p_empresa and v.estado <> 'anulada' and v.cliente_id is not null
$fn$;
revoke all on function :"schema".comision_ventas_base(uuid) from public, anon, authenticated;

create or replace function :"schema".comisiones_datos(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pol comision_politicas;
  v_admin boolean;
  v_lineas jsonb;
  v_a_cobrar jsonb;
  v_recurrencia jsonb;
begin
  select * into s from inv_sesion(null);
  v_admin := s.s_rol = 'ADMIN';
  select * into pol from comision_politicas where empresa_id = s.s_empresa;
  if not found or not pol.activo then
    return jsonb_build_object('estado', case when pol.id is null then 'sin_politica' else 'politica_inactiva' end, 'es_admin', v_admin, 'usuario_id', s.s_usuario);
  end if;

  with b as materialized (select * from comision_ventas_base(s.s_empresa)),
  pagos as (
    select d.id as pago_id, d.venta_id, (d.fecha_pago at time zone 'America/Asuncion')::date as fecha, d.monto
      from ventas_pagos_detalle d where d.empresa_id = s.s_empresa
    union all
    select a.id, x.venta_id, (c.fecha at time zone 'America/Asuncion')::date, a.monto
      from cobros_aplicaciones a
      join cobros_clientes c on c.id = a.cobro_id and c.anulado_at is null
      join cuentas_por_cobrar x on x.id = a.cxc_id
     where a.empresa_id = s.s_empresa
  ),
  cobrado as (
    select p.venta_id, sum(p.monto) as total, max(p.fecha) as ultima,
           coalesce(sum(p.monto) filter (where p.fecha between p_desde and p_hasta), 0) as del_periodo
      from pagos p where p.fecha <= p_hasta group by 1
  ),
  filas as (
    -- Cada pago del período.
    select 'pago' as tipo, b.*, p.pago_id, p.fecha as fecha_linea, p.monto * b.factor as monto_base, p.monto * b.factor as cobrado_periodo,
           b.saldo as pendiente, false as forzar
      from pagos p join b on b.id = p.venta_id
     where pol.base_calculo = 'pago_registrado' and p.fecha between p_desde and p_hasta
    union all
    -- Ventas emitidas en el período.
    select 'factura_emitida', b.*, null, b.fecha, b.neto, coalesce(co.del_periodo, 0) * b.factor, 0, true
      from b left join cobrado co on co.venta_id = b.id
     where pol.base_calculo = 'factura_emitida' and b.fecha between p_desde and p_hasta and b.neto > 0
    union all
    -- Ventas que terminaron de cobrarse en el período.
    select 'factura_pagada', b.*, null, co.ultima, b.neto, co.del_periodo * b.factor, 0, true
      from b join cobrado co on co.venta_id = b.id
     where pol.base_calculo = 'factura_pagada' and co.ultima between p_desde and p_hasta and b.saldo <= 0.02 and b.neto > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', f.tipo, 'cliente_id', f.cliente_id, 'cliente_label', f.cliente, 'factura_id', f.id, 'numero_factura', f.numero,
           'pago_id', f.pago_id, 'fecha', f.fecha_linea, 'monto_base', round(f.monto_base, 2), 'cobrado_periodo', round(f.cobrado_periodo, 2),
           'saldo_pendiente', round(f.saldo, 2), 'pendiente_por_comisionar', round(f.pendiente, 2), 'comisionable', f.comisionable,
           'tiene_suscripcion', f.tiene_suscripcion, 'recurrente', f.recurrente, 'forzar', f.forzar, 'cliente_alta', f.alta,
           'factura_monto_total', round(f.monto, 2), 'vendedor_usuario_id', f.vendedor, 'monto_suscripcion', f.monto_suscripcion
         ) order by f.fecha_linea, f.numero), '[]'::jsonb)
    into v_lineas
    from filas f
   where v_admin or f.vendedor = s.s_usuario;

  -- Lo que le falta cobrar a cada vendedor, sea del mes que sea.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', b.cliente_id, 'cliente_label', b.cliente, 'factura_id', b.id, 'numero_factura', b.numero, 'cxc_id', b.cxc_id,
           'fecha', b.fecha, 'monto_total', round(b.monto, 2), 'saldo_pendiente', round(b.saldo, 2), 'vendedor_usuario_id', b.vendedor,
           'comisionable', b.comisionable, 'tiene_suscripcion', b.tiene_suscripcion, 'recurrente', b.recurrente, 'monto_suscripcion', b.monto_suscripcion
         ) order by b.saldo desc, b.cliente), '[]'::jsonb)
    into v_a_cobrar
    from comision_ventas_base(s.s_empresa) b
   where b.saldo > 0.02 and b.vendedor is not null and (v_admin or b.vendedor = s.s_usuario);

  select coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', c.id, 'cliente', c.nombre, 'fecha', (c.creado_at at time zone 'America/Asuncion')::date, 'vendedor_usuario_id', c.vendedor_usuario_id,
           'monto', x.monto, 'plan', x.plan
         ) order by c.creado_at desc), '[]'::jsonb)
    into v_recurrencia
    from clientes c
    join lateral (
      select sum(su.precio) as monto, string_agg(su.plan_nombre, ' + ') as plan
        from suscripciones su where su.cliente_id = c.id and su.empresa_id = s.s_empresa and su.estado <> 'cancelada'
    ) x on x.monto > 0
   where c.empresa_id = s.s_empresa and c.deleted_at is null
     and (c.creado_at at time zone 'America/Asuncion')::date between p_desde and p_hasta
     and (v_admin or c.vendedor_usuario_id = s.s_usuario);

  return jsonb_build_object(
    'estado', 'ok', 'es_admin', v_admin, 'usuario_id', s.s_usuario,
    'politica', jsonb_build_object('id', pol.id, 'nombre', pol.nombre, 'base_calculo', pol.base_calculo),
    'escalas', coalesce((select jsonb_agg(jsonb_build_object('orden', e.orden, 'desde_monto', e.desde_monto, 'hasta_monto', e.hasta_monto,
                                                             'porcentaje_comision', e.porcentaje_comision, 'premio_fijo', e.premio_fijo) order by e.orden, e.desde_monto)
                           from comision_escalas e where e.politica_id = pol.id), '[]'::jsonb),
    'overrides', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('pago_id', o.pago_id, 'decision', o.decision, 'motivo', o.motivo,
                                                                                      'decidido_por', o.decidido_por_nombre, 'decidido_at', o.decidido_at))
                           from comision_overrides o where o.empresa_id = s.s_empresa and o.periodo_ym = to_char(p_desde, 'YYYY-MM')), '[]'::jsonb)
                  else coalesce((select jsonb_agg(jsonb_build_object('pago_id', o.pago_id, 'decision', o.decision))
                           from comision_overrides o where o.empresa_id = s.s_empresa and o.periodo_ym = to_char(p_desde, 'YYYY-MM')), '[]'::jsonb) end,
    'lineas', v_lineas, 'a_cobrar', v_a_cobrar, 'recurrencia', v_recurrencia,
    'nombres', coalesce((select jsonb_object_agg(u.id, u.nombre) from usuarios u where u.empresa_id = s.s_empresa), '{}'::jsonb));
end;
$fn$;

create or replace function :"schema".comision_politica_leer()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pol comision_politicas;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select * into pol from comision_politicas where empresa_id = s.s_empresa;
  return jsonb_build_object(
    'politica', case when pol.id is null then null else jsonb_build_object('id', pol.id, 'nombre', pol.nombre, 'activo', pol.activo, 'base_calculo', pol.base_calculo, 'updated_at', pol.updated_at) end,
    'escalas', coalesce((select jsonb_agg(jsonb_build_object('desde_monto', e.desde_monto, 'hasta_monto', e.hasta_monto,
                                                             'porcentaje_comision', e.porcentaje_comision, 'premio_fijo', e.premio_fijo) order by e.orden, e.desde_monto)
                           from comision_escalas e where e.politica_id = pol.id), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".comision_guardar_politica(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid;
  v_nombre text := btrim(coalesce(p->>'nombre', ''));
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
  v_base text := p->>'base_calculo';
  v_escalas jsonb := coalesce(p->'escalas', '[]'::jsonb);
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_nombre = '' then raise exception 'Poné un nombre a la política'; end if;
  if v_base is null or v_base not in ('pago_registrado', 'factura_emitida', 'factura_pagada') then raise exception 'Elegí la base de cálculo'; end if;
  if exists (select 1 from jsonb_array_elements(v_escalas) e
              where coalesce((e->>'desde_monto')::numeric, -1) < 0
                 or coalesce((e->>'porcentaje_comision')::numeric, -1) not between 0 and 100
                 or (e->>'hasta_monto')::numeric <= (e->>'desde_monto')::numeric) then
    raise exception 'Revisá las escalas: el porcentaje va de 0 a 100 y «Hasta» tiene que ser mayor que «Desde»';
  end if;

  insert into comision_politicas (empresa_id, nombre, activo, base_calculo, updated_by)
  values (s.s_empresa, v_nombre, v_activo, v_base, s.s_usuario)
  on conflict (empresa_id) do update
    set nombre = excluded.nombre, activo = excluded.activo, base_calculo = excluded.base_calculo, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;

  delete from comision_escalas where politica_id = v_id;
  insert into comision_escalas (empresa_id, politica_id, orden, desde_monto, hasta_monto, porcentaje_comision, premio_fijo)
  select s.s_empresa, v_id, (e.n - 1)::int, (e.v->>'desde_monto')::numeric, (e.v->>'hasta_monto')::numeric, (e.v->>'porcentaje_comision')::numeric, (e.v->>'premio_fijo')::numeric
    from jsonb_array_elements(v_escalas) with ordinality as e(v, n);

  insert into comision_politica_versiones (empresa_id, politica_id, version_no, nombre, activo, base_calculo, escalas, created_by)
  select s.s_empresa, v_id, coalesce(max(version_no), 0) + 1, v_nombre, v_activo, v_base, v_escalas, s.s_usuario
    from comision_politica_versiones where politica_id = v_id;

  return comision_politica_leer();
end;
$fn$;

create or replace function :"schema".comision_override_guardar(p_periodo text, p_pago uuid, p_venta uuid, p_decision text, p_motivo text)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if p_decision not in ('incluir', 'excluir') then raise exception 'Decisión inválida'; end if;
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  if p_venta is not null and not exists (select 1 from ventas where id = p_venta and empresa_id = s.s_empresa) then
    raise exception 'Venta no encontrada';
  end if;
  insert into comision_overrides (empresa_id, periodo_ym, pago_id, venta_id, decision, motivo, decidido_por, decidido_por_nombre)
  values (s.s_empresa, p_periodo, p_pago, p_venta, p_decision, btrim(p_motivo), s.s_usuario, s.s_nombre)
  on conflict (empresa_id, periodo_ym, pago_id) do update
    set venta_id = excluded.venta_id, decision = excluded.decision, motivo = excluded.motivo, decidido_por = excluded.decidido_por,
        decidido_por_nombre = excluded.decidido_por_nombre, decidido_at = now();
end;
$fn$;

create or replace function :"schema".comision_override_quitar(p_periodo text, p_pago uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  delete from comision_overrides where empresa_id = s.s_empresa and periodo_ym = p_periodo and pago_id = p_pago;
end;
$fn$;

-- Lo marca "Factura al contado": si comisiona y qué vendedor se la lleva.
create or replace function :"schema".venta_marcar_comision(p_venta uuid, p_comisionable boolean, p_vendedor uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN', 'VENDEDOR', 'CAJERO', 'SUPERVISOR']);
  if p_comisionable and p_vendedor is null then raise exception 'Elegí el vendedor que se lleva la comisión'; end if;
  if p_vendedor is not null and not exists (select 1 from usuarios where id = p_vendedor and empresa_id = s.s_empresa and activo) then
    raise exception 'Vendedor no encontrado';
  end if;
  update ventas set comisionable = p_comisionable, vendedor_usuario_id = case when p_comisionable then p_vendedor end, updated_at = now()
   where id = p_venta and empresa_id = s.s_empresa;
  if not found then raise exception 'Venta no encontrada'; end if;
end;
$fn$;

do $do$
declare
  f text;
begin
  foreach f in array array['comisiones_datos(date,date)', 'comision_politica_leer()', 'comision_guardar_politica(jsonb)',
    'comision_override_guardar(text,uuid,uuid,text,text)', 'comision_override_quitar(text,uuid)', 'venta_marcar_comision(uuid,boolean,uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;

-- Pantalla Comisiones: Vendedor y Supervisor ven la suya. Las empresas nuevas ya nacen así.
do $do$
declare
  v_def text;
  v_nuevo text := $b$when 'SUPERVISOR' then v_comun || v_inventario || array['/reportes', '/comisiones']$b$;
begin
  v_def := pg_get_functiondef('perfiles_sistema_asegurar(uuid)'::regprocedure);
  if position(v_nuevo in v_def) = 0 then
    if position($a$when 'SUPERVISOR' then v_comun || v_inventario || array['/reportes']$a$ in v_def) = 0
       or position($a$else v_comun || v_inventario end$a$ in v_def) = 0 then
      raise exception 'Receta 115: perfiles_sistema_asegurar no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, $a$when 'SUPERVISOR' then v_comun || v_inventario || array['/reportes']$a$, v_nuevo);
    v_def := replace(v_def, $a$else v_comun || v_inventario end$a$, $b$when 'VENDEDOR' then v_comun || v_inventario || array['/comisiones'] else v_comun || v_inventario end$b$);
    execute v_def;
  end if;
end;
$do$;

insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
select pf.id, pf.empresa_id, '/comisiones' from perfiles pf where pf.codigo in ('VENDEDOR', 'SUPERVISOR')
on conflict do nothing;

commit;

notify pgrst, 'reload schema';
