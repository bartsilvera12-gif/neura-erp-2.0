-- =============================================================================
-- CUOTAS LARGAS, ENTREGA INICIAL Y PLANES DE CUOTAS (rubro Inmobiliaria, fase 2 — 4-nov-2026).
-- Sirve para cualquier rubro (un lote en 120 cuotas, una moto en 24).
--
--   · Tope de cuotas por empresa: facturacion_config.max_cuotas (120 por defecto, hasta 360). La venta
--     (crear_venta) deja de cortar en 60 y usa ese tope. La columna ventas.cuotas acepta hasta 360.
--   · Entrega inicial: ventas.entrega. Las cuotas se arman sobre (total − entrega) y la entrega es la
--     "cuota 0" de la venta (cuentas_por_cobrar.cuota = 0), que vence el mismo día. Así la entrega se
--     cobra con un recibo como cualquier cuota y queda en el estado de cuenta.
--   · Planes de cuotas (planes_cuota): nombre, cuántas cuotas, cada cuánto, a cuántos días la primera
--     y la entrega mínima (% del total). Se eligen al vender; los arma el Administrador.
--   · vender_en_cuotas(p): crea la venta a crédito, pone la entrega y la COBRA en el mismo paso
--     (todo o nada). propiedad_vender(p): vende una propiedad (contado o en cuotas) y la marca
--     vendida; si la venta se anula, vuelve a disponible.
--
-- IDEMPOTENTE. Va después de 130.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Columnas y tope
-- =============================================================================
alter table :"schema".ventas add column if not exists entrega numeric(18,2) not null default 0;
alter table :"schema".ventas drop constraint if exists chk_ventas_entrega;
alter table :"schema".ventas add constraint chk_ventas_entrega check (entrega >= 0);
alter table :"schema".ventas drop constraint if exists chk_ventas_cuotas;
alter table :"schema".ventas add constraint chk_ventas_cuotas check (cuotas between 1 and 360);
comment on column :"schema".ventas.entrega is 'Crédito: entrega inicial. Es la cuota 0 de la venta (vence el día de la venta); las cuotas se arman sobre total − entrega. Receta 131.';

alter table :"schema".facturacion_config add column if not exists max_cuotas smallint not null default 120;
alter table :"schema".facturacion_config drop constraint if exists chk_fact_max_cuotas;
alter table :"schema".facturacion_config add constraint chk_fact_max_cuotas check (max_cuotas between 1 and 360);

create or replace function :"schema".max_cuotas_empresa(p_empresa uuid)
returns integer language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((select max_cuotas from facturacion_config where empresa_id = p_empresa), 120)
$$;

-- crear_venta: el tope deja de ser 60.
do $do$
declare
  v_def text := pg_get_functiondef('crear_venta(uuid,text,text,text,text,jsonb,jsonb,text,numeric,integer,uuid,uuid,text,boolean,integer,text)'::regprocedure);
  v_viejo text := $a$if coalesce(p_cuotas, 1) < 1 or coalesce(p_cuotas, 1) > 60 then
      raise exception 'Las cuotas van de 1 a 60';$a$;
begin
  if position('-- 131: tope de cuotas' in v_def) = 0 then
    if position(v_viejo in v_def) = 0 then raise exception 'Receta 131: crear_venta no tiene el patrón esperado'; end if;
    execute replace(v_def, v_viejo,
      $b$if coalesce(p_cuotas, 1) < 1 or coalesce(p_cuotas, 1) > max_cuotas_empresa(v_empresa) then -- 131: tope de cuotas
      raise exception 'Las cuotas van de 1 a %', max_cuotas_empresa(v_empresa);$b$);
  end if;
end;
$do$;

-- =============================================================================
-- 2. Cuotas de la venta (con entrega)
-- =============================================================================
create or replace function :"schema".tg_ventas_cxc()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare
  v_plazo integer;
  v_cobrado numeric;
  v_filas integer;
  v_n integer := greatest(coalesce(new.cuotas, 1), 1);
  v_fecha date := (new.fecha at time zone 'America/Asuncion')::date;
  v_primera date;
  v_dec integer := case when coalesce(new.moneda, 'GS') = 'GS' then 0 else 2 end;
  v_entrega numeric := coalesce(new.entrega, 0);
  v_financiado numeric;
  v_base numeric;
  v_acum numeric := 0;
  v_monto numeric;
  i integer;
begin
  if new.tipo_venta <> 'CREDITO' or new.cliente_id is null then
    return null;
  end if;
  if new.estado = 'anulada' then
    select coalesce(sum(cobrado), 0) into v_cobrado from cuentas_por_cobrar where venta_id = new.id;
    if v_cobrado > 0 then
      raise exception 'La venta % ya tiene cobros: anulá primero los recibos de ese cliente', new.numero_control;
    end if;
    update cuentas_por_cobrar set estado = 'anulada', updated_at = now() where venta_id = new.id;
    return null;
  end if;
  -- 131: la entrega es menor que el total (si no, es contado).
  if v_entrega > 0 and v_entrega >= new.total then
    raise exception 'La entrega (Gs. %) tiene que ser menor que el total de la venta (Gs. %)',
      replace(to_char(v_entrega, 'FM999,999,999,990'), ',', '.'), replace(to_char(new.total, 'FM999,999,999,990'), ',', '.');
  end if;
  -- 61: sin plazo en la venta ni en el cliente → "Días de vencimiento por defecto".
  select coalesce(new.plazo_dias, c.plazo_dias, dias_vencimiento_default(new.empresa_id)) into v_plazo
    from clientes c where c.id = new.cliente_id;
  v_plazo := coalesce(v_plazo, dias_vencimiento_default(new.empresa_id));
  v_primera := v_fecha + v_plazo;

  select count(*), coalesce(sum(cobrado), 0) into v_filas, v_cobrado from cuentas_por_cobrar where venta_id = new.id;

  -- Una sola cuota sin entrega (como siempre): se actualiza la cuenta que ya existe (conserva lo cobrado).
  if v_n = 1 and v_entrega = 0 and v_filas = 1 and exists (select 1 from cuentas_por_cobrar where venta_id = new.id and cuota = 1) then
    update cuentas_por_cobrar
       set monto = new.total, cliente_id = new.cliente_id, numero = new.numero_control, cuota = 1, cuotas = 1,
           estado = estado_cxc(new.total, cobrado, false), updated_at = now()
     where venta_id = new.id;
    return null;
  end if;

  if v_filas > 0 then
    if tg_op = 'UPDATE' and new.total is not distinct from old.total and new.cuotas is not distinct from old.cuotas
       and new.cuotas_cada is not distinct from old.cuotas_cada and new.plazo_dias is not distinct from old.plazo_dias
       and new.entrega is not distinct from old.entrega then
      update cuentas_por_cobrar set cliente_id = new.cliente_id, updated_at = now() where venta_id = new.id;
      return null;
    end if;
    if v_cobrado > 0 then
      raise exception 'La venta % ya tiene cobros: no se pueden cambiar su total, su entrega ni sus cuotas', new.numero_control;
    end if;
    delete from cuentas_por_cobrar where venta_id = new.id;
  end if;

  -- 131: la entrega, cuota 0, vence el día de la venta.
  if v_entrega > 0 then
    insert into cuentas_por_cobrar (empresa_id, venta_id, cliente_id, numero, fecha_emision, vencimiento, monto, cuota, cuotas)
      values (new.empresa_id, new.id, new.cliente_id, new.numero_control || ' · entrega', v_fecha, v_fecha, v_entrega, 0, v_n);
  end if;

  v_financiado := new.total - v_entrega;
  v_base := trunc(v_financiado / v_n, v_dec);
  for i in 1..v_n loop
    v_monto := case when i = v_n then v_financiado - v_acum else v_base end;
    v_acum := v_acum + v_monto;
    insert into cuentas_por_cobrar (empresa_id, venta_id, cliente_id, numero, fecha_emision, vencimiento, monto, cuota, cuotas)
      values (new.empresa_id, new.id, new.cliente_id,
              case when v_n = 1 and v_entrega = 0 then new.numero_control else new.numero_control || ' · ' || i || '/' || v_n end,
              v_fecha,
              case coalesce(new.cuotas_cada, 'mes')
                when 'quincena' then v_primera + 15 * (i - 1)
                when 'semana' then v_primera + 7 * (i - 1)
                else (v_primera + make_interval(months => i - 1))::date end,
              v_monto, i, v_n);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_ventas_cxc on :"schema".ventas;
create trigger trg_ventas_cxc after insert or update of total, estado, cliente_id, tipo_venta, plazo_dias, cuotas, cuotas_cada, entrega
  on :"schema".ventas for each row execute function :"schema".tg_ventas_cxc();

-- =============================================================================
-- 3. Planes de cuotas
-- =============================================================================
create table if not exists :"schema".planes_cuota (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  cuotas smallint not null check (cuotas between 1 and 360),
  cada text not null default 'mes' check (cada in ('mes', 'quincena', 'semana')),
  primera_dias smallint not null default 30 check (primera_dias between 1 and 3650),
  entrega_pct numeric(5,2) not null default 0 check (entrega_pct between 0 and 99),
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists planes_cuota_nombre_uq on :"schema".planes_cuota (empresa_id, lower(nombre));
alter table :"schema".planes_cuota enable row level security;
alter table :"schema".planes_cuota force row level security;
revoke all on :"schema".planes_cuota from public, anon, authenticated;
grant all on :"schema".planes_cuota to service_role;

-- Lo que ven los que venden: los planes activos y el tope de cuotas.
create or replace function :"schema".planes_cuota_lista()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  return jsonb_build_object(
    'max_cuotas', max_cuotas_empresa(s.s_empresa),
    'planes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'cuotas', p.cuotas, 'cada', p.cada,
                                                           'primera_dias', p.primera_dias, 'entrega_pct', p.entrega_pct, 'activo', p.activo)
                                        order by p.orden, p.cuotas)
                          from planes_cuota p where p.empresa_id = s.s_empresa), '[]'::jsonb));
end;
$fn$;

-- p: { max_cuotas, planes: [{id?, nombre, cuotas, cada, primera_dias, entrega_pct, activo}] } (en orden).
-- Un plan que no viene se borra (las ventas ya hechas guardan sus cuotas, no el plan).
create or replace function :"schema".planes_cuota_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  x jsonb;
  v_max integer := coalesce(nullif(p->>'max_cuotas', '')::integer, 120);
  v_orden smallint := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  select * into s from inv_sesion();
  perform exigir_permiso('configuracion');
  if v_max < 1 or v_max > 360 then raise exception 'El máximo de cuotas va de 1 a 360'; end if;
  insert into facturacion_config (empresa_id, max_cuotas) values (s.s_empresa, v_max)
    on conflict (empresa_id) do update set max_cuotas = excluded.max_cuotas;
  if jsonb_typeof(coalesce(p->'planes', '[]'::jsonb)) <> 'array' then raise exception 'Faltan los planes'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'planes', '[]'::jsonb)) loop
    if length(btrim(coalesce(x->>'nombre', ''))) < 2 then raise exception 'Cada plan necesita un nombre'; end if;
    if coalesce((x->>'cuotas')::integer, 0) < 1 or (x->>'cuotas')::integer > v_max then
      raise exception 'El plan "%" tiene que tener entre 1 y % cuotas', btrim(x->>'nombre'), v_max;
    end if;
    if coalesce(x->>'cada', 'mes') not in ('mes', 'quincena', 'semana') then raise exception 'Frecuencia inválida en "%"', btrim(x->>'nombre'); end if;
    v_orden := v_orden + 1;
    v_id := nullif(x->>'id', '')::uuid;
    if v_id is null then
      insert into planes_cuota (empresa_id, nombre, cuotas, cada, primera_dias, entrega_pct, orden, activo)
        values (s.s_empresa, btrim(x->>'nombre'), (x->>'cuotas')::integer, coalesce(x->>'cada', 'mes'),
                coalesce(nullif(x->>'primera_dias', '')::integer, 30), coalesce(nullif(x->>'entrega_pct', '')::numeric, 0),
                v_orden, coalesce((x->>'activo')::boolean, true))
        returning id into v_id;
    else
      update planes_cuota set nombre = btrim(x->>'nombre'), cuotas = (x->>'cuotas')::integer, cada = coalesce(x->>'cada', 'mes'),
             primera_dias = coalesce(nullif(x->>'primera_dias', '')::integer, 30), entrega_pct = coalesce(nullif(x->>'entrega_pct', '')::numeric, 0),
             orden = v_orden, activo = coalesce((x->>'activo')::boolean, true)
       where id = v_id and empresa_id = s.s_empresa;
      if not found then raise exception 'No existe ese plan'; end if;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  delete from planes_cuota where empresa_id = s.s_empresa and not (id = any (v_ids));
  return planes_cuota_lista();
end;
$fn$;

-- =============================================================================
-- 4. Vender en cuotas con entrega (todo o nada)
-- =============================================================================
-- p: cliente_id, items[], plan_id?, cuotas, cuotas_cada, plazo_dias, entrega, pagos[] (de la entrega),
--    tipo_documento, observaciones, idempotency_key, caja_id
create or replace function :"schema".vender_en_cuotas(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pl planes_cuota;
  v_cuotas integer := coalesce(nullif(p->>'cuotas', '')::integer, 1);
  v_cada text := coalesce(nullif(p->>'cuotas_cada', ''), 'mes');
  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_entrega numeric := round(coalesce(nullif(p->>'entrega', '')::numeric, 0));
  v_venta jsonb;
  v_id uuid;
  v_total numeric;
  v_pagado numeric := 0;
  v_cxc uuid;
  v_cobro jsonb;
  v_pagos jsonb := '[]'::jsonb;
  pg jsonb;
begin
  select * into s from inv_sesion();
  if nullif(p->>'plan_id', '') is not null then
    select * into pl from planes_cuota where id = (p->>'plan_id')::uuid and empresa_id = s.s_empresa and activo;
    if pl.id is null then raise exception 'Ese plan de cuotas no existe o está desactivado'; end if;
    v_cuotas := pl.cuotas; v_cada := pl.cada; v_plazo := coalesce(v_plazo, pl.primera_dias);
  end if;
  if v_entrega < 0 then raise exception 'La entrega no puede ser negativa'; end if;

  v_venta := crear_venta(nullif(p->>'cliente_id', '')::uuid, 'CREDITO', null, 'GS', nullif(btrim(coalesce(p->>'observaciones', '')), ''),
                         p->'items', null, nullif(p->>'idempotency_key', ''), 0, v_plazo, null, nullif(p->>'caja_id', '')::uuid,
                         coalesce(nullif(p->>'tipo_documento', ''), 'ticket'), false, v_cuotas, v_cada);
  v_id := (v_venta->>'venta_id')::uuid;
  if coalesce((v_venta->>'reusada')::boolean, false) then
    return v_venta || jsonb_build_object('cuotas_detalle', (select jsonb_agg(jsonb_build_object('cuota', c.cuota, 'vencimiento', c.vencimiento, 'monto', c.monto, 'saldo', c.saldo) order by c.cuota)
                                                             from cuentas_por_cobrar c where c.venta_id = v_id));
  end if;
  select total into v_total from ventas where id = v_id;

  if pl.id is not null and pl.entrega_pct > 0 and v_entrega < round(v_total * pl.entrega_pct / 100) then
    raise exception 'El plan "%" pide una entrega de al menos % %% (Gs. %)', pl.nombre, trim_scale(pl.entrega_pct),
      replace(to_char(round(v_total * pl.entrega_pct / 100), 'FM999,999,999,990'), ',', '.');
  end if;

  if v_entrega > 0 then
    update ventas set entrega = v_entrega, updated_at = now() where id = v_id;  -- el disparador arma la cuota 0
    if jsonb_typeof(p->'pagos') <> 'array' or jsonb_array_length(p->'pagos') = 0 then
      raise exception 'Elegí cómo paga la entrega';
    end if;
    -- Los pagos llegan como en la venta (metodo_pago) o como en el cobro (metodo): el cobro usa `metodo`.
    for pg in select * from jsonb_array_elements(p->'pagos') loop
      if coalesce(pg->>'metodo', pg->>'metodo_pago') is null
         or coalesce(pg->>'metodo', pg->>'metodo_pago') not in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro', 'saldo_favor') then
        raise exception 'Forma de pago inválida para la entrega: %', coalesce(pg->>'metodo', pg->>'metodo_pago', 'ninguna');
      end if;
      v_pagado := v_pagado + round(coalesce((pg->>'monto')::numeric, 0));
      v_pagos := v_pagos || jsonb_build_object('metodo', coalesce(pg->>'metodo', pg->>'metodo_pago'), 'monto', round((pg->>'monto')::numeric),
                                               'referencia', pg->>'referencia');
    end loop;
    if v_pagado <> v_entrega then
      raise exception 'Lo que paga (Gs. %) tiene que ser igual a la entrega (Gs. %)',
        replace(to_char(v_pagado, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_entrega, 'FM999,999,999,990'), ',', '.');
    end if;
    select id into v_cxc from cuentas_por_cobrar where venta_id = v_id and cuota = 0;
    v_cobro := registrar_cobro(jsonb_build_object(
      'cliente_id', p->>'cliente_id', 'pagos', v_pagos, 'caja_id', p->>'caja_id',
      'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', v_cxc, 'monto', v_entrega)),
      'observacion', 'Entrega inicial de la venta ' || (v_venta->>'numero_control')));
  end if;

  return v_venta || jsonb_build_object(
    'total', v_total, 'entrega', v_entrega, 'cobro', v_cobro,
    'cuotas_detalle', (select jsonb_agg(jsonb_build_object('cuota', c.cuota, 'vencimiento', c.vencimiento, 'monto', c.monto, 'saldo', c.saldo) order by c.cuota)
                         from cuentas_por_cobrar c where c.venta_id = v_id));
end;
$fn$;

-- =============================================================================
-- 5. Vender una propiedad
-- =============================================================================
alter table :"schema".propiedades add column if not exists venta_id uuid references :"schema".ventas(id) on delete set null;

-- p: propiedad_id, cliente_id, contado (bool), pagos[] (contado: todo; cuotas: la entrega), plan_id?, cuotas,
--    cuotas_cada, plazo_dias, entrega, tipo_documento, observaciones, idempotency_key, caja_id
create or replace function :"schema".propiedad_vender(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v propiedades;
  v_items jsonb;
  v_r jsonb;
begin
  select * into s from inmo_sesion();
  select * into v from propiedades where id = nullif(p->>'propiedad_id', '')::uuid and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe esa propiedad'; end if;
  if v.gestion = 'alquiler' then raise exception 'Esta propiedad es solo para alquiler'; end if;
  if v.estado not in ('disponible', 'reservada') then raise exception 'La propiedad está %: no se puede vender', v.estado; end if;
  if nullif(p->>'cliente_id', '') is null then raise exception 'Elegí el comprador'; end if;
  -- La caja la vende aunque no sea "vendible" en el mostrador (es_vendible solo la esconde de la caja).
  update productos set es_vendible = true where id = v.producto_id;
  v_items := jsonb_build_array(jsonb_build_object('producto_id', v.producto_id, 'cantidad', 1));

  if coalesce((p->>'contado')::boolean, false) then
    v_r := crear_venta((p->>'cliente_id')::uuid, 'CONTADO', null, 'GS',
                       coalesce(nullif(btrim(coalesce(p->>'observaciones', '')), ''), 'Venta de la propiedad ' || v.codigo),
                       v_items, p->'pagos', nullif(p->>'idempotency_key', ''), 0, null, null, nullif(p->>'caja_id', '')::uuid,
                       coalesce(nullif(p->>'tipo_documento', ''), 'ticket'), false, 1, 'mes');
  else
    v_r := vender_en_cuotas(p || jsonb_build_object('items', v_items,
             'observaciones', coalesce(nullif(btrim(coalesce(p->>'observaciones', '')), ''), 'Venta de la propiedad ' || v.codigo)));
  end if;

  update propiedades set estado = 'vendida', venta_id = (v_r->>'venta_id')::uuid, updated_at = now() where id = v.id;
  update productos set es_vendible = false, updated_at = now() where id = v.producto_id;
  return v_r || jsonb_build_object('propiedad', propiedad_json(v.id));
end;
$fn$;

-- Si se anula la venta de una propiedad, la propiedad vuelve a estar disponible.
create or replace function :"schema".tg_ventas_propiedad_anulada()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.estado = 'anulada' and old.estado is distinct from 'anulada' then
    update productos pr set es_vendible = x.gestion <> 'alquiler', updated_at = now()
      from propiedades x where x.venta_id = new.id and pr.id = x.producto_id;
    update propiedades set estado = 'disponible', venta_id = null, updated_at = now() where venta_id = new.id;
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_ventas_propiedad_anulada on :"schema".ventas;
create trigger trg_ventas_propiedad_anulada after update of estado on :"schema".ventas
  for each row execute function :"schema".tg_ventas_propiedad_anulada();

-- =============================================================================
-- 6. Permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  foreach f in array array['max_cuotas_empresa(uuid)', 'tg_ventas_propiedad_anulada()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['planes_cuota_lista()', 'planes_cuota_guardar(jsonb)', 'vender_en_cuotas(jsonb)', 'propiedad_vender(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
