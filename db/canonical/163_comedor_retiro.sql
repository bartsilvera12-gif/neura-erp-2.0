-- =============================================================================
-- COMEDOR — Fase 3: retiro autoservicio (sigue a 161/162).
--
--   · Terminal de autoservicio en el comedor: un enlace por token (comedor_config.retiro_token).
--     El funcionario pone su CI (hoy; huella después), ve el menú que RESERVÓ para hoy y confirma
--     el retiro UNA sola vez. El retiro ES la marca (reemplaza la planilla biométrica).
--   · Solo retira quien reservó (decisión del dueño): sin reserva con menú para hoy, no hay retiro.
--   · Al confirmar se registra el consumo (comedor_consumos, Fase 1): reparte subsidio / excedente /
--     diferencia de menú especial, y descuenta el stock de los ingredientes del plato (si está
--     linkeado a un producto con receta), reutilizando inv_mover + receta_insumos (capas PEPS).
--     El subsidio es mensual y no acumulable; lo que pasa de Gs 350.000 va a excedente.
--   · Único (funcionario, fecha) para almuerzo (índice de la 161): no dos retiros el mismo día.
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Config del comedor (la terminal de retiro: su token y el depósito del que descuenta)
-- =============================================================================
create table if not exists :"schema".comedor_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  retiro_token text,
  deposito_id uuid references :"schema".depositos(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);
create unique index if not exists comedor_config_token on :"schema".comedor_config (retiro_token) where retiro_token is not null;

do $do$
begin
  execute 'alter table comedor_config enable row level security';
  execute 'alter table comedor_config force row level security';
  execute 'revoke all on comedor_config from public, anon, authenticated';
  execute 'grant all on comedor_config to service_role';
  drop policy if exists comedor_config_empresa on comedor_config;
  create policy comedor_config_empresa on comedor_config
    using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual());
end;
$do$;

-- Trae (o crea) la config de la empresa.
create or replace function :"schema".comedor_config_de(p_empresa uuid) returns comedor_config
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c comedor_config;
begin
  select * into c from comedor_config where empresa_id = p_empresa;
  if c.empresa_id is null then
    insert into comedor_config (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
    select * into c from comedor_config where empresa_id = p_empresa;
  end if;
  return c;
end;
$fn$;

-- El depósito del que descuenta el comedor (el configurado, o el primero activo de la empresa).
create or replace function :"schema".comedor_deposito(p_empresa uuid) returns uuid
language sql stable security definer set search_path = :"schema", public as $fn$
  select coalesce(
    (select deposito_id from comedor_config where empresa_id = p_empresa and deposito_id is not null),
    (select d.id from depositos d where d.empresa_id = p_empresa and d.activo order by d.created_at limit 1)
  )
$fn$;

-- =============================================================================
-- 2. Gestión de la terminal (comedor_administrar)
-- =============================================================================
create or replace function :"schema".comedor_terminal_leer()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c comedor_config;
begin
  select * into s from comedor_sesion('comedor_administrar');
  c := comedor_config_de(s.s_empresa);
  return jsonb_build_object(
    'retiro_token', c.retiro_token,
    'deposito_id', coalesce(c.deposito_id, comedor_deposito(s.s_empresa)),
    'depositos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre) order by d.nombre)
                            from depositos d where d.empresa_id = s.s_empresa and d.activo), '[]'::jsonb)
  );
end;
$fn$;

-- Fija el depósito y/o (re)genera el token de la terminal.
create or replace function :"schema".comedor_terminal_guardar(p_deposito uuid default null, p_generar boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c comedor_config;
  v_token text;
begin
  select * into s from comedor_sesion('comedor_administrar');
  c := comedor_config_de(s.s_empresa);
  v_token := c.retiro_token;
  if p_generar or v_token is null then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  update comedor_config
     set deposito_id = p_deposito, retiro_token = v_token, updated_at = now(), updated_by = s.s_usuario
   where empresa_id = s.s_empresa;
  return comedor_terminal_leer();
end;
$fn$;

-- =============================================================================
-- 3. Retiro público (autoservicio por token + CI)
-- =============================================================================
-- Resuelve el funcionario de un token de terminal + CI.
create or replace function :"schema".comedor_retiro_func(p_token text, p_documento text,
  out o_empresa uuid, out o_funcionario uuid, out o_nombre text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
begin
  if p_token !~ '^[0-9a-f]{64}$' then raise exception 'Terminal inválida' using errcode = '42501'; end if;
  select empresa_id into o_empresa from comedor_config where retiro_token = p_token;
  if o_empresa is null then raise exception 'Terminal no disponible' using errcode = '42501'; end if;
  if length(v_doc) < 3 then raise exception 'Cargá tu cédula' using errcode = '22023'; end if;
  select c.id, c.nombre into o_funcionario, o_nombre from clientes c
   where c.empresa_id = o_empresa and c.es_funcionario and c.activo
     and regexp_replace(coalesce(c.documento, ''), '\D', '', 'g') = v_doc
   limit 1;
  if o_funcionario is null then raise exception 'No encontramos tu cédula en el padrón' using errcode = '22023'; end if;
end;
$fn$;

-- Arma el estado del funcionario para hoy (reserva, si ya retiró, saldo).
create or replace function :"schema".comedor_retiro_estado(p_empresa uuid, p_funcionario uuid, p_nombre text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_hoy date := comedor_hoy();
  v_periodo date := comedor_periodo(v_hoy);
  v_res record;
  v_consumo record;
  v_subsidio numeric;
  v_consumido numeric;
begin
  select o.id as opcion_id, o.nombre, o.especial, o.precio_habitual, o.precio_especial, r.opcion_id as elegido
    into v_res
    from comedor_reservas r
    left join comedor_menu_opciones o on o.id = r.opcion_id
   where r.funcionario_id = p_funcionario and r.fecha = v_hoy;

  select id, es_especial, precio_habitual into v_consumo
    from comedor_consumos
   where funcionario_id = p_funcionario and fecha = v_hoy and concepto = 'almuerzo' and anulado_at is null
   limit 1;

  select coalesce(ce.subsidio_mensual, 350000) into v_subsidio
    from clientes c left join comedor_empresas ce on ce.id = c.comedor_empresa_id where c.id = p_funcionario;
  v_subsidio := coalesce(v_subsidio, 350000);
  select coalesce(sum(subsidio_aplicado), 0) into v_consumido
    from comedor_consumos where funcionario_id = p_funcionario and periodo = v_periodo and anulado_at is null;

  return jsonb_build_object(
    'funcionario', jsonb_build_object('id', p_funcionario, 'nombre', p_nombre),
    'fecha', v_hoy,
    'reservo', found or (v_res.elegido is not null),
    'reserva', case when v_res.opcion_id is not null
                    then jsonb_build_object('opcion_id', v_res.opcion_id, 'nombre', v_res.nombre, 'especial', v_res.especial)
                    else null end,
    'reserva_propio', (v_res.elegido is null and v_res.opcion_id is null
                       and exists (select 1 from comedor_reservas r where r.funcionario_id = p_funcionario and r.fecha = v_hoy)),
    'ya_retiro', v_consumo.id is not null,
    'saldo', jsonb_build_object('subsidio', v_subsidio, 'disponible', greatest(v_subsidio - v_consumido, 0))
  );
end;
$fn$;

create or replace function :"schema".comedor_retiro_identificar(p_token text, p_documento text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  r record;
begin
  select * into r from comedor_retiro_func(p_token, p_documento);
  return jsonb_build_object('ok', true) || comedor_retiro_estado(r.o_empresa, r.o_funcionario, r.o_nombre);
end;
$fn$;

-- Confirma el retiro: registra el consumo (subsidio/excedente/especial) y descuenta stock.
create or replace function :"schema".comedor_retiro_confirmar(p_token text, p_documento text) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_hoy date := comedor_hoy();
  v_periodo date := comedor_periodo(v_hoy);
  v_op record;              -- opción reservada
  v_emp_contr uuid;
  v_subsidio numeric;
  v_consumido numeric;
  v_disponible numeric;
  v_subap numeric;
  v_exc numeric;
  v_dif numeric;
  v_costo numeric := 0;
  v_dep uuid;
  v_consumo uuid;
  ins record;
begin
  select * into r from comedor_retiro_func(p_token, p_documento);

  -- La opción reservada para hoy (debe existir y tener menú).
  select o.id, o.nombre, o.producto_id, o.especial, o.precio_habitual, o.precio_especial
    into v_op
    from comedor_reservas res
    join comedor_menu_opciones o on o.id = res.opcion_id
   where res.funcionario_id = r.o_funcionario and res.fecha = v_hoy;
  if not found then
    raise exception 'No reservaste almuerzo para hoy, así que no podés retirar' using errcode = '22023';
  end if;

  -- No dos veces (además del índice único, para un mensaje claro).
  if exists (select 1 from comedor_consumos where funcionario_id = r.o_funcionario and fecha = v_hoy and concepto = 'almuerzo' and anulado_at is null) then
    raise exception 'Ya retiraste tu almuerzo hoy' using errcode = '22023';
  end if;

  select comedor_empresa_id into v_emp_contr from clientes where id = r.o_funcionario;
  select coalesce(ce.subsidio_mensual, 350000) into v_subsidio from comedor_empresas ce where ce.id = v_emp_contr;
  v_subsidio := coalesce(v_subsidio, 350000);
  select coalesce(sum(subsidio_aplicado), 0) into v_consumido
    from comedor_consumos where funcionario_id = r.o_funcionario and periodo = v_periodo and anulado_at is null;
  v_disponible := greatest(v_subsidio - v_consumido, 0);

  v_subap := least(v_op.precio_habitual, v_disponible);
  v_exc := v_op.precio_habitual - v_subap;
  v_dif := case when v_op.especial then greatest(coalesce(v_op.precio_especial, v_op.precio_habitual) - v_op.precio_habitual, 0) else 0 end;

  -- Costo de la receta (si tiene) para el margen.
  if v_op.producto_id is not null and tiene_receta(v_op.producto_id) then
    select coalesce(sum(x.cantidad * coalesce(i.costo_promedio, 0)), 0) into v_costo
      from receta_insumos(v_op.producto_id, 1) x join productos i on i.id = x.insumo_id;
  end if;

  insert into comedor_consumos (empresa_id, funcionario_id, comedor_empresa_id, fecha, periodo, concepto,
                                producto_id, cantidad, es_especial, precio_habitual, precio_especial,
                                subsidio_aplicado, excedente, diferencia_especial, costo, medio_identificacion)
  values (r.o_empresa, r.o_funcionario, v_emp_contr, v_hoy, v_periodo, 'almuerzo',
          v_op.producto_id, 1, v_op.especial, v_op.precio_habitual, coalesce(v_op.precio_especial, 0),
          v_subap, v_exc, v_dif, v_costo, 'CI')
  returning id into v_consumo;

  -- Descuenta el stock de los ingredientes (si el plato linkea a un producto con receta).
  if v_op.producto_id is not null and tiene_receta(v_op.producto_id) then
    v_dep := comedor_deposito(r.o_empresa);
    if v_dep is not null then
      for ins in
        select x.insumo_id, x.cantidad, coalesce(i.costo_promedio, 0) as costo, i.controla_stock
          from receta_insumos(v_op.producto_id, 1) x join productos i on i.id = x.insumo_id
         where i.controla_stock
      loop
        perform inv_mover(r.o_empresa, ins.insumo_id, v_dep, -ins.cantidad, ins.costo, 'comedor', 'comedor_retiro',
                          v_consumo, '', 'Retiro comedor · ' || v_op.nombre, null, r.o_nombre);
      end loop;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'retiro', jsonb_build_object('menu', v_op.nombre, 'especial', v_op.especial))
         || comedor_retiro_estado(r.o_empresa, r.o_funcionario, r.o_nombre);
end;
$fn$;

-- =============================================================================
-- 4. Supervisión (comedor): retiros del día y anulación
-- =============================================================================
create or replace function :"schema".comedor_retiros_dia(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_fecha date := coalesce(p_fecha, comedor_hoy());
begin
  select * into s from comedor_sesion('comedor_recepcion');
  return jsonb_build_object(
    'fecha', v_fecha,
    'total', (select count(*) from comedor_consumos where empresa_id = s.s_empresa and fecha = v_fecha and concepto = 'almuerzo' and anulado_at is null),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cc.id, 'funcionario', c.nombre, 'documento', c.documento, 'menu', coalesce(p.nombre, '—'),
        'hora', to_char(cc.hora at time zone 'America/Asuncion', 'HH24:MI'),
        'subsidio', cc.subsidio_aplicado, 'excedente', cc.excedente, 'diferencia', cc.diferencia_especial, 'especial', cc.es_especial
      ) order by cc.hora desc)
      from comedor_consumos cc
      join clientes c on c.id = cc.funcionario_id
      left join productos p on p.id = cc.producto_id
     where cc.empresa_id = s.s_empresa and cc.fecha = v_fecha and cc.concepto = 'almuerzo' and cc.anulado_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;

-- Anula un retiro (devuelve el stock y libera el subsidio). Queda auditado.
create or replace function :"schema".comedor_retiro_anular(p_consumo uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  cc record;
  v_dep uuid;
  ins record;
begin
  select * into s from comedor_sesion('comedor_recepcion');
  select * into cc from comedor_consumos where id = p_consumo and empresa_id = s.s_empresa and concepto = 'almuerzo' and anulado_at is null;
  if not found then raise exception 'Retiro no encontrado o ya anulado'; end if;

  update comedor_consumos set anulado_at = now(), anulado_por = s.s_usuario, motivo = nullif(trim(coalesce(p_motivo, '')), '')
   where id = p_consumo;

  -- Devuelve el stock de los insumos.
  if cc.producto_id is not null and tiene_receta(cc.producto_id) then
    v_dep := comedor_deposito(s.s_empresa);
    if v_dep is not null then
      for ins in
        select x.insumo_id, x.cantidad, coalesce(i.costo_promedio, 0) as costo, i.controla_stock
          from receta_insumos(cc.producto_id, cc.cantidad) x join productos i on i.id = x.insumo_id
         where i.controla_stock
      loop
        perform inv_mover(s.s_empresa, ins.insumo_id, v_dep, ins.cantidad, ins.costo, 'comedor', 'comedor_retiro_anul',
                          cc.id, '', 'Anulación retiro comedor', s.s_usuario, s.s_nombre);
      end loop;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- =============================================================================
-- 5. Permisos
-- =============================================================================
do $do$
declare
  f text;
begin
  foreach f in array array['comedor_config_de(uuid)', 'comedor_deposito(uuid)', 'comedor_retiro_func(text,text)', 'comedor_retiro_estado(uuid,uuid,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['comedor_terminal_leer()', 'comedor_terminal_guardar(uuid,boolean)', 'comedor_retiros_dia(date)', 'comedor_retiro_anular(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['comedor_retiro_identificar(text,text)', 'comedor_retiro_confirmar(text,text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
