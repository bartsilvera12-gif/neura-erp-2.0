-- =============================================================================
-- CAJA POR SUCURSAL (Fase 2): cajas / puntos de venta, turnos, cobro con varias formas
-- de pago, arqueo por método, retiros e ingresos de efectivo y reportería de crédito.
--
-- Modelo:
--   · puntos_venta      CATÁLOGO de cajas de cada sucursal ("Caja 1" de Casa central,
--                       "Caja 1" de Luque…), cada una con su DEPÓSITO de salida (por
--                       defecto el principal de la sucursal). Solo ADMIN las da de alta.
--   · cajas             cada APERTURA es un TURNO (la tabla de siempre: numero_caja = N°
--                       de turno). Gana punto_venta_id, sucursal_id y deposito_id (foto del
--                       depósito al abrir). Puede haber VARIOS turnos abiertos a la vez,
--                       pero UNO por caja (uq_cajas_punto_abierta).
--   · caja_movimientos  gana `metodo` (detalle: tarjeta_debito, tarjeta_credito, qr…;
--                       `medio_pago` sigue siendo la categoría de siempre), referencia,
--                       banco y `numero` (MC-000001) en los retiros / ingresos manuales.
--                       Un trigger no deja escribir en un turno que no está abierto.
--   · ventas            gana sucursal_id y punto_venta_id (filtros de Órdenes de venta).
--   · ventas_pagos_detalle  cada forma de pago de la venta con su monto, referencia, banco
--                       y, en efectivo, lo recibido y el vuelto (el vuelto es solo efectivo).
--
-- Reglas:
--   · Abrir: un usuario abre una caja de SU sucursal (ADMIN cualquiera). Sin sucursal
--     fija = la principal (igual que el depósito por defecto de la Fase 1).
--   · Todo lo que mueve plata (venta, cobro, compra/gasto/pago a proveedor en efectivo,
--     retiro, ingreso) va a la caja abierta del usuario: caja_abierta_para(). Si hay
--     varias posibles y no se eligió, toma la que abrió él; si sigue habiendo más de una,
--     pide elegir (mensaje claro). Las funciones aceptan p.caja_id / p_caja_id.
--   · La venta descuenta del depósito del turno.
--   · Cerrar: arqueo por método (efectivo contado; débito/crédito/transferencia/QR
--     confirmados o corregidos), diferencias con motivo obligatorio. Queda la foto del
--     resumen (resumen_cierre). Cerrada no se puede vender ni mover nada en ella.
--   · Anular una venta de un turno CERRADO: solo ADMIN o SUPERVISOR y con motivo. El
--     turno cerrado no se toca (su arqueo queda como se cerró): el stock vuelve al
--     depósito y el efectivo que se devuelve sale como egreso 'devolucion' de una caja
--     ABIERTA (la del usuario). Tarjeta / transferencia se reintegran por fuera.
--
-- Funciones (SECURITY DEFINER, search_path fijo, validan empresa y rol adentro):
--   caja_abierta_para, listar_cajas, guardar_punto_venta, abrir_caja,
--   registrar_movimiento_caja, anular_movimiento_caja, cerrar_caja (misma firma),
--   resumen_turno, resumen_cajas_dia, reporte_ventas_credito,
--   crear_venta (+ p_caja_id), anular_venta (+ p_motivo, p_caja_id), productos_pos (+ p_deposito).
-- Ajusta (solo la línea que elegía "la caja abierta de la empresa", sobre la versión
-- VIGENTE de la base): registrar_cobro, registrar_compra, registrar_pago_proveedor
-- → usan caja_abierta_para(null, null, p.caja_id). confirmar_gasto lo hace la receta 52
-- (corre después): caja_abierta_para(null, g.sucursal_id, p.caja_id).
--
-- Migración: crea "Caja 1" en cada sucursal activa que no tenga cajas; los turnos que ya
-- existían quedan en la Caja 1 de la Casa central; las ventas toman sucursal y caja de su
-- turno (o la sucursal de su depósito); las ventas de contado sin detalle de pago lo ganan.
-- IDEMPOTENTE. Hoy = America/Asuncion.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================

create table if not exists :"schema".puntos_venta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sucursal_id uuid not null references :"schema".sucursales(id) on delete restrict,
  deposito_id uuid not null references :"schema".depositos(id) on delete restrict,
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_punto_venta_nombre check (btrim(nombre) <> '')
);
create unique index if not exists uq_puntos_venta_nombre on :"schema".puntos_venta (sucursal_id, lower(btrim(nombre)));
create index if not exists puntos_venta_empresa_idx on :"schema".puntos_venta (empresa_id, sucursal_id);

alter table :"schema".cajas add column if not exists punto_venta_id uuid references :"schema".puntos_venta(id) on delete restrict;
alter table :"schema".cajas add column if not exists sucursal_id uuid references :"schema".sucursales(id) on delete restrict;
alter table :"schema".cajas add column if not exists deposito_id uuid references :"schema".depositos(id) on delete restrict;
alter table :"schema".cajas add column if not exists diferencia_otros numeric;
alter table :"schema".cajas add column if not exists motivo_diferencia text;
alter table :"schema".cajas add column if not exists resumen_cierre jsonb;
create index if not exists cajas_sucursal_idx on :"schema".cajas (empresa_id, sucursal_id, fecha_apertura desc);
create index if not exists cajas_punto_idx on :"schema".cajas (punto_venta_id, fecha_apertura desc);

alter table :"schema".caja_movimientos add column if not exists metodo text;
alter table :"schema".caja_movimientos add column if not exists referencia text;
alter table :"schema".caja_movimientos add column if not exists banco text;
alter table :"schema".caja_movimientos add column if not exists numero text;
create index if not exists caja_mov_venta_idx on :"schema".caja_movimientos (venta_id) where venta_id is not null;
create index if not exists caja_mov_caja_fecha_idx on :"schema".caja_movimientos (caja_id, created_at);

alter table :"schema".ventas add column if not exists sucursal_id uuid references :"schema".sucursales(id) on delete set null;
alter table :"schema".ventas add column if not exists punto_venta_id uuid references :"schema".puntos_venta(id) on delete set null;
create index if not exists ventas_sucursal_fecha_idx on :"schema".ventas (empresa_id, sucursal_id, fecha desc);
create index if not exists ventas_punto_fecha_idx on :"schema".ventas (punto_venta_id, fecha desc) where punto_venta_id is not null;
create index if not exists ventas_credito_fecha_idx on :"schema".ventas (empresa_id, fecha desc) where tipo_venta = 'CREDITO';

alter table :"schema".ventas_pagos_detalle add column if not exists banco text;
alter table :"schema".ventas_pagos_detalle add column if not exists recibido numeric;
alter table :"schema".ventas_pagos_detalle add column if not exists vuelto numeric not null default 0;
create index if not exists vpd_metodo_idx on :"schema".ventas_pagos_detalle (empresa_id, metodo_pago, venta_id);

-- =============================================================================
-- 2. Métodos de pago: categoría de arqueo y etiqueta
-- =============================================================================

-- Método de arqueo: POS débito/crédito son tarjeta de débito/crédito; QR y billetera van
-- juntos; "tarjeta"/"pos" sin detalle (cobros viejos) quedan como Tarjeta.
create or replace function :"schema".metodo_caja(p text)
returns text language sql immutable as $$
  select case lower(btrim(coalesce(p, '')))
    when 'efectivo' then 'efectivo'
    when 'tarjeta_debito' then 'tarjeta_debito'
    when 'pos_debito' then 'tarjeta_debito'
    when 'tarjeta_credito' then 'tarjeta_credito'
    when 'pos_credito' then 'tarjeta_credito'
    when 'tarjeta' then 'tarjeta'
    when 'pos' then 'tarjeta'
    when 'transferencia' then 'transferencia'
    when 'qr' then 'qr'
    when 'billetera' then 'qr'
    when 'cheque' then 'cheque'
    when 'saldo_favor' then 'saldo_favor'
    else 'otro' end
$$;

create or replace function :"schema".metodo_caja_label(p text)
returns text language sql immutable set search_path = :"schema", public as $$
  select case metodo_caja(p)
    when 'efectivo' then 'Efectivo'
    when 'tarjeta_debito' then 'Tarjeta de débito'
    when 'tarjeta_credito' then 'Tarjeta de crédito'
    when 'tarjeta' then 'Tarjeta'
    when 'transferencia' then 'Transferencia'
    when 'qr' then 'QR / billetera'
    when 'cheque' then 'Cheque'
    when 'saldo_favor' then 'Saldo a favor'
    else 'Otro' end
$$;

-- Orden de los métodos en el arqueo (efectivo primero).
create or replace function :"schema".metodo_caja_orden(p text)
returns integer language sql immutable as $$
  select case p when 'efectivo' then 1 when 'tarjeta_debito' then 2 when 'tarjeta_credito' then 3 when 'tarjeta' then 4
                when 'transferencia' then 5 when 'qr' then 6 when 'cheque' then 7 else 9 end
$$;

-- Categoría de caja_movimientos.medio_pago (check de siempre) a partir del método.
create or replace function :"schema".medio_caja(p text)
returns text language sql immutable as $$
  select case
    when lower(p) like 'tarjeta%' then 'tarjeta'
    when lower(p) like 'pos%' then 'pos'
    when lower(p) in ('efectivo', 'transferencia', 'cheque') then lower(p)
    else 'otro' end
$$;

-- =============================================================================
-- 3. Migración (sin perder nada)
-- =============================================================================

-- Caja 1 en cada sucursal activa sin cajas (sale de su depósito principal).
insert into :"schema".puntos_venta (empresa_id, sucursal_id, deposito_id, nombre)
select s.empresa_id, s.id, d.id, 'Caja 1'
  from :"schema".sucursales s
  join :"schema".depositos d on d.sucursal_id = s.id and d.es_principal and d.activo
 where s.activa
   and not exists (select 1 from :"schema".puntos_venta pv where pv.sucursal_id = s.id);

-- Turnos que ya existían → Caja 1 de la Casa central.
update :"schema".cajas c
   set punto_venta_id = x.id, sucursal_id = x.sucursal_id, deposito_id = x.deposito_id
  from (select distinct on (pv.empresa_id) pv.id, pv.empresa_id, pv.sucursal_id, pv.deposito_id
          from :"schema".puntos_venta pv join :"schema".sucursales s on s.id = pv.sucursal_id and s.es_principal
         order by pv.empresa_id, pv.created_at, pv.id) x
 where c.punto_venta_id is null and x.empresa_id = c.empresa_id;

-- (Por si quedara alguno sin caja, el ALTER falla y la receta entera vuelve atrás.)
alter table :"schema".cajas alter column punto_venta_id set not null;
alter table :"schema".cajas alter column sucursal_id set not null;
alter table :"schema".cajas alter column deposito_id set not null;

-- Un turno abierto por caja (varias cajas abiertas a la vez, nunca dos turnos en la misma).
create unique index if not exists uq_cajas_punto_abierta on :"schema".cajas (punto_venta_id) where estado <> 'cerrada';

-- Ventas: sucursal y caja de su turno; si no tienen turno, la sucursal de su depósito.
update :"schema".ventas v set punto_venta_id = c.punto_venta_id, sucursal_id = c.sucursal_id
  from :"schema".cajas c
 where c.id = v.caja_id and (v.punto_venta_id is null or v.sucursal_id is null);
update :"schema".ventas v set sucursal_id = d.sucursal_id
  from :"schema".depositos d
 where d.id = v.deposito_id and v.sucursal_id is null;

-- Ventas de contado sin detalle de pago (anteriores al pago mixto): una forma de pago.
insert into :"schema".ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto, fecha_pago)
select v.empresa_id, v.id, lower(coalesce(nullif(btrim(v.metodo_pago), ''), 'efectivo')), v.total, v.fecha
  from :"schema".ventas v
 where v.tipo_venta = 'CONTADO' and v.total > 0
   and lower(coalesce(nullif(btrim(v.metodo_pago), ''), 'efectivo')) in
       ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'tarjeta_debito', 'tarjeta_credito', 'pos', 'pos_debito', 'pos_credito', 'qr', 'billetera', 'otro')
   and not exists (select 1 from :"schema".ventas_pagos_detalle d where d.venta_id = v.id);

-- Movimientos: el método detallado. Los de una venta con UNA forma de pago de esa
-- categoría toman ese detalle (ej. POS crédito); el resto, su medio.
update :"schema".caja_movimientos m set metodo = :"schema".metodo_caja(d.metodo_pago)
  from (select venta_id, min(metodo_pago) as metodo_pago, count(*) as n
          from :"schema".ventas_pagos_detalle group by venta_id) d
 where m.metodo is null and m.venta_id = d.venta_id and d.n = 1
   and :"schema".medio_caja(d.metodo_pago) = m.medio_pago;
update :"schema".caja_movimientos set metodo = :"schema".metodo_caja(medio_pago) where metodo is null;

-- =============================================================================
-- 4. Guardas: en un turno que no está abierto no se vende ni se mueve plata
-- =============================================================================

create or replace function :"schema".tg_caja_mov_abierta()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_estado text;
  v_num integer;
begin
  select estado, numero_caja into v_estado, v_num from cajas where id = new.caja_id;
  if v_estado is distinct from 'abierta' then
    raise exception 'La caja (turno N° %) ya está cerrada: no se puede registrar nada en ella', v_num;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_caja_mov_abierta on :"schema".caja_movimientos;
create trigger trg_caja_mov_abierta before insert or update of caja_id on :"schema".caja_movimientos
  for each row execute function :"schema".tg_caja_mov_abierta();

create or replace function :"schema".tg_ventas_caja_abierta()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_estado text;
  v_num integer;
begin
  if new.caja_id is null then return new; end if;
  select estado, numero_caja into v_estado, v_num from cajas where id = new.caja_id;
  if v_estado is distinct from 'abierta' then
    raise exception 'La caja (turno N° %) ya está cerrada: no se puede vender en ella', v_num;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_ventas_caja_abierta on :"schema".ventas;
create trigger trg_ventas_caja_abierta before insert or update of caja_id on :"schema".ventas
  for each row execute function :"schema".tg_ventas_caja_abierta();

-- Empresa nueva: nace con Casa central + Depósito principal + Caja 1 (redefine la de la Fase 1).
create or replace function :"schema".tg_empresas_sucursal_inicial()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_suc uuid;
  v_dep uuid;
begin
  insert into sucursales (empresa_id, nombre, establecimiento, punto_expedicion, es_principal)
    values (new.id, 'Casa central', '001', '001', true) returning id into v_suc;
  insert into depositos (empresa_id, sucursal_id, nombre, es_principal)
    values (new.id, v_suc, 'Depósito principal', true) returning id into v_dep;
  insert into puntos_venta (empresa_id, sucursal_id, deposito_id, nombre) values (new.id, v_suc, v_dep, 'Caja 1');
  return null;
end;
$fn$;

-- =============================================================================
-- 5. Helpers
-- =============================================================================

create or replace function :"schema".sucursal_principal(p_empresa uuid)
returns uuid language sql stable security definer set search_path = :"schema", public as $$
  select id from sucursales where empresa_id = p_empresa and es_principal limit 1
$$;

-- "Caja 1 · Casa central" (turno o caja).
create or replace function :"schema".caja_etiqueta(p_caja uuid)
returns text language sql stable security definer set search_path = :"schema", public as $$
  select pv.nombre || ' · ' || su.nombre
    from cajas c join puntos_venta pv on pv.id = c.punto_venta_id join sucursales su on su.id = c.sucursal_id
   where c.id = p_caja
$$;

-- LA caja abierta que corresponde a un usuario (por defecto el de la sesión).
--   p_caja      la que eligió (tiene que estar abierta y, si no es ADMIN, ser de su sucursal)
--   p_sucursal  limitar a esa sucursal (si no: la del usuario, o la principal)
-- Sin elección: si en la sucursal hay una sola abierta, esa; si hay varias, la que abrió
-- él; si no se puede decidir, pide elegir. Sin ninguna abierta → null (el que llama
-- decide si eso es un error: el efectivo sí lo necesita).
create or replace function :"schema".caja_abierta_para(p_usuario uuid default null, p_sucursal uuid default null, p_caja uuid default null)
returns uuid language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  u record;
  v_suc uuid;
  v_id uuid;
  v_suc_caja uuid;
  v_n integer;
  v_lista text;
begin
  if p_usuario is not null then
    select x.empresa_id, x.id, upper(x.rol) as rol, x.sucursal_id into u
      from usuarios x where x.id = p_usuario and x.activo and x.empresa_id = empresa_actual();
  else
    select x.empresa_id, x.id, upper(x.rol) as rol, x.sucursal_id into u
      from usuarios x where x.auth_user_id = auth.uid() and x.activo limit 1;
  end if;
  if u.empresa_id is null then raise exception 'No hay empresa en la sesión'; end if;

  if p_caja is not null then
    select c.id, c.sucursal_id into v_id, v_suc_caja
      from cajas c where c.id = p_caja and c.empresa_id = u.empresa_id and c.estado = 'abierta';
    if v_id is null then raise exception 'La caja elegida ya no está abierta: elegí otra o abrila'; end if;
    if u.rol <> 'ADMIN' and v_suc_caja <> coalesce(u.sucursal_id, sucursal_principal(u.empresa_id)) then
      raise exception 'Esa caja es de otra sucursal: usá una caja de tu sucursal';
    end if;
    return v_id;
  end if;

  v_suc := coalesce(p_sucursal, u.sucursal_id, sucursal_principal(u.empresa_id));
  select count(*) into v_n from cajas where empresa_id = u.empresa_id and estado = 'abierta' and sucursal_id = v_suc;
  -- ADMIN sin sucursal fija y la principal cerrada: cualquier caja abierta de la empresa.
  if v_n = 0 and u.rol = 'ADMIN' and p_sucursal is null and u.sucursal_id is null then
    v_suc := null;
    select count(*) into v_n from cajas where empresa_id = u.empresa_id and estado = 'abierta';
  end if;
  if v_n = 0 then return null; end if;
  if v_n = 1 then
    select id into v_id from cajas
     where empresa_id = u.empresa_id and estado = 'abierta' and (v_suc is null or sucursal_id = v_suc);
    return v_id;
  end if;
  -- Varias: la que abrió este usuario (si es una sola).
  select min(id::text)::uuid, count(*) into v_id, v_n from cajas
   where empresa_id = u.empresa_id and estado = 'abierta' and (v_suc is null or sucursal_id = v_suc) and abierta_por = u.id;
  if v_n = 1 then return v_id; end if;
  select string_agg(caja_etiqueta(id), ', ' order by fecha_apertura) into v_lista from cajas
   where empresa_id = u.empresa_id and estado = 'abierta' and (v_suc is null or sucursal_id = v_suc);
  raise exception 'Hay varias cajas abiertas (%): elegí en cuál', v_lista using hint = 'elegir_caja';
end;
$fn$;

-- Efectivo que debería haber en un turno ahora (apertura ± movimientos en efectivo vivos).
create or replace function :"schema".caja_efectivo_esperado(p_caja uuid)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select c.monto_apertura + coalesce((
           select sum(case when m.tipo in ('ingreso', 'ajuste') then m.monto when m.tipo in ('egreso', 'retiro') then -m.monto else 0 end)
             from caja_movimientos m
            where m.caja_id = c.id and m.anulado_at is null and lower(btrim(coalesce(m.medio_pago, ''))) = 'efectivo'), 0)
    from cajas c where c.id = p_caja
$$;

-- =============================================================================
-- 6. Cajas (puntos de venta): pantalla, alta / edición, apertura
-- =============================================================================

-- Estado de las cajas que ve el usuario (ADMIN: todas; el resto: las de su sucursal),
-- las abiertas que puede usar, la que le toca por defecto y los últimos turnos cerrados.
create or replace function :"schema".listar_cajas()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_suc uuid;
  v_admin boolean;
  v_pred uuid;
  v_pred_error text;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  v_admin := s.s_rol = 'ADMIN';
  v_suc := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa));
  begin
    v_pred := caja_abierta_para();
  exception when others then
    v_pred := null;
    v_pred_error := sqlerrm;
  end;

  with turnos as (
    select c.id, c.numero_caja, c.punto_venta_id, c.sucursal_id, c.deposito_id, c.abierta_por, c.fecha_apertura,
           c.monto_apertura, c.observacion_apertura, u.nombre as abierta_por_nombre,
           caja_efectivo_esperado(c.id) as efectivo_esperado,
           (select count(*) from ventas v where v.caja_id = c.id and v.estado <> 'anulada') as ventas_cantidad,
           (select coalesce(sum(v.total), 0) from ventas v where v.caja_id = c.id and v.estado <> 'anulada') as ventas_total
      from cajas c left join usuarios u on u.id = c.abierta_por
     where c.empresa_id = s.s_empresa and c.estado = 'abierta'
  ), visibles as (
    select su.* from sucursales su
     where su.empresa_id = s.s_empresa and (v_admin or su.id = v_suc)
  )
  select jsonb_build_object(
    'es_admin', v_admin,
    'mi_usuario_id', s.s_usuario,
    'mi_sucursal_id', v_suc,
    'predeterminada', v_pred,
    'predeterminada_error', v_pred_error,
    'sucursales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', su.id, 'nombre', su.nombre, 'es_principal', su.es_principal, 'activa', su.activa,
        'depositos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'es_principal', d.es_principal, 'activo', d.activo)
                                          order by d.es_principal desc, d.nombre)
                                 from depositos d where d.sucursal_id = su.id), '[]'::jsonb),
        'cajas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pv.id, 'nombre', pv.nombre, 'activo', pv.activo, 'deposito_id', pv.deposito_id, 'deposito_nombre', d.nombre,
            'turno', (select to_jsonb(t) - 'punto_venta_id' - 'sucursal_id' from turnos t where t.punto_venta_id = pv.id),
            'ultimo_cierre', (select jsonb_build_object('id', c.id, 'numero_caja', c.numero_caja, 'fecha_cierre', c.fecha_cierre,
                                                         'diferencia', c.diferencia, 'diferencia_otros', c.diferencia_otros,
                                                         'cerrada_por_nombre', uc.nombre)
                                from cajas c left join usuarios uc on uc.id = c.cerrada_por
                               where c.punto_venta_id = pv.id and c.estado = 'cerrada'
                               order by c.fecha_cierre desc nulls last limit 1)
          ) order by pv.activo desc, pv.nombre)
            from puntos_venta pv join depositos d on d.id = pv.deposito_id
           where pv.sucursal_id = su.id), '[]'::jsonb)
      ) order by su.es_principal desc, su.activa desc, su.nombre)
        from visibles su), '[]'::jsonb),
    'abiertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'numero_caja', t.numero_caja, 'punto_venta_id', t.punto_venta_id, 'punto_nombre', pv.nombre,
        'sucursal_id', t.sucursal_id, 'sucursal_nombre', su.nombre, 'deposito_id', t.deposito_id, 'deposito_nombre', d.nombre,
        'abierta_por_nombre', t.abierta_por_nombre, 'fecha_apertura', t.fecha_apertura, 'mia', t.abierta_por = s.s_usuario
      ) order by su.es_principal desc, su.nombre, pv.nombre)
        from turnos t join puntos_venta pv on pv.id = t.punto_venta_id join sucursales su on su.id = t.sucursal_id
        join depositos d on d.id = t.deposito_id
       where v_admin or t.sucursal_id = v_suc), '[]'::jsonb),
    'recientes', coalesce((
      select jsonb_agg(x order by x.fecha_cierre desc) from (
        select c.id, c.numero_caja, c.fecha_apertura, c.fecha_cierre, c.monto_apertura, c.diferencia, c.diferencia_otros,
               pv.nombre as punto_nombre, su.nombre as sucursal_nombre, uc.nombre as cerrada_por_nombre, ua.nombre as abierta_por_nombre,
               (select coalesce(sum(v.total), 0) from ventas v where v.caja_id = c.id and v.estado <> 'anulada') as total_vendido
          from cajas c join puntos_venta pv on pv.id = c.punto_venta_id join sucursales su on su.id = c.sucursal_id
          left join usuarios uc on uc.id = c.cerrada_por left join usuarios ua on ua.id = c.abierta_por
         where c.empresa_id = s.s_empresa and c.estado = 'cerrada' and (v_admin or c.sucursal_id = v_suc)
         order by c.fecha_cierre desc nulls last limit 15) x), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- guardar_punto_venta(p): { id?, sucursal_id, nombre, deposito_id?, activo? } → { id }  (ADMIN)
create or replace function :"schema".guardar_punto_venta(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_dep uuid := nullif(p->>'deposito_id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
  prev record;
  v_suc_activa boolean;
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_nombre is null then raise exception 'Escribí el nombre de la caja (ej. Caja 2)'; end if;
  if length(v_nombre) > 60 then raise exception 'El nombre de la caja es muy largo'; end if;
  select activa into v_suc_activa from sucursales where id = v_suc and empresa_id = s.s_empresa;
  if not found then raise exception 'Elegí la sucursal de la caja'; end if;
  if not v_suc_activa and v_activo then raise exception 'La sucursal está inactiva'; end if;

  -- Depósito de salida: de la misma sucursal y activo (por defecto, el principal).
  if v_dep is null then
    select id into v_dep from depositos where sucursal_id = v_suc and es_principal and activo;
    if v_dep is null then raise exception 'La sucursal no tiene un depósito principal activo'; end if;
  elsif not exists (select 1 from depositos where id = v_dep and sucursal_id = v_suc and activo) then
    raise exception 'El depósito de salida tiene que ser un depósito activo de la misma sucursal';
  end if;

  if v_id is not null then
    select * into prev from puntos_venta where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Caja no encontrada'; end if;
    if exists (select 1 from cajas where punto_venta_id = v_id and estado <> 'cerrada') then
      if prev.sucursal_id <> v_suc then raise exception 'La caja está abierta: cerrala antes de cambiarla de sucursal'; end if;
      if prev.deposito_id <> v_dep then raise exception 'La caja está abierta: cerrala antes de cambiar su depósito de salida'; end if;
      if prev.activo and not v_activo then raise exception 'La caja está abierta: cerrala antes de desactivarla'; end if;
    end if;
  end if;

  begin
    if v_id is null then
      insert into puntos_venta (empresa_id, sucursal_id, deposito_id, nombre, activo)
        values (s.s_empresa, v_suc, v_dep, v_nombre, true) returning id into v_id;
    else
      update puntos_venta set sucursal_id = v_suc, deposito_id = v_dep, nombre = v_nombre, activo = v_activo, updated_at = now()
       where id = v_id;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_puntos_venta_nombre' then raise exception 'Ya hay una caja llamada "%" en esa sucursal', v_nombre; end if;
    raise;
  end;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- abrir_caja(caja, monto inicial, observación) → { caja_id (turno), numero_caja }
create or replace function :"schema".abrir_caja(p_punto_venta uuid, p_monto numeric, p_observacion text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pv record;
  v_abierta record;
  v_num bigint;
  v_id uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  if p_monto is null or p_monto < 0 then raise exception 'El monto inicial tiene que ser 0 o más'; end if;
  select pv0.*, su.nombre as sucursal_nombre, su.activa as sucursal_activa, d.activo as deposito_activo
    into pv
    from puntos_venta pv0 join sucursales su on su.id = pv0.sucursal_id join depositos d on d.id = pv0.deposito_id
   where pv0.id = p_punto_venta and pv0.empresa_id = s.s_empresa
   for update of pv0;
  if not found then raise exception 'Caja no encontrada'; end if;
  if not pv.activo or not pv.sucursal_activa then raise exception 'La caja "%" está inactiva', pv.nombre; end if;
  if not pv.deposito_activo then raise exception 'El depósito de salida de la caja está inactivo: cambialo en la configuración de cajas'; end if;
  if s.s_rol <> 'ADMIN' and pv.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then
    raise exception 'Solo podés abrir las cajas de tu sucursal';
  end if;
  select c.numero_caja, u.nombre as quien, c.fecha_apertura into v_abierta
    from cajas c left join usuarios u on u.id = c.abierta_por
   where c.punto_venta_id = p_punto_venta and c.estado <> 'cerrada' limit 1;
  if found then
    raise exception '% · % ya está abierta (turno N° %, la abrió %)', pv.nombre, pv.sucursal_nombre, v_abierta.numero_caja, coalesce(v_abierta.quien, '—');
  end if;

  v_num := inv_numero(s.s_empresa, 'turno_caja', (select max(numero_caja) from cajas where empresa_id = s.s_empresa));
  insert into cajas (empresa_id, estado, numero_caja, abierta_por, fecha_apertura, monto_apertura, observacion_apertura,
                     punto_venta_id, sucursal_id, deposito_id)
    values (s.s_empresa, 'abierta', v_num, s.s_usuario, now(), round(p_monto), nullif(btrim(coalesce(p_observacion, '')), ''),
            pv.id, pv.sucursal_id, pv.deposito_id)
    returning id into v_id;
  return jsonb_build_object('caja_id', v_id, 'numero_caja', v_num);
end;
$fn$;

-- Retiro / ingreso de EFECTIVO documentado (MC-000001).
--   p: { caja_id?, tipo: 'retiro'|'ingreso', motivo, detalle?, monto }
--   motivo retiro: deposito_banco | retiro_dueno | caja_fuerte | otro
--   motivo ingreso: cambio | aporte | devolucion_retiro | otro   ("otro" pide el detalle)
create or replace function :"schema".registrar_movimiento_caja(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja uuid;
  v_tipo text := lower(coalesce(p->>'tipo', ''));
  v_motivo text := lower(coalesce(nullif(btrim(p->>'motivo'), ''), 'otro'));
  v_detalle text := nullif(btrim(coalesce(p->>'detalle', '')), '');
  v_monto numeric := round(coalesce(nullif(p->>'monto', '')::numeric, 0));
  v_label text;
  v_disp numeric;
  v_num text;
  v_id uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  if v_tipo not in ('retiro', 'ingreso') then raise exception 'Elegí si es un retiro o un ingreso de efectivo'; end if;
  if v_monto <= 0 then raise exception 'El monto tiene que ser mayor a cero'; end if;
  v_label := case
    when v_tipo = 'retiro' and v_motivo = 'deposito_banco' then 'Retiro para depósito en banco'
    when v_tipo = 'retiro' and v_motivo = 'retiro_dueno' then 'Retiro del dueño'
    when v_tipo = 'retiro' and v_motivo = 'caja_fuerte' then 'Retiro a caja fuerte'
    when v_tipo = 'ingreso' and v_motivo = 'cambio' then 'Ingreso de cambio / sencillo'
    when v_tipo = 'ingreso' and v_motivo = 'aporte' then 'Aporte de efectivo'
    when v_tipo = 'ingreso' and v_motivo = 'devolucion_retiro' then 'Devolución de un retiro'
    when v_motivo = 'otro' then null
    else 'x' end;
  if v_label = 'x' then raise exception 'Motivo inválido'; end if;
  if v_label is null then
    if v_detalle is null then raise exception 'Escribí el motivo del %', case when v_tipo = 'retiro' then 'retiro' else 'ingreso' end; end if;
    v_label := case when v_tipo = 'retiro' then 'Retiro' else 'Ingreso' end;
    v_motivo := 'otro';
  end if;

  v_caja := caja_abierta_para(null, null, nullif(p->>'caja_id', '')::uuid);
  if v_caja is null then raise exception 'No hay una caja abierta: abrila primero'; end if;
  perform 1 from cajas where id = v_caja for update;
  if v_tipo = 'retiro' then
    v_disp := caja_efectivo_esperado(v_caja);
    if v_monto > v_disp then
      raise exception 'En la caja debería haber Gs. % en efectivo: no se puede retirar más', replace(to_char(v_disp, 'FM999,999,999,990'), ',', '.');
    end if;
  end if;

  v_num := 'MC-' || lpad(inv_numero(s.s_empresa, 'mov_caja', (
             select max(substring(numero from '[0-9]+$')::bigint) from caja_movimientos where empresa_id = s.s_empresa and numero ~ '^MC-[0-9]+$'))::text, 6, '0');
  insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, categoria, usuario_id,
                                usuario_email, observacion, fecha, numero)
    values (s.s_empresa, v_caja, v_tipo, left(v_label || coalesce(': ' || v_detalle, ''), 200), v_monto, 'efectivo', 'efectivo',
            v_motivo, s.s_usuario, (select email from usuarios where id = s.s_usuario), v_detalle,
            (now() at time zone 'America/Asuncion')::date, v_num)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'caja_id', v_caja);
end;
$fn$;

-- Anular un retiro / ingreso manual (solo con la caja abierta).
create or replace function :"schema".anular_movimiento_caja(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  m record;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo'; end if;
  select x.*, c.estado as caja_estado, c.sucursal_id into m
    from caja_movimientos x join cajas c on c.id = x.caja_id
   where x.id = p_id and x.empresa_id = s.s_empresa for update of x;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  if m.anulado_at is not null then raise exception 'El movimiento ya está anulado'; end if;
  if m.venta_id is not null or m.cobro_id is not null or m.compra_id is not null or m.gasto_id is not null or m.pago_proveedor_id is not null then
    raise exception 'Ese movimiento es de un documento (venta, cobro, compra, gasto o pago): anulá el documento';
  end if;
  if m.caja_estado <> 'abierta' then raise exception 'La caja ya está cerrada: no se puede anular'; end if;
  if s.s_rol <> 'ADMIN' and m.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then
    raise exception 'Ese movimiento es de una caja de otra sucursal';
  end if;
  if m.tipo = 'ingreso' and m.medio_pago = 'efectivo' and m.monto > caja_efectivo_esperado(m.caja_id) then
    raise exception 'Ese efectivo ya no está en la caja: no se puede anular el ingreso';
  end if;
  update caja_movimientos set anulado_at = now(), anulado_por = s.s_usuario, anulado_motivo = left(btrim(p_motivo), 200)
   where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$fn$;

-- =============================================================================
-- 7. Resumen de un turno y de un día (lo reusa la Fase 4: cierre por día / reportes)
-- =============================================================================

-- resumen_turno(turno) → { caja, efectivo, metodos[], ventas, cobros, egresos, manuales,
--   credito, ventas_lista[], movimientos[] }  · Montos en Gs. · anulados fuera de los totales.
create or replace function :"schema".resumen_turno(p_caja uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c record;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  select cj.*, pv.nombre as punto_nombre, su.nombre as sucursal_nombre, d.nombre as deposito_nombre,
         ua.nombre as abierta_por_nombre, uc.nombre as cerrada_por_nombre
    into c
    from cajas cj
    left join puntos_venta pv on pv.id = cj.punto_venta_id
    left join sucursales su on su.id = cj.sucursal_id
    left join depositos d on d.id = cj.deposito_id
    left join usuarios ua on ua.id = cj.abierta_por
    left join usuarios uc on uc.id = cj.cerrada_por
   where cj.id = p_caja and cj.empresa_id = s.s_empresa;
  if not found then raise exception 'Turno de caja no encontrado'; end if;

  with mov as (
    select m.*, metodo_caja(coalesce(m.metodo, m.medio_pago)) as met,
           case when m.venta_id is not null and m.tipo = 'ingreso' then 'venta'
                when m.venta_id is not null then 'devolucion'
                when m.cobro_id is not null then 'cobro'
                when m.compra_id is not null then 'compra'
                when m.gasto_id is not null then 'gasto'
                when m.pago_proveedor_id is not null then 'pago_proveedor'
                else 'manual' end as origen,
           case when m.tipo in ('ingreso', 'ajuste') then 1 when m.tipo in ('egreso', 'retiro') then -1 else 0 end as signo
      from caja_movimientos m where m.caja_id = p_caja
  ), vivos as (
    select * from mov where anulado_at is null
  ), metodos as (
    select x.met,
           coalesce(sum(v.monto) filter (where v.signo > 0), 0) as ingresos,
           coalesce(sum(v.monto) filter (where v.signo < 0), 0) as egresos
      from (select 'efectivo'::text as met union select met from vivos) x
      left join vivos v on v.met = x.met
     group by x.met
  ), metodos_j as (
    select jsonb_agg(jsonb_build_object(
             'metodo', m.met, 'label', metodo_caja_label(m.met), 'ingresos', m.ingresos, 'egresos', m.egresos,
             'esperado', (case when m.met = 'efectivo' then c.monto_apertura else 0 end) + m.ingresos - m.egresos,
             'declarado', case when c.estado <> 'cerrada' then null
                               when m.met = 'efectivo' then c.monto_cierre_contado
                               else coalesce((c.arqueo_cierre_json->'declarado'->>m.met)::numeric,
                                             m.ingresos - m.egresos) end,
             'diferencia', case when c.estado <> 'cerrada' then null
                                when m.met = 'efectivo' then c.diferencia
                                else coalesce((c.arqueo_cierre_json->'declarado'->>m.met)::numeric, m.ingresos - m.egresos)
                                     - (m.ingresos - m.egresos) end
           ) order by metodo_caja_orden(m.met)) as j
      from metodos m
  )
  select jsonb_build_object(
    'caja', jsonb_build_object(
      'id', c.id, 'numero_caja', c.numero_caja, 'estado', c.estado,
      'punto_venta_id', c.punto_venta_id, 'punto_nombre', c.punto_nombre,
      'sucursal_id', c.sucursal_id, 'sucursal_nombre', c.sucursal_nombre,
      'deposito_id', c.deposito_id, 'deposito_nombre', c.deposito_nombre,
      'abierta_por', c.abierta_por, 'abierta_por_nombre', c.abierta_por_nombre, 'cerrada_por_nombre', c.cerrada_por_nombre,
      'fecha_apertura', c.fecha_apertura, 'fecha_cierre', c.fecha_cierre, 'monto_apertura', c.monto_apertura,
      'observacion_apertura', c.observacion_apertura, 'observacion_cierre', c.observacion_cierre,
      'motivo_diferencia', c.motivo_diferencia, 'monto_cierre_contado', c.monto_cierre_contado,
      'diferencia', c.diferencia, 'diferencia_otros', c.diferencia_otros,
      'billetes', c.arqueo_cierre_json->'billetes'),
    'metodos', (select coalesce(j, '[]'::jsonb) from metodos_j),
    'efectivo', (select jsonb_build_object(
        'apertura', c.monto_apertura,
        'ventas', coalesce(sum(monto) filter (where origen = 'venta'), 0),
        'cobros', coalesce(sum(monto) filter (where origen = 'cobro' and signo > 0), 0),
        'ingresos', coalesce(sum(monto) filter (where origen = 'manual' and tipo = 'ingreso'), 0),
        'retiros', coalesce(sum(monto) filter (where origen = 'manual' and tipo = 'retiro'), 0),
        'compras', coalesce(sum(monto) filter (where origen = 'compra' and signo < 0), 0),
        'gastos', coalesce(sum(monto) filter (where origen = 'gasto' and signo < 0), 0),
        'pagos_proveedores', coalesce(sum(monto) filter (where origen = 'pago_proveedor' and signo < 0), 0),
        'devoluciones', coalesce(sum(monto) filter (where origen = 'devolucion'), 0),
        'egresos_manuales', coalesce(sum(monto) filter (where origen = 'manual' and tipo = 'egreso'), 0),
        'ajustes', coalesce(sum(monto) filter (where origen = 'manual' and tipo = 'ajuste'), 0),
        'esperado', c.monto_apertura + coalesce(sum(monto * signo), 0),
        'contado', c.monto_cierre_contado,
        'diferencia', c.diferencia)
      from vivos where met = 'efectivo'),
    'ventas', jsonb_build_object(
      'contado', (select jsonb_build_object('cantidad', count(distinct venta_id), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'venta'),
      'credito', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(total), 0))
                    from ventas where caja_id = p_caja and tipo_venta = 'CREDITO' and estado <> 'anulada'),
      'anuladas', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(total), 0))
                     from ventas where caja_id = p_caja and estado = 'anulada'),
      'total', coalesce((select sum(monto) from vivos where origen = 'venta'), 0)
               + coalesce((select sum(total) from ventas where caja_id = p_caja and tipo_venta = 'CREDITO' and estado <> 'anulada'), 0),
      'cantidad', (select count(distinct venta_id) from vivos where origen = 'venta')
                  + (select count(*) from ventas where caja_id = p_caja and tipo_venta = 'CREDITO' and estado <> 'anulada'),
      'por_metodo', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', metodo_caja_label(met), 'cantidad', n, 'total', t)
                                               order by metodo_caja_orden(met))
                                from (select met, count(*) as n, sum(monto) as t from vivos where origen = 'venta' group by met) x), '[]'::jsonb)),
    'cobros', jsonb_build_object(
      'cantidad', (select count(distinct cobro_id) from vivos where origen = 'cobro'),
      'total', (select coalesce(sum(monto), 0) from vivos where origen = 'cobro' and signo > 0),
      'por_metodo', coalesce((select jsonb_agg(jsonb_build_object('metodo', met, 'label', metodo_caja_label(met), 'cantidad', n, 'total', t)
                                               order by metodo_caja_orden(met))
                                from (select met, count(*) as n, sum(monto) as t from vivos where origen = 'cobro' group by met) x), '[]'::jsonb)),
    'egresos', jsonb_build_object(
      'compras', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'compra'),
      'gastos', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'gasto'),
      'pagos_proveedores', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'pago_proveedor'),
      'devoluciones', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'devolucion'),
      'total', (select coalesce(sum(monto), 0) from vivos where origen in ('compra', 'gasto', 'pago_proveedor', 'devolucion') and signo < 0)),
    'manuales', jsonb_build_object(
      'ingresos', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'manual' and tipo = 'ingreso'),
      'retiros', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'manual' and tipo = 'retiro'),
      'egresos', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'manual' and tipo = 'egreso'),
      'ajustes', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(monto), 0)) from vivos where origen = 'manual' and tipo = 'ajuste')),
    'credito', jsonb_build_object(
      'cantidad', (select count(*) from ventas where caja_id = p_caja and tipo_venta = 'CREDITO' and estado <> 'anulada'),
      'total', (select coalesce(sum(total), 0) from ventas where caja_id = p_caja and tipo_venta = 'CREDITO' and estado <> 'anulada'),
      'ventas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'venta_id', v.id, 'numero_control', v.numero_control, 'fecha', v.fecha, 'estado', v.estado,
          'cliente_id', v.cliente_id, 'cliente_nombre', coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre),
          'cliente_ruc', coalesce(cl.ruc, cl.documento), 'total', v.total, 'plazo_dias', v.plazo_dias,
          'vencimiento', cx.vencimiento, 'cobrado', cx.cobrado, 'saldo', cx.saldo, 'estado_cuenta', cx.estado
        ) order by v.fecha)
          from ventas v left join clientes cl on cl.id = v.cliente_id left join cuentas_por_cobrar cx on cx.venta_id = v.id
         where v.caja_id = p_caja and v.tipo_venta = 'CREDITO'), '[]'::jsonb)),
    'ventas_lista', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'numero_control', v.numero_control, 'fecha', v.fecha, 'total', v.total, 'tipo_venta', v.tipo_venta,
        'estado', v.estado, 'metodo_pago', v.metodo_pago, 'anulada_at', v.anulada_at,
        'cliente_nombre', coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre),
        'pagos', coalesce((select jsonb_agg(jsonb_build_object('metodo', metodo_caja(d.metodo_pago), 'label', metodo_caja_label(d.metodo_pago),
                                                               'monto', d.monto, 'referencia', d.referencia, 'vuelto', d.vuelto) order by d.created_at)
                             from ventas_pagos_detalle d where d.venta_id = v.id), '[]'::jsonb)
      ) order by v.fecha)
        from ventas v left join clientes cl on cl.id = v.cliente_id
       where v.caja_id = p_caja), '[]'::jsonb),
    'movimientos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'tipo', m.tipo, 'origen', m.origen, 'concepto', m.concepto, 'monto', m.monto, 'signo', m.signo,
        'metodo', m.met, 'metodo_label', metodo_caja_label(m.met), 'referencia', m.referencia, 'banco', m.banco,
        'categoria', m.categoria, 'numero', m.numero, 'observacion', m.observacion,
        'documento', coalesce(vt.numero_control, cb.numero_recibo, co.numero_control, ga.numero, pp.numero, m.numero),
        'venta_id', m.venta_id, 'cobro_id', m.cobro_id, 'compra_id', m.compra_id, 'gasto_id', m.gasto_id,
        'pago_proveedor_id', m.pago_proveedor_id, 'usuario_nombre', us.nombre, 'created_at', m.created_at,
        'anulado', m.anulado_at is not null, 'anulado_motivo', m.anulado_motivo
      ) order by m.created_at, m.id)
        from mov m
        left join ventas vt on vt.id = m.venta_id
        left join cobros_clientes cb on cb.id = m.cobro_id
        left join compras co on co.id = m.compra_id
        left join gastos ga on ga.id = m.gasto_id
        left join pagos_proveedores pp on pp.id = m.pago_proveedor_id
        left join usuarios us on us.id = m.usuario_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- resumen_cajas_dia(fecha, sucursal?) → turnos ABIERTOS ese día (hora de Asunción), con su
-- resumen corto, totales por sucursal y del día, y los métodos sumados. ADMIN ve todas las
-- sucursales; el resto, la suya.
create or replace function :"schema".resumen_cajas_dia(p_fecha date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Asuncion')::date);
  v_suc uuid := p_sucursal;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  if s.s_rol <> 'ADMIN' then v_suc := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)); end if;

  with t as (
    select c.id, resumen_turno(c.id) as rt
      from cajas c
     where c.empresa_id = s.s_empresa
       and (c.fecha_apertura at time zone 'America/Asuncion')::date = v_fecha
       and (v_suc is null or c.sucursal_id = v_suc)
  ), filas as (
    select t.id,
           jsonb_build_object(
             'id', t.id, 'numero_caja', rt->'caja'->'numero_caja', 'estado', rt->'caja'->'estado',
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
      from t
  )
  select jsonb_build_object(
    'fecha', v_fecha,
    'sucursal_id', v_suc,
    'turnos', coalesce((select jsonb_agg(f order by f->>'sucursal_nombre', f->>'punto_nombre', f->>'fecha_apertura') from filas), '[]'::jsonb),
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
  return r;
end;
$fn$;

-- Ventas a crédito (reportería de Caja): por rango, sucursal, caja, turno, cliente, estado.
--   p: { desde?, hasta?, sucursal_id?, punto_venta_id?, caja_id?, cliente_id?, estado?, q?, pagina?, por_pagina? }
--   estado: pendiente | parcial | pagada | anulada | vencida | abiertas (pendiente+parcial)
-- → { rows[], total, totales{cantidad,total,cobrado,saldo,vencido} }
create or replace function :"schema".reporte_ventas_credito(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date := nullif(p->>'desde', '')::date;
  v_hasta date := nullif(p->>'hasta', '')::date;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_punto uuid := nullif(p->>'punto_venta_id', '')::uuid;
  v_turno uuid := nullif(p->>'caja_id', '')::uuid;
  v_cli uuid := nullif(p->>'cliente_id', '')::uuid;
  v_estado text := nullif(p->>'estado', '');
  v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_pp integer := least(greatest(coalesce(nullif(p->>'por_pagina', '')::integer, 50), 10), 500);
  v_pag integer := greatest(coalesce(nullif(p->>'pagina', '')::integer, 1), 1);
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  if s.s_rol not in ('ADMIN', 'SUPERVISOR') then v_suc := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)); end if;

  with base as (
    select v.id as venta_id, v.numero_control, v.fecha, v.total, v.plazo_dias, v.estado as estado_venta,
           v.cliente_id, coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as cliente_nombre,
           coalesce(cl.ruc, cl.documento) as cliente_ruc,
           cx.vencimiento, coalesce(cx.cobrado, 0) as cobrado, coalesce(cx.saldo, 0) as saldo,
           case when v.estado = 'anulada' then 'anulada' else coalesce(cx.estado, 'pendiente') end as estado,
           (cx.estado in ('pendiente', 'parcial') and cx.vencimiento < v_hoy) as vencida,
           case when cx.estado in ('pendiente', 'parcial') and cx.vencimiento < v_hoy then v_hoy - cx.vencimiento else 0 end as dias_vencida,
           v.sucursal_id, su.nombre as sucursal_nombre, v.punto_venta_id, pv.nombre as punto_nombre,
           v.caja_id, cj.numero_caja, v.usuario_nombre, uc.nombre as cajero_nombre
      from ventas v
      left join clientes cl on cl.id = v.cliente_id
      left join cuentas_por_cobrar cx on cx.venta_id = v.id
      left join sucursales su on su.id = v.sucursal_id
      left join puntos_venta pv on pv.id = v.punto_venta_id
      left join cajas cj on cj.id = v.caja_id
      left join usuarios uc on uc.auth_user_id = v.created_by
     where v.empresa_id = s.s_empresa and v.tipo_venta = 'CREDITO'
       and (v_desde is null or v.fecha >= (v_desde::timestamp at time zone 'America/Asuncion'))
       and (v_hasta is null or v.fecha < ((v_hasta + 1)::timestamp at time zone 'America/Asuncion'))
       and (v_suc is null or v.sucursal_id = v_suc)
       and (v_punto is null or v.punto_venta_id = v_punto)
       and (v_turno is null or v.caja_id = v_turno)
       and (v_cli is null or v.cliente_id = v_cli)
       and (v_q is null or v.numero_control ilike '%' || v_q || '%' or cl.nombre ilike '%' || v_q || '%'
            or cl.razon_social ilike '%' || v_q || '%' or cl.ruc ilike '%' || v_q || '%' or cl.documento ilike '%' || v_q || '%')
  ), filtrada as (
    select * from base
     where v_estado is null
        or (v_estado = 'vencida' and vencida)
        or (v_estado = 'abiertas' and estado in ('pendiente', 'parcial'))
        or estado = v_estado
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc, x.venta_id)
                        from (select * from filtrada order by fecha desc, venta_id limit v_pp offset (v_pag - 1) * v_pp) x), '[]'::jsonb),
    'total', (select count(*) from filtrada),
    'totales', (select jsonb_build_object(
                  'cantidad', count(*) filter (where estado <> 'anulada'),
                  'total', coalesce(sum(total) filter (where estado <> 'anulada'), 0),
                  'cobrado', coalesce(sum(cobrado) filter (where estado <> 'anulada'), 0),
                  'saldo', coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial')), 0),
                  'vencido', coalesce(sum(saldo) filter (where vencida), 0),
                  'vencidas', count(*) filter (where vencida))
                  from filtrada)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 8. Cierre (misma firma). p_arqueo_json: { declarado: { metodo: monto }, billetes?: {},
--    motivo_diferencia? }. El efectivo se cuenta (p_monto_contado); lo demás se confirma
--    (si no viene declarado, se toma lo esperado). Con diferencia, el motivo es obligatorio.
-- =============================================================================
create or replace function :"schema".cerrar_caja(
  p_caja_id uuid,
  p_monto_contado numeric,
  p_observacion text,
  p_arqueo_json jsonb
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja record;
  rt jsonb;
  m jsonb;
  v_esperado numeric;
  v_contado numeric := round(p_monto_contado);
  v_dif numeric;
  v_dif_otros numeric := 0;
  v_decl jsonb := '{}'::jsonb;
  v_valor numeric;
  v_motivo text := nullif(btrim(coalesce(p_arqueo_json->>'motivo_diferencia', '')), '');
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  if p_monto_contado is null or p_monto_contado < 0 then raise exception 'Contá el efectivo antes de cerrar (monto 0 o más)'; end if;

  select * into v_caja from cajas where id = p_caja_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Caja no encontrada'; end if;
  if v_caja.estado = 'cerrada' then raise exception 'Esa caja ya está cerrada'; end if;
  if s.s_rol <> 'ADMIN' and v_caja.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then
    raise exception 'Solo podés cerrar las cajas de tu sucursal';
  end if;

  rt := resumen_turno(p_caja_id);
  v_esperado := (rt->'efectivo'->>'esperado')::numeric;
  v_dif := v_contado - v_esperado;
  for m in select * from jsonb_array_elements(rt->'metodos') loop
    if m->>'metodo' = 'efectivo' then continue; end if;
    v_valor := coalesce(nullif(p_arqueo_json->'declarado'->>(m->>'metodo'), '')::numeric, (m->>'esperado')::numeric);
    if v_valor < 0 then raise exception 'El monto declarado de % no puede ser negativo', m->>'label'; end if;
    v_valor := round(v_valor);
    v_decl := v_decl || jsonb_build_object(m->>'metodo', v_valor);
    v_dif_otros := v_dif_otros + (v_valor - (m->>'esperado')::numeric);
  end loop;
  if (v_dif <> 0 or v_dif_otros <> 0) and v_motivo is null then
    raise exception 'Hay diferencias en el arqueo: escribí el motivo';
  end if;

  update cajas
     set estado = 'cerrada', fecha_cierre = now(), cerrada_por = s.s_usuario,
         monto_cierre_contado = v_contado, monto_esperado_efectivo = v_esperado,
         diferencia = v_dif, diferencia_otros = v_dif_otros, motivo_diferencia = v_motivo,
         observacion_cierre = nullif(btrim(coalesce(p_observacion, '')), ''),
         arqueo_cierre_json = jsonb_build_object('declarado', v_decl, 'billetes', p_arqueo_json->'billetes'),
         updated_at = now()
   where id = p_caja_id;
  -- Foto del turno tal como se cerró (el PDF y los reportes la pueden usar sin recalcular).
  update cajas set resumen_cierre = resumen_turno(p_caja_id) where id = p_caja_id;

  return jsonb_build_object(
    'caja_id', p_caja_id, 'numero_caja', v_caja.numero_caja,
    'contado', v_contado, 'esperado', v_esperado, 'diferencia', v_dif, 'diferencia_otros', v_dif_otros);
end;
$fn$;

-- =============================================================================
-- 9. VENTA (Caja). Igual que la Fase 1 + la caja: la venta va al turno abierto que
--    corresponde (p_caja_id o caja_abierta_para) y sale del depósito de ESE turno (o de
--    p_deposito_id, validado como antes). Formas de pago normalizadas: efectivo,
--    tarjeta_debito, tarjeta_credito, transferencia, qr/billetera, cheque (+ los POS
--    viejos), cada una con monto, referencia y banco; en efectivo, lo recibido y el vuelto
--    (solo el efectivo da vuelto). Crédito: cliente obligatorio, plazo y límite.
-- =============================================================================
drop function if exists :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid);

create or replace function :"schema".crear_venta(
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text,
  p_descuento_pct numeric default 0, p_plazo_dias integer default null, p_deposito_id uuid default null,
  p_caja_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
declare
  s record;
  v_empresa uuid;
  v_caja record;
  v_caja_id uuid;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario uuid;
  v_dep uuid;
  v_dep_info record;
  v_tipo text := upper(coalesce(nullif(btrim(p_tipo_venta), ''), 'CONTADO'));
  it jsonb;
  pg jsonb;
  v_pagos jsonb;
  v_pago_metodo text;
  v_pago_monto numeric;
  v_recibido numeric;
  v_vuelto numeric;
  v_vuelto_total numeric := 0;
  v_pagos_sum numeric := 0;
  v_metodos text[] := '{}';
  prod record;
  v_precio numeric;
  v_precio_lista numeric;
  v_precio_override numeric;
  v_factor numeric;
  v_iva_tipo text;
  v_tasa numeric;
  v_cant numeric;
  v_total_linea numeric;
  v_iva numeric;
  v_sub numeric;
  v_item uuid;
  tot_sub numeric := 0;
  tot_iva numeric := 0;
  tot_total numeric := 0;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_empresa := s.s_empresa;
  v_usuario := s.s_usuario;

  if v_tipo not in ('CONTADO', 'CREDITO') then raise exception 'Condición de venta inválida'; end if;
  v_factor := 1 - greatest(0, least(coalesce(p_descuento_pct, 0), 100)) / 100.0;

  -- Idempotencia: si ya se creó con esta clave, devolver la misma venta.
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, numero_control into v_venta, v_numero
      from ventas where empresa_id = v_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_venta is not null then
      return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'reusada', true);
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un ítem';
  end if;

  -- Caja (turno abierto) de la venta.
  v_caja_id := caja_abierta_para(null, null, p_caja_id);
  if v_caja_id is null then raise exception 'Abrí la caja para vender'; end if;
  select c.id, c.sucursal_id, c.punto_venta_id, c.deposito_id, c.numero_caja into v_caja
    from cajas c where c.id = v_caja_id for share;

  -- Cliente (si viene): de la empresa y no borrado. Crédito: obligatorio.
  if p_cliente_id is not null and not exists (
       select 1 from clientes where id = p_cliente_id and empresa_id = v_empresa and deleted_at is null) then
    raise exception 'Cliente no encontrado';
  end if;
  if v_tipo = 'CREDITO' then
    if p_cliente_id is null then raise exception 'La venta a crédito necesita un cliente'; end if;
    if p_plazo_dias is not null and (p_plazo_dias < 1 or p_plazo_dias > 3650) then
      raise exception 'El plazo del crédito tiene que estar entre 1 y 3650 días';
    end if;
  end if;

  -- Depósito del que sale el stock: el de la caja (o el elegido, validado como antes).
  if p_deposito_id is not null then
    select * into v_dep_info from inv_deposito(v_empresa, p_deposito_id, true);
    if s.s_rol <> 'ADMIN' and s.s_sucursal is not null and v_dep_info.suc_id <> s.s_sucursal then
      raise exception 'Solo podés vender desde los depósitos de tu sucursal';
    end if;
    v_dep := p_deposito_id;
  else
    select * into v_dep_info from inv_deposito(v_empresa, v_caja.deposito_id, true);
    v_dep := v_caja.deposito_id;
  end if;

  -- Numeración: varias cajas venden a la vez → se serializa (misma llave que suscripciones).
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  select coalesce(max(case when numero_control ~ '^VTA-[0-9]+$'
           then substring(numero_control from '[0-9]+$')::bigint end), 0) + 1
    into v_next from ventas where empresa_id = v_empresa;
  v_numero := 'VTA-' || lpad(v_next::text, 6, '0');

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio,
                      subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago,
                      caja_id, created_by, usuario_nombre, fecha, observaciones, idempotency_key, deposito_id,
                      sucursal_id, punto_venta_id)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', v_tipo,
            case when v_tipo = 'CREDITO' then p_plazo_dias else null end,
            case when v_tipo = 'CREDITO' then 'credito' else null end,
            v_caja.id, auth.uid(), s.s_nombre, now(), p_observaciones, nullif(p_idempotency_key, ''), v_dep,
            v_caja.sucursal_id, v_caja.punto_venta_id)
    returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un ítem'; end if;

    select * into prod from productos
      where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no existe en esta empresa', it->>'producto_id'; end if;

    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then prod.costo_promedio
                  else prod.precio_venta end;
    v_precio_override := nullif(it->>'precio_unitario', '')::numeric;
    v_precio := case when v_precio_override is not null and v_precio_override > 0
                     then v_precio_override else v_precio_lista end;
    v_precio := round(v_precio
                      * (1 - greatest(0, least(coalesce((it->>'descuento_pct')::numeric, 0), 100)) / 100.0)
                      * v_factor);
    v_total_linea := round(v_cant * v_precio);
    v_iva_tipo := coalesce(nullif(it->>'tipo_iva', ''), prod.tipo_iva);
    v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
    v_iva := case when v_tasa = 0 then 0 else round(v_total_linea * v_tasa / (100 + v_tasa)) end;
    v_sub := v_total_linea - v_iva;

    insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
                             precio_venta_original, precio_venta, tipo_precio, tipo_iva,
                             subtotal, monto_iva, total_linea, costo_unitario)
      values (v_empresa, v_venta, prod.id, prod.nombre, prod.sku, v_cant,
              v_precio_lista, v_precio, coalesce(it->>'tipo_precio', 'minorista'), v_iva_tipo,
              v_sub, v_iva, v_total_linea, prod.costo_promedio)
      returning id into v_item;

    if prod.controla_stock then
      perform inv_mover(v_empresa, prod.id, v_dep, -v_cant, coalesce(prod.costo_promedio, 0), 'venta', 'venta',
                        v_venta, v_numero, 'Venta ' || v_numero, v_usuario, s.s_nombre);
      if prod.controla_lotes then
        perform lotes_consumir(v_empresa, prod.id, v_dep, v_cant, 'venta', v_venta, v_item, null, 'venta', v_venta, v_item);
      end if;
    end if;

    tot_sub := tot_sub + v_sub;
    tot_iva := tot_iva + v_iva;
    tot_total := tot_total + v_total_linea;
  end loop;

  update ventas set subtotal = tot_sub, monto_iva = tot_iva, total = tot_total, updated_at = now()
    where id = v_venta;

  -- Límite de crédito: cliente_saldo ya incluye esta venta (la cuenta por cobrar la crea el trigger).
  if v_tipo = 'CREDITO' then
    declare
      v_limite numeric;
      v_saldo numeric;
    begin
      select limite_credito into v_limite from clientes where id = p_cliente_id and empresa_id = v_empresa;
      if coalesce(v_limite, 0) > 0 then
        v_saldo := cliente_saldo(p_cliente_id);
        if v_saldo > v_limite then
          raise exception 'Supera el límite de crédito del cliente (límite Gs. %, con esta venta quedaría en Gs. %)',
            replace(to_char(v_limite, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_saldo, 'FM999,999,999,990'), ',', '.');
        end if;
      end if;
    end;
  end if;

  -- Cobro (contado): una o varias formas de pago. Sin detalle = todo en efectivo.
  if v_tipo = 'CONTADO' then
    v_pagos := case when p_pagos is not null and jsonb_typeof(p_pagos) = 'array' and jsonb_array_length(p_pagos) > 0
                    then p_pagos
                    else jsonb_build_array(jsonb_build_object('metodo_pago', coalesce(nullif(p_metodo_pago, ''), 'efectivo'), 'monto', tot_total)) end;
    for pg in select * from jsonb_array_elements(v_pagos) loop
      v_pago_metodo := lower(coalesce(nullif(btrim(pg->>'metodo_pago'), ''), 'efectivo'));
      if v_pago_metodo not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'tarjeta_debito', 'tarjeta_credito',
                               'pos', 'pos_debito', 'pos_credito', 'qr', 'billetera', 'otro') then
        raise exception 'Forma de pago inválida: %', v_pago_metodo;
      end if;
      v_pago_monto := round((pg->>'monto')::numeric);
      if v_pago_monto is null or v_pago_monto <= 0 then raise exception 'Hay una forma de pago con monto en cero'; end if;
      v_recibido := round(nullif(pg->>'recibido', '')::numeric);
      v_vuelto := 0;
      if v_pago_metodo = 'efectivo' and v_recibido is not null then
        if v_recibido < v_pago_monto then
          raise exception 'El efectivo recibido (Gs. %) no alcanza para lo que se paga en efectivo (Gs. %)',
            replace(to_char(v_recibido, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_pago_monto, 'FM999,999,999,990'), ',', '.');
        end if;
        v_vuelto := v_recibido - v_pago_monto;
      else
        v_recibido := null;
      end if;
      v_vuelto_total := v_vuelto_total + v_vuelto;
      v_pagos_sum := v_pagos_sum + v_pago_monto;
      if not (metodo_caja(v_pago_metodo) = any (v_metodos)) then v_metodos := v_metodos || metodo_caja(v_pago_metodo); end if;

      insert into ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto, referencia, titular, banco, recibido, vuelto)
        values (v_empresa, v_venta, v_pago_metodo, v_pago_monto, nullif(btrim(pg->>'referencia'), ''), nullif(btrim(pg->>'titular'), ''),
                nullif(btrim(pg->>'banco'), ''), v_recibido, v_vuelto);
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, referencia, banco,
                                    categoria, venta_id, usuario_id, fecha)
        values (v_empresa, v_caja.id, 'ingreso', left('Venta ' || v_numero || ' · ' || metodo_caja_label(v_pago_metodo), 200),
                v_pago_monto, medio_caja(v_pago_metodo), metodo_caja(v_pago_metodo), nullif(btrim(pg->>'referencia'), ''),
                nullif(btrim(pg->>'banco'), ''), 'venta', v_venta, v_usuario, (now() at time zone 'America/Asuncion')::date);
    end loop;
    if v_pagos_sum <> tot_total then
      raise exception 'Las formas de pago suman Gs. % y la venta es de Gs. %',
        replace(to_char(v_pagos_sum, 'FM999,999,999,990'), ',', '.'), replace(to_char(tot_total, 'FM999,999,999,990'), ',', '.');
    end if;
    update ventas set metodo_pago = case when array_length(v_metodos, 1) > 1 then 'mixto' else v_metodos[1] end
     where id = v_venta;
  end if;

  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', tot_total, 'reusada', false,
                            'vuelto', v_vuelto_total, 'caja_id', v_caja.id);
end;
$function$;

-- Anulación. Turno abierto (o venta sin turno): como siempre (el cobro sale del arqueo).
-- Turno CERRADO: solo ADMIN / SUPERVISOR, con motivo; el turno no se toca y el efectivo
-- que se devuelve sale como egreso 'devolucion' de una caja abierta (p_caja_id o la del usuario).
drop function if exists :"schema".anular_venta(uuid);

create or replace function :"schema".anular_venta(p_venta_id uuid, p_motivo text default null, p_caja_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
declare
  s record;
  v_empresa uuid;
  v_venta record;
  v_turno record;
  v_cerrado boolean := false;
  v_dep uuid;
  v_efectivo numeric := 0;
  v_caja_dev uuid;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  it record;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_empresa := s.s_empresa;

  select * into v_venta from ventas where id = p_venta_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_venta.estado = 'anulada' then
    return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', true);
  end if;
  if s.s_rol not in ('ADMIN', 'SUPERVISOR') and v_venta.sucursal_id is not null
     and v_venta.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(v_empresa)) then
    raise exception 'La venta es de otra sucursal: no la podés anular';
  end if;

  if v_venta.caja_id is not null then
    select c.id, c.estado, c.numero_caja into v_turno from cajas c where c.id = v_venta.caja_id;
    v_cerrado := v_turno.estado <> 'abierta';
  end if;

  if v_cerrado then
    if s.s_rol not in ('ADMIN', 'SUPERVISOR') then
      raise exception 'La venta es de % (turno N° %), que ya se cerró: solo un administrador o supervisor puede anularla',
        caja_etiqueta(v_turno.id), v_turno.numero_caja;
    end if;
    if v_motivo is null then raise exception 'La venta es de un turno ya cerrado: escribí el motivo de la anulación'; end if;
    select coalesce(sum(monto), 0) into v_efectivo from caja_movimientos
     where venta_id = p_venta_id and tipo = 'ingreso' and medio_pago = 'efectivo' and anulado_at is null;
    if v_efectivo > 0 then
      v_caja_dev := caja_abierta_para(null, null, p_caja_id);
      if v_caja_dev is null then
        raise exception 'Hay que devolver Gs. % en efectivo: abrí una caja (sale de ahí) y volvé a intentar',
          replace(to_char(v_efectivo, 'FM999,999,999,990'), ',', '.');
      end if;
      if v_efectivo > caja_efectivo_esperado(v_caja_dev) then
        raise exception 'En % no hay Gs. % en efectivo para devolver', caja_etiqueta(v_caja_dev),
          replace(to_char(v_efectivo, 'FM999,999,999,990'), ',', '.');
      end if;
    end if;
  end if;

  v_dep := coalesce(v_venta.deposito_id, deposito_por_defecto(v_empresa, null));
  for it in select vi.producto_id, vi.cantidad, vi.costo_unitario
              from ventas_items vi
              join productos p on p.id = vi.producto_id and p.controla_stock
             where vi.venta_id = p_venta_id and vi.empresa_id = v_empresa
             order by vi.producto_id loop
    perform inv_mover(v_empresa, it.producto_id, v_dep, it.cantidad, coalesce(it.costo_unitario, 0), 'anulacion_venta',
                      'venta', v_venta.id, v_venta.numero_control, 'Anulación ' || v_venta.numero_control,
                      s.s_usuario, s.s_nombre);
  end loop;
  perform lotes_revertir(v_empresa, v_venta.id, null, null, 'SALIDA', array['venta'], 'anulacion_venta',
                         'Anulación ' || v_venta.numero_control);

  if v_cerrado then
    if v_efectivo > 0 then
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, categoria, venta_id,
                                    usuario_id, observacion, fecha)
        values (v_empresa, v_caja_dev, 'egreso', left('Devolución por anulación de ' || v_venta.numero_control, 200), v_efectivo,
                'efectivo', 'efectivo', 'devolucion', v_venta.id, s.s_usuario, v_motivo, (now() at time zone 'America/Asuncion')::date);
    end if;
  else
    update caja_movimientos
       set anulado_at = now(), anulado_por = s.s_usuario, anulado_motivo = coalesce('Venta anulada: ' || v_motivo, 'Venta anulada')
     where venta_id = p_venta_id and empresa_id = v_empresa and anulado_at is null;
  end if;

  update ventas set estado = 'anulada', anulada_at = now(), anulada_por = s.s_usuario, anulada_motivo = v_motivo, updated_at = now()
   where id = p_venta_id;

  return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', false,
                            'devolucion_efectivo', v_efectivo, 'caja_devolucion', v_caja_dev);
end;
$function$;

-- Catálogo del POS con el stock del depósito de la caja (p_deposito; si no, el de siempre).
drop function if exists :"schema".productos_pos(boolean);

create or replace function :"schema".productos_pos(p_solo_nombre boolean default false, p_deposito uuid default null)
returns json language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_dep uuid;
  v_prod json;
  v_venc json;
begin
  if v_emp is null then return json_build_object('productos', '[]'::json, 'vencidos', '[]'::json); end if;
  if coalesce(p_solo_nombre, false) then
    select coalesce(json_agg(r), '[]'::json) into v_prod from (
      select p.nombre from productos p
       where p.empresa_id = v_emp and p.activo and p.es_vendible
       order by p.nombre, p.id) r;
    return json_build_object('productos', v_prod, 'vencidos', '[]'::json);
  end if;
  if p_deposito is not null then
    select id into v_dep from depositos where id = p_deposito and empresa_id = v_emp;
    if v_dep is null then raise exception 'Depósito no encontrado'; end if;
  else
    v_dep := deposito_por_defecto(v_emp, (select u.sucursal_id from usuarios u where u.auth_user_id = auth.uid() and u.activo limit 1));
  end if;
  select coalesce(json_agg(r), '[]'::json) into v_prod from (
    select p.id, p.nombre, p.sku, p.codigo_barras, p.precio_venta, p.precio_mayorista, p.precio_distribuidor,
           p.descuento_pct, coalesce(sd.cantidad, 0) as stock_actual, p.stock_actual as stock_total,
           p.unidad_medida, p.tipo_iva, p.controla_stock, p.imagen_url
      from productos p
      left join stock_depositos sd on sd.producto_id = p.id and sd.deposito_id = v_dep
     where p.empresa_id = v_emp and p.activo and p.es_vendible
     order by p.nombre, p.id) r;
  select coalesce(json_agg(v), '[]'::json) into v_venc from (
    select l.producto_id, sum(l.cantidad) as vencido
      from lotes l
     where l.empresa_id = v_emp and l.deposito_id = v_dep and l.cantidad > 0
       and l.vencimiento < (now() at time zone 'America/Asuncion')::date
     group by l.producto_id) v;
  return json_build_object('productos', v_prod, 'vencidos', v_venc, 'deposito_id', v_dep);
end;
$fn$;

-- =============================================================================
-- 10. Cobros, compras y pagos a proveedores en efectivo: la caja del usuario (los gastos,
--     en la receta 52).
--     Sobre la definición VIGENTE de cada función se reemplaza SOLO la línea que tomaba
--     "la última caja abierta de la empresa" por caja_abierta_para(null, null, p.caja_id)
--     (acepta p.caja_id para elegir). Si alguna ya no tiene esa línea, avisa y no la toca.
-- =============================================================================
do $patch$
declare
  f record;
  v_def text;
  v_new text;
begin
  for f in select p.oid, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = current_schema()
              and p.proname in ('registrar_cobro', 'registrar_compra', 'registrar_pago_proveedor') loop
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def,
      'select id into v_caja from cajas where empresa_id = v_[a-z_]+ and estado = ''abierta'' order by fecha_apertura desc limit 1',
      'v_caja := caja_abierta_para(null, null, nullif(p->>''caja_id'', '''')::uuid)', 'g');
    if v_new <> v_def then
      execute v_new;
      raise notice '51_caja_sucursal: % ahora usa la caja abierta del usuario (caja_abierta_para)', f.proname;
    elsif position('caja_abierta_para' in v_def) > 0 then
      raise notice '51_caja_sucursal: % ya usa caja_abierta_para', f.proname;
    else
      raise warning '51_caja_sucursal: % no tiene la búsqueda de la caja de la empresa: revisala a mano', f.proname;
    end if;
  end loop;
end;
$patch$;

-- =============================================================================
-- 11. Permisos: puntos_venta y cajas son de SOLO LECTURA para la sesión del usuario
--     (se escriben por las funciones de arriba). caja_movimientos sigue con escritura
--     porque cobros/pagos/gastos (SECURITY INVOKER) insertan ahí; la guarda de turno
--     abierto la pone el trigger.
-- =============================================================================
alter table :"schema".puntos_venta enable row level security;
alter table :"schema".puntos_venta force row level security;
drop policy if exists puntos_venta_propios on :"schema".puntos_venta;
create policy puntos_venta_propios on :"schema".puntos_venta for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
revoke all on :"schema".puntos_venta from authenticated;
grant select on :"schema".puntos_venta to authenticated;
grant all on :"schema".puntos_venta to service_role;

revoke insert, update, delete on :"schema".cajas from authenticated;
grant select on :"schema".cajas to authenticated;

revoke execute on function :"schema".tg_caja_mov_abierta() from public;
revoke execute on function :"schema".tg_ventas_caja_abierta() from public;

grant execute on function :"schema".metodo_caja(text) to authenticated, service_role;
grant execute on function :"schema".metodo_caja_label(text) to authenticated, service_role;
grant execute on function :"schema".metodo_caja_orden(text) to authenticated, service_role;
grant execute on function :"schema".medio_caja(text) to authenticated, service_role;
grant execute on function :"schema".sucursal_principal(uuid) to authenticated, service_role;
grant execute on function :"schema".caja_etiqueta(uuid) to authenticated, service_role;
grant execute on function :"schema".caja_abierta_para(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function :"schema".caja_efectivo_esperado(uuid) to authenticated, service_role;
grant execute on function :"schema".listar_cajas() to authenticated, service_role;
grant execute on function :"schema".guardar_punto_venta(jsonb) to authenticated, service_role;
grant execute on function :"schema".abrir_caja(uuid, numeric, text) to authenticated, service_role;
grant execute on function :"schema".registrar_movimiento_caja(jsonb) to authenticated, service_role;
grant execute on function :"schema".anular_movimiento_caja(uuid, text) to authenticated, service_role;
grant execute on function :"schema".resumen_turno(uuid) to authenticated, service_role;
grant execute on function :"schema".resumen_cajas_dia(date, uuid) to authenticated, service_role;
grant execute on function :"schema".reporte_ventas_credito(jsonb) to authenticated, service_role;
grant execute on function :"schema".cerrar_caja(uuid, numeric, text, jsonb) to authenticated, service_role;
grant execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, uuid) to authenticated, service_role;
grant execute on function :"schema".anular_venta(uuid, text, uuid) to authenticated, service_role;
grant execute on function :"schema".productos_pos(boolean, uuid) to authenticated, service_role;

commit;
