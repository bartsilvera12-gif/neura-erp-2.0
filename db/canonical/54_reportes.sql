-- =============================================================================
-- REPORTES Y DASHBOARD (Fase 4): funciones de LECTURA de agregados. Cada pantalla hace
-- una sola llamada; todo se suma en la base (anda igual con 50 ventas que con 50.000).
--
--   dashboard_inicio(p_sucursal)                      Inicio: ventas por día (30 días vs 30
--                                                     anteriores), hoy / semana / mes "a la misma
--                                                     altura" que el período anterior, ticket,
--                                                     top productos, medios de pago, inventario.
--   reporte_cierres_dias(p_desde, p_hasta, p_suc)     Cierre de caja: un renglón por DÍA.
--   reporte_cierre_dia(p_fecha, p_suc)                Un día: resumen_cajas_dia + el resumen
--                                                     completo (resumen_turno) de cada turno.
--   reporte_estado_cuenta(p_desde, p_hasta, p_suc)    Estado de cuenta de la empresa.
--   reporte_proveedores(p_desde, p_hasta, p_suc)      Listado / ranking de proveedores.
--   reporte_proveedor(p_id, p_desde, p_hasta, p_suc)  Ficha de un proveedor.
--   reporte_cxp(p_desde, p_hasta, p_suc, p_prov)      Cuentas por pagar (antigüedad, GS y USD).
--   reporte_cxc(p_desde, p_hasta, p_suc)              Cuentas por cobrar (antigüedad, origen,
--                                                     cobros en aprobación de Conciliación).
--   reporte_ventas_mes(p_desde, p_hasta, p_suc)       Ventas totales por mes (+ interanual).
--   reporte_perdidas(p_desde, p_hasta, p_suc)         Pérdidas de producto y su impacto.
--
-- Reglas comunes:
--   · Empresa: SIEMPRE la de la sesión (inv_sesion → usuarios.auth_user_id = auth.uid()).
--   · Sucursal (rep_sesion): ADMIN ve todas o la que elige; cualquier otro rol queda fijo en
--     la suya (o la principal si no tiene). SUPERVISOR solo entra al cierre de caja (de su
--     sucursal); el resto de los reportes financieros son solo ADMIN. El dashboard lo ve
--     cualquier rol: sin ADMIN no trae costos, márgenes ni valores de inventario.
--   · Fechas: día de Paraguay (America/Asuncion), desde/hasta inclusive.
--   · Ventas netas = ventas no anuladas, IVA incluido (igual que reporte_ventas_resumen). Una
--     venta sin sucursal (factura al contado, suscripción) cuenta para la sucursal principal.
--   · CMV = Σ cantidad × costo_unitario guardado en cada línea al vender (costo de ESA venta).
--   · Pérdidas = PE- aplicadas (valor al costo de lo que salió) + faltantes de traslados
--     recibidos con diferencias (cantidad no recibida × costo del traslado, sucursal destino).
--   · Montos en USD → Gs. con el tipo de cambio del documento (como gastos_resumen).
--   · Cierres de caja: un turno pertenece al día en que se ABRIÓ (un turno que cruza la
--     medianoche cuenta entero para el día de apertura). La UI lo aclara.
-- SECURITY DEFINER + search_path fijo; EXECUTE solo para authenticated. IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- Índices de apoyo (lecturas por fecha de los documentos de inventario).
create index if not exists ajustes_aplicado_idx on :"schema".ajustes_inventario (empresa_id, tipo, aplicado_at) where estado = 'aplicado';
create index if not exists traslados_recibido_idx on :"schema".traslados (empresa_id, recibido_at) where estado = 'recibido_con_diferencias';
create index if not exists cobros_apl_cxc_idx on :"schema".cobros_aplicaciones (cxc_id);
create index if not exists pagos_prov_apl_cxp_idx on :"schema".pagos_proveedores_aplicaciones (cxp_id);
create index if not exists pagos_prov_apl_pago_idx on :"schema".pagos_proveedores_aplicaciones (pago_id);
create index if not exists cajas_empresa_apertura_idx on :"schema".cajas (empresa_id, fecha_apertura);

-- =============================================================================
-- Helpers internos (no se exponen a la sesión)
-- =============================================================================

-- Sesión de reportes: empresa, rol y la sucursal EFECTIVA del filtro.
create or replace function :"schema".rep_sesion(
  p_roles text[], p_sucursal uuid,
  out s_empresa uuid, out s_rol text, out s_sucursal uuid, out s_admin boolean, out s_principal uuid)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(p_roles);
  s_empresa := s.s_empresa;
  s_rol := s.s_rol;
  s_admin := s.s_rol = 'ADMIN';
  s_principal := sucursal_principal(s.s_empresa);
  if s_admin then
    if p_sucursal is not null and not exists (select 1 from sucursales where id = p_sucursal and empresa_id = s.s_empresa) then
      raise exception 'Sucursal no encontrada';
    end if;
    s_sucursal := p_sucursal;
  else
    s_sucursal := coalesce(s.s_sucursal, s_principal);
  end if;
end;
$fn$;

-- Sucursales para el filtro (ADMIN: todas las activas; el resto: la suya).
create or replace function :"schema".rep_sucursales(p_empresa uuid, p_admin boolean, p_sucursal uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'es_principal', es_principal)
                            order by es_principal desc, nombre), '[]'::jsonb)
    from sucursales
   where empresa_id = p_empresa and (activa or id = p_sucursal)
     and (p_admin or id = p_sucursal)
$$;

-- Factor a guaraníes de un documento.
create or replace function :"schema".rep_fx(p_moneda text, p_tc numeric)
returns numeric language sql immutable as $$
  select case when p_moneda = 'USD' then coalesce(nullif(p_tc, 0), 1) else 1 end
$$;

-- Inicio de un día de Paraguay como timestamptz.
create or replace function :"schema".rep_ts(p_dia date)
returns timestamptz language sql stable as $$
  select (p_dia::timestamp at time zone 'America/Asuncion')
$$;

-- Rango por defecto (mes en curso) y validado.
create or replace function :"schema".rep_rango(p_desde date, p_hasta date, out r_desde date, out r_hasta date)
language plpgsql stable as $fn$
declare
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  r_desde := coalesce(p_desde, date_trunc('month', v_hoy)::date);
  r_hasta := coalesce(p_hasta, v_hoy);
  if r_hasta < r_desde then raise exception 'El rango de fechas está invertido'; end if;
  if r_hasta - r_desde > 3700 then raise exception 'El rango máximo es de 10 años'; end if;
end;
$fn$;

-- Pérdidas valorizadas (PE- aplicadas + faltantes de traslados) entre dos timestamps.
create or replace function :"schema".rep_perdidas_base(p_empresa uuid, p_sucursal uuid, p_ini timestamptz, p_fin timestamptz)
returns table (
  dia date, origen text, documento_id uuid, documento text, motivo text, detalle text,
  producto_id uuid, producto_nombre text, producto_sku text, deposito_id uuid, sucursal_id uuid,
  unidades numeric, valor numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select (a.aplicado_at at time zone 'America/Asuncion')::date, 'perdida', a.id, a.numero, a.motivo, a.detalle,
         ai.producto_id, ai.producto_nombre, ai.producto_sku, a.deposito_id, d.sucursal_id,
         -ai.diferencia, -ai.valor
    from ajustes_inventario a
    join ajustes_items ai on ai.ajuste_id = a.id
    join depositos d on d.id = a.deposito_id
   where a.empresa_id = p_empresa and a.tipo = 'perdida' and a.estado = 'aplicado' and ai.diferencia < 0
     and a.aplicado_at >= p_ini and a.aplicado_at < p_fin
     and (p_sucursal is null or d.sucursal_id = p_sucursal)
  union all
  select (t.recibido_at at time zone 'America/Asuncion')::date, 'traslado', t.id, t.numero, 'diferencia_traslado', t.diferencia_motivo,
         ti.producto_id, ti.producto_nombre, ti.producto_sku, t.deposito_destino_id, d.sucursal_id,
         ti.cantidad - coalesce(ti.cantidad_recibida, 0), round((ti.cantidad - coalesce(ti.cantidad_recibida, 0)) * coalesce(ti.costo_unitario, 0))
    from traslados t
    join traslados_items ti on ti.traslado_id = t.id
    join depositos d on d.id = t.deposito_destino_id
   where t.empresa_id = p_empresa and t.estado = 'recibido_con_diferencias'
     and ti.cantidad > coalesce(ti.cantidad_recibida, 0)
     and t.recibido_at >= p_ini and t.recibido_at < p_fin
     and (p_sucursal is null or d.sucursal_id = p_sucursal)
$$;

-- Etiquetas de los motivos de pérdida.
create or replace function :"schema".rep_motivo_perdida(p text)
returns text language sql immutable as $$
  select case p
    when 'vencimiento' then 'Vencimiento'
    when 'rotura' then 'Rotura / daño'
    when 'devolucion_cliente' then 'Devolución de cliente'
    when 'devolucion_proveedor' then 'Devolución a proveedor'
    when 'faltante' then 'Faltante'
    when 'consumo_interno' then 'Consumo interno'
    when 'diferencia_traslado' then 'Diferencia de traslado'
    else 'Otro' end
$$;

-- Categoría raíz de cada categoría de la empresa (Bebidas › Gaseosas → Bebidas), una sola vez.
create or replace function :"schema".rep_categorias_raiz(p_empresa uuid)
returns table (id uuid, raiz uuid)
language sql stable security definer set search_path = :"schema", public as $$
  with recursive up as (
    select c.id, c.id as raiz, c.parent_id, 0 as n from categorias_productos c where c.empresa_id = p_empresa
    union all
    select up.id, p.id, p.parent_id, up.n + 1 from up join categorias_productos p on p.id = up.parent_id where up.n < 10
  )
  select id, raiz from up where parent_id is null
$$;

-- =============================================================================
-- 1. DASHBOARD (Inicio)
-- =============================================================================
create or replace function :"schema".dashboard_inicio(p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_ahora timestamptz := now();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_ini30 date;
  v_lunes date;
  v_mes date;
  v_mes_ant date;
  v_desde date;
  r jsonb;
begin
  select * into s from rep_sesion(null, p_sucursal);
  v_ini30 := v_hoy - 29;
  v_lunes := date_trunc('week', v_hoy)::date;
  v_mes := date_trunc('month', v_hoy)::date;
  v_mes_ant := (v_mes - interval '1 month')::date;
  v_desde := least(v_hoy - 59, v_mes_ant, v_lunes - 7);

  with v as (
    select v.id, v.fecha, (v.fecha at time zone 'America/Asuncion')::date as dia,
           v.total * rep_fx(v.moneda, v.tipo_cambio) as total, v.tipo_venta, v.metodo_pago,
           coalesce(v.sucursal_id, s.s_principal) as suc
      from ventas v
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada'
       and v.fecha >= rep_ts(v_desde)
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  mes as (select * from v where fecha >= rep_ts(v_mes)),
  dias as (select (v_ini30 + k) as dia from generate_series(0, 29) k),
  items_mes as (
    select vi.producto_id, max(vi.producto_nombre) as nombre, sum(vi.cantidad) as unidades,
           sum(vi.total_linea) as monto, sum(vi.total_linea - vi.cantidad * coalesce(vi.costo_unitario, 0)) as ganancia,
           sum(vi.cantidad * coalesce(vi.costo_unitario, 0)) as costo
      from ventas_items vi join mes on mes.id = vi.venta_id
     group by vi.producto_id
  ),
  pagos_mes as (
    select metodo_caja(d.metodo_pago) as met, d.monto from mes join ventas_pagos_detalle d on d.venta_id = mes.id
     where mes.tipo_venta <> 'CREDITO'
    union all
    select metodo_caja(coalesce(mes.metodo_pago, 'efectivo')), mes.total from mes
     where mes.tipo_venta <> 'CREDITO' and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = mes.id)
    union all
    select 'credito', mes.total from mes where mes.tipo_venta = 'CREDITO'
  ),
  stock as (
    select d.sucursal_id, sum(sd.cantidad * coalesce(p.costo_promedio, 0)) as valor, sum(sd.cantidad) as unidades
      from stock_depositos sd join depositos d on d.id = sd.deposito_id join productos p on p.id = sd.producto_id
     where sd.empresa_id = s.s_empresa and sd.cantidad > 0 and p.controla_stock
       and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)
     group by d.sucursal_id
  ),
  lotes_v as (
    select l.vencimiento, l.cantidad, l.cantidad * coalesce(nullif(l.costo_unitario, 0), p.costo_promedio, 0) as valor
      from lotes l join depositos d on d.id = l.deposito_id join productos p on p.id = l.producto_id
     where l.empresa_id = s.s_empresa and l.cantidad > 0 and l.vencimiento is not null and l.vencimiento <= v_hoy + 30
       and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)
  ),
  perd as (select * from rep_perdidas_base(s.s_empresa, s.s_sucursal, rep_ts(v_mes), rep_ts(v_hoy + 1)))
  select jsonb_build_object(
    'hoy', v_hoy, 'es_admin', s.s_admin, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, s.s_admin, s.s_sucursal),
    'kpis', (select jsonb_build_object(
        'hoy', jsonb_build_object('total', coalesce(sum(total) filter (where dia = v_hoy), 0),
                                  'cantidad', count(*) filter (where dia = v_hoy),
                                  'anterior', coalesce(sum(total) filter (where dia = v_hoy - 7 and fecha <= v_ahora - interval '7 days'), 0)),
        'semana', jsonb_build_object('total', coalesce(sum(total) filter (where dia >= v_lunes), 0),
                                     'cantidad', count(*) filter (where dia >= v_lunes),
                                     'anterior', coalesce(sum(total) filter (where dia >= v_lunes - 7 and fecha <= v_ahora - interval '7 days'), 0)),
        'mes', jsonb_build_object('total', coalesce(sum(total) filter (where dia >= v_mes), 0),
                                  'cantidad', count(*) filter (where dia >= v_mes),
                                  'anterior', coalesce(sum(total) filter (where dia >= v_mes_ant and fecha <= v_ahora - interval '1 month'), 0),
                                  'anterior_cantidad', count(*) filter (where dia >= v_mes_ant and fecha <= v_ahora - interval '1 month')),
        'treinta', jsonb_build_object('total', coalesce(sum(total) filter (where dia >= v_ini30), 0),
                                      'cantidad', count(*) filter (where dia >= v_ini30),
                                      'anterior', coalesce(sum(total) filter (where dia between v_ini30 - 30 and v_ini30 - 1), 0)))
      from v),
    'por_dia', (select jsonb_agg(jsonb_build_object(
        'dia', d.dia,
        'total', coalesce((select sum(total) from v where v.dia = d.dia), 0),
        'cantidad', (select count(*) from v where v.dia = d.dia),
        'anterior', coalesce((select sum(total) from v where v.dia = d.dia - 30), 0),
        'por_sucursal', coalesce((select jsonb_object_agg(x.suc, x.t) from (select suc, sum(total) t from v where v.dia = d.dia group by suc) x), '{}'::jsonb))
      order by d.dia) from dias d),
    'por_sucursal', coalesce((select jsonb_agg(jsonb_build_object('id', x.suc, 'nombre', su.nombre, 'total', x.t, 'cantidad', x.n) order by x.t desc)
        from (select suc, sum(total) t, count(*) n from mes group by suc) x join sucursales su on su.id = x.suc), '[]'::jsonb),
    'top_productos', coalesce((select jsonb_agg(jsonb_build_object(
          'producto_id', producto_id, 'nombre', nombre, 'unidades', unidades, 'monto', monto,
          'ganancia', case when s.s_admin then ganancia end) order by monto desc)
        from (select * from items_mes order by monto desc limit 8) x), '[]'::jsonb),
    'medios', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', case when met = 'credito' then 'Crédito' else metodo_caja_label(met) end, 'total', t)
                                         order by t desc)
        from (select met, sum(monto) t from pagos_mes group by met) x), '[]'::jsonb),
    'margen_mes', case when s.s_admin then (select jsonb_build_object('ventas', coalesce(sum(monto), 0), 'costo', coalesce(sum(costo), 0),
                                                                      'ganancia', coalesce(sum(ganancia), 0)) from items_mes) end,
    'inventario', jsonb_build_object(
      'valor_stock', case when s.s_admin then (select coalesce(sum(valor), 0) from stock) end,
      'por_sucursal', case when s.s_admin then coalesce((select jsonb_agg(jsonb_build_object('id', st.sucursal_id, 'nombre', su.nombre, 'valor', round(st.valor), 'unidades', st.unidades) order by st.valor desc)
                                                          from stock st join sucursales su on su.id = st.sucursal_id), '[]'::jsonb) end,
      'bajo_minimo', (select count(*) from productos p where p.empresa_id = s.s_empresa and p.activo and p.controla_stock
                        and coalesce(p.stock_minimo, 0) > 0 and p.stock_actual < p.stock_minimo),
      'sin_stock', (select count(*) from productos p where p.empresa_id = s.s_empresa and p.activo and p.es_vendible and p.controla_stock and p.stock_actual <= 0),
      'vencidos', (select jsonb_build_object('lotes', count(*), 'unidades', coalesce(sum(cantidad), 0),
                                             'valor', case when s.s_admin then round(coalesce(sum(valor), 0)) end)
                     from lotes_v where vencimiento < v_hoy),
      'por_vencer', (select jsonb_build_object('lotes', count(*), 'unidades', coalesce(sum(cantidad), 0),
                                               'valor', case when s.s_admin then round(coalesce(sum(valor), 0)) end)
                       from lotes_v where vencimiento >= v_hoy),
      'en_transito', (select jsonb_build_object('cantidad', count(*), 'unidades', coalesce(sum(t.total_unidades), 0),
                                                'valor', case when s.s_admin then coalesce(sum(t.valor_costo), 0) end)
                        from traslados t
                        join depositos o on o.id = t.deposito_origen_id join depositos d on d.id = t.deposito_destino_id
                       where t.empresa_id = s.s_empresa and t.estado = 'en_transito'
                         and (s.s_sucursal is null or o.sucursal_id = s.s_sucursal or d.sucursal_id = s.s_sucursal)),
      'perdidas_mes', (select jsonb_build_object('documentos', count(distinct documento_id), 'unidades', coalesce(sum(unidades), 0),
                                                 'valor', case when s.s_admin then coalesce(sum(valor), 0) end) from perd),
      'perdidas_pendientes', (select count(*) from ajustes_inventario a join depositos d on d.id = a.deposito_id
                               where a.empresa_id = s.s_empresa and a.tipo = 'perdida' and a.estado = 'pendiente'
                                 and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal))),
    'cajas_abiertas', (select count(*) from cajas c where c.empresa_id = s.s_empresa and c.estado <> 'cerrada'
                         and (s.s_sucursal is null or c.sucursal_id = s.s_sucursal))
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 2. CIERRE DE CAJA POR DÍA (ADMIN; SUPERVISOR solo su sucursal)
-- =============================================================================
-- p_turnos: además, un renglón por turno (para el Excel).
drop function if exists :"schema".reporte_cierres_dias(date, date, uuid);
create or replace function :"schema".reporte_cierres_dias(p_desde date default null, p_hasta date default null, p_sucursal uuid default null, p_turnos boolean default false)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN', 'SUPERVISOR'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);

  with t as (
    select c.id, (c.fecha_apertura at time zone 'America/Asuncion')::date as dia, c.estado, c.sucursal_id,
           c.monto_apertura, c.diferencia, c.diferencia_otros, c.numero_caja, c.fecha_apertura, c.fecha_cierre,
           c.monto_cierre_contado, c.motivo_diferencia, c.abierta_por, c.cerrada_por, c.punto_venta_id
      from cajas c
     where c.empresa_id = s.s_empresa
       and c.fecha_apertura >= rep_ts(g.r_desde) and c.fecha_apertura < rep_ts(g.r_hasta + 1)
       and (s.s_sucursal is null or c.sucursal_id = s.s_sucursal)
  ),
  mv as (
    select m.caja_id, metodo_caja(coalesce(m.metodo, m.medio_pago)) as met, m.monto, m.tipo, m.venta_id,
           case when m.venta_id is not null and m.tipo = 'ingreso' then 'venta'
                when m.venta_id is not null then 'devolucion'
                when m.cobro_id is not null then 'cobro'
                when m.compra_id is not null or m.gasto_id is not null or m.pago_proveedor_id is not null then 'egreso'
                else 'manual' end as origen,
           case when m.tipo in ('ingreso', 'ajuste') then 1 when m.tipo in ('egreso', 'retiro') then -1 else 0 end as signo
      from caja_movimientos m join t on t.id = m.caja_id
     where m.anulado_at is null
  ),
  porturno as (
    select t.id, t.dia, t.estado, t.sucursal_id, t.diferencia, t.diferencia_otros, t.numero_caja, t.fecha_apertura, t.fecha_cierre,
           t.monto_apertura, t.monto_cierre_contado, t.motivo_diferencia, t.abierta_por, t.cerrada_por, t.punto_venta_id,
           coalesce(a.contado, 0) as contado, coalesce(a.n_contado, 0) as n_contado, coalesce(a.cobros, 0) as cobros,
           coalesce(a.egresos, 0) as egresos, coalesce(a.retiros, 0) as retiros, coalesce(a.ingresos, 0) as ingresos,
           t.monto_apertura + coalesce(a.efectivo_neto, 0) as efectivo_esperado,
           coalesce(cr.total, 0) as credito, coalesce(cr.n, 0) as n_credito,
           coalesce(an.total, 0) as anuladas_total, coalesce(an.n, 0) as anuladas
      from t
      left join (
        select caja_id,
               sum(monto) filter (where origen = 'venta') as contado,
               count(distinct venta_id) filter (where origen = 'venta') as n_contado,
               sum(monto) filter (where origen = 'cobro' and signo > 0) as cobros,
               sum(monto) filter (where signo < 0 and (origen in ('egreso', 'devolucion') or (origen = 'manual' and tipo = 'egreso'))) as egresos,
               sum(monto) filter (where origen = 'manual' and tipo = 'retiro') as retiros,
               sum(monto) filter (where origen = 'manual' and tipo = 'ingreso') as ingresos,
               sum(monto * signo) filter (where met = 'efectivo') as efectivo_neto
          from mv group by caja_id) a on a.caja_id = t.id
      left join (select v.caja_id, sum(v.total) total, count(*) n from ventas v join t on t.id = v.caja_id
                  where v.tipo_venta = 'CREDITO' and v.estado <> 'anulada' group by v.caja_id) cr on cr.caja_id = t.id
      left join (select v.caja_id, sum(v.total) total, count(*) n from ventas v join t on t.id = v.caja_id
                  where v.estado = 'anulada' group by v.caja_id) an on an.caja_id = t.id
  ),
  metodo_dia as (
    select t.dia, mv.met, sum(mv.monto) as total from mv join t on t.id = mv.caja_id where mv.origen = 'venta' group by t.dia, mv.met
  ),
  dias as (
    select p.dia,
           count(*) as turnos, count(*) filter (where p.estado <> 'cerrada') as abiertos,
           sum(p.contado) as contado, sum(p.credito) as credito, sum(p.contado + p.credito) as total,
           sum(p.n_contado + p.n_credito) as cantidad, sum(p.cobros) as cobros, sum(p.egresos) as egresos,
           sum(p.retiros) as retiros, sum(p.ingresos) as ingresos, sum(p.efectivo_esperado) as efectivo_esperado,
           coalesce(sum(p.diferencia), 0) as diferencia, coalesce(sum(p.diferencia_otros), 0) as diferencia_otros,
           count(*) filter (where coalesce(p.diferencia, 0) <> 0 or coalesce(p.diferencia_otros, 0) <> 0) as con_diferencia,
           sum(p.anuladas) as anuladas, sum(p.anuladas_total) as anuladas_total,
           array_agg(distinct p.sucursal_id) as sucs
      from porturno p group by p.dia
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal, 'es_admin', s.s_admin,
    'sucursales', rep_sucursales(s.s_empresa, s.s_admin, s.s_sucursal),
    'metodos', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', metodo_caja_label(met)) order by metodo_caja_orden(met))
                           from (select distinct met from metodo_dia) x), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(jsonb_build_object(
        'dia', d.dia, 'turnos', d.turnos, 'abiertos', d.abiertos, 'contado', d.contado, 'credito', d.credito, 'total', d.total,
        'cantidad', d.cantidad, 'cobros', d.cobros, 'egresos', d.egresos, 'retiros', d.retiros, 'ingresos', d.ingresos,
        'efectivo_esperado', d.efectivo_esperado, 'diferencia', d.diferencia, 'diferencia_otros', d.diferencia_otros,
        'con_diferencia', d.con_diferencia, 'anuladas', d.anuladas, 'anuladas_total', d.anuladas_total,
        'sucursales', (select coalesce(jsonb_agg(su.nombre order by su.es_principal desc, su.nombre), '[]'::jsonb) from sucursales su where su.id = any (d.sucs)),
        'por_metodo', coalesce((select jsonb_object_agg(md.met, md.total) from metodo_dia md where md.dia = d.dia), '{}'::jsonb)
      ) order by d.dia desc) from dias d), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'dias', count(*), 'turnos', coalesce(sum(turnos), 0), 'abiertos', coalesce(sum(abiertos), 0),
        'contado', coalesce(sum(contado), 0), 'credito', coalesce(sum(credito), 0), 'total', coalesce(sum(total), 0),
        'cantidad', coalesce(sum(cantidad), 0), 'cobros', coalesce(sum(cobros), 0), 'egresos', coalesce(sum(egresos), 0),
        'retiros', coalesce(sum(retiros), 0), 'diferencia', coalesce(sum(diferencia), 0),
        'diferencia_otros', coalesce(sum(diferencia_otros), 0), 'con_diferencia', coalesce(sum(con_diferencia), 0),
        'anuladas', coalesce(sum(anuladas), 0), 'anuladas_total', coalesce(sum(anuladas_total), 0),
        'por_metodo', coalesce((select jsonb_object_agg(met, t) from (select met, sum(total) t from metodo_dia group by met) x), '{}'::jsonb))
      from dias),
    'turnos', case when p_turnos then coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'dia', p.dia, 'numero_caja', p.numero_caja, 'estado', p.estado, 'sucursal_nombre', su.nombre, 'punto_nombre', pv.nombre,
        'fecha_apertura', p.fecha_apertura, 'fecha_cierre', p.fecha_cierre, 'abierta_por_nombre', ua.nombre, 'cerrada_por_nombre', uc.nombre,
        'monto_apertura', p.monto_apertura, 'contado', p.contado, 'credito', p.credito, 'total', p.contado + p.credito,
        'cantidad', p.n_contado + p.n_credito, 'cobros', p.cobros, 'egresos', p.egresos, 'retiros', p.retiros, 'ingresos', p.ingresos,
        'efectivo_esperado', p.efectivo_esperado, 'efectivo_contado', p.monto_cierre_contado, 'diferencia', p.diferencia,
        'diferencia_otros', p.diferencia_otros, 'motivo_diferencia', p.motivo_diferencia, 'anuladas', p.anuladas,
        'por_metodo', coalesce(mt.j, '{}'::jsonb))
        order by p.fecha_apertura, su.nombre)
        from porturno p left join sucursales su on su.id = p.sucursal_id left join puntos_venta pv on pv.id = p.punto_venta_id
        left join (select caja_id, jsonb_object_agg(met, t) as j
                     from (select caja_id, met, sum(monto) t from mv where origen = 'venta' group by caja_id, met) x group by caja_id) mt on mt.caja_id = p.id
        left join usuarios ua on ua.id = p.abierta_por left join usuarios uc on uc.id = p.cerrada_por), '[]'::jsonb) end
  ) into r;
  return r;
end;
$fn$;

-- Un día: el resumen completo de cada turno (resumen_turno, UNA vez por turno) y, armados a
-- partir de esos mismos resúmenes, los totales del día con la forma de resumen_cajas_dia
-- (turnos, totales, metodos, por_sucursal) — así el día y sus turnos no pueden descuadrar.
create or replace function :"schema".reporte_cierre_dia(p_fecha date, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Asuncion')::date);
  r jsonb;
  det jsonb;
begin
  select * into s from rep_sesion(array['ADMIN', 'SUPERVISOR'], p_sucursal);
  select coalesce(jsonb_agg(resumen_turno(c.id) order by su.es_principal desc, su.nombre, pv.nombre, c.fecha_apertura), '[]'::jsonb)
    into det
    from cajas c
    left join sucursales su on su.id = c.sucursal_id
    left join puntos_venta pv on pv.id = c.punto_venta_id
   where c.empresa_id = s.s_empresa
     and c.fecha_apertura >= rep_ts(v_fecha) and c.fecha_apertura < rep_ts(v_fecha + 1)
     and (s.s_sucursal is null or c.sucursal_id = s.s_sucursal);

  with filas as (
    select jsonb_build_object(
             'id', rt->'caja'->'id', 'numero_caja', rt->'caja'->'numero_caja', 'estado', rt->'caja'->'estado',
             'punto_nombre', rt->'caja'->'punto_nombre', 'sucursal_id', rt->'caja'->'sucursal_id',
             'sucursal_nombre', rt->'caja'->'sucursal_nombre', 'abierta_por_nombre', rt->'caja'->'abierta_por_nombre',
             'cerrada_por_nombre', rt->'caja'->'cerrada_por_nombre',
             'fecha_apertura', rt->'caja'->'fecha_apertura', 'fecha_cierre', rt->'caja'->'fecha_cierre',
             'monto_apertura', (rt->'caja'->>'monto_apertura')::numeric,
             'ventas_contado', (rt->'ventas'->'contado'->>'total')::numeric,
             'ventas_credito', (rt->'ventas'->'credito'->>'total')::numeric,
             'total_vendido', (rt->'ventas'->>'total')::numeric,
             'cantidad_ventas', (rt->'ventas'->>'cantidad')::numeric,
             'cobros', (rt->'cobros'->>'total')::numeric,
             'egresos', (rt->'egresos'->>'total')::numeric + (rt->'manuales'->'egresos'->>'total')::numeric,
             'retiros', (rt->'manuales'->'retiros'->>'total')::numeric,
             'ingresos', (rt->'manuales'->'ingresos'->>'total')::numeric,
             'efectivo_esperado', (rt->'efectivo'->>'esperado')::numeric,
             'efectivo_contado', (rt->'efectivo'->>'contado')::numeric,
             'diferencia', (rt->'caja'->>'diferencia')::numeric,
             'diferencia_otros', (rt->'caja'->>'diferencia_otros')::numeric,
             'metodos', rt->'metodos') as f
      from jsonb_array_elements(det) rt
  )
  select jsonb_build_object(
    'fecha', v_fecha,
    'sucursal_id', s.s_sucursal,
    'turnos', coalesce((select jsonb_agg(f) from filas), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'turnos', count(*),
        'abiertos', count(*) filter (where f->>'estado' <> 'cerrada'),
        'total_vendido', coalesce(sum((f->>'total_vendido')::numeric), 0),
        'ventas_contado', coalesce(sum((f->>'ventas_contado')::numeric), 0),
        'ventas_credito', coalesce(sum((f->>'ventas_credito')::numeric), 0),
        'cantidad_ventas', coalesce(sum((f->>'cantidad_ventas')::numeric), 0),
        'cobros', coalesce(sum((f->>'cobros')::numeric), 0),
        'egresos', coalesce(sum((f->>'egresos')::numeric), 0),
        'retiros', coalesce(sum((f->>'retiros')::numeric), 0),
        'ingresos', coalesce(sum((f->>'ingresos')::numeric), 0),
        'efectivo_esperado', coalesce(sum((f->>'efectivo_esperado')::numeric), 0),
        'diferencia', coalesce(sum((f->>'diferencia')::numeric), 0),
        'diferencia_otros', coalesce(sum((f->>'diferencia_otros')::numeric), 0)) from filas),
    'metodos', coalesce((
      select jsonb_agg(jsonb_build_object('metodo', met, 'label', metodo_caja_label(met), 'ingresos', ing, 'egresos', egr, 'esperado', esp)
                       order by metodo_caja_orden(met))
        from (select m.v->>'metodo' as met, sum((m.v->>'ingresos')::numeric) as ing, sum((m.v->>'egresos')::numeric) as egr,
                     sum((m.v->>'esperado')::numeric) as esp
                from filas, jsonb_array_elements(f->'metodos') as m(v) group by 1) x), '[]'::jsonb),
    'por_sucursal', coalesce((
      select jsonb_agg(jsonb_build_object('sucursal_id', sid, 'sucursal_nombre', snom, 'turnos', n, 'total_vendido', tv,
                                          'ventas_contado', vc, 'ventas_credito', vcr, 'efectivo_esperado', ee, 'diferencia', dif)
                       order by snom)
        from (select f->>'sucursal_id' as sid, f->>'sucursal_nombre' as snom, count(*) as n,
                     sum((f->>'total_vendido')::numeric) as tv, sum((f->>'ventas_contado')::numeric) as vc,
                     sum((f->>'ventas_credito')::numeric) as vcr, sum((f->>'efectivo_esperado')::numeric) as ee,
                     coalesce(sum((f->>'diferencia')::numeric), 0) as dif
                from filas group by 1, 2) x), '[]'::jsonb)
  ) into r;

  return r || jsonb_build_object(
    'es_admin', s.s_admin,
    'sucursales', rep_sucursales(s.s_empresa, s.s_admin, s.s_sucursal),
    'detalle', det,
    -- Ventas del día sumadas por método (contado por forma de pago + crédito): cuadra con total_vendido.
    'ventas_por_metodo', coalesce((
      select jsonb_agg(jsonb_build_object('metodo', met, 'label', lbl, 'cantidad', n, 'total', t) order by o)
        from (select x->>'metodo' as met, max(x->>'label') as lbl, sum((x->>'cantidad')::numeric) as n, sum((x->>'total')::numeric) as t,
                     metodo_caja_orden(x->>'metodo') as o
                from jsonb_array_elements(det) d, jsonb_array_elements(d->'ventas'->'por_metodo') x group by x->>'metodo'
              union all
              select 'credito', 'Crédito', sum((d->'ventas'->'credito'->>'cantidad')::numeric), sum((d->'ventas'->'credito'->>'total')::numeric), 99
                from jsonb_array_elements(det) d having sum((d->'ventas'->'credito'->>'total')::numeric) > 0) q), '[]'::jsonb));
end;
$fn$;

-- =============================================================================
-- 3. ESTADO DE CUENTA DE LA EMPRESA (ADMIN)
-- =============================================================================
create or replace function :"schema".reporte_estado_cuenta(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  ga jsonb;
  v_mes_ini date;
  v_fin timestamptz;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);
  v_fin := rep_ts(g.r_hasta + 1);
  -- Compras de mercadería y gastos operativos: la MISMA cuenta que Gastos empresariales.
  ga := gastos_resumen(g.r_desde, g.r_hasta, s.s_sucursal);
  v_mes_ini := least(g.r_desde, (select min((x->>'mes')::date) from jsonb_array_elements(ga->'por_mes') x));

  with vi as (
    select (v.fecha at time zone 'America/Asuncion')::date as dia,
           vi.total_linea * rep_fx(v.moneda, v.tipo_cambio) as monto,
           vi.monto_iva * rep_fx(v.moneda, v.tipo_cambio) as iva,
           vi.cantidad * coalesce(vi.costo_unitario, 0) * rep_fx(v.moneda, v.tipo_cambio) as costo,
           vi.producto_id, coalesce(vi.costo_unitario, 0) = 0 and vi.producto_id is not null as sin_costo, v.id as venta_id
      from ventas v join ventas_items vi on vi.venta_id = v.id
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada'
       and v.fecha >= rep_ts(v_mes_ini) and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  per as (select * from vi where dia >= g.r_desde),
  perd as (select * from rep_perdidas_base(s.s_empresa, s.s_sucursal, rep_ts(v_mes_ini), v_fin)),
  perd_per as (select * from perd where dia >= g.r_desde),
  -- CxC al cierre del rango (emitidas hasta `hasta` menos lo cobrado hasta ese día).
  cxc as (
    select x.monto - coalesce((select sum(a.monto) from cobros_aplicaciones a join cobros_clientes c on c.id = a.cobro_id
                                where a.cxc_id = x.id and c.anulado_at is null and c.fecha < v_fin), 0) as saldo,
           x.vencimiento
      from cuentas_por_cobrar x join ventas v on v.id = x.venta_id
     where x.empresa_id = s.s_empresa and x.estado <> 'anulada' and x.fecha_emision <= g.r_hasta
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  cxp as (
    select (x.monto - coalesce((select sum(a.monto) from pagos_proveedores_aplicaciones a join pagos_proveedores p on p.id = a.pago_id
                                 where a.cxp_id = x.id and p.anulado_at is null and p.fecha < v_fin), 0))
           * case when x.moneda = 'USD' then coalesce(gg.tipo_cambio, co.tipo_cambio, 1) else 1 end as saldo,
           x.vencimiento
      from cuentas_por_pagar x
      left join gastos gg on gg.id = x.gasto_id
      left join compras co on co.id = x.compra_id
      left join depositos d on d.id = co.deposito_id
     where x.empresa_id = s.s_empresa and x.estado <> 'anulada' and x.fecha_emision <= g.r_hasta
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id) = s.s_sucursal)
  ),
  -- Flujo de caja del rango (lo que efectivamente entró y salió, por cualquier medio).
  cobrado as (
    select 'ventas_contado' as concepto, d.monto * rep_fx(v.moneda, v.tipo_cambio) as monto
      from ventas v join ventas_pagos_detalle d on d.venta_id = v.id
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada' and v.tipo_venta <> 'CREDITO'
       and v.fecha >= rep_ts(g.r_desde) and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
    union all
    select 'ventas_contado', v.total * rep_fx(v.moneda, v.tipo_cambio)
      from ventas v
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada' and v.tipo_venta <> 'CREDITO'
       and v.fecha >= rep_ts(g.r_desde) and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
       and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = v.id)
    union all
    select 'cobros', c.total from cobros_clientes c
     where s.s_sucursal is null and c.empresa_id = s.s_empresa and c.anulado_at is null
       and c.fecha >= rep_ts(g.r_desde) and c.fecha < v_fin
    union all
    select 'cobros', a.monto from cobros_clientes c join cobros_aplicaciones a on a.cobro_id = c.id
      join cuentas_por_cobrar x on x.id = a.cxc_id join ventas v on v.id = x.venta_id
     where s.s_sucursal is not null and c.empresa_id = s.s_empresa and c.anulado_at is null
       and c.fecha >= rep_ts(g.r_desde) and c.fecha < v_fin and coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal
  ),
  pagado as (
    select 'compras_contado' as concepto, round(c.total * rep_fx(c.moneda, c.tipo_cambio)) as monto
      from compras c left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada' and coalesce(c.tipo_pago, 'contado') = 'contado'
       and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)
    union all
    select 'gastos_contado', round(i.monto * g2.tipo_cambio)
      from gastos g2 join gasto_items i on i.gasto_id = g2.id
     where g2.empresa_id = s.s_empresa and g2.estado = 'confirmado' and coalesce(g2.tipo_pago, 'contado') = 'contado'
       and g2.fecha between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(i.sucursal_id, g2.sucursal_id) = s.s_sucursal)
    union all
    select 'pagos_proveedores', round(a.monto * case when x.moneda = 'USD' then coalesce(gg.tipo_cambio, co.tipo_cambio, 1) else 1 end)
      from pagos_proveedores p join pagos_proveedores_aplicaciones a on a.pago_id = p.id
      join cuentas_por_pagar x on x.id = a.cxp_id
      left join gastos gg on gg.id = x.gasto_id left join compras co on co.id = x.compra_id left join depositos d on d.id = co.deposito_id
     where p.empresa_id = s.s_empresa and p.anulado_at is null and p.fecha >= rep_ts(g.r_desde) and p.fecha < v_fin
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id) = s.s_sucursal)
  ),
  meses as (select (x->>'mes')::date as mes, (x->>'compras')::numeric as compras, (x->>'operativos')::numeric as operativos
              from jsonb_array_elements(ga->'por_mes') x),
  vi_mes as (select date_trunc('month', dia)::date as mes, sum(monto) as ventas, sum(costo) as cmv from vi group by 1),
  perd_mes as (select date_trunc('month', dia)::date as mes, sum(valor) as perdidas from perd group by 1)
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'ventas', (select jsonb_build_object(
        'netas', round(coalesce(sum(monto), 0)), 'iva', round(coalesce(sum(iva), 0)), 'cmv', round(coalesce(sum(costo), 0)),
        'cantidad', count(distinct venta_id), 'productos_sin_costo', count(distinct producto_id) filter (where sin_costo))
      from per),
    'anuladas', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(v.total * rep_fx(v.moneda, v.tipo_cambio)), 0))
                   from ventas v where v.empresa_id = s.s_empresa and v.estado = 'anulada'
                    and v.fecha >= rep_ts(g.r_desde) and v.fecha < v_fin
                    and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)),
    'gastos', jsonb_build_object(
        'compras', (ga->'totales'->>'compras')::numeric, 'operativos', (ga->'totales'->>'operativos')::numeric,
        'iva_credito', (ga->'totales'->>'iva_credito')::numeric, 'fijo', (ga->'totales'->>'fijo')::numeric,
        'docs_compras', (ga->'totales'->>'docs_compras')::numeric, 'docs_gastos', (ga->'totales'->>'docs_gastos')::numeric,
        'por_rubro', coalesce((select jsonb_agg(jsonb_build_object('id', x->'id', 'nombre', x->'nombre', 'total', x->'total') order by (x->>'total')::numeric desc)
                                 from jsonb_array_elements(ga->'por_rubro') x where not (x->>'mercaderia')::boolean and (x->>'total')::numeric > 0), '[]'::jsonb)),
    'perdidas', (select jsonb_build_object(
        'total', coalesce(sum(valor), 0), 'unidades', coalesce(sum(unidades), 0),
        'pe', coalesce(sum(valor) filter (where origen = 'perdida'), 0), 'traslados', coalesce(sum(valor) filter (where origen = 'traslado'), 0),
        'por_motivo', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'label', rep_motivo_perdida(motivo), 'valor', t) order by t desc)
                                  from (select motivo, sum(valor) t from perd_per group by motivo) x), '[]'::jsonb))
      from perd_per),
    'cxc', (select jsonb_build_object('saldo', coalesce(sum(saldo) filter (where saldo > 0), 0),
                                      'vencido', coalesce(sum(saldo) filter (where saldo > 0 and vencimiento < g.r_hasta), 0)) from cxc),
    'cxp', (select jsonb_build_object('saldo', round(coalesce(sum(saldo) filter (where saldo > 0), 0)),
                                      'vencido', round(coalesce(sum(saldo) filter (where saldo > 0 and vencimiento < g.r_hasta), 0))) from cxp),
    'flujo', jsonb_build_object(
        'ventas_contado', (select round(coalesce(sum(monto), 0)) from cobrado where concepto = 'ventas_contado'),
        'cobros', (select round(coalesce(sum(monto), 0)) from cobrado where concepto = 'cobros'),
        'compras_contado', (select coalesce(sum(monto), 0) from pagado where concepto = 'compras_contado'),
        'gastos_contado', (select coalesce(sum(monto), 0) from pagado where concepto = 'gastos_contado'),
        'pagos_proveedores', (select coalesce(sum(monto), 0) from pagado where concepto = 'pagos_proveedores')),
    'por_mes', (select jsonb_agg(jsonb_build_object(
        'mes', m.mes, 'ventas', round(coalesce(vm.ventas, 0)), 'cmv', round(coalesce(vm.cmv, 0)),
        'compras', m.compras, 'operativos', m.operativos, 'perdidas', coalesce(pm.perdidas, 0)) order by m.mes)
      from meses m left join vi_mes vm on vm.mes = m.mes left join perd_mes pm on pm.mes = m.mes)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 4. PROVEEDORES (ADMIN)
-- =============================================================================
create or replace function :"schema".reporte_proveedores(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);

  with co as (
    select c.proveedor_id, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           round(c.total * rep_fx(c.moneda, c.tipo_cambio)) as total
      from compras c left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada'
       and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)
  ),
  co_per as (
    select proveedor_id, sum(total) as total, count(*) as n from co where fecha between g.r_desde and g.r_hasta group by proveedor_id
  ),
  co_ult as (select proveedor_id, max(fecha) as ultima from co group by proveedor_id),
  ga as (
    select g2.proveedor_id, sum(round(i.monto * g2.tipo_cambio)) as total, count(distinct g2.id) as n
      from gastos g2 join gasto_items i on i.gasto_id = g2.id
     where g2.empresa_id = s.s_empresa and g2.estado = 'confirmado' and g2.proveedor_id is not null
       and g2.fecha between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(i.sucursal_id, g2.sucursal_id) = s.s_sucursal)
     group by g2.proveedor_id
  ),
  deuda as (
    select x.proveedor_id,
           sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(gg.tipo_cambio, cc.tipo_cambio, 1)) else x.saldo end) as saldo_gs,
           sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(gg.tipo_cambio, cc.tipo_cambio, 1)) else x.saldo end)
             filter (where x.vencimiento < v_hoy) as vencido_gs,
           sum(x.saldo) filter (where x.moneda = 'USD') as saldo_usd
      from cuentas_por_pagar x left join gastos gg on gg.id = x.gasto_id left join compras cc on cc.id = x.compra_id
      left join depositos d on d.id = cc.deposito_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id) = s.s_sucursal)
     group by x.proveedor_id
  ),
  prods as (select proveedor_principal_id as id, count(*) as n from productos
             where empresa_id = s.s_empresa and activo and proveedor_principal_id is not null group by proveedor_principal_id),
  filas as (
    select p.id, p.nombre, p.nombre_comercial, p.ruc, p.telefono, p.activo,
           coalesce(cp.total, 0) as compras, coalesce(cp.n, 0) as compras_cant, cu.ultima as ultima_compra,
           coalesce(ga.total, 0) as gastos, coalesce(ga.n, 0) as gastos_cant,
           coalesce(de.saldo_gs, 0) as deuda_gs, coalesce(de.vencido_gs, 0) as vencido_gs, coalesce(de.saldo_usd, 0) as deuda_usd,
           coalesce(pr.n, 0) as productos
      from proveedores p
      left join co_per cp on cp.proveedor_id = p.id
      left join co_ult cu on cu.proveedor_id = p.id
      left join ga on ga.proveedor_id = p.id
      left join deuda de on de.proveedor_id = p.id
      left join prods pr on pr.id = p.id
     where p.empresa_id = s.s_empresa
       and (p.activo or cp.n > 0 or ga.n > 0 or de.saldo_gs > 0)
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.compras desc, f.gastos desc, f.nombre) from filas f), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'compras', coalesce(sum(compras), 0), 'compras_cant', coalesce(sum(compras_cant), 0), 'gastos', coalesce(sum(gastos), 0),
        'deuda_gs', coalesce(sum(deuda_gs), 0), 'vencido_gs', coalesce(sum(vencido_gs), 0), 'deuda_usd', coalesce(sum(deuda_usd), 0),
        'proveedores_con_compras', count(*) filter (where compras_cant > 0),
        'compras_sin_proveedor', (select coalesce(sum(total), 0) from co where proveedor_id is null and fecha between g.r_desde and g.r_hasta))
      from filas)
  ) into r;
  return r;
end;
$fn$;

create or replace function :"schema".reporte_proveedor(p_proveedor uuid, p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  pr record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_mes_ini date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);
  select * into pr from proveedores where id = p_proveedor and empresa_id = s.s_empresa;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  v_mes_ini := (date_trunc('month', g.r_hasta) - interval '11 months')::date;

  with co as (
    select c.id, c.numero_control, c.numero_factura, c.tipo_pago, c.moneda, c.total, c.estado,
           coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           round(c.total * rep_fx(c.moneda, c.tipo_cambio)) as total_gs, rep_fx(c.moneda, c.tipo_cambio) as fx,
           d.nombre as deposito_nombre, su.nombre as sucursal_nombre
      from compras c left join depositos d on d.id = c.deposito_id left join sucursales su on su.id = d.sucursal_id
     where c.empresa_id = s.s_empresa and c.proveedor_id = p_proveedor
       and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)
  ),
  vivas as (select * from co where estado = 'registrada'),
  ci as (
    select ci.producto_id, ci.producto_nombre, ci.producto_sku, ci.cantidad, ci.costo_unitario * vv.fx as costo_gs,
           round(ci.total * vv.fx) as total_gs, vv.fecha, vv.id as compra_id
      from compras_items ci join vivas vv on vv.id = ci.compra_id
  ),
  prod as (
    select p.id, p.nombre, p.sku, p.stock_actual, p.costo_promedio, p.precio_venta, p.activo,
           p.proveedor_principal_id = p_proveedor as principal,
           (select max(ci.fecha) from ci where ci.producto_id = p.id) as ultima_compra,
           (select ci.costo_gs from ci where ci.producto_id = p.id order by ci.fecha desc, ci.compra_id limit 1) as ultimo_costo,
           coalesce((select sum(ci.cantidad) from ci where ci.producto_id = p.id and ci.fecha between g.r_desde and g.r_hasta), 0) as cantidad,
           coalesce((select sum(ci.total_gs) from ci where ci.producto_id = p.id and ci.fecha between g.r_desde and g.r_hasta), 0) as monto,
           coalesce((select count(distinct ci.compra_id) from ci where ci.producto_id = p.id and ci.fecha between g.r_desde and g.r_hasta), 0) as compras
      from productos p
     where p.empresa_id = s.s_empresa
       and (p.proveedor_principal_id = p_proveedor or p.id in (select producto_id from ci where producto_id is not null))
  ),
  cxp as (
    select x.id, x.numero, x.moneda, x.monto, x.pagado, x.saldo, x.fecha_emision, x.vencimiento, x.estado,
           case when x.compra_id is not null then 'compra' else 'gasto' end as origen, coalesce(x.compra_id, x.gasto_id) as doc_id,
           coalesce(cc.numero_control, gg.numero) as documento,
           greatest(v_hoy - x.vencimiento, 0) as dias_atraso,
           case when x.moneda = 'USD' then round(x.saldo * coalesce(gg.tipo_cambio, cc.tipo_cambio, 1)) else x.saldo end as saldo_gs
      from cuentas_por_pagar x left join compras cc on cc.id = x.compra_id left join gastos gg on gg.id = x.gasto_id
      left join depositos d on d.id = cc.deposito_id
     where x.empresa_id = s.s_empresa and x.proveedor_id = p_proveedor and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id) = s.s_sucursal)
  ),
  ga as (
    select g2.id, g2.numero, g2.fecha, g2.descripcion, round(i.monto * g2.tipo_cambio) as monto
      from gastos g2 join gasto_items i on i.gasto_id = g2.id
     where g2.empresa_id = s.s_empresa and g2.proveedor_id = p_proveedor and g2.estado = 'confirmado'
       and g2.fecha between least(g.r_desde, v_mes_ini) and g.r_hasta
       and (s.s_sucursal is null or coalesce(i.sucursal_id, g2.sucursal_id) = s.s_sucursal)
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'proveedor', jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'nombre_comercial', pr.nombre_comercial, 'ruc', pr.ruc,
        'telefono', pr.telefono, 'email', pr.email, 'contacto', pr.contacto, 'ciudad', pr.ciudad, 'condicion_pago', pr.condicion_pago,
        'plazo_pago_dias', pr.plazo_pago_dias, 'moneda', pr.moneda, 'activo', pr.activo),
    'kpis', (select jsonb_build_object(
        'compras', coalesce(sum(total_gs) filter (where fecha between g.r_desde and g.r_hasta), 0),
        'compras_cant', count(*) filter (where fecha between g.r_desde and g.r_hasta),
        'ultima_compra', max(fecha), 'primera_compra', min(fecha), 'compras_historicas', coalesce(sum(total_gs), 0),
        'gastos', (select coalesce(sum(monto), 0) from ga where fecha between g.r_desde and g.r_hasta),
        'deuda_gs', (select coalesce(sum(saldo_gs), 0) from cxp),
        'vencido_gs', (select coalesce(sum(saldo_gs), 0) from cxp where dias_atraso > 0),
        'deuda_usd', (select coalesce(sum(saldo), 0) from cxp where moneda = 'USD'),
        'pagado', (select coalesce(sum(p.total), 0) from pagos_proveedores p where p.empresa_id = s.s_empresa and p.proveedor_id = p_proveedor
                     and p.anulado_at is null and p.moneda = 'GS' and p.fecha >= rep_ts(g.r_desde) and p.fecha < rep_ts(g.r_hasta + 1)))
      from vivas),
    'compras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero_control', c.numero_control, 'numero_factura', c.numero_factura, 'fecha', c.fecha, 'tipo_pago', c.tipo_pago,
        'moneda', c.moneda, 'total', c.total, 'total_gs', c.total_gs, 'estado', c.estado, 'sucursal_nombre', c.sucursal_nombre,
        'deposito_nombre', c.deposito_nombre, 'items', (select count(*) from compras_items x where x.compra_id = c.id),
        'saldo', (select x.saldo from cuentas_por_pagar x where x.compra_id = c.id and x.estado in ('pendiente', 'parcial')))
        order by c.fecha desc, c.numero_control desc)
        from co c where c.fecha between g.r_desde and g.r_hasta), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(to_jsonb(x) order by x.monto desc, x.principal desc, x.nombre) from prod x), '[]'::jsonb),
    'por_mes', (select jsonb_agg(jsonb_build_object('mes', m,
        'compras', coalesce((select sum(total_gs) from vivas where date_trunc('month', fecha)::date = m), 0),
        'operativos', coalesce((select sum(monto) from ga where date_trunc('month', fecha)::date = m), 0)) order by m)
      from (select (v_mes_ini + make_interval(months => k))::date as m from generate_series(0, 11) k) mm),
    'cuentas', coalesce((select jsonb_agg(to_jsonb(x) order by x.vencimiento, x.numero) from cxp x), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero, 'fecha', p.fecha, 'moneda', p.moneda,
        'total', p.total, 'anulado', p.anulado_at is not null,
        'medios', (select coalesce(jsonb_agg(jsonb_build_object('metodo', m.metodo, 'monto', m.monto)), '[]'::jsonb) from pagos_proveedores_medios m where m.pago_id = p.id))
        order by p.fecha desc)
        from pagos_proveedores p where p.empresa_id = s.s_empresa and p.proveedor_id = p_proveedor
         and p.fecha >= rep_ts(g.r_desde) and p.fecha < rep_ts(g.r_hasta + 1)), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 5. CUENTAS POR PAGAR (ADMIN) — foto de hoy; desde/hasta (opcionales) filtran la EMISIÓN.
-- =============================================================================
create or replace function :"schema".reporte_cxp(p_desde date default null, p_hasta date default null, p_sucursal uuid default null, p_proveedor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then raise exception 'El rango de fechas está invertido'; end if;

  with c as (
    select x.id, x.proveedor_id, pr.nombre as proveedor_nombre, pr.ruc as proveedor_ruc, pr.telefono as proveedor_telefono,
           case when x.compra_id is not null then 'compra' else 'gasto' end as origen, coalesce(x.compra_id, x.gasto_id) as doc_id,
           coalesce(cc.numero_control, gg.numero, x.numero) as documento, coalesce(cc.numero_factura, gg.numero_comprobante) as factura,
           coalesce(gg.descripcion, '') as descripcion,
           x.fecha_emision, x.vencimiento, x.moneda, x.monto, x.pagado, x.saldo,
           case when x.moneda = 'USD' then coalesce(gg.tipo_cambio, cc.tipo_cambio, 1) else 1 end as tc,
           greatest(v_hoy - x.vencimiento, 0) as dias_atraso, x.vencimiento - v_hoy as dias_para_vencer,
           coalesce(gg.sucursal_id, d.sucursal_id) as sucursal_id
      from cuentas_por_pagar x
      join proveedores pr on pr.id = x.proveedor_id
      left join compras cc on cc.id = x.compra_id
      left join gastos gg on gg.id = x.gasto_id
      left join depositos d on d.id = cc.deposito_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (p_proveedor is null or x.proveedor_id = p_proveedor)
       and (p_desde is null or x.fecha_emision >= p_desde) and (p_hasta is null or x.fecha_emision <= p_hasta)
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id) = s.s_sucursal)
  ),
  f as (
    select c.*, round(c.saldo * c.tc) as saldo_gs,
           case when c.dias_atraso = 0 then 'al_dia' when c.dias_atraso <= 30 then 'd1_30' when c.dias_atraso <= 60 then 'd31_60'
                when c.dias_atraso <= 90 then 'd61_90' else 'd90' end as tramo
      from c
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.vencimiento, f.documento) from f), '[]'::jsonb),
    'por_moneda', coalesce((select jsonb_object_agg(moneda, j) from (
        select moneda, jsonb_build_object(
          'saldo', sum(saldo), 'saldo_gs', sum(saldo_gs), 'cuentas', count(*),
          'vencido', coalesce(sum(saldo) filter (where dias_atraso > 0), 0),
          'al_dia', coalesce(sum(saldo) filter (where tramo = 'al_dia'), 0), 'd1_30', coalesce(sum(saldo) filter (where tramo = 'd1_30'), 0),
          'd31_60', coalesce(sum(saldo) filter (where tramo = 'd31_60'), 0), 'd61_90', coalesce(sum(saldo) filter (where tramo = 'd61_90'), 0),
          'd90', coalesce(sum(saldo) filter (where tramo = 'd90'), 0),
          'vence_7', coalesce(sum(saldo) filter (where dias_atraso = 0 and dias_para_vencer <= 7), 0)) as j
          from f group by moneda) x), '{}'::jsonb),
    'tramos_gs', (select jsonb_build_object(
        'al_dia', coalesce(sum(saldo_gs) filter (where tramo = 'al_dia'), 0), 'd1_30', coalesce(sum(saldo_gs) filter (where tramo = 'd1_30'), 0),
        'd31_60', coalesce(sum(saldo_gs) filter (where tramo = 'd31_60'), 0), 'd61_90', coalesce(sum(saldo_gs) filter (where tramo = 'd61_90'), 0),
        'd90', coalesce(sum(saldo_gs) filter (where tramo = 'd90'), 0), 'total', coalesce(sum(saldo_gs), 0),
        'vencido', coalesce(sum(saldo_gs) filter (where dias_atraso > 0), 0),
        'compras', coalesce(sum(saldo_gs) filter (where origen = 'compra'), 0), 'gastos', coalesce(sum(saldo_gs) filter (where origen = 'gasto'), 0),
        'proveedores', count(distinct proveedor_id)) from f),
    'por_proveedor', coalesce((select jsonb_agg(to_jsonb(x) order by x.saldo_gs desc) from (
        select proveedor_id as id, max(proveedor_nombre) as nombre, max(proveedor_telefono) as telefono, count(*) as cuentas,
               sum(saldo_gs) as saldo_gs, coalesce(sum(saldo_gs) filter (where dias_atraso > 0), 0) as vencido_gs,
               coalesce(sum(saldo) filter (where moneda = 'USD'), 0) as saldo_usd,
               coalesce(sum(saldo_gs) filter (where tramo = 'al_dia'), 0) as al_dia, coalesce(sum(saldo_gs) filter (where tramo = 'd1_30'), 0) as d1_30,
               coalesce(sum(saldo_gs) filter (where tramo = 'd31_60'), 0) as d31_60, coalesce(sum(saldo_gs) filter (where tramo = 'd61_90'), 0) as d61_90,
               coalesce(sum(saldo_gs) filter (where tramo = 'd90'), 0) as d90,
               min(vencimiento) filter (where dias_atraso = 0) as proximo_vencimiento, max(dias_atraso) as max_atraso
          from f group by proveedor_id) x), '[]'::jsonb),
    -- Próximas 8 semanas (desde hoy), en Gs.: para planificar los pagos.
    'calendario', (select jsonb_agg(jsonb_build_object('desde', v_hoy + k * 7, 'hasta', v_hoy + k * 7 + 6,
        'saldo_gs', coalesce((select sum(saldo_gs) from f where vencimiento between v_hoy + k * 7 and v_hoy + k * 7 + 6), 0)) order by k)
      from generate_series(0, 7) k)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 6. CUENTAS POR COBRAR (ADMIN) — foto de hoy; desde/hasta (opcionales) filtran la EMISIÓN.
-- =============================================================================
create or replace function :"schema".reporte_cxc(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then raise exception 'El rango de fechas está invertido'; end if;

  with c as (
    select x.id, x.cliente_id, coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as cliente_nombre, cl.telefono as cliente_telefono,
           coalesce(cl.ruc, cl.documento) as cliente_ruc, x.venta_id, x.numero as documento,
           case when v.suscripcion_id is not null then 'suscripcion'
                when v.caja_id is null and v.observaciones like 'Factura al contado%' then 'factura_contado'
                else 'credito' end as origen,
           x.fecha_emision, x.vencimiento, x.monto, x.cobrado, x.saldo, v.moneda,
           greatest(v_hoy - x.vencimiento, 0) as dias_atraso, x.vencimiento - v_hoy as dias_para_vencer,
           coalesce((select sum(cp.monto) from cobros_pendientes cp where cp.cxc_id = x.id and cp.estado = 'pendiente'), 0) as en_aprobacion,
           su.nombre as sucursal_nombre
      from cuentas_por_cobrar x
      join clientes cl on cl.id = x.cliente_id
      join ventas v on v.id = x.venta_id
      left join sucursales su on su.id = coalesce(v.sucursal_id, s.s_principal)
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (p_desde is null or x.fecha_emision >= p_desde) and (p_hasta is null or x.fecha_emision <= p_hasta)
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  f as (
    select c.*,
           case when c.dias_atraso = 0 then 'al_dia' when c.dias_atraso <= 30 then 'd1_30' when c.dias_atraso <= 60 then 'd31_60'
                when c.dias_atraso <= 90 then 'd61_90' else 'd90' end as tramo
      from c
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.vencimiento, f.documento) from f), '[]'::jsonb),
    'tramos', (select jsonb_build_object(
        'al_dia', coalesce(sum(saldo) filter (where tramo = 'al_dia'), 0), 'd1_30', coalesce(sum(saldo) filter (where tramo = 'd1_30'), 0),
        'd31_60', coalesce(sum(saldo) filter (where tramo = 'd31_60'), 0), 'd61_90', coalesce(sum(saldo) filter (where tramo = 'd61_90'), 0),
        'd90', coalesce(sum(saldo) filter (where tramo = 'd90'), 0), 'total', coalesce(sum(saldo), 0),
        'vencido', coalesce(sum(saldo) filter (where dias_atraso > 0), 0), 'en_aprobacion', coalesce(sum(en_aprobacion), 0),
        'vence_7', coalesce(sum(saldo) filter (where dias_atraso = 0 and dias_para_vencer <= 7), 0),
        'clientes', count(distinct cliente_id), 'cuentas', count(*)) from f),
    'por_origen', coalesce((select jsonb_agg(jsonb_build_object('origen', origen, 'saldo', t, 'cuentas', n) order by t desc)
        from (select origen, sum(saldo) t, count(*) n from f group by origen) x), '[]'::jsonb),
    'por_cliente', coalesce((select jsonb_agg(to_jsonb(x) order by x.saldo desc) from (
        select cliente_id as id, max(cliente_nombre) as nombre, max(cliente_telefono) as telefono, count(*) as cuentas,
               sum(saldo) as saldo, coalesce(sum(saldo) filter (where dias_atraso > 0), 0) as vencido,
               sum(en_aprobacion) as en_aprobacion, max(dias_atraso) as max_atraso,
               coalesce(sum(saldo) filter (where tramo = 'al_dia'), 0) as al_dia, coalesce(sum(saldo) filter (where tramo = 'd1_30'), 0) as d1_30,
               coalesce(sum(saldo) filter (where tramo = 'd31_60'), 0) as d31_60, coalesce(sum(saldo) filter (where tramo = 'd61_90'), 0) as d61_90,
               coalesce(sum(saldo) filter (where tramo = 'd90'), 0) as d90,
               min(vencimiento) filter (where dias_atraso = 0) as proximo_vencimiento,
               (select max(cc.fecha) from cobros_clientes cc where cc.cliente_id = f.cliente_id and cc.anulado_at is null) as ultimo_cobro
          from f group by cliente_id) x), '[]'::jsonb),
    -- Transferencias informadas que esperan la aprobación de Conciliación.
    'en_aprobacion', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'fecha', cp.fecha, 'monto', cp.monto,
        'cliente_nombre', coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre), 'documento', x.numero,
        'banco', cp.banco_origen, 'operacion', cp.numero_operacion, 'creado_por', cp.creado_por_nombre) order by cp.fecha)
        from cobros_pendientes cp join cuentas_por_cobrar x on x.id = cp.cxc_id join clientes cl on cl.id = cp.cliente_id
        join ventas v on v.id = x.venta_id
       where cp.empresa_id = s.s_empresa and cp.estado = 'pendiente'
         and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)), '[]'::jsonb),
    'calendario', (select jsonb_agg(jsonb_build_object('desde', v_hoy + k * 7, 'hasta', v_hoy + k * 7 + 6,
        'saldo', coalesce((select sum(saldo) from f where vencimiento between v_hoy + k * 7 and v_hoy + k * 7 + 6), 0)) order by k)
      from generate_series(0, 7) k)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 7. VENTAS TOTALES POR MES (ADMIN) — meses de desde..hasta (máx. 36) + mismos meses del año anterior.
-- =============================================================================
create or replace function :"schema".reporte_ventas_mes(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_hasta date := coalesce(p_hasta, (now() at time zone 'America/Asuncion')::date);
  v_desde date;
  v_m0 date;
  v_m1 date;
  v_n integer;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  v_m1 := date_trunc('month', v_hasta)::date;
  v_m0 := date_trunc('month', coalesce(p_desde, (v_m1 - interval '11 months')::date))::date;
  if v_m0 > v_m1 then raise exception 'El rango de fechas está invertido'; end if;
  v_n := (extract(year from age(v_m1, v_m0)) * 12 + extract(month from age(v_m1, v_m0)))::integer + 1;
  if v_n > 36 then
    v_m0 := (v_m1 - interval '35 months')::date;
    v_n := 36;
  end if;
  v_desde := v_m0;

  with v as (
    select v.id, date_trunc('month', v.fecha at time zone 'America/Asuncion')::date as mes, v.fecha,
           v.total * rep_fx(v.moneda, v.tipo_cambio) as total, v.tipo_venta, v.metodo_pago,
           coalesce(v.sucursal_id, s.s_principal) as suc, rep_fx(v.moneda, v.tipo_cambio) as fx
      from ventas v
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada'
       and v.fecha >= rep_ts((v_desde - interval '12 months')::date) and v.fecha < rep_ts(v_hasta + 1)
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  act as (select * from v where mes >= v_m0),
  meses as (select (v_m0 + make_interval(months => k))::date as mes from generate_series(0, v_n - 1) k),
  -- Se agrupa primero por el valor crudo (método / categoría del producto) y recién después se
  -- traduce: la traducción corre sobre decenas de filas, no sobre cada pago o cada ítem.
  pagos as (
    select x.mes, metodo_caja(x.metodo) as met, sum(x.monto) as monto
      from (select act.mes, d.metodo_pago as metodo, sum(d.monto * act.fx) as monto
              from act join ventas_pagos_detalle d on d.venta_id = act.id where act.tipo_venta <> 'CREDITO' group by 1, 2
            union all
            select act.mes, coalesce(act.metodo_pago, 'efectivo'), sum(act.total) from act
             where act.tipo_venta <> 'CREDITO' and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = act.id) group by 1, 2) x
     group by 1, 2
    union all
    select act.mes, 'credito', sum(act.total) from act where act.tipo_venta = 'CREDITO' group by 1
  ),
  it as (
    select x.mes, cr.raiz as cat, sum(x.monto) as monto
      from (select act.mes, p.categoria_principal_id as catp, sum(vi.total_linea * act.fx) as monto
              from act join ventas_items vi on vi.venta_id = act.id left join productos p on p.id = vi.producto_id group by 1, 2) x
      left join rep_categorias_raiz(s.s_empresa) cr on cr.id = x.catp
     group by 1, 2
  ),
  cat_tot as (select cat, sum(monto) as t, row_number() over (order by sum(monto) desc) as rk from it group by cat),
  it2 as (select it.mes, case when ct.rk <= 6 then it.cat::text else 'otras' end as cat, it.monto from it join cat_tot ct on ct.cat is not distinct from it.cat),
  -- Agregados por mes (una pasada cada uno; nada de subconsultas por mes).
  vm as (select mes, sum(total) as total, count(*) as n,
                coalesce(sum(total) filter (where tipo_venta <> 'CREDITO'), 0) as contado,
                coalesce(sum(total) filter (where tipo_venta = 'CREDITO'), 0) as credito
           from v group by mes),
  vsuc as (select mes, jsonb_object_agg(suc, t) as j from (select mes, suc, sum(total) t from v group by mes, suc) x group by mes),
  vmet as (select mes, jsonb_object_agg(met, t) as j from (select mes, met, sum(monto) t from pagos group by mes, met) x group by mes),
  vcat as (select mes, jsonb_object_agg(cat, t) as j from (select mes, coalesce(cat, 'sin') as cat, sum(monto) t from it2 group by 1, 2) x group by mes)
  select jsonb_build_object(
    'desde', v_m0, 'hasta', v_hasta, 'hoy', v_hoy, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'meses', (select jsonb_agg(jsonb_build_object(
        'mes', m.mes,
        'total', coalesce(a.total, 0), 'cantidad', coalesce(a.n, 0), 'contado', coalesce(a.contado, 0), 'credito', coalesce(a.credito, 0),
        'anterior', coalesce(b.total, 0), 'anterior_cantidad', coalesce(b.n, 0),
        'por_sucursal', coalesce(vsuc.j, '{}'::jsonb), 'por_metodo', coalesce(vmet.j, '{}'::jsonb), 'por_categoria', coalesce(vcat.j, '{}'::jsonb))
      order by m.mes)
      from meses m
      left join vm a on a.mes = m.mes
      left join vm b on b.mes = (m.mes - interval '12 months')::date
      left join vsuc on vsuc.mes = m.mes left join vmet on vmet.mes = m.mes left join vcat on vcat.mes = m.mes),
    'metodos', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', case when met = 'credito' then 'Crédito' else metodo_caja_label(met) end, 'total', t)
                                          order by t desc)
        from (select met, sum(monto) t from pagos group by met) x), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(x.cat, 'sin'),
        'nombre', case when x.cat = 'otras' then 'Otras categorías' when x.cat is null then 'Sin categoría' else (select nombre from categorias_productos where id = x.cat::uuid) end,
        'total', x.t) order by x.t desc)
        from (select cat, sum(monto) t from it2 group by cat) x), '[]'::jsonb),
    'por_sucursal', coalesce((select jsonb_agg(jsonb_build_object('id', x.suc, 'nombre', su.nombre, 'total', x.t, 'cantidad', x.n) order by x.t desc)
        from (select suc, sum(total) t, count(*) n from act group by suc) x join sucursales su on su.id = x.suc), '[]'::jsonb),
    'totales', (select jsonb_build_object('total', coalesce(sum(total) filter (where mes >= v_m0), 0),
                                          'cantidad', count(*) filter (where mes >= v_m0),
                                          'contado', coalesce(sum(total) filter (where mes >= v_m0 and tipo_venta <> 'CREDITO'), 0),
                                          'credito', coalesce(sum(total) filter (where mes >= v_m0 and tipo_venta = 'CREDITO'), 0),
                                          'anterior', coalesce(sum(total) filter (where mes < v_m0), 0),
                                          'anterior_cantidad', count(*) filter (where mes < v_m0)) from v)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 8. PÉRDIDAS DE PRODUCTO (ADMIN)
-- =============================================================================
create or replace function :"schema".reporte_perdidas(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  v_mes_ini date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);
  v_mes_ini := least(date_trunc('month', g.r_desde)::date, (date_trunc('month', g.r_hasta) - interval '11 months')::date);

  with b as (
    select b.*, p.categoria_principal_id, cr.raiz as cat_raiz
      from rep_perdidas_base(s.s_empresa, s.s_sucursal, rep_ts(v_mes_ini), rep_ts(g.r_hasta + 1)) b
      left join productos p on p.id = b.producto_id
      left join rep_categorias_raiz(s.s_empresa) cr on cr.id = p.categoria_principal_id
  ),
  per as (select * from b where dia >= g.r_desde),
  ventas_per as (
    select coalesce(sum(vi.total_linea * rep_fx(v.moneda, v.tipo_cambio)), 0) as netas,
           coalesce(sum(vi.cantidad * coalesce(vi.costo_unitario, 0) * rep_fx(v.moneda, v.tipo_cambio)), 0) as cmv
      from ventas v join ventas_items vi on vi.venta_id = v.id
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada'
       and v.fecha >= rep_ts(g.r_desde) and v.fecha < rep_ts(g.r_hasta + 1)
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  inv as (
    select coalesce(sum(sd.cantidad * coalesce(p.costo_promedio, 0)), 0) as valor
      from stock_depositos sd join depositos d on d.id = sd.deposito_id join productos p on p.id = sd.producto_id
     where sd.empresa_id = s.s_empresa and sd.cantidad > 0 and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'totales', (select jsonb_build_object('valor', coalesce(sum(valor), 0), 'unidades', coalesce(sum(unidades), 0),
                                          'documentos', count(distinct documento_id), 'productos', count(distinct producto_id),
                                          'pe', coalesce(sum(valor) filter (where origen = 'perdida'), 0),
                                          'traslados', coalesce(sum(valor) filter (where origen = 'traslado'), 0)) from per),
    'impacto', (select jsonb_build_object('ventas_netas', round(vp.netas), 'cmv', round(vp.cmv), 'valor_inventario', round(inv.valor))
                  from ventas_per vp, inv),
    'pendientes', (select jsonb_build_object('cantidad', count(distinct a.id), 'valor', coalesce(round(sum(-ai.diferencia * ai.costo_unitario)), 0))
                     from ajustes_inventario a join ajustes_items ai on ai.ajuste_id = a.id join depositos d on d.id = a.deposito_id
                    where a.empresa_id = s.s_empresa and a.tipo = 'perdida' and a.estado = 'pendiente'
                      and (s.s_sucursal is null or d.sucursal_id = s.s_sucursal)),
    'por_motivo', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'label', rep_motivo_perdida(motivo), 'valor', v, 'unidades', u, 'documentos', n) order by v desc)
        from (select motivo, sum(valor) v, sum(unidades) u, count(distinct documento_id) n from per group by motivo) x), '[]'::jsonb),
    'por_producto', coalesce((select jsonb_agg(jsonb_build_object('id', producto_id, 'nombre', nombre, 'sku', sku, 'valor', v, 'unidades', u,
                                                                   'motivos', motivos) order by v desc)
        from (select producto_id, max(producto_nombre) nombre, max(producto_sku) sku, sum(valor) v, sum(unidades) u,
                     jsonb_agg(distinct rep_motivo_perdida(motivo)) motivos
                from per group by producto_id order by sum(valor) desc limit 50) x), '[]'::jsonb),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('id', x.cat_raiz, 'nombre', coalesce(c.nombre, 'Sin categoría'), 'valor', x.v, 'unidades', x.u) order by x.v desc)
        from (select cat_raiz, sum(valor) v, sum(unidades) u from per group by cat_raiz) x left join categorias_productos c on c.id = x.cat_raiz), '[]'::jsonb),
    'por_deposito', coalesce((select jsonb_agg(jsonb_build_object('id', x.deposito_id, 'nombre', d.nombre, 'sucursal', su.nombre, 'valor', x.v, 'unidades', x.u) order by x.v desc)
        from (select deposito_id, sum(valor) v, sum(unidades) u from per group by deposito_id) x
        join depositos d on d.id = x.deposito_id join sucursales su on su.id = d.sucursal_id), '[]'::jsonb),
    'por_mes', (select jsonb_agg(jsonb_build_object('mes', m,
        'valor', coalesce((select sum(valor) from b where date_trunc('month', b.dia)::date = m), 0),
        'por_motivo', coalesce((select jsonb_object_agg(x.motivo, x.v) from (select motivo, sum(valor) v from b where date_trunc('month', b.dia)::date = m group by motivo) x), '{}'::jsonb))
        order by m)
      from (select (v_mes_ini + make_interval(months => k))::date as m
              from generate_series(0, (extract(year from age(date_trunc('month', g.r_hasta), v_mes_ini)) * 12
                                       + extract(month from age(date_trunc('month', g.r_hasta), v_mes_ini)))::integer) k) mm),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('dia', x.dia, 'origen', x.origen, 'documento_id', x.documento_id, 'documento', x.documento,
        'motivo', x.motivo, 'motivo_label', rep_motivo_perdida(x.motivo), 'detalle', x.detalle, 'producto_id', x.producto_id,
        'producto', x.producto_nombre, 'sku', x.producto_sku, 'deposito', d.nombre, 'sucursal', su.nombre,
        'unidades', x.unidades, 'valor', x.valor) order by x.dia desc, x.documento desc)
        from (select * from per order by dia desc, documento desc limit 1000) x
        join depositos d on d.id = x.deposito_id join sucursales su on su.id = d.sucursal_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- Permisos: solo la sesión autenticada ejecuta los reportes; los helpers son internos.
-- =============================================================================
revoke all on function :"schema".rep_sesion(text[], uuid) from public, anon, authenticated;
revoke all on function :"schema".rep_sucursales(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function :"schema".rep_perdidas_base(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function :"schema".rep_categorias_raiz(uuid) from public, anon, authenticated;
revoke all on function :"schema".rep_rango(date, date) from public, anon;
revoke all on function :"schema".rep_fx(text, numeric) from public, anon;
revoke all on function :"schema".rep_ts(date) from public, anon;
revoke all on function :"schema".rep_motivo_perdida(text) from public, anon;
grant execute on function :"schema".rep_rango(date, date) to authenticated;
grant execute on function :"schema".rep_fx(text, numeric) to authenticated;
grant execute on function :"schema".rep_ts(date) to authenticated;
grant execute on function :"schema".rep_motivo_perdida(text) to authenticated;

revoke all on function :"schema".dashboard_inicio(uuid) from public, anon;
revoke all on function :"schema".reporte_cierres_dias(date, date, uuid, boolean) from public, anon;
revoke all on function :"schema".reporte_cierre_dia(date, uuid) from public, anon;
revoke all on function :"schema".reporte_estado_cuenta(date, date, uuid) from public, anon;
revoke all on function :"schema".reporte_proveedores(date, date, uuid) from public, anon;
revoke all on function :"schema".reporte_proveedor(uuid, date, date, uuid) from public, anon;
revoke all on function :"schema".reporte_cxp(date, date, uuid, uuid) from public, anon;
revoke all on function :"schema".reporte_cxc(date, date, uuid) from public, anon;
revoke all on function :"schema".reporte_ventas_mes(date, date, uuid) from public, anon;
revoke all on function :"schema".reporte_perdidas(date, date, uuid) from public, anon;
grant execute on function :"schema".dashboard_inicio(uuid) to authenticated;
grant execute on function :"schema".reporte_cierres_dias(date, date, uuid, boolean) to authenticated;
grant execute on function :"schema".reporte_cierre_dia(date, uuid) to authenticated;
grant execute on function :"schema".reporte_estado_cuenta(date, date, uuid) to authenticated;
grant execute on function :"schema".reporte_proveedores(date, date, uuid) to authenticated;
grant execute on function :"schema".reporte_proveedor(uuid, date, date, uuid) to authenticated;
grant execute on function :"schema".reporte_cxp(date, date, uuid, uuid) to authenticated;
grant execute on function :"schema".reporte_cxc(date, date, uuid) to authenticated;
grant execute on function :"schema".reporte_ventas_mes(date, date, uuid) to authenticated;
grant execute on function :"schema".reporte_perdidas(date, date, uuid) to authenticated;

commit;
