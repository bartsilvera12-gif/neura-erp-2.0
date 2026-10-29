-- =============================================================================
-- NOTAS DE CRÉDITO Y ANULACIÓN DE FACTURAS (pedido del dueño, 29-oct-2026).
--
-- Nota de crédito (NC-000001) sobre una venta, con motivo:
--   · Devolución de productos: por línea y cantidad (hasta lo que queda sin devolver). Monto =
--     la parte proporcional de la línea (con su descuento y sus modificadores); la última
--     unidad toma lo que falta para no dejar centavos. IVA de la línea.
--     Por línea "vuelve al stock" (por defecto sí): entra al depósito de la venta a las MISMAS
--     capas de costo (PEPS) y lotes de los que salió; un plato con receta devuelve sus
--     ingredientes en proporción. Si "no vuelve" (vino dañado) queda como PÉRDIDA (reporte de
--     pérdidas, motivo "Devolución de cliente", al costo de la venta).
--   · Descuento / bonificación por monto: sin stock; el IVA se reparte como el de la venta.
--   · Tope: lo que falta acreditar de la venta (total − notas emitidas).
--   · La plata: venta a CRÉDITO → primero baja la deuda de esa venta (lo más viejo primero; la
--     cuota baja su monto). Lo que sobra (o todo, si fue al contado) se elige en cada nota:
--       - "devolver": sale de una caja abierta (efectivo, transferencia, …) como egreso
--         "Devolución NC-…" (en el cierre de turno figura en Devoluciones);
--       - "saldo_favor": queda a favor del cliente (saldo_favor_movimientos) y se usa como
--         forma de pago en la próxima venta o para pagar su deuda.
--   · Permiso nuevo 'notas_credito' (Ventas y caja), dado a los perfiles que anulan ventas.
-- Anular una nota (anular_nota_credito): con motivo; vuelve todo (stock fuera de nuevo, deuda,
--   saldo a favor, caja). No se puede si su saldo a favor ya se usó o si la devolución salió de
--   un turno ya cerrado.
-- Anulación de ventas (anular_venta, parche):
--   · una FACTURA solo se anula dentro de las 48 h de emitida (regla SIFEN); después, nota de
--     crédito. El ticket no tiene plazo.
--   · con notas de crédito emitidas no se anula (hay que anularlas primero).
-- Caja (crear_venta, parche): forma de pago 'saldo_favor' (con cliente; no entra a la caja;
--   descuenta su saldo). Anular la venta se lo devuelve.
-- Cuentas por cobrar: columna nc_monto (lo que bajaron las notas); estado_cxc marca "pagada"
--   la cuota que queda en 0; tg_ventas_cxc conserva lo acreditado y no regenera las cuotas de
--   una venta con notas.
-- Consultas: nota_credito_previa(venta) · listar_notas_credito · nota_credito_detalle.
--
-- IDEMPOTENTE. Va después de 98.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Orígenes y tipos nuevos
-- =============================================================================
alter table :"schema".movimientos_inventario drop constraint if exists movinv_origen_check;
alter table :"schema".movimientos_inventario add constraint movinv_origen_check check (origen in (
  'inventario_inicial', 'ajuste_manual', 'venta', 'anulacion_venta', 'compra', 'anulacion_compra', 'traslado_salida',
  'traslado_entrada', 'anulacion_traslado', 'ajuste', 'perdida', 'anulacion_ajuste', 'anulacion_perdida', 'apertura',
  'produccion', 'anulacion_produccion', 'devolucion_venta', 'anulacion_devolucion'));
alter table :"schema".movimientos_inventario drop constraint if exists movinv_documento_tipo_check;
alter table :"schema".movimientos_inventario add constraint movinv_documento_tipo_check
  check (documento_tipo is null or documento_tipo in ('compra', 'venta', 'traslado', 'ajuste', 'perdida', 'produccion', 'nota_credito'));
alter table :"schema".lotes_movimientos drop constraint if exists chk_lotes_mov_origen;
alter table :"schema".lotes_movimientos add constraint chk_lotes_mov_origen check (origen in (
  'compra', 'anulacion_compra', 'venta', 'anulacion_venta', 'ajuste_manual', 'baja_lote', 'sin_lote_inicial',
  'traslado_salida', 'traslado_entrada', 'anulacion_traslado', 'ajuste', 'inventario_inicial', 'perdida',
  'anulacion_ajuste', 'anulacion_perdida', 'produccion', 'anulacion_produccion', 'devolucion_venta', 'anulacion_devolucion'));

alter table :"schema".ventas_pagos_detalle drop constraint if exists vpd_metodo_check;
alter table :"schema".ventas_pagos_detalle add constraint vpd_metodo_check check (metodo_pago in (
  'efectivo', 'transferencia', 'cheque', 'tarjeta', 'tarjeta_debito', 'tarjeta_credito', 'pos', 'pos_debito',
  'pos_credito', 'qr', 'billetera', 'otro', 'saldo_favor'));

alter table :"schema".saldo_favor_movimientos drop constraint if exists chk_sf_tipo;
alter table :"schema".saldo_favor_movimientos add constraint chk_sf_tipo
  check (tipo in ('anticipo', 'uso', 'ajuste', 'nota_credito'));

alter table :"schema".cuentas_por_cobrar add column if not exists nc_monto numeric not null default 0;
comment on column :"schema".cuentas_por_cobrar.nc_monto is
  'Lo que bajaron las notas de crédito (receta 99): el monto original de la cuota es monto + nc_monto.';

-- =============================================================================
-- 2. Tablas
-- =============================================================================
create table if not exists :"schema".notas_credito (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,
  venta_id uuid not null references :"schema".ventas(id) on delete restrict,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  fecha timestamptz not null default now(),
  tipo text not null default 'devolucion',
  motivo text not null,
  subtotal numeric not null default 0,
  monto_iva numeric not null default 0,
  total numeric not null default 0,
  a_cuenta numeric not null default 0,              -- bajó la deuda de la venta (crédito)
  devuelto numeric not null default 0,              -- plata devuelta desde una caja
  a_favor numeric not null default 0,               -- quedó como saldo a favor del cliente
  metodo_devolucion text,
  referencia_devolucion text,
  caja_id uuid references :"schema".cajas(id) on delete set null,
  deposito_id uuid references :"schema".depositos(id) on delete set null,
  sucursal_id uuid references :"schema".sucursales(id) on delete set null,
  tipo_documento text,                              -- de la venta (factura / ticket)
  estado text not null default 'emitida',
  idempotency_key text,
  created_by uuid,
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  anulada_at timestamptz,
  anulada_por uuid,
  anulada_por_nombre text,
  anulada_motivo text,
  constraint chk_nc_tipo check (tipo in ('devolucion', 'descuento')),
  constraint chk_nc_estado check (estado in ('emitida', 'anulada')),
  constraint chk_nc_motivo check (length(btrim(motivo)) between 3 and 500),
  constraint chk_nc_montos check (total >= 0 and a_cuenta >= 0 and devuelto >= 0 and a_favor >= 0),
  constraint uq_notas_credito_numero unique (empresa_id, numero)
);
create unique index if not exists notas_credito_idem_idx on :"schema".notas_credito (empresa_id, idempotency_key) where idempotency_key is not null;
create index if not exists notas_credito_lista_idx on :"schema".notas_credito (empresa_id, fecha desc);
create index if not exists notas_credito_venta_idx on :"schema".notas_credito (venta_id);
create index if not exists notas_credito_cliente_idx on :"schema".notas_credito (cliente_id);

create table if not exists :"schema".notas_credito_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nota_id uuid not null references :"schema".notas_credito(id) on delete cascade,
  orden integer not null default 0,
  venta_item_id uuid references :"schema".ventas_items(id) on delete set null,
  producto_id uuid references :"schema".productos(id) on delete set null,
  producto_nombre text not null,
  sku text,
  cantidad numeric not null,
  precio_unitario numeric not null default 0,
  tipo_iva text,
  subtotal numeric not null default 0,
  monto_iva numeric not null default 0,
  total_linea numeric not null default 0,
  mueve_stock boolean not null default false,       -- el producto (o su receta) mueve stock
  vuelve_stock boolean not null default false,      -- volvió al depósito (si no: pérdida)
  costo_unitario numeric not null default 0,        -- costo de la venta (lo que vuelve o se pierde)
  constraint chk_nci_cantidad check (cantidad > 0)
);
create index if not exists notas_credito_items_nota_idx on :"schema".notas_credito_items (nota_id, orden);
create index if not exists notas_credito_items_vi_idx on :"schema".notas_credito_items (venta_item_id);

create table if not exists :"schema".notas_credito_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nota_id uuid not null references :"schema".notas_credito(id) on delete cascade,
  cxc_id uuid not null references :"schema".cuentas_por_cobrar(id) on delete cascade,
  monto numeric not null check (monto > 0)
);
create index if not exists notas_credito_aplic_nota_idx on :"schema".notas_credito_aplicaciones (nota_id);

alter table :"schema".saldo_favor_movimientos add column if not exists nota_credito_id uuid references :"schema".notas_credito(id) on delete set null;
alter table :"schema".saldo_favor_movimientos add column if not exists venta_id uuid references :"schema".ventas(id) on delete set null;
create index if not exists sf_nota_idx on :"schema".saldo_favor_movimientos (nota_credito_id) where nota_credito_id is not null;
create index if not exists sf_venta_idx on :"schema".saldo_favor_movimientos (venta_id) where venta_id is not null;
alter table :"schema".caja_movimientos add column if not exists nota_credito_id uuid references :"schema".notas_credito(id) on delete set null;
create index if not exists caja_mov_nota_idx on :"schema".caja_movimientos (nota_credito_id) where nota_credito_id is not null;

alter table :"schema".notas_credito enable row level security;
alter table :"schema".notas_credito force row level security;
alter table :"schema".notas_credito_items enable row level security;
alter table :"schema".notas_credito_items force row level security;
alter table :"schema".notas_credito_aplicaciones enable row level security;
alter table :"schema".notas_credito_aplicaciones force row level security;
-- Se leen con las funciones (llevan costos).
revoke all on :"schema".notas_credito, :"schema".notas_credito_items, :"schema".notas_credito_aplicaciones from anon, authenticated;
grant all on :"schema".notas_credito, :"schema".notas_credito_items, :"schema".notas_credito_aplicaciones to service_role;

-- Numeración NC-000001 con contador O(1) (receta 96).
insert into :"schema".numeracion_familias (familia, tabla, columna, modo, serie_modo, serie_col)
  values ('notas_credito.numero', 'notas_credito', 'numero', 'sufijo', '', null)
on conflict (familia) do nothing;
drop trigger if exists trg_num_notas_credito_numero on :"schema".notas_credito;
create trigger trg_num_notas_credito_numero after insert or delete or update of numero, empresa_id on :"schema".notas_credito
  for each row execute function :"schema".tg_numeracion_maximos('notas_credito.numero');
drop trigger if exists trg_num_notas_credito_numero_tr on :"schema".notas_credito;
create trigger trg_num_notas_credito_numero_tr after truncate on :"schema".notas_credito
  for each statement execute function :"schema".tg_numeracion_maximos('notas_credito.numero');
insert into :"schema".numeracion_maximos (empresa_id, familia, serie, ultimo)
  select e.id, 'notas_credito.numero', '', :"schema".numeracion_contar(e.id, 'notas_credito.numero', '') from :"schema".empresas e
on conflict (empresa_id, familia, serie) do update set ultimo = excluded.ultimo, updated_at = now()
  where numeracion_maximos.ultimo is distinct from excluded.ultimo;

-- =============================================================================
-- 3. Cuentas por cobrar: la cuota que queda en 0 está pagada
-- =============================================================================
create or replace function :"schema".estado_cxc(p_monto numeric, p_cobrado numeric, p_anulada boolean)
returns text language sql immutable as $$
  select case when p_anulada then 'anulada'
              when p_monto <= 0 and p_cobrado >= p_monto then 'pagada'   -- 99: una nota de crédito la dejó en 0
              when p_cobrado <= 0 then 'pendiente'
              when p_cobrado >= p_monto then 'pagada'
              else 'parcial' end
$$;

-- =============================================================================
-- 4. Lotes: devolver a los mismos lotes de los que salió la línea
-- =============================================================================
create or replace function :"schema".nc_lotes_devolver(p_empresa uuid, p_producto uuid, p_deposito uuid, p_venta_item uuid,
                                                       p_venta uuid, p_cantidad numeric, p_nota uuid, p_nota_item uuid, p_numero text)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_resta numeric := p_cantidad;
  v_ya numeric;
  v_toma numeric;
begin
  if not exists (select 1 from productos where id = p_producto and controla_lotes and controla_stock) then return; end if;
  for r in
    select lm.lote_id, sum(lm.cantidad) as salio, max(lm.created_at) as ultima
      from lotes_movimientos lm
     where lm.empresa_id = p_empresa and lm.venta_item_id = p_venta_item and lm.producto_id = p_producto
       and lm.tipo = 'SALIDA' and lm.origen = 'venta' and not lm.revertido
     group by lm.lote_id
     order by max(lm.created_at) desc, lm.lote_id
  loop
    exit when v_resta <= 0;
    select coalesce(sum(x.cantidad), 0) into v_ya from lotes_movimientos x
     where x.empresa_id = p_empresa and x.venta_item_id = p_venta_item and x.producto_id = p_producto
       and x.tipo = 'ENTRADA' and x.origen = 'devolucion_venta' and not x.revertido and x.lote_id is not distinct from r.lote_id;
    v_toma := least(r.salio - v_ya, v_resta);
    continue when v_toma <= 0;
    if r.lote_id is not null then update lotes set cantidad = cantidad + v_toma where id = r.lote_id; end if;
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, venta_id, venta_item_id,
                                   motivo, documento_tipo, documento_id, documento_item_id)
      values (p_empresa, p_producto, r.lote_id, p_deposito, 'ENTRADA', v_toma, 'devolucion_venta', p_venta, p_venta_item,
              left('Devolución ' || p_numero, 300), 'nota_credito', p_nota, p_nota_item);
    v_resta := v_resta - v_toma;
  end loop;
  -- Lo que no tenía lote (vendido sin lote): entra sin lote.
  if v_resta > 0 then
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, venta_id, venta_item_id,
                                   motivo, documento_tipo, documento_id, documento_item_id)
      values (p_empresa, p_producto, null, p_deposito, 'ENTRADA', v_resta, 'devolucion_venta', p_venta, p_venta_item,
              left('Devolución ' || p_numero, 300), 'nota_credito', p_nota, p_nota_item);
  end if;
end;
$fn$;

-- =============================================================================
-- 5. Vista previa para el modal (lo que queda por devolver de cada línea)
-- =============================================================================
create or replace function :"schema".nota_credito_previa(p_venta uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v record;
  v_ya numeric;
  v_deuda numeric;
  v_caja uuid;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  select * into v from ventas where id = p_venta and empresa_id = s.s_empresa;
  if not found then raise exception 'Venta no encontrada'; end if;
  select coalesce(sum(total), 0) into v_ya from notas_credito where venta_id = v.id and estado = 'emitida';
  select coalesce(sum(saldo), 0) into v_deuda from cuentas_por_cobrar
   where venta_id = v.id and estado in ('pendiente', 'parcial');
  begin
    v_caja := caja_abierta_para(null, null, null);
  exception when others then v_caja := null;   -- varias cajas: se elige en el modal
  end;
  select jsonb_build_object(
    'venta', jsonb_build_object(
      'id', v.id, 'numero_control', v.numero_control, 'fecha', v.fecha, 'total', v.total, 'estado', v.estado,
      'tipo_venta', v.tipo_venta, 'tipo_documento', v.tipo_documento, 'cliente_id', v.cliente_id,
      'cliente_nombre', coalesce((select coalesce(nullif(btrim(c.razon_social), ''), c.nombre) from clientes c where c.id = v.cliente_id),
                                 case when v.receptor_ocasional then 'Cliente ocasional (X)' else 'Consumidor final (sin cliente)' end),
      'horas', round(extract(epoch from now() - v.fecha) / 3600, 1),
      'factura_anulable', v.tipo_documento <> 'factura' or now() - v.fecha <= interval '48 hours'),
    'acreditado', v_ya,
    'disponible', greatest(v.total - v_ya, 0),
    'deuda', v_deuda,
    'saldo_favor', case when v.cliente_id is null then 0 else saldo_favor_cliente(v.cliente_id) end,
    'caja', case when v_caja is null then null else jsonb_build_object(
              'id', v_caja, 'etiqueta', caja_etiqueta(v_caja), 'efectivo', caja_efectivo_esperado(v_caja)) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', vi.id, 'producto_id', vi.producto_id, 'producto_nombre', vi.producto_nombre, 'sku', vi.sku,
               'modificadores_texto', vi.modificadores_texto,
               'cantidad', vi.cantidad, 'precio_venta', vi.precio_venta, 'total_linea', vi.total_linea, 'tipo_iva', vi.tipo_iva,
               'unidad_medida', p.unidad_medida,
               'devuelto', coalesce(d.cant, 0), 'disponible', greatest(vi.cantidad - coalesce(d.cant, 0), 0),
               'monto_disponible', greatest(vi.total_linea - coalesce(d.monto, 0), 0),
               'receta', exists (select 1 from ventas_items_insumos x where x.venta_item_id = vi.id and x.descontado),
               'mueve_stock', coalesce(p.controla_stock, false)
                              or exists (select 1 from ventas_items_insumos x where x.venta_item_id = vi.id and x.descontado))
             order by vi.created_at, vi.id)
        from ventas_items vi
        left join productos p on p.id = vi.producto_id
        left join lateral (
          select sum(nci.cantidad) as cant, sum(nci.total_linea) as monto
            from notas_credito_items nci join notas_credito n on n.id = nci.nota_id
           where nci.venta_item_id = vi.id and n.estado = 'emitida') d on true
       where vi.venta_id = v.id), '[]'::jsonb),
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'numero', n.numero, 'fecha', n.fecha, 'total', n.total, 'estado', n.estado,
                                          'tipo', n.tipo, 'motivo', n.motivo) order by n.fecha)
        from notas_credito n where n.venta_id = v.id), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 6. Emitir la nota de crédito
-- =============================================================================
create or replace function :"schema".crear_nota_credito(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_emp uuid;
  v record;
  vi record;
  it jsonb;
  ins record;
  g record;
  cx record;
  v_nc uuid;
  v_num text;
  v_key text := nullif(btrim(coalesce(p->>'idempotency_key', '')), '');
  v_tipo text := lower(coalesce(nullif(btrim(p->>'tipo'), ''), 'devolucion'));
  v_motivo text := nullif(btrim(coalesce(p->>'motivo', '')), '');
  v_destino text := lower(coalesce(nullif(btrim(p->>'destino'), ''), 'devolver'));
  v_metodo text := lower(coalesce(nullif(btrim(p->>'metodo'), ''), 'efectivo'));
  v_ref text := nullif(left(btrim(coalesce(p->>'referencia', '')), 80), '');
  v_dep uuid;
  v_caja uuid;
  v_restante numeric;
  v_cant numeric;
  v_disp numeric;
  v_ya_cant numeric;
  v_ya_monto numeric;
  v_monto numeric;
  v_tasa numeric;
  v_iva numeric;
  v_vuelve boolean;
  v_mueve boolean;
  v_receta boolean;
  v_item uuid;
  v_orden integer := 0;
  v_total numeric := 0;
  v_ivat numeric := 0;
  v_a_cuenta numeric := 0;
  v_resto numeric;
  v_ap numeric;
  v_base numeric;
  v_acum numeric := 0;
  v_n integer;
  v_i integer := 0;
  v_q numeric;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_emp := s.s_empresa;
  perform exigir_permiso('notas_credito');

  if v_key is not null then
    select id, numero into v_nc, v_num from notas_credito where empresa_id = v_emp and idempotency_key = v_key;
    if v_nc is not null then return jsonb_build_object('id', v_nc, 'numero', v_num, 'reusada', true); end if;
  end if;

  if v_motivo is null or length(v_motivo) < 3 then raise exception 'Escribí el motivo de la nota de crédito'; end if;
  if v_tipo not in ('devolucion', 'descuento') then raise exception 'Tipo de nota de crédito inválido'; end if;
  if v_destino not in ('devolver', 'saldo_favor') then raise exception 'Elegí qué hacer con la plata: devolverla o dejarla a favor'; end if;

  select * into v from ventas where id = nullif(p->>'venta_id', '')::uuid and empresa_id = v_emp for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.estado = 'anulada' then raise exception 'La venta % está anulada', v.numero_control; end if;
  if not (alcance_todas() or tiene_permiso('anular_ventas_cerradas')) and v.sucursal_id is not null
     and v.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(v_emp)) then
    raise exception 'La venta es de otra sucursal: no le podés hacer nota de crédito';
  end if;

  v_restante := v.total - coalesce((select sum(total) from notas_credito where venta_id = v.id and estado = 'emitida'), 0);
  if v_restante <= 0 then raise exception 'La venta % ya tiene notas de crédito por todo su total', v.numero_control; end if;

  perform pg_advisory_xact_lock(hashtext('nc_numero_' || v_emp::text));
  v_num := 'NC-' || lpad(inv_numero(v_emp, 'nota_credito', numeracion_max(v_emp, 'notas_credito.numero'))::text, 6, '0');
  v_dep := coalesce(v.deposito_id, deposito_por_defecto(v_emp, v.sucursal_id));

  insert into notas_credito (empresa_id, numero, venta_id, cliente_id, tipo, motivo, deposito_id, sucursal_id, tipo_documento,
                             idempotency_key, created_by, usuario_id, usuario_nombre)
    values (v_emp, v_num, v.id, v.cliente_id, v_tipo, left(v_motivo, 500), v_dep, v.sucursal_id, v.tipo_documento,
            v_key, auth.uid(), s.s_usuario, s.s_nombre)
    returning id into v_nc;

  -- Las capas de costo vuelven a las de la venta (capas_aplicar, origen devolucion_venta).
  perform set_config('erp.nc_venta', v.id::text, true);

  if v_tipo = 'devolucion' then
    if jsonb_typeof(p->'items') <> 'array' then raise exception 'Elegí qué productos se devuelven'; end if;
    for it in select * from jsonb_array_elements(p->'items') loop
      v_cant := coalesce(nullif(it->>'cantidad', '')::numeric, 0);
      continue when v_cant <= 0;
      select vi2.*, coalesce(pr.controla_stock, false) as controla_stock, pr.unidad_medida
        into vi
        from ventas_items vi2 left join productos pr on pr.id = vi2.producto_id
       where vi2.id = nullif(it->>'venta_item_id', '')::uuid and vi2.venta_id = v.id
         for update of vi2;
      if not found then raise exception 'Uno de los productos no es de esta venta'; end if;
      select coalesce(sum(nci.cantidad), 0), coalesce(sum(nci.total_linea), 0) into v_ya_cant, v_ya_monto
        from notas_credito_items nci join notas_credito n on n.id = nci.nota_id
       where nci.venta_item_id = vi.id and n.estado = 'emitida' and n.id <> v_nc;
      v_disp := vi.cantidad - v_ya_cant;
      if v_cant > v_disp + 0.00001 then
        raise exception '"%": se vendieron %, ya se devolvieron %; podés devolver hasta %',
          vi.producto_nombre, trim_scale(vi.cantidad), trim_scale(v_ya_cant), trim_scale(greatest(v_disp, 0));
      end if;
      -- La última parte toma lo que falta de la línea (sin centavos sueltos).
      v_monto := case when abs(v_cant - v_disp) < 0.00001 then vi.total_linea - v_ya_monto
                      else round(vi.total_linea * v_cant / nullif(vi.cantidad, 0)) end;
      -- Con un descuento previo, la devolución no pasa lo que queda por acreditar de la venta.
      v_monto := greatest(least(v_monto, v_restante - v_total), 0);
      v_tasa := case vi.tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
      v_iva := case when v_tasa = 0 then 0 else round(v_monto * v_tasa / (100 + v_tasa)) end;
      v_receta := exists (select 1 from ventas_items_insumos x where x.venta_item_id = vi.id and x.descontado);
      v_mueve := vi.controla_stock or v_receta;
      v_vuelve := v_mueve and coalesce((it->>'vuelve_stock')::boolean, true);
      v_orden := v_orden + 1;
      insert into notas_credito_items (empresa_id, nota_id, orden, venta_item_id, producto_id, producto_nombre, sku, cantidad,
                                       precio_unitario, tipo_iva, subtotal, monto_iva, total_linea, mueve_stock, vuelve_stock,
                                       costo_unitario)
        values (v_emp, v_nc, v_orden, vi.id, vi.producto_id, vi.producto_nombre, vi.sku, v_cant,
                round(v_monto / v_cant, 2), vi.tipo_iva, v_monto - v_iva, v_iva, v_monto, v_mueve, v_vuelve,
                coalesce(vi.costo_unitario, 0))
        returning id into v_item;

      if v_vuelve then
        if v_receta then
          -- Plato con receta: vuelven sus ingredientes en proporción.
          for ins in
            select x.insumo_id, coalesce(x.deposito_id, v_dep) as dep, sum(x.cantidad) as cantidad, max(x.costo_unitario) as costo
              from ventas_items_insumos x
             where x.venta_item_id = vi.id and x.descontado
             group by x.insumo_id, coalesce(x.deposito_id, v_dep)
             order by x.insumo_id
          loop
            v_q := round(ins.cantidad * v_cant / vi.cantidad, 4);
            continue when v_q <= 0;
            perform inv_mover(v_emp, ins.insumo_id, ins.dep, v_q, coalesce(ins.costo, 0), 'devolucion_venta', 'nota_credito',
                              v_nc, v_num, 'Devolución ' || v_num || ' · ' || v.numero_control || ' · ' || vi.producto_nombre,
                              s.s_usuario, s.s_nombre);
            perform nc_lotes_devolver(v_emp, ins.insumo_id, ins.dep, vi.id, v.id, v_q, v_nc, v_item, v_num);
          end loop;
        else
          perform inv_mover(v_emp, vi.producto_id, v_dep, v_cant, coalesce(vi.costo_unitario, 0), 'devolucion_venta', 'nota_credito',
                            v_nc, v_num, 'Devolución ' || v_num || ' · ' || v.numero_control, s.s_usuario, s.s_nombre);
          perform nc_lotes_devolver(v_emp, vi.producto_id, v_dep, vi.id, v.id, v_cant, v_nc, v_item, v_num);
        end if;
      end if;
      v_total := v_total + v_monto;
      v_ivat := v_ivat + v_iva;
    end loop;
    if v_orden = 0 then raise exception 'Elegí qué productos se devuelven y cuántos'; end if;
  else
    -- Descuento / bonificación por monto: el IVA se reparte como el de la venta.
    v_total := round(coalesce(nullif(p->>'monto', '')::numeric, 0));
    if v_total <= 0 then raise exception 'Poné el monto del descuento'; end if;
    if v_total > v_restante then
      raise exception 'El descuento (Gs. %) supera lo que queda por acreditar de la venta (Gs. %)',
        replace(to_char(v_total, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_restante, 'FM999,999,999,990'), ',', '.');
    end if;
    select count(*) into v_n from (select distinct coalesce(tipo_iva, 'Exenta') from ventas_items where venta_id = v.id) x;
    for g in
      select coalesce(tipo_iva, 'Exenta') as tipo_iva, sum(total_linea) as monto
        from ventas_items where venta_id = v.id group by 1 order by 2 desc, 1
    loop
      v_i := v_i + 1;
      v_base := case when v_i = v_n then v_total - v_acum
                     else round(v_total * g.monto / nullif(v.total, 0)) end;
      v_acum := v_acum + v_base;
      continue when v_base <= 0;
      v_tasa := case g.tipo_iva when '10%' then 10 when '5%' then 5 else 0 end;
      v_iva := case when v_tasa = 0 then 0 else round(v_base * v_tasa / (100 + v_tasa)) end;
      v_orden := v_orden + 1;
      insert into notas_credito_items (empresa_id, nota_id, orden, producto_nombre, cantidad, precio_unitario, tipo_iva,
                                       subtotal, monto_iva, total_linea)
        values (v_emp, v_nc, v_orden,
                'Descuento / bonificación' || case when v_n > 1 then ' (IVA ' || g.tipo_iva || ')' else '' end,
                1, v_base, g.tipo_iva, v_base - v_iva, v_iva, v_base);
      v_ivat := v_ivat + v_iva;
    end loop;
    if v_orden = 0 then raise exception 'La venta no tiene productos para repartir el descuento'; end if;
  end if;

  if v_total <= 0 then raise exception 'La nota de crédito quedó en cero: elegí qué se devuelve'; end if;
  if v_total > v_restante then
    raise exception 'La nota (Gs. %) supera lo que queda por acreditar de la venta (Gs. %)',
      replace(to_char(v_total, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_restante, 'FM999,999,999,990'), ',', '.');
  end if;

  -- La plata: crédito → primero baja la deuda de la venta (lo más viejo primero).
  v_resto := v_total;
  if v.tipo_venta = 'CREDITO' then
    for cx in select * from cuentas_por_cobrar
               where venta_id = v.id and empresa_id = v_emp and estado in ('pendiente', 'parcial') and saldo > 0
               order by vencimiento, cuota, numero for update loop
      exit when v_resto <= 0;
      v_ap := least(cx.saldo, v_resto);
      update cuentas_por_cobrar
         set monto = monto - v_ap, nc_monto = nc_monto + v_ap,
             estado = estado_cxc(monto - v_ap, cobrado, false), updated_at = now()
       where id = cx.id;
      insert into notas_credito_aplicaciones (empresa_id, nota_id, cxc_id, monto) values (v_emp, v_nc, cx.id, v_ap);
      v_a_cuenta := v_a_cuenta + v_ap;
      v_resto := v_resto - v_ap;
    end loop;
  end if;

  if v_resto > 0 then
    if v_destino = 'saldo_favor' then
      if v.cliente_id is null then
        raise exception 'La venta no tiene cliente: no puede quedar saldo a favor. Devolvé el dinero.';
      end if;
      insert into saldo_favor_movimientos (empresa_id, cliente_id, tipo, monto, observacion, nota_credito_id, venta_id)
        values (v_emp, v.cliente_id, 'nota_credito', v_resto, left('Nota de crédito ' || v_num || ' (' || v.numero_control || ')', 300),
                v_nc, v.id);
    else
      if v_metodo not in ('efectivo', 'transferencia', 'tarjeta_debito', 'tarjeta_credito', 'qr', 'cheque', 'otro') then
        raise exception 'Forma de devolución inválida';
      end if;
      v_caja := caja_abierta_para(null, null, nullif(p->>'caja_id', '')::uuid);
      if v_caja is null then raise exception 'Para devolver el dinero abrí una caja: la devolución sale de ahí'; end if;
      if v_metodo = 'efectivo' and v_resto > caja_efectivo_esperado(v_caja) then
        raise exception 'En % no hay Gs. % en efectivo para devolver', caja_etiqueta(v_caja),
          replace(to_char(v_resto, 'FM999,999,999,990'), ',', '.');
      end if;
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, referencia, categoria,
                                    venta_id, nota_credito_id, usuario_id, observacion, fecha)
        values (v_emp, v_caja, 'egreso', left('Devolución ' || v_num || ' · ' || v.numero_control, 200), v_resto,
                medio_caja(v_metodo), metodo_caja(v_metodo), v_ref, 'devolucion', v.id, v_nc, s.s_usuario, left(v_motivo, 500),
                (now() at time zone 'America/Asuncion')::date);
    end if;
  end if;

  update notas_credito
     set subtotal = v_total - v_ivat, monto_iva = v_ivat, total = v_total, a_cuenta = v_a_cuenta,
         devuelto = case when v_resto > 0 and v_destino = 'devolver' then v_resto else 0 end,
         a_favor = case when v_resto > 0 and v_destino = 'saldo_favor' then v_resto else 0 end,
         metodo_devolucion = case when v_resto > 0 and v_destino = 'devolver' then v_metodo end,
         referencia_devolucion = case when v_resto > 0 and v_destino = 'devolver' then v_ref end,
         caja_id = v_caja
   where id = v_nc;

  return jsonb_build_object('id', v_nc, 'numero', v_num, 'total', v_total, 'a_cuenta', v_a_cuenta,
                            'devuelto', case when v_destino = 'devolver' then v_resto else 0 end,
                            'a_favor', case when v_destino = 'saldo_favor' then v_resto else 0 end,
                            'caja_id', v_caja, 'reusada', false);
end;
$fn$;

-- =============================================================================
-- 7. Anular la nota de crédito
-- =============================================================================
create or replace function :"schema".anular_nota_credito(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  n record;
  m record;
  ap record;
  v_turno record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('notas_credito');
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into n from notas_credito where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Nota de crédito no encontrada'; end if;
  if n.estado = 'anulada' then return jsonb_build_object('id', n.id, 'numero', n.numero, 'reusada', true); end if;

  -- La devolución en plata: solo si su turno sigue abierto (si no, ese arqueo ya se cerró).
  if n.devuelto > 0 and n.caja_id is not null then
    select c.estado, c.numero_caja into v_turno from cajas c where c.id = n.caja_id;
    if v_turno.estado <> 'abierta' then
      raise exception 'La devolución de % salió del turno N° % (%), que ya se cerró: no se puede anular',
        n.numero, v_turno.numero_caja, caja_etiqueta(n.caja_id);
    end if;
  end if;
  -- El saldo a favor: solo si no se usó.
  if n.a_favor > 0 and n.cliente_id is not null and saldo_favor_cliente(n.cliente_id) < n.a_favor then
    raise exception 'El saldo a favor de % ya se usó: anulá primero la venta o el cobro que lo usó', n.numero;
  end if;

  -- Stock: sale de nuevo lo que había vuelto (lotes primero, después el depósito).
  perform lotes_revertir(n.empresa_id, null, n.id, null, 'ENTRADA', array['devolucion_venta'], 'anulacion_devolucion',
                         'Anulación ' || n.numero);
  for m in select mi.producto_id, mi.deposito_id, mi.cantidad, mi.costo_unitario
             from movimientos_inventario mi
            where mi.empresa_id = n.empresa_id and mi.documento_tipo = 'nota_credito' and mi.documento_id = n.id
              and mi.origen = 'devolucion_venta'
            order by mi.producto_id, mi.created_at loop
    perform inv_mover(n.empresa_id, m.producto_id, m.deposito_id, -m.cantidad, m.costo_unitario, 'anulacion_devolucion',
                      'nota_credito', n.id, n.numero, 'Anulación ' || n.numero, s.s_usuario, s.s_nombre);
  end loop;

  -- La deuda vuelve a la venta.
  for ap in select a.cxc_id, a.monto from notas_credito_aplicaciones a where a.nota_id = n.id loop
    update cuentas_por_cobrar
       set monto = monto + ap.monto, nc_monto = greatest(nc_monto - ap.monto, 0),
           estado = estado_cxc(monto + ap.monto, cobrado, estado = 'anulada'), updated_at = now()
     where id = ap.cxc_id;
  end loop;
  update saldo_favor_movimientos set anulado_at = now() where nota_credito_id = n.id and anulado_at is null;
  update caja_movimientos set anulado_at = now(), anulado_por = s.s_usuario, anulado_motivo = left('Nota de crédito anulada: ' || v_motivo, 200)
   where nota_credito_id = n.id and anulado_at is null;

  update notas_credito set estado = 'anulada', anulada_at = now(), anulada_por = s.s_usuario, anulada_por_nombre = s.s_nombre,
         anulada_motivo = left(v_motivo, 500)
   where id = n.id;
  return jsonb_build_object('id', n.id, 'numero', n.numero, 'reusada', false);
end;
$fn$;

-- =============================================================================
-- 8. Listado y detalle
-- =============================================================================
create or replace function :"schema".listar_notas_credito(p_desde date default null, p_hasta date default null, p_q text default null,
                                                          p_estado text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_q text := nullif(lower(btrim(coalesce(p_q, ''))), '');
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  with base as (
    select n.*, v.numero_control as venta_numero,
           coalesce((select coalesce(nullif(btrim(c.razon_social), ''), c.nombre) from clientes c where c.id = n.cliente_id),
                    case when v.receptor_ocasional then 'Cliente ocasional (X)' else 'Consumidor final' end) as cliente_nombre
      from notas_credito n join ventas v on v.id = n.venta_id
     where n.empresa_id = s.s_empresa
       and (alcance_todas() or n.sucursal_id is null or n.sucursal_id = coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)))
       and (p_desde is null or n.fecha >= (p_desde::timestamp at time zone 'America/Asuncion'))
       and (p_hasta is null or n.fecha < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion'))
       and (p_estado is null or n.estado = p_estado)
  ), filtrada as (
    select * from base b
     where v_q is null or lower(b.numero) like '%' || v_q || '%' or lower(b.venta_numero) like '%' || v_q || '%'
        or lower(b.cliente_nombre) like '%' || v_q || '%' or lower(b.motivo) like '%' || v_q || '%'
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'id', f.id, 'numero', f.numero, 'fecha', f.fecha, 'venta_id', f.venta_id, 'venta_numero', f.venta_numero,
              'cliente_nombre', f.cliente_nombre, 'tipo', f.tipo, 'motivo', f.motivo, 'total', f.total,
              'a_cuenta', f.a_cuenta, 'devuelto', f.devuelto, 'a_favor', f.a_favor, 'estado', f.estado,
              'usuario_nombre', f.usuario_nombre) order by f.fecha desc)
        from (select * from filtrada order by fecha desc limit greatest(least(coalesce(p_limit, 50), 200), 1)
              offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb),
    'total', (select count(*) from filtrada),
    'totales', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(total), 0))
                  from filtrada where estado = 'emitida'))
  into r;
  return r;
end;
$fn$;

create or replace function :"schema".nota_credito_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  select jsonb_build_object(
    'nota', to_jsonb(n) - 'idempotency_key' - 'created_by',
    'venta', jsonb_build_object('id', v.id, 'numero_control', v.numero_control, 'fecha', v.fecha, 'total', v.total,
                                'tipo_venta', v.tipo_venta, 'tipo_documento', v.tipo_documento,
                                'receptor_nombre', v.receptor_nombre, 'receptor_ruc', v.receptor_ruc),
    'cliente', (select jsonb_build_object('id', c.id, 'nombre', coalesce(nullif(btrim(c.razon_social), ''), c.nombre),
                                          'documento', c.documento) from clientes c where c.id = n.cliente_id),
    'cliente_nombre', coalesce((select coalesce(nullif(btrim(c.razon_social), ''), c.nombre) from clientes c where c.id = n.cliente_id),
                               case when v.receptor_ocasional then 'Cliente ocasional (X)' else 'Consumidor final' end),
    'caja', case when n.caja_id is null then null else jsonb_build_object(
              'id', n.caja_id, 'etiqueta', caja_etiqueta(n.caja_id),
              'numero_caja', (select numero_caja from cajas where id = n.caja_id),
              'estado', (select estado from cajas where id = n.caja_id)) end,
    'deposito', (select nombre from depositos where id = n.deposito_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
               'id', i.id, 'producto_nombre', i.producto_nombre, 'sku', i.sku, 'cantidad', i.cantidad,
               'precio_unitario', i.precio_unitario, 'tipo_iva', i.tipo_iva, 'monto_iva', i.monto_iva, 'total_linea', i.total_linea,
               'mueve_stock', i.mueve_stock, 'vuelve_stock', i.vuelve_stock) order by i.orden)
        from notas_credito_items i where i.nota_id = n.id), '[]'::jsonb),
    'aplicaciones', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero, 'vencimiento', x.vencimiento, 'monto', a.monto)
                                              order by x.vencimiento)
        from notas_credito_aplicaciones a join cuentas_por_cobrar x on x.id = a.cxc_id where a.nota_id = n.id), '[]'::jsonb),
    'saldo_favor_usado', case when n.a_favor > 0 and n.cliente_id is not null and n.estado = 'emitida'
                              then saldo_favor_cliente(n.cliente_id) < n.a_favor else false end
  ) into r
  from notas_credito n join ventas v on v.id = n.venta_id
  where n.id = p_id and n.empresa_id = s.s_empresa
    and (alcance_todas() or n.sucursal_id is null or n.sucursal_id = coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)));
  if r is null then raise exception 'Nota de crédito no encontrada'; end if;
  return r;
end;
$fn$;

revoke all on function :"schema".nc_lotes_devolver(uuid, uuid, uuid, uuid, uuid, numeric, uuid, uuid, text) from public, anon, authenticated;
grant execute on function :"schema".nc_lotes_devolver(uuid, uuid, uuid, uuid, uuid, numeric, uuid, uuid, text) to service_role;
revoke all on function :"schema".nota_credito_previa(uuid) from public, anon;
revoke all on function :"schema".crear_nota_credito(jsonb) from public, anon;
revoke all on function :"schema".anular_nota_credito(uuid, text) from public, anon;
revoke all on function :"schema".listar_notas_credito(date, date, text, text, integer, integer) from public, anon;
revoke all on function :"schema".nota_credito_detalle(uuid) from public, anon;
grant execute on function
  :"schema".nota_credito_previa(uuid), :"schema".crear_nota_credito(jsonb), :"schema".anular_nota_credito(uuid, text),
  :"schema".listar_notas_credito(date, date, text, text, integer, integer), :"schema".nota_credito_detalle(uuid)
  to authenticated, service_role;

-- =============================================================================
-- 9. Parches sobre la versión vigente (cada patrón tiene que aparecer, o ya estar aplicado)
-- =============================================================================
do $do$
declare
  c record;
  v_def text;
  v_nueva text;
begin
  for c in select * from (values
      -- Capas: la devolución vuelve a las capas que consumió la venta; su anulación saca primero
      -- de las capas propias de la nota.
      ('capas_aplicar', $a$if p_origen in ('anulacion_venta', 'anulacion_traslado',$a$,
                        $b$if p_origen in ('anulacion_venta', 'devolucion_venta', 'anulacion_traslado',$b$),
      ('capas_aplicar', $a$from capas_revertir(p_empresa, p_producto, p_deposito, p_doc_id, p_cantidad,$a$,
                        $b$from capas_revertir(p_empresa, p_producto, p_deposito,
               case when p_origen = 'devolucion_venta' then coalesce(nullif(current_setting('erp.nc_venta', true), '')::uuid, p_doc_id) else p_doc_id end,
               p_cantidad,$b$),
      ('capas_aplicar', $a$case p_origen when 'anulacion_venta' then array['venta']$a$,
                        $b$case p_origen when 'anulacion_venta' then array['venta']
                             when 'devolucion_venta' then array['venta']   -- 99: nota de crédito$b$),
      ('capas_aplicar', $a$case when p_origen in ('anulacion_compra', 'anulacion_ajuste', 'anulacion_perdida', 'anulacion_produccion') then p_doc_id end,$a$,
                        $b$case when p_origen in ('anulacion_compra', 'anulacion_ajuste', 'anulacion_perdida', 'anulacion_produccion', 'anulacion_devolucion') then p_doc_id end,$b$),
      -- Cuotas: lo acreditado por notas de crédito se conserva; no se regeneran.
      ('tg_ventas_cxc', $a$set monto = new.total, cliente_id = new.cliente_id, numero = new.numero_control, cuota = 1, cuotas = 1,
           estado = estado_cxc(new.total, cobrado, false), updated_at = now()$a$,
                        $b$set monto = new.total - nc_monto, cliente_id = new.cliente_id, numero = new.numero_control, cuota = 1, cuotas = 1,
           estado = estado_cxc(new.total - nc_monto, cobrado, false), updated_at = now()$b$),
      ('tg_ventas_cxc', $a$    delete from cuentas_por_cobrar where venta_id = new.id;$a$,
                        $b$    if exists (select 1 from notas_credito n where n.venta_id = new.id and n.estado = 'emitida') then  -- 99
      raise exception 'La venta % tiene notas de crédito: no se pueden cambiar su total ni sus cuotas', new.numero_control;
    end if;
    delete from cuentas_por_cobrar where venta_id = new.id;$b$),
      -- Anular venta: con notas no; factura solo dentro de las 48 h (SIFEN); devuelve el saldo a favor usado.
      ('anular_venta', $a$  if not (alcance_todas() or tiene_permiso('anular_ventas_cerradas')) and v_venta.sucursal_id is not null$a$,
                       $b$  -- 99: con notas de crédito emitidas no se anula; una factura, solo dentro de las 48 h (regla SIFEN).
  if exists (select 1 from notas_credito n where n.venta_id = p_venta_id and n.estado = 'emitida') then
    raise exception 'La venta % tiene notas de crédito: anulalas primero', v_venta.numero_control;
  end if;
  if v_venta.tipo_documento = 'factura' and now() - v_venta.fecha > interval '48 hours' then
    raise exception 'La factura % se emitió hace más de 48 horas: ya no se puede anular. Hacé una nota de crédito.', v_venta.numero_control;
  end if;
  if not (alcance_todas() or tiene_permiso('anular_ventas_cerradas')) and v_venta.sucursal_id is not null$b$),
      ('anular_venta', $a$  update ventas set estado = 'anulada', anulada_at = now(), anulada_por = s.s_usuario$a$,
                       $b$  update saldo_favor_movimientos set anulado_at = now() where venta_id = p_venta_id and tipo = 'uso' and anulado_at is null;  -- 99
  update ventas set estado = 'anulada', anulada_at = now(), anulada_por = s.s_usuario$b$),
      -- Caja: pagar con el saldo a favor del cliente (no entra a la caja).
      ('crear_venta', $a$  v_metodos text[] := '{}';$a$,
                      $b$  v_metodos text[] := '{}';
  v_sf numeric := 0;   -- 99: pagado con saldo a favor$b$),
      ('crear_venta', $a$'pos', 'pos_debito', 'pos_credito', 'qr', 'billetera', 'otro') then$a$,
                      $b$'pos', 'pos_debito', 'pos_credito', 'qr', 'billetera', 'otro', 'saldo_favor') then$b$),
      ('crear_venta', $a$      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, referencia, banco,$a$,
                      $b$      -- 99: el saldo a favor no entra a la caja (esa plata ya entró antes).
      if v_pago_metodo = 'saldo_favor' then
        v_sf := v_sf + v_pago_monto;
        continue;
      end if;
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, referencia, banco,$b$),
      ('crear_venta', $a$    if v_pagos_sum <> tot_total then$a$,
                      $b$    if v_sf > 0 then
      if p_cliente_id is null then raise exception 'Para pagar con saldo a favor elegí el cliente'; end if;
      if v_sf > saldo_favor_cliente(p_cliente_id) then
        raise exception 'El cliente tiene Gs. % a favor, no alcanza',
          replace(to_char(saldo_favor_cliente(p_cliente_id), 'FM999,999,999,990'), ',', '.');
      end if;
      insert into saldo_favor_movimientos (empresa_id, cliente_id, tipo, monto, observacion, venta_id)
        values (v_empresa, p_cliente_id, 'uso', -v_sf, left('Pago de la venta ' || v_numero, 300), v_venta);
    end if;
    if v_pagos_sum <> tot_total then$b$)
    ) x(fn, patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = c.fn;
    if v_def is null then raise exception 'Parche 99: no existe %', c.fn; end if;
    if position(c.nuevo in v_def) > 0 then continue; end if;   -- ya aplicado
    if position(c.patron in v_def) = 0 then raise exception 'Parche 99: % no tiene el patrón esperado (%)', c.fn, left(c.patron, 60); end if;
    v_nueva := replace(v_def, c.patron, c.nuevo);
    execute v_nueva;
  end loop;

  -- Cierre de turno: lo pagado con saldo a favor cuenta en "Ventas del turno" (no en el arqueo:
  -- esa plata no entró a la caja). El primer reemplazo cambia TODAS las lecturas de ventas.
  for c in select * from (values
      ($a$from vivos where origen = 'venta'$a$, $b$from ventas_mov$b$),
      ($a$  ), metodos as ($a$, $b$  ), ventas_mov as (   -- 99: ventas cobradas en este turno (caja + saldo a favor)
    select venta_id, met, monto from vivos where origen = 'venta'
    union all
    select d.venta_id, 'saldo_favor', d.monto from ventas_pagos_detalle d join ventas v on v.id = d.venta_id
     where v.caja_id = p_caja and v.estado <> 'anulada' and d.metodo_pago = 'saldo_favor'
  ), metodos as ($b$)
    ) x(patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'resumen_turno';
    if position(c.nuevo in v_def) > 0 then continue; end if;
    if position(c.patron in v_def) = 0 then raise exception 'Parche 99: resumen_turno no tiene el patrón esperado (%)', left(c.patron, 60); end if;
    execute replace(v_def, c.patron, c.nuevo);
  end loop;

  -- Pérdidas: lo devuelto que no volvió al stock (vino dañado).
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'rep_perdidas_base';
  if position('notas_credito_items' in v_def) = 0 then
    v_nueva := regexp_replace(v_def, '\$function\$\s*$', '');
    v_nueva := regexp_replace(v_nueva, '\s*$', '');
    v_nueva := v_nueva || $x$
  union all
  select (n.fecha at time zone 'America/Asuncion')::date, 'nota_credito', n.id, n.numero, 'devolucion_cliente', n.motivo,
         i.producto_id, i.producto_nombre, i.sku, n.deposito_id, d.sucursal_id,
         i.cantidad, round(i.cantidad * i.costo_unitario)
    from notas_credito n
    join notas_credito_items i on i.nota_id = n.id
    left join depositos d on d.id = n.deposito_id
   where n.empresa_id = p_empresa and n.estado = 'emitida' and i.mueve_stock and not i.vuelve_stock
     and n.fecha >= p_ini and n.fecha < p_fin
     and (p_sucursal is null or coalesce(d.sucursal_id, n.sucursal_id) = p_sucursal)
$function$
$x$;
    execute v_nueva;
  end if;

  -- Permiso nuevo en el catálogo (después de "Anular ventas de turnos cerrados").
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'permisos_catalogo';
  if position('''notas_credito''' in v_def) = 0 then
    v_nueva := regexp_replace(v_def, '(\(''anular_ventas_cerradas'',[^\n]*\n)',
                              E'\\1    (''notas_credito'',              ''Hacer y anular notas de crédito'',               ''Ventas y caja''),\n');
    if v_nueva = v_def then raise exception 'Parche 99: permisos_catalogo no tiene el patrón esperado'; end if;
    execute v_nueva;
  end if;
end;
$do$;

-- Los perfiles que anulan ventas también hacen notas de crédito (se puede quitar en Usuarios › Perfiles).
insert into :"schema".perfil_permisos (perfil_id, empresa_id, permiso)
  select pp.perfil_id, pp.empresa_id, 'notas_credito' from :"schema".perfil_permisos pp
   where pp.permiso = 'anular_ventas'
     and not exists (select 1 from :"schema".perfil_permisos x where x.perfil_id = pp.perfil_id and x.permiso = 'notas_credito');

commit;
