-- =============================================================================
-- INTERÉS MORATORIO EN CUENTAS A COBRAR (pedido del dueño, 4-nov-2026). Para todos los rubros;
-- arranca APAGADO.
--
--   · Configuración: facturacion_config.mora_activa (prender), interes_moratorio (% mensual, ya
--     existía desde la 61 pero solo se mostraba), mora_dias_gracia (días después del vencimiento sin
--     interés) y mora_iva (IVA del interés, 10 % por defecto).
--   · Cálculo: por cada cuota vencida hace más que la gracia, saldo × tasa mensual × días / 30. Se
--     cuenta desde el vencimiento, o desde la última vez que se le cobró o perdonó el interés
--     (cuentas_por_cobrar.mora_hasta): nunca se cobra dos veces el mismo atraso.
--   · Se SUMA AL COBRAR: registrar_cobro_con_mora crea el interés como un cargo propio (una venta a
--     crédito sin caja con un renglón "Interés por mora", ventas.es_interes), lo cobra PRIMERO y
--     después aplica el resto a las cuotas. Queda registrado aparte del capital.
--   · Perdonar: con el permiso perdonar_mora y un motivo; queda en mora_condonaciones.
--
-- IDEMPOTENTE. Va después de 134.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Columnas y tablas
-- =============================================================================
alter table :"schema".facturacion_config add column if not exists mora_activa boolean not null default false;
alter table :"schema".facturacion_config add column if not exists mora_dias_gracia smallint not null default 0;
alter table :"schema".facturacion_config add column if not exists mora_iva text not null default '10%';
alter table :"schema".facturacion_config drop constraint if exists chk_fact_mora_gracia;
alter table :"schema".facturacion_config add constraint chk_fact_mora_gracia check (mora_dias_gracia between 0 and 90);
alter table :"schema".facturacion_config drop constraint if exists chk_fact_mora_iva;
alter table :"schema".facturacion_config add constraint chk_fact_mora_iva check (mora_iva in ('EXENTA', '5%', '10%'));

alter table :"schema".cuentas_por_cobrar add column if not exists mora_hasta date;
comment on column :"schema".cuentas_por_cobrar.mora_hasta is 'Hasta qué día ya se cobró (o perdonó) el interés por mora de esta cuota. Receta 135.';
alter table :"schema".ventas add column if not exists es_interes boolean not null default false;
comment on column :"schema".ventas.es_interes is 'Cargo de interés por mora (receta 135): no es una venta de mercadería.';

create table if not exists :"schema".mora_condonaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  monto numeric(16,0) not null,
  motivo text not null,
  cuentas uuid[] not null,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table :"schema".mora_condonaciones enable row level security;
alter table :"schema".mora_condonaciones force row level security;
revoke all on :"schema".mora_condonaciones from public, anon, authenticated;
grant all on :"schema".mora_condonaciones to service_role;

-- Permiso para perdonar el interés.
do $do$
declare
  v_def text := pg_get_functiondef('permisos_catalogo()'::regprocedure);
  v_ancla text := $a$('administrar_rrhh',           'Administrar RR HH y salarios',                  'Administración')$a$;
begin
  if position('perdonar_mora' in v_def) = 0 then
    if position(v_ancla in v_def) = 0 then raise exception 'Receta 135: permisos_catalogo no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ancla, $b$('perdonar_mora',              'Perdonar el interés por mora',                  'Cobranzas'),
    $b$ || v_ancla);
  end if;
end;
$do$;

-- =============================================================================
-- 2. Configuración
-- =============================================================================
create or replace function :"schema".mora_config()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c facturacion_config;
begin
  select * into s from inv_sesion();
  select * into c from facturacion_config where empresa_id = s.s_empresa;
  return jsonb_build_object('activa', coalesce(c.mora_activa, false), 'tasa', coalesce(c.interes_moratorio, 1.5),
                            'gracia', coalesce(c.mora_dias_gracia, 0), 'iva', coalesce(c.mora_iva, '10%'));
end;
$fn$;

-- p: activa, tasa (% mensual), gracia (días), iva
create or replace function :"schema".mora_config_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_tasa numeric := coalesce(nullif(p->>'tasa', '')::numeric, 1.5);
  v_gracia integer := coalesce(nullif(p->>'gracia', '')::integer, 0);
  v_iva text := coalesce(nullif(p->>'iva', ''), '10%');
begin
  select * into s from inv_sesion();
  perform exigir_permiso('configuracion');
  if v_tasa < 0 or v_tasa > 10 then raise exception 'La tasa de mora va de 0 a 10 %% por mes'; end if;
  if v_gracia < 0 or v_gracia > 90 then raise exception 'Los días de gracia van de 0 a 90'; end if;
  if v_iva not in ('EXENTA', '5%', '10%') then raise exception 'IVA inválido'; end if;
  insert into facturacion_config (empresa_id, mora_activa, interes_moratorio, mora_dias_gracia, mora_iva)
    values (s.s_empresa, coalesce((p->>'activa')::boolean, false), round(v_tasa, 2), v_gracia, v_iva)
  on conflict (empresa_id) do update set mora_activa = excluded.mora_activa, interes_moratorio = excluded.interes_moratorio,
         mora_dias_gracia = excluded.mora_dias_gracia, mora_iva = excluded.mora_iva;
  return mora_config();
end;
$fn$;

-- =============================================================================
-- 3. Cálculo
-- =============================================================================
-- Interés de cada cuota vencida del cliente a hoy (vacío si la mora está apagada).
create or replace function :"schema".mora_cuotas(p_empresa uuid, p_cliente uuid)
returns table (cxc_id uuid, numero text, vencimiento date, saldo numeric, desde date, dias integer, interes numeric)
language sql stable security definer set search_path = :"schema", public as $$
  with cfg as (
    select coalesce(c.mora_activa, false) activa, coalesce(c.interes_moratorio, 1.5) tasa, coalesce(c.mora_dias_gracia, 0) gracia
      from (select 1) x left join facturacion_config c on c.empresa_id = p_empresa),
  hoy as (select (now() at time zone 'America/Asuncion')::date d)
  select x.id, x.numero, x.vencimiento, x.saldo, x.desde, (hoy.d - x.desde)::integer,
         round(x.saldo * cfg.tasa / 100.0 * (hoy.d - x.desde) / 30.0)
    from cfg, hoy, lateral (
      select c.id, c.numero, c.vencimiento, c.saldo, greatest(c.vencimiento, coalesce(c.mora_hasta, c.vencimiento)) desde
        from cuentas_por_cobrar c
        join ventas v on v.id = c.venta_id
       where c.empresa_id = p_empresa and c.cliente_id = p_cliente and c.estado in ('pendiente', 'parcial') and c.saldo > 0
         and not v.es_interes) x
   where cfg.activa and cfg.tasa > 0 and hoy.d - x.vencimiento > cfg.gracia and hoy.d > x.desde
     and round(x.saldo * cfg.tasa / 100.0 * (hoy.d - x.desde) / 30.0) > 0
   order by x.vencimiento, x.numero
$$;

create or replace function :"schema".mora_calcular(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  return mora_config() || jsonb_build_object(
    'puede_perdonar', tiene_permiso('perdonar_mora'),
    'cuotas', coalesce((select jsonb_agg(jsonb_build_object('cxc_id', m.cxc_id, 'numero', m.numero, 'vencimiento', m.vencimiento,
                                                           'saldo', m.saldo, 'dias', m.dias, 'interes', m.interes))
                          from mora_cuotas(s.s_empresa, p_cliente) m), '[]'::jsonb),
    'total', coalesce((select sum(m.interes) from mora_cuotas(s.s_empresa, p_cliente) m), 0));
end;
$fn$;

-- =============================================================================
-- 4. Cobrar con mora (o perdonarla)
-- =============================================================================
-- p: lo mismo que registrar_cobro + mora: { perdonar: bool, motivo }.
-- Sin interés pendiente (o mora apagada) es exactamente registrar_cobro.
create or replace function :"schema".registrar_cobro_con_mora(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_cli uuid := nullif(p->>'cliente_id', '')::uuid;
  v_total_mora numeric;
  v_ids uuid[];
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_iva_tipo text;
  v_tasa numeric;
  v_iva numeric;
  v_venta uuid;
  v_numero text;
  v_cxc_interes uuid;
  v_pagado numeric := 0;
  v_resto numeric;
  v_apl jsonb := '[]'::jsonb;
  v_aplicar numeric;
  r record;
  ap jsonb;
  v_cobro jsonb;
begin
  select * into s from inv_sesion();
  if not exists (select 1 from clientes where id = v_cli and empresa_id = s.s_empresa and deleted_at is null) then
    raise exception 'Cliente no encontrado';
  end if;
  select coalesce(sum(m.interes), 0), array_agg(m.cxc_id) into v_total_mora, v_ids from mora_cuotas(s.s_empresa, v_cli) m;
  if v_total_mora <= 0 then
    return registrar_cobro(p - 'mora');
  end if;

  -- Perdonar: con permiso y motivo; desde hoy esas cuotas no acumulan lo ya corrido.
  if coalesce((p->'mora'->>'perdonar')::boolean, false) then
    perform exigir_permiso('perdonar_mora');
    if length(btrim(coalesce(p->'mora'->>'motivo', ''))) < 3 then raise exception 'Escribí por qué se perdona el interés'; end if;
    insert into mora_condonaciones (empresa_id, cliente_id, monto, motivo, cuentas, usuario_id)
      values (s.s_empresa, v_cli, v_total_mora, btrim(p->'mora'->>'motivo'), v_ids, s.s_usuario);
    update cuentas_por_cobrar set mora_hasta = v_hoy, updated_at = now() where id = any (v_ids);
    perform registrar_historial_cliente(v_cli, 'mora', jsonb_build_object('evento', 'perdonado', 'monto', v_total_mora, 'motivo', btrim(p->'mora'->>'motivo')));
    return registrar_cobro(p - 'mora') || jsonb_build_object('interes_perdonado', v_total_mora);
  end if;

  -- El interés es un cargo propio: venta a crédito sin caja con un renglón manual, vence hoy.
  select coalesce(mora_iva, '10%') into v_iva_tipo from facturacion_config where empresa_id = s.s_empresa;
  v_iva_tipo := coalesce(v_iva_tipo, '10%');
  v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0 else round(v_total_mora * v_tasa / (100 + v_tasa)) end;
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || s.s_empresa::text));
  v_numero := siguiente_numero_venta(s.s_empresa);
  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
                      tipo_venta, plazo_dias, metodo_pago, caja_id, created_by, usuario_nombre, fecha, observaciones, tipo_documento, es_interes)
  values (s.s_empresa, v_cli, v_numero, 'GS', 1, 0, 0, 0, 'completada', 'CREDITO', 0, null, null, auth.uid(),
          (select nombre from usuarios where id = s.s_usuario), now(), 'Interés por mora', 'ticket', true)
  returning id into v_venta;
  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (s.s_empresa, v_venta, null, 'Interés por mora (' || cardinality(v_ids) || ' cuota' || case when cardinality(v_ids) = 1 then '' else 's' end || ' vencida' || case when cardinality(v_ids) = 1 then '' else 's' end || ')',
          null, 1, v_total_mora, v_total_mora, 'minorista', v_iva_tipo, v_total_mora - v_iva, v_iva, v_total_mora, true, 0);
  update ventas set subtotal = v_total_mora - v_iva, monto_iva = v_iva, total = v_total_mora, updated_at = now() where id = v_venta;
  update cuentas_por_cobrar set vencimiento = v_hoy, updated_at = now() where venta_id = v_venta returning id into v_cxc_interes;
  update cuentas_por_cobrar set mora_hasta = v_hoy, updated_at = now() where id = any (v_ids);

  -- Lo que paga: primero el interés, después las cuotas (las elegidas o lo más viejo primero).
  for ap in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    v_pagado := v_pagado + round(coalesce((ap->>'monto')::numeric, 0));
  end loop;
  v_aplicar := least(v_pagado, v_total_mora);
  v_apl := jsonb_build_array(jsonb_build_object('cxc_id', v_cxc_interes, 'monto', v_aplicar));
  v_resto := v_pagado - v_aplicar;
  if jsonb_typeof(p->'aplicaciones') = 'array' and jsonb_array_length(p->'aplicaciones') > 0 then
    for ap in select * from jsonb_array_elements(p->'aplicaciones') loop
      exit when v_resto <= 0;
      v_aplicar := least(round((ap->>'monto')::numeric), v_resto);
      v_apl := v_apl || jsonb_build_object('cxc_id', ap->>'cxc_id', 'monto', v_aplicar);
      v_resto := v_resto - v_aplicar;
    end loop;
  else
    for r in select c.id, c.saldo from cuentas_por_cobrar c
              where c.empresa_id = s.s_empresa and c.cliente_id = v_cli and c.estado in ('pendiente', 'parcial') and c.saldo > 0 and c.id <> v_cxc_interes
              order by c.vencimiento, c.numero loop
      exit when v_resto <= 0;
      v_aplicar := least(r.saldo, v_resto);
      v_apl := v_apl || jsonb_build_object('cxc_id', r.id, 'monto', v_aplicar);
      v_resto := v_resto - v_aplicar;
    end loop;
  end if;

  perform registrar_historial_cliente(v_cli, 'mora', jsonb_build_object('evento', 'cobrado', 'monto', v_total_mora, 'numero', v_numero));
  v_cobro := registrar_cobro((p - 'mora') || jsonb_build_object('aplicaciones', v_apl));
  return v_cobro || jsonb_build_object('interes', v_total_mora, 'interes_venta', v_numero);
end;
$fn$;

-- =============================================================================
-- 5. Permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  execute 'revoke all on function mora_cuotas(uuid,uuid) from public, anon, authenticated';
  execute 'grant execute on function mora_cuotas(uuid,uuid) to service_role';
  foreach f in array array['mora_config()', 'mora_config_guardar(jsonb)', 'mora_calcular(uuid)', 'registrar_cobro_con_mora(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
