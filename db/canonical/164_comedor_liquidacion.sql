-- =============================================================================
-- COMEDOR — Fase 4: cantina a cuenta y liquidación mensual (sigue a 161/162/163).
--
--   · Cantina (comedor_consumos.concepto = 'cantina'): el operador carga productos de reventa a la
--     cuenta del funcionario, sin pago en caja. El subsidio cubre almuerzo + cantina (decisión del
--     dueño): cada consumo descuenta del saldo del mes hasta agotarlo; el resto es excedente.
--     Descuenta el stock del producto (reventa) con inv_mover.
--   · Liquidación mensual (comedor_liquidacion): por funcionario, reservas vs entregas, subsidio
--     aplicado, excedente (a recuperar del funcionario) y diferencia de menú especial (de la
--     empresa), más los totales. Sale a PDF/Excel (molde de los reportes).
--   · Anulación genérica (almuerzo o cantina): devuelve el stock y libera el subsidio, auditado.
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Cantina (operador)
-- =============================================================================
-- Identifica al funcionario por CI y trae su saldo del mes.
create or replace function :"schema".comedor_cantina_funcionario(p_documento text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_func uuid;
  v_nombre text;
begin
  select * into s from comedor_sesion('comedor_recepcion');
  if length(v_doc) < 3 then raise exception 'Cargá la cédula' using errcode = '22023'; end if;
  select c.id, c.nombre into v_func, v_nombre from clientes c
   where c.empresa_id = s.s_empresa and c.es_funcionario and c.activo
     and regexp_replace(coalesce(c.documento, ''), '\D', '', 'g') = v_doc
   limit 1;
  if v_func is null then raise exception 'No encontramos esa cédula en el padrón' using errcode = '22023'; end if;
  return jsonb_build_object('funcionario', jsonb_build_object('id', v_func, 'nombre', v_nombre), 'saldo', comedor_saldo(v_func, null));
end;
$fn$;

-- Registra productos de cantina a la cuenta del funcionario (subsidio → excedente) y descuenta stock.
create or replace function :"schema".comedor_cantina_registrar(p_funcionario uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := comedor_hoy();
  v_periodo date := comedor_periodo(v_hoy);
  v_emp_contr uuid;
  v_subsidio numeric;
  v_consumido numeric;
  v_disponible numeric;
  v_dep uuid;
  it jsonb;
  prod record;
  v_cant numeric;
  v_total numeric;
  v_subap numeric;
  v_exc numeric;
  v_consumo uuid;
  v_n integer := 0;
begin
  select * into s from comedor_sesion('comedor_recepcion');
  if not exists (select 1 from clientes where id = p_funcionario and empresa_id = s.s_empresa and es_funcionario) then
    raise exception 'Funcionario no encontrado';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agregá al menos un producto'; end if;

  select comedor_empresa_id into v_emp_contr from clientes where id = p_funcionario;
  select coalesce(ce.subsidio_mensual, 350000) into v_subsidio from comedor_empresas ce where ce.id = v_emp_contr;
  v_subsidio := coalesce(v_subsidio, 350000);
  select coalesce(sum(subsidio_aplicado), 0) into v_consumido
    from comedor_consumos where funcionario_id = p_funcionario and periodo = v_periodo and anulado_at is null;
  v_disponible := greatest(v_subsidio - v_consumido, 0);
  v_dep := comedor_deposito(s.s_empresa);

  for it in select * from jsonb_array_elements(p_items) loop
    select p.id, p.nombre, p.precio_venta, coalesce(p.costo_promedio, 0) as costo, p.controla_stock, p.tipo_producto
      into prod from productos p where p.id = (it->>'producto_id')::uuid and p.empresa_id = s.s_empresa and p.activo;
    if not found then raise exception 'Producto no encontrado'; end if;
    if prod.tipo_producto = 'materia_prima' then raise exception '"%" es materia prima, no se vende', prod.nombre; end if;
    if prod.tipo_producto = 'menu' then
      raise exception '"%" es un plato del menú; se entrega por el retiro, no por la cantina', prod.nombre using errcode = '22023';
    end if;
    v_cant := greatest(coalesce((it->>'cantidad')::numeric, 1), 0.001);
    -- El precio SIEMPRE sale del catálogo (precio_venta), nunca de lo que mande el cliente:
    -- así nadie puede cargar a cuenta un monto arbitrario ni falsear el subsidio aplicado.
    v_total := round(prod.precio_venta * v_cant);
    v_subap := least(v_total, v_disponible);
    v_exc := v_total - v_subap;
    v_disponible := v_disponible - v_subap;

    insert into comedor_consumos (empresa_id, funcionario_id, comedor_empresa_id, fecha, periodo, concepto,
                                  producto_id, cantidad, es_especial, precio_habitual, precio_especial,
                                  subsidio_aplicado, excedente, diferencia_especial, costo, operador_usuario_id, medio_identificacion)
    values (s.s_empresa, p_funcionario, v_emp_contr, v_hoy, v_periodo, 'cantina',
            prod.id, v_cant, false, v_total, 0, v_subap, v_exc, 0, round(prod.costo * v_cant), s.s_usuario, 'operador')
    returning id into v_consumo;

    -- Descuento de stock best-effort: no frena la cantina si el inventario no alcanza.
    if prod.controla_stock and v_dep is not null
       and coalesce((select cantidad from stock_depositos where producto_id = prod.id and deposito_id = v_dep), 0) >= v_cant then
      perform inv_mover(s.s_empresa, prod.id, v_dep, -v_cant, prod.costo, 'comedor', 'comedor',
                        v_consumo, '', 'Cantina · ' || prod.nombre, s.s_usuario, s.s_nombre);
    end if;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'registrados', v_n, 'saldo', comedor_saldo(p_funcionario, null));
end;
$fn$;

-- =============================================================================
-- 2. Anulación genérica (almuerzo o cantina): devuelve stock y libera subsidio
-- =============================================================================
create or replace function :"schema".comedor_consumo_anular(p_consumo uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  cc record;
  mv record;
begin
  select * into s from comedor_sesion('comedor_recepcion');
  select * into cc from comedor_consumos where id = p_consumo and empresa_id = s.s_empresa and anulado_at is null and concepto in ('almuerzo', 'cantina');
  if not found then raise exception 'Consumo no encontrado o ya anulado'; end if;

  update comedor_consumos set anulado_at = now(), anulado_por = s.s_usuario, motivo = nullif(trim(coalesce(p_motivo, '')), '')
   where id = p_consumo;

  -- Devuelve EXACTAMENTE lo que se descontó: reversa los movimientos reales de este consumo
  -- (las salidas que dejó inv_mover), en vez de recalcular la receta. El descuento es best-effort
  -- (puede saltearse si faltaba stock), así que recalcular infla el inventario; reversar lo real no.
  for mv in
    select producto_id, deposito_id, cantidad, costo_unitario
      from movimientos_inventario
     where empresa_id = s.s_empresa and documento_tipo = 'comedor' and documento_id = cc.id and tipo = 'SALIDA'
  loop
    perform inv_mover(s.s_empresa, mv.producto_id, mv.deposito_id, mv.cantidad, mv.costo_unitario, 'comedor', 'comedor',
                      cc.id, '', 'Anulación comedor', s.s_usuario, s.s_nombre);
  end loop;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- =============================================================================
-- 3. Liquidación mensual (comedor_administrar)
-- =============================================================================
create or replace function :"schema".comedor_liquidacion(p_desde date, p_hasta date, p_empresa uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_rows jsonb;
  v_tot jsonb;
begin
  select * into s from comedor_sesion('comedor_administrar');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Rango de fechas inválido'; end if;

  with consumos as (
    select cc.funcionario_id,
           count(*) filter (where cc.concepto = 'almuerzo') as almuerzos,
           count(*) filter (where cc.concepto = 'cantina') as cantina_items,
           coalesce(sum(cc.subsidio_aplicado), 0) as subsidio,
           coalesce(sum(cc.excedente), 0) as excedente,
           coalesce(sum(cc.diferencia_especial), 0) as diferencia,
           coalesce(sum(cc.subsidio_aplicado + cc.excedente + cc.diferencia_especial), 0) as total
      from comedor_consumos cc
     where cc.empresa_id = s.s_empresa and cc.anulado_at is null
       and cc.fecha between p_desde and p_hasta
     group by cc.funcionario_id
  ),
  reservas as (
    select r.funcionario_id, count(*) filter (where r.opcion_id is not null) as reservas
      from comedor_reservas r
     where r.empresa_id = s.s_empresa and r.fecha between p_desde and p_hasta
     group by r.funcionario_id
  ),
  base as (
    select c.id, c.nombre, c.documento, c.comedor_empresa_id,
           coalesce(co.almuerzos, 0) as almuerzos, coalesce(co.cantina_items, 0) as cantina_items,
           coalesce(re.reservas, 0) as reservas,
           coalesce(co.subsidio, 0) as subsidio, coalesce(co.excedente, 0) as excedente,
           coalesce(co.diferencia, 0) as diferencia, coalesce(co.total, 0) as total
      from clientes c
      left join consumos co on co.funcionario_id = c.id
      left join reservas re on re.funcionario_id = c.id
     where c.empresa_id = s.s_empresa and c.es_funcionario
       and (p_empresa is null or c.comedor_empresa_id = p_empresa)
       and (coalesce(co.almuerzos, 0) > 0 or coalesce(co.cantina_items, 0) > 0 or coalesce(re.reservas, 0) > 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'funcionario_id', id, 'funcionario', nombre, 'documento', documento,
           'almuerzos', almuerzos, 'cantina_items', cantina_items, 'reservas', reservas,
           'subsidio', subsidio, 'excedente', excedente, 'diferencia', diferencia, 'total', total
         ) order by nombre), '[]'::jsonb),
         jsonb_build_object(
           'funcionarios', count(*), 'almuerzos', coalesce(sum(almuerzos), 0), 'cantina_items', coalesce(sum(cantina_items), 0),
           'subsidio', coalesce(sum(subsidio), 0), 'excedente', coalesce(sum(excedente), 0),
           'diferencia', coalesce(sum(diferencia), 0), 'total', coalesce(sum(total), 0)
         )
    into v_rows, v_tot
    from base;

  return jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'rows', v_rows, 'totales', v_tot);
end;
$fn$;

-- =============================================================================
-- 4. Permisos
-- =============================================================================
do $do$
declare
  f text;
begin
  foreach f in array array['comedor_cantina_funcionario(text)', 'comedor_cantina_registrar(uuid,jsonb)',
                           'comedor_consumo_anular(uuid,text)', 'comedor_liquidacion(date,date,uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
