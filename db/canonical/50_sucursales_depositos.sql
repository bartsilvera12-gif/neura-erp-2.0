-- =============================================================================
-- SUCURSALES, DEPÓSITOS, STOCK POR DEPÓSITO Y TRASLADOS — inventario 100% por documentos.
--
-- Modelo:
--   · sucursales        local físico de la empresa (dirección, ciudad, teléfono y el
--                       establecimiento / punto de expedición para la numeración fiscal).
--                       Una es la principal (Casa central).
--   · depositos         dónde está la mercadería. Pertenece a una sucursal; una sucursal
--                       puede tener varios y uno es su principal.
--   · usuarios.sucursal_id  sucursal donde trabaja (su depósito por defecto). ADMIN ve todo.
--   · stock_depositos   FUENTE DE VERDAD del stock (producto × depósito, nunca negativo).
--                       productos.stock_actual = Σ stock_depositos (lo mantiene un trigger;
--                       Caja, reportes y búsquedas lo siguen leyendo igual). En tránsito
--                       (traslado enviado, sin recibir) no está en ningún depósito.
--   · lotes / lotes_movimientos  ganan deposito_id: un lote vive en un depósito (el mismo
--                       número puede estar en dos depósitos después de un traslado).
--   · movimientos_inventario (kardex) gana deposito_id y el documento que lo originó
--                       (documento_tipo / documento_id / documento_numero) y, en traslados,
--                       el depósito de la otra punta (deposito_contraparte_id).
--   · traslados (+ items + lotes)  TR-000001 con su NOTA DE REMISIÓN (001-001-0000001 por
--                       establecimiento/punto de la sucursal de origen) y los datos que pide
--                       SIFEN para la remisión electrónica (motivo, fecha de inicio, puntos de
--                       partida/llegada, vehículo/chapa, chofer/CI, transportista).
--                       Enviar (sale de A) → en tránsito → recibir en B (con diferencias
--                       documentadas) · o anular mientras no se recibió (vuelve a A, a los
--                       mismos lotes).
--   · ajustes_inventario (+ items)  AJ-000001 ajuste documentado (conteo físico, inventario
--                       inicial, corrección, importación) y PE-000001 baja por PÉRDIDA
--                       (vencimiento, rotura, devolución no revendible…) valorizada al costo.
--                       Solo ADMIN aplica; una pérdida cargada por otro rol queda PENDIENTE
--                       hasta que un ADMIN la aprueba (o la rechaza). Se pueden anular.
--
-- NADA SE CARGA A MANO: todo cambio de stock nace de un documento con número (compra,
-- venta, anulación, traslado, ajuste, pérdida, importación). Un trigger en productos
-- rechaza cualquier UPDATE de stock_actual que no venga de stock_depositos, y las tablas
-- de stock (stock_depositos, kardex, lotes, traslados, ajustes) son de SOLO LECTURA para
-- la sesión del usuario: se escriben únicamente por las funciones SECURITY DEFINER de
-- abajo, que validan empresa Y rol adentro (inv_sesion).
--
-- Redefine (misma firma salvo lo indicado): crear_venta (+ p_deposito_id opcional),
-- anular_venta, registrar_compra (p.deposito_id), anular_compra, dar_baja_lote (ahora genera
-- una pérdida PE-), aplicar_importacion_productos (+ p_deposito, p_documento: genera su
-- ajuste AJ- por depósito), lotes_producto, reporte_vencimientos (+ p_deposito),
-- listar_movimientos (+ p_deposito, p_sucursal), productos_pos, verificar_lotes,
-- tg_productos_lotes_activar. Borra registrar_movimiento_stock / registrar_movimiento_lotes
-- (el "Nuevo movimiento" manual) y los triggers de lotes de ventas (crear_venta/anular_venta
-- consumen y devuelven los lotes del depósito explícitamente).
--
-- Migración (sin perder nada): por cada empresa crea "Casa central" (001-001) con su
-- "Depósito principal", pasa TODO el stock actual a ese depósito y le asigna los lotes,
-- sus movimientos, el kardex, las ventas y las compras existentes. Como el kardex anterior
-- no explicaba todo el stock (datos previos al kardex), deja UN documento AJ-
-- "Saldo de apertura" con la diferencia por producto (origen 'apertura', no mueve stock):
-- desde ahí Σ kardex = stock por depósito (verificar_inventario lo controla).
-- Empresas nuevas: un trigger les crea Casa central + Depósito principal.
-- IDEMPOTENTE. Hoy = America/Asuncion.
-- =============================================================================

-- Todo o nada: la migración de stock y el saldo de apertura van en la misma transacción.
begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================

create table if not exists :"schema".sucursales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  direccion text,
  ciudad text,
  telefono text,
  establecimiento text,            -- 3 dígitos (001): numeración fiscal / SIFEN
  punto_expedicion text,           -- 3 dígitos (001)
  es_principal boolean not null default false,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_sucursal_nombre check (btrim(nombre) <> ''),
  constraint chk_sucursal_establecimiento check (establecimiento is null or establecimiento ~ '^[0-9]{3}$'),
  constraint chk_sucursal_punto check (punto_expedicion is null or punto_expedicion ~ '^[0-9]{3}$')
);
create unique index if not exists uq_sucursales_nombre on :"schema".sucursales (empresa_id, lower(btrim(nombre)));
create unique index if not exists uq_sucursales_principal on :"schema".sucursales (empresa_id) where es_principal;
create unique index if not exists uq_sucursales_establecimiento on :"schema".sucursales (empresa_id, establecimiento)
  where establecimiento is not null;

create table if not exists :"schema".depositos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sucursal_id uuid not null references :"schema".sucursales(id) on delete restrict,
  nombre text not null,
  descripcion text,
  es_principal boolean not null default false,  -- principal de SU sucursal
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_deposito_nombre check (btrim(nombre) <> '')
);
create unique index if not exists uq_depositos_nombre on :"schema".depositos (empresa_id, lower(btrim(nombre)));
create unique index if not exists uq_depositos_principal on :"schema".depositos (sucursal_id) where es_principal;
create index if not exists depositos_sucursal_idx on :"schema".depositos (sucursal_id);

alter table :"schema".usuarios add column if not exists sucursal_id uuid references :"schema".sucursales(id) on delete set null;

create table if not exists :"schema".stock_depositos (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id) on delete cascade,
  deposito_id uuid not null references :"schema".depositos(id) on delete restrict,
  cantidad numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (producto_id, deposito_id),
  constraint chk_stock_deposito_no_negativo check (cantidad >= 0)
);
-- cantidad NO va en índices "de búsqueda": cada venta actualiza la fila con HOT update.
create index if not exists stock_depositos_deposito_idx on :"schema".stock_depositos (deposito_id, producto_id);
create index if not exists stock_depositos_empresa_idx on :"schema".stock_depositos (empresa_id);

-- Lotes por depósito.
alter table :"schema".lotes add column if not exists deposito_id uuid references :"schema".depositos(id) on delete restrict;
alter table :"schema".lotes_movimientos add column if not exists deposito_id uuid references :"schema".depositos(id) on delete restrict;
alter table :"schema".lotes_movimientos add column if not exists documento_tipo text;
alter table :"schema".lotes_movimientos add column if not exists documento_id uuid;
alter table :"schema".lotes_movimientos add column if not exists documento_item_id uuid;
alter table :"schema".lotes drop constraint if exists chk_lotes_origen;
alter table :"schema".lotes add constraint chk_lotes_origen
  check (origen in ('compra', 'ajuste_manual', 'traslado', 'ajuste', 'inventario_inicial'));
alter table :"schema".lotes_movimientos drop constraint if exists chk_lotes_mov_origen;
alter table :"schema".lotes_movimientos add constraint chk_lotes_mov_origen check (origen in (
  'compra', 'anulacion_compra', 'venta', 'anulacion_venta', 'ajuste_manual', 'baja_lote', 'sin_lote_inicial',
  'traslado_salida', 'traslado_entrada', 'anulacion_traslado', 'ajuste', 'inventario_inicial', 'perdida',
  'anulacion_ajuste', 'anulacion_perdida'));

-- Kardex por depósito y por documento.
alter table :"schema".movimientos_inventario add column if not exists deposito_id uuid references :"schema".depositos(id) on delete restrict;
alter table :"schema".movimientos_inventario add column if not exists documento_tipo text;
alter table :"schema".movimientos_inventario add column if not exists documento_id uuid;
alter table :"schema".movimientos_inventario add column if not exists documento_numero text;
alter table :"schema".movimientos_inventario add column if not exists deposito_contraparte_id uuid references :"schema".depositos(id) on delete set null;
alter table :"schema".movimientos_inventario drop constraint if exists movinv_origen_check;
alter table :"schema".movimientos_inventario add constraint movinv_origen_check check (origen in (
  'inventario_inicial', 'ajuste_manual', 'venta', 'anulacion_venta', 'compra', 'anulacion_compra',
  'traslado_salida', 'traslado_entrada', 'anulacion_traslado', 'ajuste', 'perdida',
  'anulacion_ajuste', 'anulacion_perdida', 'apertura'));
alter table :"schema".movimientos_inventario drop constraint if exists movinv_documento_tipo_check;
alter table :"schema".movimientos_inventario add constraint movinv_documento_tipo_check
  check (documento_tipo is null or documento_tipo in ('compra', 'venta', 'traslado', 'ajuste', 'perdida'));

-- De qué depósito salió la venta / a cuál entró la compra.
alter table :"schema".ventas add column if not exists deposito_id uuid references :"schema".depositos(id);
alter table :"schema".compras add column if not exists deposito_id uuid references :"schema".depositos(id);

-- ── Traslados ────────────────────────────────────────────────────────────────
create table if not exists :"schema".traslados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,                       -- TR-000001
  remision_numero text not null,              -- 001-001-0000001 (establecimiento-punto de la sucursal de origen)
  deposito_origen_id uuid not null references :"schema".depositos(id),
  deposito_destino_id uuid not null references :"schema".depositos(id),
  estado text not null default 'en_transito',
  -- Datos de la nota de remisión (SIFEN): motivo (1 venta, 2 consignación, 3 exportación,
  -- 4 compra, 5 importación, 6 devolución, 7 entre locales de la empresa, 8 transformación,
  -- 9 reparación, 10 emisor móvil, 11 exhibición, 12 ferias, 13 encomienda, 14 decomiso, 99 otro).
  motivo_codigo smallint not null default 7,
  motivo_descripcion text,
  fecha_inicio date not null,
  fecha_fin_estimada date,
  punto_partida text,
  ciudad_partida text,
  punto_llegada text,
  ciudad_llegada text,
  vehiculo_marca text,
  vehiculo_chapa text,
  chofer_nombre text,
  chofer_documento text,
  transportista_nombre text,
  transportista_ruc text,
  observacion text,
  total_items integer not null default 0,
  total_unidades numeric not null default 0,
  valor_costo numeric not null default 0,
  diferencia_unidades numeric not null default 0,
  diferencia_valor numeric not null default 0,
  diferencia_motivo text,
  created_by uuid,                            -- usuarios.id
  usuario_nombre text,
  created_at timestamptz not null default now(),
  recibido_por uuid,
  recibido_por_nombre text,
  recibido_at timestamptz,
  recepcion_observacion text,
  anulado_por uuid,
  anulado_por_nombre text,
  anulado_at timestamptz,
  anulado_motivo text,
  idempotency_key uuid,
  constraint chk_traslado_estado check (estado in ('en_transito', 'recibido', 'recibido_con_diferencias', 'anulado')),
  constraint chk_traslado_depositos check (deposito_origen_id <> deposito_destino_id),
  constraint chk_traslado_motivo check (motivo_codigo in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 99))
);
create unique index if not exists uq_traslados_numero on :"schema".traslados (empresa_id, numero);
create unique index if not exists uq_traslados_remision on :"schema".traslados (empresa_id, remision_numero);
create unique index if not exists uq_traslados_idem on :"schema".traslados (empresa_id, idempotency_key) where idempotency_key is not null;
create index if not exists traslados_lista_idx on :"schema".traslados (empresa_id, created_at desc, id desc);
create index if not exists traslados_transito_idx on :"schema".traslados (empresa_id) where estado = 'en_transito';

create table if not exists :"schema".traslados_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  traslado_id uuid not null references :"schema".traslados(id) on delete cascade,
  orden integer not null,
  producto_id uuid not null references :"schema".productos(id) on delete restrict,
  producto_nombre text not null,
  producto_sku text,
  unidad_medida text,
  controla_lotes boolean not null default false,
  cantidad numeric not null,                  -- enviada
  cantidad_recibida numeric,                  -- null hasta recibir
  costo_unitario numeric not null default 0,
  constraint chk_traslado_item_cantidad check (cantidad > 0),
  constraint chk_traslado_item_recibida check (cantidad_recibida is null or (cantidad_recibida >= 0 and cantidad_recibida <= cantidad))
);
create index if not exists traslados_items_traslado_idx on :"schema".traslados_items (traslado_id, orden);
create index if not exists traslados_items_producto_idx on :"schema".traslados_items (producto_id);

create table if not exists :"schema".traslados_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  traslado_id uuid not null references :"schema".traslados(id) on delete cascade,
  item_id uuid not null references :"schema".traslados_items(id) on delete cascade,
  lote_origen_id uuid references :"schema".lotes(id),   -- null = unidades sin lote
  lote_numero text,
  vencimiento date,
  costo_unitario numeric not null default 0,
  cantidad numeric not null,
  cantidad_recibida numeric,
  lote_destino_id uuid references :"schema".lotes(id),
  constraint chk_traslado_lote_cantidad check (cantidad > 0),
  constraint chk_traslado_lote_recibida check (cantidad_recibida is null or (cantidad_recibida >= 0 and cantidad_recibida <= cantidad))
);
create index if not exists traslados_lotes_item_idx on :"schema".traslados_lotes (item_id);

-- ── Ajustes y pérdidas ───────────────────────────────────────────────────────
create table if not exists :"schema".ajustes_inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  tipo text not null,                          -- ajuste (AJ-) | perdida (PE-)
  numero text not null,
  deposito_id uuid not null references :"schema".depositos(id),
  motivo text not null,
  detalle text,
  estado text not null default 'pendiente',
  total_entrada numeric not null default 0,    -- unidades
  total_salida numeric not null default 0,
  valor_entrada numeric not null default 0,    -- Gs. al costo
  valor_salida numeric not null default 0,
  created_by uuid,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  aplicado_por uuid,
  aplicado_por_nombre text,
  aplicado_at timestamptz,
  rechazado_por_nombre text,
  rechazado_at timestamptz,
  rechazado_motivo text,
  anulado_por uuid,
  anulado_por_nombre text,
  anulado_at timestamptz,
  anulado_motivo text,
  idempotency_key uuid,
  constraint chk_ajuste_tipo check (tipo in ('ajuste', 'perdida')),
  constraint chk_ajuste_estado check (estado in ('pendiente', 'aplicado', 'rechazado', 'anulado')),
  constraint chk_ajuste_motivo check (
    (tipo = 'ajuste' and motivo in ('conteo_fisico', 'inventario_inicial', 'correccion', 'importacion', 'apertura', 'otro'))
    or (tipo = 'perdida' and motivo in ('vencimiento', 'rotura', 'devolucion_cliente', 'devolucion_proveedor', 'faltante', 'consumo_interno', 'otro')))
);
create unique index if not exists uq_ajustes_numero on :"schema".ajustes_inventario (empresa_id, numero);
create unique index if not exists uq_ajustes_idem on :"schema".ajustes_inventario (empresa_id, idempotency_key) where idempotency_key is not null;
create index if not exists ajustes_lista_idx on :"schema".ajustes_inventario (empresa_id, created_at desc, id desc);
create index if not exists ajustes_pendientes_idx on :"schema".ajustes_inventario (empresa_id) where estado = 'pendiente';

create table if not exists :"schema".ajustes_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  ajuste_id uuid not null references :"schema".ajustes_inventario(id) on delete cascade,
  orden integer not null,
  producto_id uuid not null references :"schema".productos(id) on delete restrict,
  producto_nombre text not null,
  producto_sku text,
  unidad_medida text,
  modo text not null default 'diferencia',     -- conteo (se cargó el stock real) | diferencia (+/−)
  cantidad_contada numeric,                    -- modo conteo
  cantidad_sistema numeric,                    -- stock del depósito al aplicar
  diferencia numeric not null default 0,       -- lo que se movió (+ entra, − sale); definitivo al aplicar
  costo_unitario numeric not null default 0,
  valor numeric not null default 0,            -- diferencia valorizada al costo (signo de la diferencia)
  lote_id uuid references :"schema".lotes(id), -- salida de un lote puntual / lote al que entró
  lote_numero text,                            -- entrada con lote
  vencimiento date,
  lotes jsonb,                                 -- qué lotes se consumieron (FEFO) al aplicar
  nota text,
  constraint chk_ajuste_item_modo check (modo in ('conteo', 'diferencia')),
  constraint chk_ajuste_item_contada check (cantidad_contada is null or cantidad_contada >= 0)
);
create index if not exists ajustes_items_ajuste_idx on :"schema".ajustes_items (ajuste_id, orden);
create index if not exists ajustes_items_producto_idx on :"schema".ajustes_items (producto_id);

-- =============================================================================
-- 2. Migración: Casa central + Depósito principal y TODO el stock a ese depósito.
--    (erp.inv_migracion = '1' apaga el trigger que suma al total: el stock ya está ahí).
-- =============================================================================
do $mig$
declare
  e record;
  v_suc uuid;
  v_dep uuid;
  v_neg text;
  v_nuevas text[] := '{}';
begin
  perform set_config('erp.inv_migracion', '1', true);
  for e in select id from empresas loop
    if not exists (select 1 from sucursales s where s.empresa_id = e.id) then
      v_nuevas := v_nuevas || e.id::text;
      insert into sucursales (empresa_id, nombre, establecimiento, punto_expedicion, es_principal)
        values (e.id, 'Casa central', '001', '001', true) returning id into v_suc;
      insert into depositos (empresa_id, sucursal_id, nombre, es_principal)
        values (e.id, v_suc, 'Depósito principal', true);
    end if;
    select d.id into v_dep
      from depositos d join sucursales s on s.id = d.sucursal_id
     where d.empresa_id = e.id
     order by s.es_principal desc, d.es_principal desc, d.created_at, d.id limit 1;

    -- Solo la primera vez: productos que todavía no tienen filas por depósito.
    select string_agg(p.nombre || ' (' || p.stock_actual || ')', ', ') into v_neg
      from productos p
     where p.empresa_id = e.id and p.stock_actual < 0
       and not exists (select 1 from stock_depositos sd where sd.producto_id = p.id);
    if v_neg is not null then
      raise exception 'Hay productos con stock negativo: %. Corregilos antes de pasar a depósitos', v_neg;
    end if;
    insert into stock_depositos (empresa_id, producto_id, deposito_id, cantidad)
      select p.empresa_id, p.id, v_dep, p.stock_actual
        from productos p
       where p.empresa_id = e.id and p.stock_actual <> 0
         and not exists (select 1 from stock_depositos sd where sd.producto_id = p.id);

    update lotes set deposito_id = v_dep where empresa_id = e.id and deposito_id is null;
    update lotes_movimientos set deposito_id = v_dep where empresa_id = e.id and deposito_id is null;
    update movimientos_inventario set deposito_id = v_dep where empresa_id = e.id and deposito_id is null;
    update compras set deposito_id = v_dep where empresa_id = e.id and deposito_id is null;
    update ventas v set deposito_id = v_dep
     where v.empresa_id = e.id and v.deposito_id is null
       and exists (select 1 from ventas_items vi where vi.venta_id = v.id and vi.producto_id is not null);

    -- Documento del kardex anterior (para verlo con su número): ventas y compras.
    update movimientos_inventario m set documento_tipo = 'venta', documento_id = v.id, documento_numero = v.numero_control
      from ventas v
     where m.empresa_id = e.id and m.documento_tipo is null and m.origen in ('venta', 'anulacion_venta')
       and v.empresa_id = e.id and v.numero_control = substring(m.referencia from '(VTA-[0-9]+)');
    update movimientos_inventario m set documento_tipo = 'compra', documento_id = c.id, documento_numero = c.numero_control
      from compras c
     where m.empresa_id = e.id and m.documento_tipo is null and m.origen in ('compra', 'anulacion_compra')
       and m.compra_id = c.id;
  end loop;
  perform set_config('erp.inv_migracion', '', true);
  -- Empresas que se migran en ESTA corrida: solo ellas reciben el saldo de apertura (sección 14).
  perform set_config('erp.inv_apertura', array_to_string(v_nuevas, ','), true);
end
$mig$;

alter table :"schema".lotes alter column deposito_id set not null;
alter table :"schema".lotes_movimientos alter column deposito_id set not null;
alter table :"schema".movimientos_inventario alter column deposito_id set not null;

-- Un lote = producto + depósito + número + vencimiento.
drop index if exists :"schema".uq_lotes_producto_numero;
create unique index if not exists uq_lotes_deposito_numero on :"schema".lotes (empresa_id, producto_id, deposito_id, numero, vencimiento);
drop index if exists :"schema".lotes_fefo_idx;
create index if not exists lotes_fefo_dep_idx on :"schema".lotes (producto_id, deposito_id, vencimiento, created_at) where cantidad > 0;
create index if not exists lotes_mov_doc_idx on :"schema".lotes_movimientos (documento_id) where documento_id is not null;
create index if not exists movinv_deposito_idx on :"schema".movimientos_inventario (empresa_id, deposito_id, fecha desc, id desc);
create index if not exists movinv_documento_idx on :"schema".movimientos_inventario (documento_id) where documento_id is not null;
create index if not exists movinv_producto_dep_idx on :"schema".movimientos_inventario (producto_id, deposito_id, fecha desc, id desc);

-- =============================================================================
-- 3. Total por producto y "nada a mano"
-- =============================================================================

-- stock_depositos → productos.stock_actual (delta). erp.stock_sync deja pasar el UPDATE.
create or replace function :"schema".tg_stock_depositos_total()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_delta numeric;
begin
  if coalesce(current_setting('erp.inv_migracion', true), '') = '1' then return null; end if;
  v_delta := (case when tg_op <> 'DELETE' then new.cantidad else 0 end)
           - (case when tg_op <> 'INSERT' then old.cantidad else 0 end);
  if v_delta = 0 then return null; end if;
  perform set_config('erp.stock_sync', '1', true);
  update productos set stock_actual = stock_actual + v_delta, updated_at = now()
   where id = case when tg_op = 'DELETE' then old.producto_id else new.producto_id end;
  perform set_config('erp.stock_sync', '', true);
  return null;
end;
$fn$;
drop trigger if exists trg_stock_depositos_total on :"schema".stock_depositos;
create trigger trg_stock_depositos_total
  after insert or update of cantidad or delete on :"schema".stock_depositos
  for each row execute function :"schema".tg_stock_depositos_total();

-- productos.stock_actual solo cambia desde stock_depositos (documentos).
create or replace function :"schema".tg_productos_stock_guard()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
begin
  if coalesce(current_setting('erp.stock_sync', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.stock_actual, 0) <> 0 then
      raise exception 'El stock no se carga a mano: creá el producto y cargá su stock inicial con un ajuste de inventario';
    end if;
  elsif new.stock_actual is distinct from old.stock_actual then
    raise exception 'El stock no se edita a mano: se mueve con compras, ventas, traslados, ajustes o pérdidas';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_productos_stock_guard on :"schema".productos;
create trigger trg_productos_stock_guard
  before insert or update of stock_actual on :"schema".productos
  for each row execute function :"schema".tg_productos_stock_guard();

-- Empresa nueva: nace con Casa central + Depósito principal.
create or replace function :"schema".tg_empresas_sucursal_inicial()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_suc uuid;
begin
  insert into sucursales (empresa_id, nombre, establecimiento, punto_expedicion, es_principal)
    values (new.id, 'Casa central', '001', '001', true) returning id into v_suc;
  insert into depositos (empresa_id, sucursal_id, nombre, es_principal) values (new.id, v_suc, 'Depósito principal', true);
  return null;
end;
$fn$;
drop trigger if exists trg_empresas_sucursal_inicial on :"schema".empresas;
create trigger trg_empresas_sucursal_inicial after insert on :"schema".empresas
  for each row execute function :"schema".tg_empresas_sucursal_inicial();

-- =============================================================================
-- 4. Primitivas internas (NO se exponen a la sesión del usuario)
-- =============================================================================

-- Sesión: empresa, usuario, rol y sucursal. Con p_roles exige uno de esos roles.
create or replace function :"schema".inv_sesion(
  p_roles text[] default null,
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_rol text, out s_sucursal uuid)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
begin
  select u.empresa_id, u.id, u.nombre, upper(u.rol), u.sucursal_id
    into s_empresa, s_usuario, s_nombre, s_rol, s_sucursal
    from usuarios u where u.auth_user_id = auth.uid() and u.activo limit 1;
  if s_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if p_roles is not null and not (s_rol = any (p_roles)) then
    raise exception 'Sin permiso para esta operación' using errcode = '42501';
  end if;
end;
$fn$;

-- Siguiente número de un documento (secuencia por empresa, con piso = el mayor ya usado).
create or replace function :"schema".inv_numero(p_empresa uuid, p_clave text, p_piso bigint)
returns bigint language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v bigint;
begin
  insert into secuencias_producto (empresa_id, clave, valor)
    values (p_empresa, p_clave, greatest(coalesce(p_piso, 0), 0) + 1)
  on conflict (empresa_id, clave) do update set valor = greatest(secuencias_producto.valor, coalesce(p_piso, 0)) + 1
  returning valor into v;
  return v;
end;
$fn$;

-- Depósito válido de la empresa (con su sucursal). p_activo: exige que esté activo.
create or replace function :"schema".inv_deposito(
  p_empresa uuid, p_deposito uuid, p_activo boolean default true,
  out dep_id uuid, out dep_nombre text, out suc_id uuid, out suc_nombre text, out suc_direccion text,
  out suc_ciudad text, out suc_establecimiento text, out suc_punto text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_activo boolean;
begin
  if p_deposito is null then raise exception 'Elegí el depósito'; end if;
  select d.id, d.nombre, s.id, s.nombre, s.direccion, s.ciudad, s.establecimiento, s.punto_expedicion, d.activo and s.activa
    into dep_id, dep_nombre, suc_id, suc_nombre, suc_direccion, suc_ciudad, suc_establecimiento, suc_punto, v_activo
    from depositos d join sucursales s on s.id = d.sucursal_id
   where d.id = p_deposito and d.empresa_id = p_empresa;
  if dep_id is null then raise exception 'Depósito no encontrado'; end if;
  if p_activo and not v_activo then raise exception 'El depósito "%" está inactivo', dep_nombre; end if;
end;
$fn$;

-- Depósito por defecto: el principal de la sucursal del usuario; si no tiene, el
-- principal de la Casa central; si no, cualquier activo.
create or replace function :"schema".deposito_por_defecto(p_empresa uuid, p_sucursal uuid)
returns uuid language sql stable security definer set search_path = :"schema", public as $$
  select d.id
    from depositos d join sucursales s on s.id = d.sucursal_id
   where d.empresa_id = p_empresa and d.activo and s.activa
   order by case when d.sucursal_id = p_sucursal and d.es_principal then 0
                 when d.sucursal_id = p_sucursal then 1
                 when s.es_principal and d.es_principal then 2
                 when d.es_principal then 3 else 4 end,
            d.created_at, d.id
   limit 1
$$;

-- EL movimiento de stock: suma/resta en el depósito (nunca negativo) + fila del kardex.
-- Devuelve el saldo del depósito. p_extra: contraparte, proveedor, numero_factura,
-- proveedor_id, compra_id.
create or replace function :"schema".inv_mover(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_delta numeric, p_costo numeric,
  p_origen text, p_doc_tipo text, p_doc_id uuid, p_doc_numero text, p_referencia text,
  p_usuario uuid, p_usuario_nombre text, p_extra jsonb default '{}'::jsonb
) returns numeric
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  prod record;
  v_actual numeric;
  v_nuevo numeric;
  v_dep text;
begin
  if p_delta is null or p_delta = 0 then return null; end if;
  select p.id, p.nombre, p.sku into prod from productos p where p.id = p_producto and p.empresa_id = p_empresa;
  if not found then raise exception 'Producto no encontrado'; end if;
  insert into stock_depositos (empresa_id, producto_id, deposito_id, cantidad)
    values (p_empresa, p_producto, p_deposito, 0)
  on conflict (producto_id, deposito_id) do nothing;
  select sd.cantidad into v_actual from stock_depositos sd
   where sd.producto_id = p_producto and sd.deposito_id = p_deposito for update;
  v_nuevo := v_actual + p_delta;
  if v_nuevo < 0 then
    select d.nombre into v_dep from depositos d where d.id = p_deposito;
    raise exception 'Stock insuficiente de "%" en %: hay %, se necesitan %',
      prod.nombre, coalesce(v_dep, 'el depósito'), trim_scale(v_actual), trim_scale(abs(p_delta));
  end if;
  update stock_depositos set cantidad = v_nuevo, updated_at = now()
   where producto_id = p_producto and deposito_id = p_deposito;
  insert into movimientos_inventario (
    empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia,
    created_by, usuario_nombre, deposito_id, documento_tipo, documento_id, documento_numero, deposito_contraparte_id,
    proveedor, numero_factura, proveedor_id, compra_id)
  values (
    p_empresa, p_producto, prod.nombre, prod.sku, case when p_delta > 0 then 'ENTRADA' else 'SALIDA' end, abs(p_delta),
    coalesce(p_costo, 0), p_origen, left(p_referencia, 200), p_usuario, p_usuario_nombre, p_deposito, p_doc_tipo,
    p_doc_id, p_doc_numero, nullif(p_extra->>'contraparte', '')::uuid,
    nullif(left(btrim(coalesce(p_extra->>'proveedor', '')), 120), ''), nullif(left(btrim(coalesce(p_extra->>'numero_factura', '')), 60), ''),
    nullif(p_extra->>'proveedor_id', '')::uuid, nullif(p_extra->>'compra_id', '')::uuid);
  return v_nuevo;
end;
$fn$;

-- Entrada a un lote del depósito (lo crea o le suma). Devuelve el id del lote.
drop function if exists :"schema".lote_entrada(uuid, text, date, numeric, numeric, text, uuid, text);
create or replace function :"schema".lote_entrada(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_numero text, p_vencimiento date, p_cantidad numeric,
  p_costo numeric, p_origen text, p_compra uuid, p_motivo text,
  p_doc_tipo text default null, p_doc_id uuid default null, p_doc_item uuid default null
) returns uuid
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_numero text := upper(btrim(coalesce(nullif(btrim(p_numero), ''), lote_numero_auto())));
  v_id uuid;
begin
  if p_vencimiento is null then raise exception 'Falta el vencimiento del lote'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad inválida para el lote'; end if;
  if length(v_numero) > 40 then raise exception 'El número de lote es muy largo (máximo 40)'; end if;
  insert into lotes (empresa_id, producto_id, deposito_id, numero, vencimiento, cantidad, cantidad_inicial, costo_unitario, origen, compra_id)
    values (p_empresa, p_producto, p_deposito, v_numero, p_vencimiento, p_cantidad, p_cantidad, coalesce(p_costo, 0),
            case when p_origen = 'compra' then 'compra'
                 when p_origen in ('traslado_entrada', 'anulacion_traslado') then 'traslado'
                 when p_origen = 'inventario_inicial' then 'inventario_inicial'
                 else 'ajuste' end,
            p_compra)
  on conflict (empresa_id, producto_id, deposito_id, numero, vencimiento) do update
    set cantidad = lotes.cantidad + excluded.cantidad,
        cantidad_inicial = lotes.cantidad_inicial + excluded.cantidad
  returning id into v_id;
  insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, compra_id, motivo,
                                 documento_tipo, documento_id, documento_item_id)
    values (p_empresa, p_producto, v_id, p_deposito, 'ENTRADA', p_cantidad, p_origen, p_compra, left(p_motivo, 300),
            p_doc_tipo, p_doc_id, p_doc_item);
  return v_id;
end;
$fn$;

-- Unidades "sin lote" de un producto con lotes en un depósito (entrada o salida).
create or replace function :"schema".lote_sin_lote(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_tipo text, p_cantidad numeric, p_origen text, p_motivo text,
  p_doc_tipo text default null, p_doc_id uuid default null, p_doc_item uuid default null
) returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if p_cantidad is null or p_cantidad <= 0 then return; end if;
  insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, motivo,
                                 documento_tipo, documento_id, documento_item_id)
    values (p_empresa, p_producto, null, p_deposito, p_tipo, p_cantidad, p_origen, left(p_motivo, 300),
            p_doc_tipo, p_doc_id, p_doc_item);
end;
$fn$;

-- Salida de lotes de UN depósito. p_lote: de ese lote puntual (tiene que alcanzar). Si no,
-- FEFO (vence primero sale primero; a igual vencimiento el más viejo); los vencidos se
-- saltean salvo p_incluir_vencidos. Lo que los lotes no cubren sale "sin lote".
-- Devuelve [{lote_id, numero, vencimiento, cantidad, costo}] (lote_id null = sin lote).
drop function if exists :"schema".lotes_consumir(uuid, numeric, text, uuid, uuid, text);
create or replace function :"schema".lotes_consumir(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_cantidad numeric, p_origen text,
  p_venta uuid, p_venta_item uuid, p_motivo text,
  p_doc_tipo text default null, p_doc_id uuid default null, p_doc_item uuid default null,
  p_lote uuid default null, p_incluir_vencidos boolean default false
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_resta numeric := p_cantidad;
  v_toma numeric;
  l record;
  v_out jsonb := '[]'::jsonb;
begin
  if p_cantidad is null or p_cantidad <= 0 then return v_out; end if;
  if p_lote is not null then
    select x.id, x.numero, x.vencimiento, x.cantidad, x.costo_unitario, x.deposito_id into l
      from lotes x where x.id = p_lote and x.empresa_id = p_empresa and x.producto_id = p_producto for update;
    if not found then raise exception 'El lote elegido no es de este producto'; end if;
    if l.deposito_id <> p_deposito then raise exception 'El lote % no está en ese depósito', l.numero; end if;
    if l.cantidad < p_cantidad then
      raise exception 'Del lote % quedan %: no alcanza para %', l.numero, trim_scale(l.cantidad), trim_scale(p_cantidad);
    end if;
    update lotes set cantidad = cantidad - p_cantidad where id = l.id;
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, venta_id, venta_item_id,
                                   motivo, documento_tipo, documento_id, documento_item_id)
      values (p_empresa, p_producto, l.id, p_deposito, 'SALIDA', p_cantidad, p_origen, p_venta, p_venta_item,
              left(p_motivo, 300), p_doc_tipo, p_doc_id, p_doc_item);
    return jsonb_build_array(jsonb_build_object('lote_id', l.id, 'numero', l.numero, 'vencimiento', l.vencimiento,
                                                'cantidad', p_cantidad, 'costo', l.costo_unitario));
  end if;

  for l in
    select x.id, x.numero, x.vencimiento, x.cantidad, x.costo_unitario from lotes x
     where x.producto_id = p_producto and x.deposito_id = p_deposito and x.empresa_id = p_empresa and x.cantidad > 0
       and (p_incluir_vencidos or x.vencimiento >= v_hoy)
     order by x.vencimiento, x.created_at, x.id
     for update
  loop
    exit when v_resta <= 0;
    v_toma := least(l.cantidad, v_resta);
    update lotes set cantidad = cantidad - v_toma where id = l.id;
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, venta_id, venta_item_id,
                                   motivo, documento_tipo, documento_id, documento_item_id)
      values (p_empresa, p_producto, l.id, p_deposito, 'SALIDA', v_toma, p_origen, p_venta, p_venta_item,
              left(p_motivo, 300), p_doc_tipo, p_doc_id, p_doc_item);
    v_out := v_out || jsonb_build_object('lote_id', l.id, 'numero', l.numero, 'vencimiento', l.vencimiento,
                                         'cantidad', v_toma, 'costo', l.costo_unitario);
    v_resta := v_resta - v_toma;
  end loop;
  if v_resta > 0 then
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, venta_id, venta_item_id,
                                   motivo, documento_tipo, documento_id, documento_item_id)
      values (p_empresa, p_producto, null, p_deposito, 'SALIDA', v_resta, p_origen, p_venta, p_venta_item,
              left(coalesce(p_motivo || ' · ', '') || 'Sin lote vigente que lo cubra', 300), p_doc_tipo, p_doc_id, p_doc_item);
    v_out := v_out || jsonb_build_object('lote_id', null, 'numero', null, 'vencimiento', null, 'cantidad', v_resta, 'costo', null);
  end if;
  return v_out;
end;
$fn$;

-- Revierte movimientos de lotes de un documento (anulaciones): cada SALIDA vuelve a SU
-- lote (o al saldo sin lote) y cada ENTRADA sale de su lote (si ya no alcanza, error).
-- Filtro: p_venta, o p_doc_id (+ p_doc_item). Marca los originales como revertidos.
create or replace function :"schema".lotes_revertir(
  p_empresa uuid, p_venta uuid, p_doc_id uuid, p_doc_item uuid, p_tipo text, p_origenes text[],
  p_origen_nuevo text, p_motivo text
) returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_cant numeric;
  v_num text;
begin
  if p_venta is null and p_doc_id is null then raise exception 'lotes_revertir: falta el documento'; end if;
  for r in
    select lm.* from lotes_movimientos lm
     where lm.empresa_id = p_empresa and lm.tipo = p_tipo and not lm.revertido and lm.origen = any (p_origenes)
       and (p_venta is null or lm.venta_id = p_venta)
       and (p_doc_id is null or lm.documento_id = p_doc_id)
       and (p_doc_item is null or lm.documento_item_id = p_doc_item)
     order by lm.created_at, lm.id
     for update of lm
  loop
    if r.lote_id is not null then
      if p_tipo = 'SALIDA' then
        update lotes set cantidad = cantidad + r.cantidad where id = r.lote_id;
      else
        select cantidad, numero into v_cant, v_num from lotes where id = r.lote_id for update;
        if v_cant < r.cantidad then
          raise exception 'Del lote % quedan % y hay que sacar %: ya se vendió o se movió parte', v_num, trim_scale(v_cant), trim_scale(r.cantidad);
        end if;
        update lotes set cantidad = cantidad - r.cantidad where id = r.lote_id;
      end if;
    end if;
    insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, venta_id, venta_item_id,
                                   compra_id, motivo, documento_tipo, documento_id, documento_item_id)
      values (r.empresa_id, r.producto_id, r.lote_id, r.deposito_id, case when p_tipo = 'SALIDA' then 'ENTRADA' else 'SALIDA' end,
              r.cantidad, p_origen_nuevo, r.venta_id, r.venta_item_id, r.compra_id, left(p_motivo, 300),
              r.documento_tipo, r.documento_id, r.documento_item_id);
    update lotes_movimientos set revertido = true where id = r.id;
  end loop;
end;
$fn$;

-- =============================================================================
-- 5. Sucursales y depósitos (configuración, ADMIN)
-- =============================================================================

-- guardar_sucursal(p): { id?, nombre, direccion?, ciudad?, telefono?, establecimiento?,
--   punto_expedicion?, es_principal?, activa?, deposito_nombre? (alta: nombre del depósito
--   principal que se crea con la sucursal) } → { id }
create or replace function :"schema".guardar_sucursal(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_est text := nullif(btrim(coalesce(p->>'establecimiento', '')), '');
  v_pto text := nullif(btrim(coalesce(p->>'punto_expedicion', '')), '');
  v_principal boolean := coalesce((p->>'es_principal')::boolean, false);
  v_activa boolean := coalesce((p->>'activa')::boolean, true);
  v_dep_nombre text := nullif(btrim(coalesce(p->>'deposito_nombre', '')), '');
  prev record;
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_nombre is null then raise exception 'Escribí el nombre de la sucursal'; end if;
  if v_est is not null and v_est !~ '^[0-9]{3}$' then raise exception 'El establecimiento son 3 dígitos (ej. 001)'; end if;
  if v_pto is not null and v_pto !~ '^[0-9]{3}$' then raise exception 'El punto de expedición son 3 dígitos (ej. 001)'; end if;

  if v_id is not null then
    select * into prev from sucursales where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Sucursal no encontrada'; end if;
    if prev.es_principal and not v_principal then
      raise exception 'Siempre tiene que haber una sucursal principal: marcá otra como principal';
    end if;
    if prev.activa and not v_activa then
      if prev.es_principal then raise exception 'La sucursal principal no se puede desactivar'; end if;
      if exists (select 1 from stock_depositos sd join depositos d on d.id = sd.deposito_id
                  where d.sucursal_id = v_id and sd.cantidad > 0) then
        raise exception 'La sucursal tiene stock en sus depósitos: trasladalo antes de desactivarla';
      end if;
      if exists (select 1 from traslados t join depositos d on d.id in (t.deposito_origen_id, t.deposito_destino_id)
                  where d.sucursal_id = v_id and t.estado = 'en_transito') then
        raise exception 'La sucursal tiene traslados en tránsito: recibilos o anulalos antes';
      end if;
    end if;
  end if;
  if v_principal and not v_activa then raise exception 'La sucursal principal tiene que estar activa'; end if;

  if v_principal then
    update sucursales set es_principal = false, updated_at = now()
     where empresa_id = s.s_empresa and es_principal and id is distinct from v_id;
  end if;

  begin
    if v_id is null then
      insert into sucursales (empresa_id, nombre, direccion, ciudad, telefono, establecimiento, punto_expedicion, es_principal, activa)
        values (s.s_empresa, v_nombre, nullif(btrim(p->>'direccion'), ''), nullif(btrim(p->>'ciudad'), ''),
                nullif(btrim(p->>'telefono'), ''), v_est, v_pto, v_principal, true)
        returning id into v_id;
      insert into depositos (empresa_id, sucursal_id, nombre, es_principal)
        values (s.s_empresa, v_id, coalesce(v_dep_nombre, 'Depósito ' || v_nombre), true);
    else
      update sucursales set nombre = v_nombre, direccion = nullif(btrim(p->>'direccion'), ''),
             ciudad = nullif(btrim(p->>'ciudad'), ''), telefono = nullif(btrim(p->>'telefono'), ''),
             establecimiento = v_est, punto_expedicion = v_pto, es_principal = v_principal, activa = v_activa,
             updated_at = now()
       where id = v_id;
      if not v_activa then
        update depositos set activo = false, updated_at = now() where sucursal_id = v_id and activo;
        update usuarios set sucursal_id = null where sucursal_id = v_id;
      end if;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_sucursales_nombre' then raise exception 'Ya hay una sucursal llamada "%"', v_nombre; end if;
    if v_cons = 'uq_sucursales_establecimiento' then raise exception 'El establecimiento % ya lo usa otra sucursal', v_est; end if;
    if v_cons = 'uq_depositos_nombre' then raise exception 'Ya hay un depósito llamado "%"', coalesce(v_dep_nombre, 'Depósito ' || v_nombre); end if;
    raise;
  end;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- guardar_deposito(p): { id?, sucursal_id, nombre, descripcion?, es_principal?, activo? } → { id }
create or replace function :"schema".guardar_deposito(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_principal boolean := coalesce((p->>'es_principal')::boolean, false);
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
  prev record;
  v_suc_activa boolean;
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_nombre is null then raise exception 'Escribí el nombre del depósito'; end if;
  select activa into v_suc_activa from sucursales where id = v_suc and empresa_id = s.s_empresa;
  if not found then raise exception 'Elegí la sucursal del depósito'; end if;
  if not v_suc_activa and v_activo then raise exception 'La sucursal está inactiva'; end if;

  if v_id is not null then
    select * into prev from depositos where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Depósito no encontrado'; end if;
    if prev.es_principal and (not v_principal or prev.sucursal_id <> v_suc) then
      raise exception 'Es el depósito principal de su sucursal: marcá otro como principal antes';
    end if;
    if prev.sucursal_id <> v_suc and exists (select 1 from traslados t where t.estado = 'en_transito'
                                              and v_id in (t.deposito_origen_id, t.deposito_destino_id)) then
      raise exception 'El depósito tiene traslados en tránsito: recibilos o anulalos antes de cambiarlo de sucursal';
    end if;
    if prev.activo and not v_activo then
      if exists (select 1 from stock_depositos where deposito_id = v_id and cantidad > 0) then
        raise exception 'El depósito tiene stock: trasladalo antes de desactivarlo';
      end if;
      if exists (select 1 from traslados t where t.estado = 'en_transito' and v_id in (t.deposito_origen_id, t.deposito_destino_id)) then
        raise exception 'El depósito tiene traslados en tránsito: recibilos o anulalos antes';
      end if;
      if exists (select 1 from ajustes_inventario a where a.deposito_id = v_id and a.estado = 'pendiente') then
        raise exception 'El depósito tiene pérdidas pendientes de aprobar';
      end if;
    end if;
  end if;
  if v_principal and not v_activo then raise exception 'El depósito principal tiene que estar activo'; end if;
  if v_principal then
    update depositos set es_principal = false, updated_at = now()
     where sucursal_id = v_suc and es_principal and id is distinct from v_id;
  end if;

  begin
    if v_id is null then
      insert into depositos (empresa_id, sucursal_id, nombre, descripcion, es_principal, activo)
        values (s.s_empresa, v_suc, v_nombre, nullif(btrim(p->>'descripcion'), ''), v_principal, true)
        returning id into v_id;
    else
      update depositos set sucursal_id = v_suc, nombre = v_nombre, descripcion = nullif(btrim(p->>'descripcion'), ''),
             es_principal = v_principal, activo = v_activo, updated_at = now()
       where id = v_id;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_depositos_nombre' then raise exception 'Ya hay un depósito llamado "%"', v_nombre; end if;
    raise;
  end;
  -- Una sucursal activa siempre tiene un depósito principal.
  if not exists (select 1 from depositos where sucursal_id = v_suc and es_principal) then
    update depositos set es_principal = true, updated_at = now()
     where id = (select id from depositos where sucursal_id = v_suc and activo order by created_at limit 1);
  end if;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- Sucursal por defecto de un usuario (donde trabaja). null = sin sucursal fija.
create or replace function :"schema".asignar_sucursal_usuario(p_usuario uuid, p_sucursal uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if p_sucursal is not null and not exists (select 1 from sucursales where id = p_sucursal and empresa_id = s.s_empresa and activa) then
    raise exception 'Sucursal no encontrada o inactiva';
  end if;
  update usuarios set sucursal_id = p_sucursal where id = p_usuario and empresa_id = s.s_empresa;
  if not found then raise exception 'Usuario no encontrado'; end if;
  return jsonb_build_object('id', p_usuario, 'sucursal_id', p_sucursal);
end;
$fn$;

-- Pantalla Depósitos y selectores: sucursales con sus depósitos (y lo que tiene cada uno),
-- usuarios con su sucursal (solo ADMIN), la sucursal/depósito por defecto de quien pide.
create or replace function :"schema".sucursales_depositos()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  with dep as (
    select d.id, d.sucursal_id, d.nombre, d.descripcion, d.es_principal, d.activo,
           coalesce(x.productos, 0) as productos, coalesce(x.unidades, 0) as unidades, coalesce(x.valor, 0) as valor
      from depositos d
      left join lateral (
        select count(*) filter (where sd.cantidad > 0) as productos, sum(sd.cantidad) as unidades,
               round(sum(sd.cantidad * coalesce(p.costo_promedio, 0))) as valor
          from stock_depositos sd join productos p on p.id = sd.producto_id
         where sd.deposito_id = d.id) x on true
     where d.empresa_id = s.s_empresa
  )
  select jsonb_build_object(
    'sucursales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', su.id, 'nombre', su.nombre, 'direccion', su.direccion, 'ciudad', su.ciudad, 'telefono', su.telefono,
        'establecimiento', su.establecimiento, 'punto_expedicion', su.punto_expedicion, 'es_principal', su.es_principal,
        'activa', su.activa,
        'usuarios', (select count(*) from usuarios u where u.sucursal_id = su.id and u.activo),
        'depositos', coalesce((select jsonb_agg(to_jsonb(dep) - 'sucursal_id' order by dep.es_principal desc, dep.activo desc, dep.nombre)
                                 from dep where dep.sucursal_id = su.id), '[]'::jsonb)
      ) order by su.es_principal desc, su.activa desc, su.nombre)
        from sucursales su where su.empresa_id = s.s_empresa), '[]'::jsonb),
    'usuarios', case when s.s_rol = 'ADMIN' then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'rol', u.rol, 'sucursal_id', u.sucursal_id) order by u.nombre)
        from usuarios u where u.empresa_id = s.s_empresa and u.activo), '[]'::jsonb) else '[]'::jsonb end,
    'mi_sucursal_id', s.s_sucursal,
    'mi_deposito_id', deposito_por_defecto(s.s_empresa, s.s_sucursal),
    'es_admin', s.s_rol = 'ADMIN',
    'traslados_en_transito', (select count(*) from traslados t where t.empresa_id = s.s_empresa and t.estado = 'en_transito'),
    'ajustes_pendientes', (select count(*) from ajustes_inventario a where a.empresa_id = s.s_empresa and a.estado = 'pendiente')
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 6. VENTA y su anulación (Caja). Misma salida que antes; el stock sale del depósito de
--    la venta: p_deposito_id si viene (la Fase 2 lo manda desde la caja de la sucursal);
--    si no, el principal de la sucursal del usuario (o el de la Casa central). Productos
--    con lotes: FEFO dentro de ESE depósito.
-- =============================================================================
drop trigger if exists trg_ventas_items_lotes on :"schema".ventas_items;
drop trigger if exists trg_ventas_anular_lotes on :"schema".ventas;
drop function if exists :"schema".tg_ventas_items_lotes();
drop function if exists :"schema".tg_ventas_anular_lotes();
drop function if exists :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer);

create or replace function :"schema".crear_venta(
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text,
  p_descuento_pct numeric default 0, p_plazo_dias integer default null, p_deposito_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
declare
  s record;
  v_empresa uuid;
  v_caja uuid;
  v_venta uuid;
  v_numero text;
  v_next bigint;
  v_usuario uuid;
  v_dep uuid;
  v_dep_info record;
  it jsonb;
  pg jsonb;
  v_pago_metodo text;
  v_pago_monto numeric;
  v_medio text;
  v_pagos_sum numeric := 0;
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

  -- Descuento global: factor 1 - pct/100, clamp 0..100. Se prorratea por línea.
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

  -- Depósito del que sale el stock.
  if p_deposito_id is not null then
    select * into v_dep_info from inv_deposito(v_empresa, p_deposito_id, true);
    if s.s_rol <> 'ADMIN' and s.s_sucursal is not null and v_dep_info.suc_id <> s.s_sucursal then
      raise exception 'Solo podés vender desde los depósitos de tu sucursal';
    end if;
    v_dep := p_deposito_id;
  else
    v_dep := deposito_por_defecto(v_empresa, s.s_sucursal);
  end if;

  select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta'
    order by fecha_apertura desc limit 1;

  select coalesce(max(case when numero_control ~ '^VTA-[0-9]+$'
           then substring(numero_control from '[0-9]+$')::bigint end), 0) + 1
    into v_next from ventas where empresa_id = v_empresa;
  v_numero := 'VTA-' || lpad(v_next::text, 6, '0');

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio,
                      subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago,
                      caja_id, created_by, fecha, observaciones, idempotency_key, deposito_id)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', coalesce(p_tipo_venta, 'CONTADO'),
            case when coalesce(p_tipo_venta,'CONTADO') = 'CREDITO' then p_plazo_dias else null end,
            p_metodo_pago,
            v_caja, auth.uid(), now(), p_observaciones, nullif(p_idempotency_key, ''), v_dep)
    returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un ítem'; end if;

    select * into prod from productos
      where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no existe en esta empresa', it->>'producto_id'; end if;

    -- Precio de lista según el nivel elegido.
    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then prod.costo_promedio
                  else prod.precio_venta end;
    -- Override manual de precio por el cajero (editar precio en la línea).
    v_precio_override := nullif(it->>'precio_unitario', '')::numeric;
    v_precio := case when v_precio_override is not null and v_precio_override > 0
                     then v_precio_override else v_precio_lista end;
    -- Descuento POR PRODUCTO (%) + global (si viniera): bajan el precio unitario.
    v_precio := round(v_precio
                      * (1 - greatest(0, least(coalesce((it->>'descuento_pct')::numeric, 0), 100)) / 100.0)
                      * v_factor);
    v_total_linea := round(v_cant * v_precio);
    v_iva_tipo := coalesce(nullif(it->>'tipo_iva', ''), prod.tipo_iva);
    v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
    v_iva := case when v_tasa = 0 then 0 else round(v_total_linea * v_tasa / (100 + v_tasa)) end;
    v_sub := v_total_linea - v_iva;

    if prod.controla_stock and v_dep is null then
      raise exception 'No hay un depósito activo del que descontar "%": creá uno en Inventario › Depósitos', prod.nombre;
    end if;

    insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
                             precio_venta_original, precio_venta, tipo_precio, tipo_iva,
                             subtotal, monto_iva, total_linea, costo_unitario)
      values (v_empresa, v_venta, prod.id, prod.nombre, prod.sku, v_cant,
              v_precio_lista, v_precio, coalesce(it->>'tipo_precio', 'minorista'), v_iva_tipo,
              v_sub, v_iva, v_total_linea, prod.costo_promedio)
      returning id into v_item;

    if prod.controla_stock then
      -- Stock del depósito + kardex (falla si en ese depósito no alcanza).
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

  -- Límite de crédito: si la venta es a crédito y el cliente tiene tope, no dejar pasarse.
  if coalesce(p_tipo_venta, 'CONTADO') = 'CREDITO' and p_cliente_id is not null then
    declare
      v_limite numeric;
      v_saldo numeric;
    begin
      select limite_credito into v_limite from clientes where id = p_cliente_id and empresa_id = v_empresa;
      if coalesce(v_limite, 0) > 0 then
        v_saldo := cliente_saldo(p_cliente_id);
        if v_saldo > v_limite then
          raise exception 'Supera el límite de crédito del cliente (límite %, quedaría en %)', v_limite, v_saldo;
        end if;
      end if;
    end;
  end if;

  -- Cobro en caja (venta de contado), con PAGO MIXTO (ver 11_venta_fn.sql).
  if coalesce(p_tipo_venta, 'CONTADO') = 'CONTADO' then
    if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
      for pg in select * from jsonb_array_elements(p_pagos) loop
        v_pago_metodo := coalesce(nullif(pg->>'metodo_pago', ''), 'efectivo');
        v_pago_monto := round((pg->>'monto')::numeric);
        if v_pago_monto is null or v_pago_monto <= 0 then
          raise exception 'Monto de pago inválido en el detalle';
        end if;
        v_pagos_sum := v_pagos_sum + v_pago_monto;
        v_medio := case
          when v_pago_metodo like 'tarjeta%' then 'tarjeta'
          when v_pago_metodo like 'pos%' then 'pos'
          when v_pago_metodo in ('efectivo', 'transferencia', 'cheque') then v_pago_metodo
          else 'otro' end;
        insert into ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto, referencia, titular)
          values (v_empresa, v_venta, v_pago_metodo, v_pago_monto, pg->>'referencia', pg->>'titular');
        if v_caja is not null then
          insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, venta_id, usuario_id, fecha)
            values (v_empresa, v_caja, 'ingreso', 'Venta ' || v_numero || ' (' || v_medio || ')', v_pago_monto, v_medio, v_venta, v_usuario, (now() at time zone 'America/Asuncion')::date);
        end if;
      end loop;
      if v_pagos_sum <> tot_total then
        raise exception 'La suma de los pagos (%) no coincide con el total (%)', v_pagos_sum, tot_total;
      end if;
    elsif v_caja is not null then
      insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, venta_id, usuario_id, fecha)
        values (v_empresa, v_caja, 'ingreso', 'Venta ' || v_numero, tot_total,
                case when coalesce(p_metodo_pago,'efectivo') in ('efectivo','transferencia','tarjeta','cheque','pos') then p_metodo_pago else 'otro' end,
                v_venta, v_usuario, (now() at time zone 'America/Asuncion')::date);
    end if;
  end if;

  return jsonb_build_object('venta_id', v_venta, 'numero_control', v_numero, 'total', tot_total, 'reusada', false);
end;
$function$;

create or replace function :"schema".anular_venta(p_venta_id uuid)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
declare
  s record;
  v_empresa uuid;
  v_venta record;
  v_dep uuid;
  it record;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_empresa := s.s_empresa;

  select * into v_venta from ventas where id = p_venta_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_venta.estado = 'anulada' then
    return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', true);
  end if;
  v_dep := coalesce(v_venta.deposito_id, deposito_por_defecto(v_empresa, null));

  -- Devolver stock de cada ítem al MISMO depósito (y dejarlo en el kardex).
  for it in select vi.producto_id, vi.cantidad, vi.costo_unitario
              from ventas_items vi
              join productos p on p.id = vi.producto_id and p.controla_stock
             where vi.venta_id = p_venta_id and vi.empresa_id = v_empresa
             order by vi.producto_id loop
    perform inv_mover(v_empresa, it.producto_id, v_dep, it.cantidad, coalesce(it.costo_unitario, 0), 'anulacion_venta',
                      'venta', v_venta.id, v_venta.numero_control, 'Anulación ' || v_venta.numero_control,
                      s.s_usuario, s.s_nombre);
  end loop;
  -- Cada consumo de lotes vuelve a SU lote (o al saldo sin lote).
  perform lotes_revertir(v_empresa, v_venta.id, null, null, 'SALIDA', array['venta'], 'anulacion_venta',
                         'Anulación ' || v_venta.numero_control);

  -- Anular el movimiento de caja del cobro (si lo hubo).
  update caja_movimientos
     set anulado_at = now(), anulado_motivo = 'Venta anulada'
   where venta_id = p_venta_id and empresa_id = v_empresa and anulado_at is null;

  update ventas set estado = 'anulada', anulada_at = now() where id = p_venta_id;

  return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', false);
end;
$function$;

-- =============================================================================
-- 7. COMPRA (recarga de stock) y su anulación. Igual que la receta 49 + depósito:
--    p.deposito_id (por defecto el principal de la sucursal del usuario). La anulación
--    saca del MISMO depósito (y del mismo lote).
-- =============================================================================
create or replace function :"schema".registrar_compra(p jsonb)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
declare
  s record;
  v_empresa uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_prov record;
  v_dep record;
  v_compra uuid;
  v_numero text;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then nullif(p->>'tipo_cambio', '')::numeric else 1 end;
  v_tipo_pago text := coalesce(nullif(p->>'tipo_pago', ''), 'contado');
  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_fecha_fact date := nullif(p->>'fecha_factura', '')::date;
  v_factura text := nullif(btrim(p->>'numero_factura'), '');
  v_timbrado text := nullif(btrim(p->>'nro_timbrado'), '');
  v_medio text := nullif(btrim(coalesce(p->>'medio_pago', '')), '');
  v_ref text := left(nullif(btrim(coalesce(p->>'referencia_pago', '')), ''), 120);
  v_excedente boolean := coalesce(nullif(p->>'permitir_excedente', '')::boolean, false);
  v_caja uuid;
  it jsonb;
  prod record;
  oci record;
  v_cant numeric;
  v_costo_orig numeric;
  v_costo numeric;
  v_total_linea numeric;
  v_cpp numeric;
  v_pv numeric;
  v_subtotal numeric := 0;
  v_iva numeric := 0;
  v_total numeric := 0;
  v_orden integer := 0;
  v_oc uuid := nullif(p->>'orden_compra_id', '')::uuid;
  v_oc_row record;
  v_oc_item uuid;
  v_item uuid;
  v_lote_num text;
  v_lote_venc date;
  v_lote uuid;
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;

  -- Idempotencia: el mismo envío (doble clic, reintento) espera al primero y lo devuelve.
  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('compra:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero_control, total into v_rep from compras where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero_control', v_rep.numero_control, 'total', v_rep.total, 'repetido', true);
    end if;
  end if;

  select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre) as nombre, activo into v_prov
    from proveedores where id = nullif(p->>'proveedor_id', '')::uuid and empresa_id = v_empresa;
  if not found then raise exception 'Elegí el proveedor'; end if;
  if v_factura is null then raise exception 'Falta el número de factura'; end if;
  if v_fecha_fact > v_hoy then raise exception 'La fecha de la factura no puede ser futura'; end if;
  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición de pago inválida'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  if v_plazo is not null and (v_plazo < 0 or v_plazo > 3650) then raise exception 'El plazo tiene que estar entre 0 y 3650 días'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'La compra no tiene productos';
  end if;

  -- Depósito al que entra la mercadería.
  select * into v_dep from inv_deposito(v_empresa,
    coalesce(nullif(p->>'deposito_id', '')::uuid, deposito_por_defecto(v_empresa, s.s_sucursal)), true);

  -- Contado: cómo se pagó. El efectivo sale de la caja abierta (solo Gs.).
  if v_tipo_pago = 'contado' then
    if v_medio is not null and v_medio not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then
      raise exception 'Medio de pago inválido';
    end if;
    if v_medio = 'efectivo' then
      if v_moneda <> 'GS' then
        raise exception 'El efectivo de la caja es en guaraníes: una factura en dólares al contado va por transferencia, cheque u otro medio';
      end if;
      select id into v_caja from cajas where empresa_id = v_empresa and estado = 'abierta' order by fecha_apertura desc limit 1;
      if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
    end if;
    if v_medio = 'efectivo' then v_ref := null; end if;
  else
    v_medio := null;
    v_ref := null;
  end if;

  -- Recepción de una orden de compra: del mismo proveedor, ni cancelada ni ya recibida completa.
  if v_oc is not null then
    select id, numero_oc, estado into v_oc_row from ordenes_compra
     where id = v_oc and empresa_id = v_empresa and proveedor_id = v_prov.id for update;
    if not found then raise exception 'La orden de compra no es de este proveedor'; end if;
    if v_oc_row.estado = 'cancelada' then raise exception 'La orden % está cancelada: no se puede recibir', v_oc_row.numero_oc; end if;
    if v_oc_row.estado = 'recibida_total' then
      raise exception 'La orden % ya se recibió completa. Si llegó algo más, cargalo como una compra sin orden', v_oc_row.numero_oc;
    end if;
  end if;

  -- Misma factura ya cargada (no anulada).
  if exists (select 1 from compras c
              where c.empresa_id = v_empresa and c.proveedor_id = v_prov.id and c.estado <> 'anulada'
                and coalesce(c.nro_timbrado, '') = coalesce(v_timbrado, '')
                and regexp_replace(lower(c.numero_factura), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(v_factura), '[^a-z0-9]+', '', 'g')) then
    raise exception 'La factura % de % ya está cargada', v_factura, v_prov.nombre;
  end if;

  v_numero := 'COMP-' || lpad(reservar_secuencia('compra', coalesce((
                select max(substring(numero_control from '[0-9]+$')::bigint) from compras where empresa_id = v_empresa), 0))::text, 6, '0');

  begin
    insert into compras (empresa_id, numero_control, proveedor_id, proveedor_nombre, fecha_factura, nro_timbrado,
                         numero_factura, tipo_pago, plazo_dias, vencimiento, moneda, tipo_cambio, observacion,
                         created_by, usuario_nombre, orden_compra_id, idempotency_key, medio_pago, referencia_pago, caja_id,
                         deposito_id)
      values (v_empresa, v_numero, v_prov.id, v_prov.nombre, v_fecha_fact, v_timbrado, v_factura, v_tipo_pago,
              case when v_tipo_pago = 'credito' then v_plazo end,
              case when v_tipo_pago = 'credito' and v_plazo is not null
                   then coalesce(v_fecha_fact, v_hoy) + v_plazo end,
              v_moneda, v_cambio, nullif(btrim(p->>'observacion'), ''), auth.uid(), s.s_nombre, v_oc,
              v_idem, v_medio, v_ref, v_caja, v_dep.dep_id)
      returning id into v_compra;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_compras_factura' then
      raise exception 'La factura % de % ya está cargada', v_factura, v_prov.nombre;
    end if;
    raise;
  end;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    v_cant := nullif(it->>'cantidad', '')::numeric;
    v_costo_orig := nullif(it->>'costo_unitario', '')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_costo_orig is null or v_costo_orig <= 0 then raise exception 'Producto %: falta el costo', v_orden; end if;
    v_costo := round(v_costo_orig * v_cambio, 2);

    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no encontrado', v_orden; end if;

    -- Lotes: solo productos que controlan stock y lotes. Vencimiento obligatorio.
    v_lote_num := null; v_lote_venc := null;
    if prod.controla_stock and prod.controla_lotes then
      v_lote_venc := nullif(it->>'vencimiento', '')::date;
      if v_lote_venc is null then
        raise exception 'Producto %: "%" controla lotes, cargá el vencimiento', v_orden, prod.nombre;
      end if;
      v_lote_num := upper(btrim(coalesce(nullif(btrim(it->>'lote'), ''), lote_numero_auto())));
    end if;

    v_total_linea := round(v_cant * v_costo);
    v_subtotal := v_subtotal + v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva);
    v_iva := v_iva + iva_contenido(v_total_linea, prod.tipo_iva);
    v_total := v_total + v_total_linea;

    v_oc_item := null;
    if nullif(it->>'oc_item_id', '') is not null then
      if v_oc is null then raise exception 'Producto %: viene de una orden de compra pero falta la orden', v_orden; end if;
      select id, producto_id, cantidad, cantidad_recibida into oci from ordenes_compra_items
       where id = (it->>'oc_item_id')::uuid and orden_compra_id = v_oc for update;
      if not found then
        raise exception 'Producto % ("%"): esa línea ya no está en la orden % (¿la editaron?). Volvé a abrir la recepción', v_orden, prod.nombre, v_oc_row.numero_oc;
      end if;
      if oci.producto_id <> prod.id then
        raise exception 'Producto % ("%"): no corresponde a esa línea de la orden %', v_orden, prod.nombre, v_oc_row.numero_oc;
      end if;
      if oci.cantidad_recibida + v_cant > oci.cantidad and not v_excedente then
        raise exception '"%": pediste %, ya llegaron % y estás recibiendo %. Si de verdad llegó de más, confirmá la recepción excedente',
          prod.nombre, trim_scale(oci.cantidad), trim_scale(oci.cantidad_recibida), trim_scale(v_cant);
      end if;
      update ordenes_compra_items set cantidad_recibida = cantidad_recibida + v_cant
       where id = oci.id
       returning id into v_oc_item;
    end if;

    insert into compras_items (empresa_id, compra_id, producto_id, producto_nombre, producto_sku, cantidad,
                               costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total,
                               precio_venta_nuevo, orden, oc_item_id, lote_numero, lote_vencimiento)
      values (v_empresa, v_compra, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              v_total_linea - iva_contenido(v_total_linea, prod.tipo_iva), iva_contenido(v_total_linea, prod.tipo_iva),
              v_total_linea, nullif(nullif(it->>'precio_venta_nuevo', '')::numeric, 0), v_orden, v_oc_item, v_lote_num, v_lote_venc)
      returning id into v_item;

    -- Costo promedio ponderado (sobre el stock TOTAL) + precio de venta nuevo.
    v_cpp := case when prod.controla_stock and greatest(prod.stock_actual, 0) + v_cant > 0
                  then round((greatest(prod.stock_actual, 0) * coalesce(prod.costo_promedio, 0) + v_cant * v_costo)
                             / (greatest(prod.stock_actual, 0) + v_cant), 2)
                  else v_costo end;
    v_pv := nullif(nullif(it->>'precio_venta_nuevo', '')::numeric, 0);
    update productos
       set costo_promedio = v_cpp,
           precio_venta = coalesce(v_pv, precio_venta),
           proveedor_principal_id = coalesce(proveedor_principal_id, v_prov.id),
           updated_at = now()
     where id = prod.id;

    if prod.controla_stock then
      perform inv_mover(v_empresa, prod.id, v_dep.dep_id, v_cant, v_costo, 'compra', 'compra', v_compra, v_numero,
                        v_numero || case when v_lote_num is not null
                                         then ' · Lote ' || v_lote_num || ' vence ' || to_char(v_lote_venc, 'DD/MM/YYYY') else '' end,
                        s.s_usuario, s.s_nombre,
                        jsonb_build_object('proveedor', v_prov.nombre, 'numero_factura', v_factura,
                                           'proveedor_id', v_prov.id, 'compra_id', v_compra));
    end if;

    if v_lote_num is not null then
      v_lote := lote_entrada(v_empresa, prod.id, v_dep.dep_id, v_lote_num, v_lote_venc, v_cant, v_costo, 'compra',
                             v_compra, v_numero, 'compra', v_compra, v_item);
      update compras_items set lote_id = v_lote where id = v_item;
    end if;
  end loop;

  update compras set subtotal = v_subtotal, monto_iva = v_iva, total = v_total,
         busqueda = concat_ws(' ', norm(v_numero), compacto(v_numero), norm(v_prov.nombre), norm(v_factura), compacto(v_factura),
                              norm(v_timbrado), (select string_agg(norm(i.producto_nombre) || ' ' || norm(i.producto_sku) || ' ' || compacto(i.producto_sku), ' ')
                                                  from compras_items i where i.compra_id = v_compra))
   where id = v_compra;

  if v_caja is not null then
    insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, compra_id, observacion)
    values (v_empresa, v_caja, 'egreso', left('Compra ' || v_numero || ' · ' || v_prov.nombre, 200), round(v_total), 'efectivo', 'compra',
            s.s_usuario, v_hoy, v_compra, left('Factura ' || v_factura, 200));
  end if;

  if v_oc is not null then perform recalcular_orden_compra(v_oc); end if;
  return jsonb_build_object('id', v_compra, 'numero_control', v_numero, 'total', v_total,
                            'deposito_id', v_dep.dep_id, 'deposito', v_dep.dep_nombre);
end;
$function$;

create or replace function :"schema".anular_compra(p_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
declare
  s record;
  v_empresa uuid;
  c record;
  it record;
  prod record;
  v_cpp numeric;
  l record;
  v_pagado numeric;
  v_ops text;
  v_caja record;
  v_dep uuid;
  v_dep_nombre text;
  v_en_dep numeric;
  v_ref text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into c from compras where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada'; end if;
  v_dep := coalesce(c.deposito_id, deposito_por_defecto(v_empresa, null));
  select nombre into v_dep_nombre from depositos where id = v_dep;
  v_ref := left('Anulación ' || c.numero_control || ': ' || btrim(p_motivo), 200);

  if c.orden_compra_id is not null then
    perform 1 from ordenes_compra where id = c.orden_compra_id for update;
  end if;

  select x.pagado into v_pagado from cuentas_por_pagar x where x.compra_id = c.id for update;
  if coalesce(v_pagado, 0) > 0 then
    select string_agg(distinct k.numero, ', ' order by k.numero) into v_ops
      from pagos_proveedores_aplicaciones a
      join pagos_proveedores k on k.id = a.pago_id
      join cuentas_por_pagar x on x.id = a.cxp_id
     where x.compra_id = c.id and k.anulado_at is null;
    raise exception 'La compra % ya tiene pagos al proveedor (%): anulá primero esos pagos', c.numero_control, coalesce(v_ops, 'órdenes de pago');
  end if;

  select m.id, cj.estado, cj.numero_caja into v_caja
    from caja_movimientos m join cajas cj on cj.id = m.caja_id
   where m.compra_id = c.id and m.anulado_at is null limit 1;
  if found and v_caja.estado <> 'abierta' then
    raise exception 'El efectivo de esta compra salió de la caja N° %, que ya se cerró: no se puede anular', v_caja.numero_caja;
  end if;

  for it in select * from compras_items where compra_id = c.id order by orden loop
    select * into prod from productos where id = it.producto_id and empresa_id = v_empresa for update;
    if not found or not prod.controla_stock then continue; end if;
    v_en_dep := coalesce((select cantidad from stock_depositos where producto_id = prod.id and deposito_id = v_dep), 0);
    if v_en_dep < it.cantidad then
      raise exception 'No se puede anular: de "%" quedan % en % y la compra trajo %. Ya se vendió o se trasladó parte.',
        prod.nombre, trim_scale(v_en_dep), coalesce(v_dep_nombre, 'el depósito'), trim_scale(it.cantidad);
    end if;
    if it.lote_id is not null then
      select id, numero, cantidad into l from lotes where id = it.lote_id for update;
      if found then
        if l.cantidad < it.cantidad then
          raise exception 'No se puede anular: del lote % de "%" quedan % y la compra trajo %. Ya se vendió, se trasladó o se dio de baja parte.',
            l.numero, prod.nombre, trim_scale(l.cantidad), trim_scale(it.cantidad);
        end if;
        update lotes set cantidad = cantidad - it.cantidad where id = l.id;
        insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, compra_id, motivo,
                                       documento_tipo, documento_id, documento_item_id)
          values (v_empresa, prod.id, l.id, v_dep, 'SALIDA', it.cantidad, 'anulacion_compra', c.id, left(v_ref, 300),
                  'compra', c.id, it.id);
      end if;
    end if;
    -- Saca la compra del promedio: (stock·cpp − cant·costo) / (stock − cant).
    v_cpp := case when prod.stock_actual - it.cantidad > 0
                  then greatest(round((prod.stock_actual * coalesce(prod.costo_promedio, 0) - it.cantidad * it.costo_unitario)
                                      / (prod.stock_actual - it.cantidad), 2), 0)
                  else prod.costo_promedio end;
    update productos set costo_promedio = v_cpp, updated_at = now() where id = prod.id;
    perform inv_mover(v_empresa, prod.id, v_dep, -it.cantidad, it.costo_unitario, 'anulacion_compra', 'compra', c.id,
                      c.numero_control, v_ref, s.s_usuario, s.s_nombre,
                      jsonb_build_object('proveedor', c.proveedor_nombre, 'numero_factura', c.numero_factura,
                                         'proveedor_id', c.proveedor_id, 'compra_id', c.id));
  end loop;

  update compras set estado = 'anulada', anulada_at = now(), anulada_por = s.s_nombre,
         anulada_motivo = left(btrim(p_motivo), 500)
   where id = c.id;

  update caja_movimientos set anulado_at = now(), anulado_por = s.s_usuario,
         anulado_motivo = left('Compra anulada: ' || btrim(p_motivo), 200)
   where compra_id = c.id and anulado_at is null;

  if c.orden_compra_id is not null then
    update ordenes_compra_items oi set cantidad_recibida = greatest(oi.cantidad_recibida - ci.cantidad, 0)
      from compras_items ci
     where ci.compra_id = c.id and ci.oc_item_id = oi.id;
    perform recalcular_orden_compra(c.orden_compra_id);
  end if;
  return jsonb_build_object('id', c.id, 'numero_control', c.numero_control);
end;
$function$;

-- =============================================================================
-- 8. TRASLADOS entre depósitos (con nota de remisión)
-- =============================================================================

-- crear_traslado(p) — ADMIN. Envía: el stock SALE del origen ya (queda en tránsito).
--   { deposito_origen_id, deposito_destino_id, fecha_inicio?, fecha_fin_estimada?, motivo_codigo? (7),
--     motivo_descripcion?, punto_partida?, ciudad_partida?, punto_llegada?, ciudad_llegada?,
--     vehiculo_marca?, vehiculo_chapa?, chofer_nombre?, chofer_documento?, transportista_nombre?,
--     transportista_ruc?, observacion?, idempotency_key?,
--     items: [{ producto_id, cantidad, lotes?: [{ lote_id, cantidad }] }] }
--   Producto con lotes sin "lotes": FEFO (los vigentes que vencen primero; lo que no cubren, sin lote).
create or replace function :"schema".crear_traslado(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  o record;
  d record;
  v_id uuid;
  v_numero text;
  v_remision text;
  v_est text;
  v_pto text;
  v_motivo smallint := coalesce(nullif(p->>'motivo_codigo', '')::smallint, 7);
  v_fecha date := coalesce(nullif(p->>'fecha_inicio', '')::date, v_hoy);
  it jsonb;
  lj jsonb;
  prod record;
  v_cant numeric;
  v_lc numeric;
  v_suma numeric;
  v_item uuid;
  v_orden integer := 0;
  v_cons jsonb;
  v_ids uuid[] := '{}';
  v_tot_u numeric := 0;
  v_tot_v numeric := 0;
  v_ref text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;

  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('traslado:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero, remision_numero into v_rep from traslados where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero', v_rep.numero, 'remision_numero', v_rep.remision_numero, 'repetido', true);
    end if;
  end if;

  select * into o from inv_deposito(v_empresa, nullif(p->>'deposito_origen_id', '')::uuid, true);
  select * into d from inv_deposito(v_empresa, nullif(p->>'deposito_destino_id', '')::uuid, true);
  if o.dep_id = d.dep_id then raise exception 'El depósito de origen y el de destino tienen que ser distintos'; end if;
  if v_motivo not in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 99) then raise exception 'Motivo de traslado inválido'; end if;
  if v_motivo = 99 and coalesce(btrim(p->>'motivo_descripcion'), '') = '' then
    raise exception 'Contá el motivo del traslado';
  end if;
  if v_fecha < v_hoy - 30 or v_fecha > v_hoy + 30 then
    raise exception 'La fecha de inicio del traslado tiene que estar cerca de hoy (±30 días)';
  end if;
  if nullif(p->>'fecha_fin_estimada', '')::date < v_fecha then
    raise exception 'La fecha estimada de llegada no puede ser anterior al inicio';
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'El traslado no tiene productos';
  end if;
  if jsonb_array_length(p->'items') > 300 then raise exception 'Máximo 300 productos por traslado'; end if;

  v_numero := 'TR-' || lpad(inv_numero(v_empresa, 'traslado',
                (select max(substring(t.numero from '[0-9]+$')::bigint) from traslados t where t.empresa_id = v_empresa))::text, 6, '0');
  v_est := coalesce(o.suc_establecimiento, '001');
  v_pto := coalesce(o.suc_punto, '001');
  v_remision := v_est || '-' || v_pto || '-' || lpad(inv_numero(v_empresa, 'remision:' || v_est || '-' || v_pto,
                (select max(substring(t.remision_numero from '[0-9]+$')::bigint) from traslados t
                  where t.empresa_id = v_empresa and t.remision_numero like v_est || '-' || v_pto || '-%'))::text, 7, '0');

  insert into traslados (empresa_id, numero, remision_numero, deposito_origen_id, deposito_destino_id, estado,
                         motivo_codigo, motivo_descripcion, fecha_inicio, fecha_fin_estimada,
                         punto_partida, ciudad_partida, punto_llegada, ciudad_llegada,
                         vehiculo_marca, vehiculo_chapa, chofer_nombre, chofer_documento,
                         transportista_nombre, transportista_ruc, observacion,
                         created_by, usuario_nombre, idempotency_key)
    values (v_empresa, v_numero, v_remision, o.dep_id, d.dep_id, 'en_transito',
            v_motivo, nullif(left(btrim(p->>'motivo_descripcion'), 200), ''), v_fecha, nullif(p->>'fecha_fin_estimada', '')::date,
            coalesce(nullif(left(btrim(p->>'punto_partida'), 200), ''), nullif(o.suc_direccion, ''), o.suc_nombre),
            coalesce(nullif(left(btrim(p->>'ciudad_partida'), 80), ''), o.suc_ciudad),
            coalesce(nullif(left(btrim(p->>'punto_llegada'), 200), ''), nullif(d.suc_direccion, ''), d.suc_nombre),
            coalesce(nullif(left(btrim(p->>'ciudad_llegada'), 80), ''), d.suc_ciudad),
            nullif(left(btrim(p->>'vehiculo_marca'), 60), ''), nullif(upper(left(btrim(p->>'vehiculo_chapa'), 20)), ''),
            nullif(left(btrim(p->>'chofer_nombre'), 120), ''), nullif(left(btrim(p->>'chofer_documento'), 20), ''),
            nullif(left(btrim(p->>'transportista_nombre'), 120), ''), nullif(left(btrim(p->>'transportista_ruc'), 20), ''),
            nullif(left(btrim(p->>'observacion'), 1000), ''), s.s_usuario, s.s_nombre, v_idem)
    returning id into v_id;

  v_ref := 'Traslado ' || v_numero || ' → ' || d.dep_nombre;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    v_cant := nullif(it->>'cantidad', '')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no encontrado', v_orden; end if;
    if not prod.controla_stock then raise exception '"%" no controla stock: no se traslada', prod.nombre; end if;
    if prod.id = any (v_ids) then raise exception '"%" está dos veces en el traslado', prod.nombre; end if;
    v_ids := v_ids || prod.id;

    insert into traslados_items (empresa_id, traslado_id, orden, producto_id, producto_nombre, producto_sku, unidad_medida,
                                 controla_lotes, cantidad, costo_unitario)
      values (v_empresa, v_id, v_orden, prod.id, prod.nombre, prod.sku, prod.unidad_medida, prod.controla_lotes, v_cant,
              coalesce(prod.costo_promedio, 0))
      returning id into v_item;

    perform inv_mover(v_empresa, prod.id, o.dep_id, -v_cant, coalesce(prod.costo_promedio, 0), 'traslado_salida', 'traslado',
                      v_id, v_numero, v_ref, s.s_usuario, s.s_nombre, jsonb_build_object('contraparte', d.dep_id));

    if prod.controla_lotes then
      if jsonb_typeof(it->'lotes') = 'array' and jsonb_array_length(it->'lotes') > 0 then
        v_suma := 0;
        for lj in select * from jsonb_array_elements(it->'lotes') loop
          v_lc := nullif(lj->>'cantidad', '')::numeric;
          continue when v_lc is null or v_lc = 0;
          if v_lc < 0 then raise exception '"%": cantidad de lote inválida', prod.nombre; end if;
          if nullif(lj->>'lote_id', '') is null then
            -- Unidades sin lote elegidas a propósito.
            perform lote_sin_lote(v_empresa, prod.id, o.dep_id, 'SALIDA', v_lc, 'traslado_salida', v_ref, 'traslado', v_id, v_item);
            v_cons := jsonb_build_array(jsonb_build_object('lote_id', null, 'cantidad', v_lc));
          else
            v_cons := lotes_consumir(v_empresa, prod.id, o.dep_id, v_lc, 'traslado_salida', null, null, v_ref,
                                     'traslado', v_id, v_item, (lj->>'lote_id')::uuid, true);
          end if;
          insert into traslados_lotes (empresa_id, traslado_id, item_id, lote_origen_id, lote_numero, vencimiento, costo_unitario, cantidad)
            select v_empresa, v_id, v_item, nullif(x->>'lote_id', '')::uuid, x->>'numero', nullif(x->>'vencimiento', '')::date,
                   coalesce(nullif(nullif(x->>'costo', '')::numeric, 0), prod.costo_promedio, 0), (x->>'cantidad')::numeric
              from jsonb_array_elements(v_cons) x;
          v_suma := v_suma + v_lc;
        end loop;
        if v_suma <> v_cant then
          raise exception '"%": los lotes elegidos suman % y el traslado es de %', prod.nombre, trim_scale(v_suma), trim_scale(v_cant);
        end if;
      else
        v_cons := lotes_consumir(v_empresa, prod.id, o.dep_id, v_cant, 'traslado_salida', null, null, v_ref,
                                 'traslado', v_id, v_item, null, false);
        insert into traslados_lotes (empresa_id, traslado_id, item_id, lote_origen_id, lote_numero, vencimiento, costo_unitario, cantidad)
          select v_empresa, v_id, v_item, nullif(x->>'lote_id', '')::uuid, x->>'numero', nullif(x->>'vencimiento', '')::date,
                 coalesce(nullif(nullif(x->>'costo', '')::numeric, 0), prod.costo_promedio, 0), (x->>'cantidad')::numeric
            from jsonb_array_elements(v_cons) x;
      end if;
    end if;
    v_tot_u := v_tot_u + v_cant;
    v_tot_v := v_tot_v + v_cant * coalesce(prod.costo_promedio, 0);
  end loop;

  update traslados set total_items = v_orden, total_unidades = v_tot_u, valor_costo = round(v_tot_v) where id = v_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'remision_numero', v_remision);
end;
$fn$;

-- recibir_traslado(id, p) — ADMIN o alguien de la sucursal de destino.
--   p: { items?: [{ item_id, cantidad_recibida, lotes?: [{ id (traslados_lotes), cantidad_recibida }] }],
--        diferencia_motivo? (obligatorio si llegó menos), observacion? }
--   Sin items = llegó todo. Producto con lotes y recibido < enviado sin detalle de lotes: se
--   reciben primero los lotes que vencen antes. Lo que no llegó queda documentado como
--   diferencia (unidades y valor al costo) y NO vuelve al origen.
create or replace function :"schema".recibir_traslado(p_id uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  t record;
  d record;
  o record;
  ti record;
  tl record;
  x jsonb;
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_rec numeric;
  v_rest numeric;
  v_lr numeric;
  v_suma numeric;
  v_ld uuid;
  v_dif_u numeric := 0;
  v_dif_v numeric := 0;
  v_ref text;
  v_motivo text := nullif(left(btrim(coalesce(p->>'diferencia_motivo', '')), 300), '');
begin
  select * into s from inv_sesion(null);
  v_empresa := s.s_empresa;
  select * into t from traslados where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Traslado no encontrado'; end if;
  if t.estado <> 'en_transito' then
    raise exception 'El traslado % ya está %', t.numero, case t.estado when 'anulado' then 'anulado' else 'recibido' end;
  end if;
  select * into d from inv_deposito(v_empresa, t.deposito_destino_id, true);
  select * into o from inv_deposito(v_empresa, t.deposito_origen_id, false);
  if s.s_rol <> 'ADMIN' and s.s_sucursal is distinct from d.suc_id then
    raise exception 'Solo un administrador o alguien de % puede recibir este traslado', d.suc_nombre using errcode = '42501';
  end if;
  v_ref := 'Traslado ' || t.numero || ' ← ' || o.dep_nombre;

  for ti in select * from traslados_items where traslado_id = t.id order by orden for update loop
    select e into x from jsonb_array_elements(v_items) e where e->>'item_id' = ti.id::text limit 1;
    v_rec := coalesce(nullif(x->>'cantidad_recibida', '')::numeric, ti.cantidad);
    if v_rec < 0 or v_rec > ti.cantidad then
      raise exception '"%": lo recibido tiene que estar entre 0 y %', ti.producto_nombre, trim_scale(ti.cantidad);
    end if;

    if exists (select 1 from traslados_lotes where item_id = ti.id) then
      v_rest := v_rec;
      v_suma := 0;
      for tl in select * from traslados_lotes where item_id = ti.id order by vencimiento nulls last, id for update loop
        if jsonb_typeof(x->'lotes') = 'array' then
          v_lr := coalesce((select nullif(e->>'cantidad_recibida', '')::numeric from jsonb_array_elements(x->'lotes') e
                             where e->>'id' = tl.id::text limit 1), tl.cantidad);
        else
          v_lr := least(tl.cantidad, greatest(v_rest, 0));
          v_rest := v_rest - v_lr;
        end if;
        if v_lr < 0 or v_lr > tl.cantidad then
          raise exception '"%": lo recibido del lote % tiene que estar entre 0 y %', ti.producto_nombre,
            coalesce(tl.lote_numero, 'sin lote'), trim_scale(tl.cantidad);
        end if;
        v_ld := null;
        if v_lr > 0 then
          if tl.lote_origen_id is not null then
            v_ld := lote_entrada(v_empresa, ti.producto_id, d.dep_id, tl.lote_numero, tl.vencimiento, v_lr, tl.costo_unitario,
                                 'traslado_entrada', null, v_ref, 'traslado', t.id, ti.id);
          else
            perform lote_sin_lote(v_empresa, ti.producto_id, d.dep_id, 'ENTRADA', v_lr, 'traslado_entrada', v_ref, 'traslado', t.id, ti.id);
          end if;
        end if;
        update traslados_lotes set cantidad_recibida = v_lr, lote_destino_id = v_ld where id = tl.id;
        v_suma := v_suma + v_lr;
      end loop;
      v_rec := v_suma;
    end if;

    if v_rec > 0 then
      perform inv_mover(v_empresa, ti.producto_id, d.dep_id, v_rec, ti.costo_unitario, 'traslado_entrada', 'traslado',
                        t.id, t.numero, v_ref, s.s_usuario, s.s_nombre, jsonb_build_object('contraparte', o.dep_id));
    end if;
    update traslados_items set cantidad_recibida = v_rec where id = ti.id;
    v_dif_u := v_dif_u + (ti.cantidad - v_rec);
    v_dif_v := v_dif_v + (ti.cantidad - v_rec) * ti.costo_unitario;
  end loop;

  if v_dif_u > 0 and v_motivo is null then
    raise exception 'Llegó menos de lo enviado: escribí el motivo de la diferencia';
  end if;
  update traslados
     set estado = case when v_dif_u > 0 then 'recibido_con_diferencias' else 'recibido' end,
         recibido_por = s.s_usuario, recibido_por_nombre = s.s_nombre, recibido_at = now(),
         recepcion_observacion = nullif(left(btrim(coalesce(p->>'observacion', '')), 1000), ''),
         diferencia_unidades = v_dif_u, diferencia_valor = round(v_dif_v),
         diferencia_motivo = case when v_dif_u > 0 then v_motivo end
   where id = t.id;
  return jsonb_build_object('id', t.id, 'numero', t.numero,
                            'estado', case when v_dif_u > 0 then 'recibido_con_diferencias' else 'recibido' end,
                            'diferencia_unidades', v_dif_u, 'diferencia_valor', round(v_dif_v));
end;
$fn$;

-- anular_traslado(id, motivo) — ADMIN. Solo en tránsito: todo vuelve al origen, a los mismos lotes.
create or replace function :"schema".anular_traslado(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  t record;
  ti record;
  v_ref text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into t from traslados where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Traslado no encontrado'; end if;
  if t.estado <> 'en_transito' then
    raise exception 'Solo se anula un traslado en tránsito (este ya está %)', case t.estado when 'anulado' then 'anulado' else 'recibido' end;
  end if;
  v_ref := left('Anulación ' || t.numero || ': ' || btrim(p_motivo), 200);
  for ti in select * from traslados_items where traslado_id = t.id order by orden loop
    perform inv_mover(v_empresa, ti.producto_id, t.deposito_origen_id, ti.cantidad, ti.costo_unitario, 'anulacion_traslado',
                      'traslado', t.id, t.numero, v_ref, s.s_usuario, s.s_nombre,
                      jsonb_build_object('contraparte', t.deposito_destino_id));
  end loop;
  perform lotes_revertir(v_empresa, null, t.id, null, 'SALIDA', array['traslado_salida'], 'anulacion_traslado', v_ref);
  update traslados set estado = 'anulado', anulado_por = s.s_usuario, anulado_por_nombre = s.s_nombre, anulado_at = now(),
         anulado_motivo = left(btrim(p_motivo), 500)
   where id = t.id;
  return jsonb_build_object('id', t.id, 'numero', t.numero, 'estado', 'anulado');
end;
$fn$;

-- Lista de traslados (paginada). p_estado: en_transito | recibido (incluye con diferencias)
-- | recibido_con_diferencias | anulado | null. p_deposito: origen o destino.
create or replace function :"schema".listar_traslados(
  p_estado text default null, p_deposito uuid default null, p_q text default null,
  p_desde text default null, p_hasta text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(norm(coalesce(p_q, ''))), '');
  v_desde date := case when p_desde ~ '^\d{4}-\d{2}-\d{2}$' then p_desde::date end;
  v_hasta date := case when p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then p_hasta::date end;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  with f as (
    select t.* from traslados t
     where t.empresa_id = v_emp
       and (coalesce(p_estado, '') = '' or t.estado = p_estado
            or (p_estado = 'recibido' and t.estado = 'recibido_con_diferencias'))
       and (p_deposito is null or p_deposito in (t.deposito_origen_id, t.deposito_destino_id))
       and (v_desde is null or t.fecha_inicio >= v_desde)
       and (v_hasta is null or t.fecha_inicio <= v_hasta)
       and (v_q is null
            or norm(concat_ws(' ', t.numero, t.remision_numero, t.observacion, t.chofer_nombre, t.vehiculo_chapa, t.usuario_nombre)) like '%' || v_q || '%'
            or exists (select 1 from traslados_items i where i.traslado_id = t.id
                        and (norm(i.producto_nombre) like '%' || v_q || '%' or norm(i.producto_sku) like '%' || v_q || '%')))
  ), pag as (
    select * from f order by created_at desc, id desc limit v_lim offset v_off
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'en_transito', (select count(*) from traslados t where t.empresa_id = v_emp and t.estado = 'en_transito'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'numero', g.numero, 'remision_numero', g.remision_numero, 'estado', g.estado,
        'fecha_inicio', g.fecha_inicio, 'created_at', g.created_at, 'motivo_codigo', g.motivo_codigo,
        'origen', jsonb_build_object('id', od.id, 'nombre', od.nombre, 'sucursal', os.nombre),
        'destino', jsonb_build_object('id', dd.id, 'nombre', dd.nombre, 'sucursal', ds.nombre, 'sucursal_id', ds.id),
        'total_items', g.total_items, 'total_unidades', g.total_unidades, 'valor_costo', g.valor_costo,
        'diferencia_unidades', g.diferencia_unidades, 'diferencia_valor', g.diferencia_valor,
        'usuario_nombre', g.usuario_nombre, 'recibido_at', g.recibido_at, 'recibido_por_nombre', g.recibido_por_nombre,
        'anulado_at', g.anulado_at
      ) order by g.created_at desc, g.id desc)
      from pag g
      join depositos od on od.id = g.deposito_origen_id join sucursales os on os.id = od.sucursal_id
      join depositos dd on dd.id = g.deposito_destino_id join sucursales ds on ds.id = dd.sucursal_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- Detalle de un traslado (pantalla y nota de remisión).
create or replace function :"schema".traslado_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  select to_jsonb(t) || jsonb_build_object(
    'origen', jsonb_build_object('id', od.id, 'nombre', od.nombre, 'sucursal_id', os.id, 'sucursal', os.nombre,
                                 'direccion', os.direccion, 'ciudad', os.ciudad, 'telefono', os.telefono,
                                 'establecimiento', os.establecimiento, 'punto_expedicion', os.punto_expedicion),
    'destino', jsonb_build_object('id', dd.id, 'nombre', dd.nombre, 'sucursal_id', ds.id, 'sucursal', ds.nombre,
                                  'direccion', ds.direccion, 'ciudad', ds.ciudad, 'telefono', ds.telefono),
    'empresa', (select e.nombre from empresas e where e.id = t.empresa_id),
    'puede_recibir', t.estado = 'en_transito' and (s.s_rol = 'ADMIN' or s.s_sucursal = ds.id),
    'puede_anular', t.estado = 'en_transito' and s.s_rol = 'ADMIN',
    'items', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'lotes', coalesce((select jsonb_agg(to_jsonb(l) order by l.vencimiento nulls last, l.id)
                             from traslados_lotes l where l.item_id = i.id), '[]'::jsonb)) order by i.orden)
        from traslados_items i where i.traslado_id = t.id), '[]'::jsonb))
    into r
    from traslados t
    join depositos od on od.id = t.deposito_origen_id join sucursales os on os.id = od.sucursal_id
    join depositos dd on dd.id = t.deposito_destino_id join sucursales ds on ds.id = dd.sucursal_id
   where t.id = p_id and t.empresa_id = s.s_empresa;
  if r is null then raise exception 'Traslado no encontrado'; end if;
  return r;
end;
$fn$;

-- =============================================================================
-- 9. AJUSTES (AJ-) y PÉRDIDAS (PE-) de inventario
-- =============================================================================

-- Aplica un ajuste/pérdida PENDIENTE (interno). Cada ítem:
--   conteo: diferencia = contado − stock del depósito en ESTE momento
--   diferencia: la cargada (pérdida: siempre −cantidad)
--   + entra (con lote si el producto lo controla: vencimiento obligatorio salvo
--     p_permitir_sin_lote, que usan las importaciones) · − sale (lote puntual o FEFO,
--     incluidos los vencidos). Valoriza al costo (de los lotes si salió de lotes).
create or replace function :"schema".inv_aplicar_ajuste(
  p_id uuid, p_usuario uuid, p_usuario_nombre text, p_permitir_sin_lote boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  a record;
  ai record;
  prod record;
  l record;
  v_sis numeric;
  v_dif numeric;
  v_cu numeric;
  v_valor numeric;
  v_lote uuid;
  v_cons jsonb;
  v_origen text;
  v_ref text;
  v_sale numeric;
  v_ent numeric := 0;
  v_sal numeric := 0;
  v_vent numeric := 0;
  v_vsal numeric := 0;
begin
  select * into a from ajustes_inventario where id = p_id for update;
  if not found then raise exception 'Documento no encontrado'; end if;
  if a.estado <> 'pendiente' then raise exception 'El documento % ya está %', a.numero, a.estado; end if;
  perform 1 from inv_deposito(a.empresa_id, a.deposito_id, true);
  v_origen := case when a.tipo = 'perdida' then 'perdida' when a.motivo = 'inventario_inicial' then 'inventario_inicial' else 'ajuste' end;

  for ai in select * from ajustes_items where ajuste_id = a.id order by orden loop
    select * into prod from productos where id = ai.producto_id and empresa_id = a.empresa_id for update;
    if not found then raise exception 'Producto no encontrado'; end if;
    if not prod.controla_stock then raise exception '"%" no controla stock', prod.nombre; end if;
    v_sis := coalesce((select cantidad from stock_depositos where producto_id = prod.id and deposito_id = a.deposito_id), 0);
    v_dif := case when ai.modo = 'conteo' then ai.cantidad_contada - v_sis else ai.diferencia end;
    v_ref := left(case a.tipo when 'perdida' then 'Pérdida ' else 'Ajuste ' end || a.numero
                  || coalesce(' · ' || nullif(btrim(a.detalle), ''), ''), 200);
    v_lote := ai.lote_id;
    v_cons := null;
    v_valor := 0;
    v_cu := coalesce(prod.costo_promedio, 0);

    if v_dif > 0 then
      v_cu := coalesce(nullif(ai.costo_unitario, 0), prod.costo_promedio, 0);
      perform inv_mover(a.empresa_id, prod.id, a.deposito_id, v_dif, v_cu, v_origen, a.tipo, a.id, a.numero, v_ref,
                        p_usuario, p_usuario_nombre);
      if prod.controla_lotes then
        if ai.vencimiento is not null then
          v_lote := lote_entrada(a.empresa_id, prod.id, a.deposito_id, ai.lote_numero, ai.vencimiento, v_dif, v_cu, v_origen,
                                 null, v_ref, a.tipo, a.id, ai.id);
        elsif ai.lote_id is not null then
          select x.id, x.deposito_id into l from lotes x where x.id = ai.lote_id and x.producto_id = prod.id for update;
          if not found or l.deposito_id <> a.deposito_id then raise exception '"%": el lote elegido no está en ese depósito', prod.nombre; end if;
          update lotes set cantidad = cantidad + v_dif where id = ai.lote_id;
          insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, motivo,
                                         documento_tipo, documento_id, documento_item_id)
            values (a.empresa_id, prod.id, ai.lote_id, a.deposito_id, 'ENTRADA', v_dif, v_origen, v_ref, a.tipo, a.id, ai.id);
        elsif p_permitir_sin_lote then
          perform lote_sin_lote(a.empresa_id, prod.id, a.deposito_id, 'ENTRADA', v_dif, v_origen, v_ref, a.tipo, a.id, ai.id);
        else
          raise exception '"%" controla lotes: cargá el vencimiento (y el lote) de lo que entra', prod.nombre;
        end if;
      end if;
      v_valor := round(v_dif * v_cu);
      v_ent := v_ent + v_dif;
      v_vent := v_vent + v_valor;
    elsif v_dif < 0 then
      v_sale := -v_dif;
      if prod.controla_lotes and ai.lote_id is not null and v_sis < v_sale then
        -- El lote dice más de lo que hay en el depósito (se vendió sin lote): el stock baja
        -- hasta 0 y la diferencia compensa el faltante sin lote (como dar_baja_lote).
        select x.cantidad into v_cu from lotes x where x.id = ai.lote_id;
        if v_cu is null or v_cu < v_sale then
          raise exception '"%": del lote quedan %', prod.nombre, trim_scale(coalesce(v_cu, 0));
        end if;
        v_cons := lotes_consumir(a.empresa_id, prod.id, a.deposito_id, v_sale, v_origen, null, null, v_ref, a.tipo, a.id, ai.id, ai.lote_id, true);
        perform lote_sin_lote(a.empresa_id, prod.id, a.deposito_id, 'ENTRADA', v_sale - v_sis, v_origen,
                              'Ya no estaba en stock (se vendió sin lote) · ' || v_ref, a.tipo, a.id, ai.id);
        v_sale := v_sis;
        v_dif := -v_sis;
        v_cons := jsonb_build_array(jsonb_set(v_cons->0, '{cantidad}', to_jsonb(v_sis)));
      elsif prod.controla_lotes then
        v_cons := lotes_consumir(a.empresa_id, prod.id, a.deposito_id, v_sale, v_origen, null, null, v_ref, a.tipo, a.id, ai.id, ai.lote_id, true);
      end if;
      if v_sale > 0 then
        perform inv_mover(a.empresa_id, prod.id, a.deposito_id, -v_sale, coalesce(prod.costo_promedio, 0), v_origen, a.tipo, a.id,
                          a.numero, v_ref, p_usuario, p_usuario_nombre);
      end if;
      v_cu := coalesce(prod.costo_promedio, 0);
      if v_cons is not null then
        select coalesce(round(sum((x->>'cantidad')::numeric * coalesce(nullif(nullif(x->>'costo', '')::numeric, 0), v_cu))), 0)
          into v_valor from jsonb_array_elements(v_cons) x;
        if v_sale > 0 then v_cu := round(v_valor / v_sale, 2); end if;
      else
        v_valor := round(v_sale * v_cu);
      end if;
      v_valor := -v_valor;
      v_sal := v_sal + v_sale;
      v_vsal := v_vsal - v_valor;
    end if;

    update ajustes_items set cantidad_sistema = v_sis, diferencia = v_dif, costo_unitario = v_cu, valor = v_valor,
           lote_id = v_lote, lotes = v_cons
     where id = ai.id;
  end loop;

  update ajustes_inventario set estado = 'aplicado', aplicado_por = p_usuario, aplicado_por_nombre = p_usuario_nombre,
         aplicado_at = now(), total_entrada = v_ent, total_salida = v_sal, valor_entrada = v_vent, valor_salida = v_vsal
   where id = a.id;
  return jsonb_build_object('id', a.id, 'numero', a.numero, 'estado', 'aplicado', 'total_entrada', v_ent,
                            'total_salida', v_sal, 'valor_entrada', v_vent, 'valor_salida', v_vsal);
end;
$fn$;

-- registrar_ajuste(p) — documento AJ- (ajuste, solo ADMIN) o PE- (pérdida: ADMIN la aplica
-- ya; otro rol la deja PENDIENTE de aprobación, y solo en depósitos de su sucursal).
--   { tipo: 'ajuste'|'perdida', deposito_id?, motivo, detalle?, idempotency_key?,
--     items: [{ producto_id, modo?: 'conteo'|'diferencia', cantidad,  -- conteo: stock real contado;
--               lote_id?, lote?, vencimiento?, costo_unitario?, nota? }] }  -- diferencia: +/−; pérdida: unidades que se pierden
create or replace function :"schema".registrar_ajuste(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  v_tipo text := coalesce(nullif(p->>'tipo', ''), 'ajuste');
  v_motivo text := nullif(btrim(coalesce(p->>'motivo', '')), '');
  v_detalle text := nullif(left(btrim(coalesce(p->>'detalle', '')), 500), '');
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_dep record;
  v_id uuid;
  v_numero text;
  it jsonb;
  prod record;
  v_modo text;
  v_cant numeric;
  v_orden integer := 0;
  v_conteo uuid[] := '{}';
  v_lote uuid;
  r jsonb;
begin
  if v_tipo not in ('ajuste', 'perdida') then raise exception 'Tipo de documento inválido'; end if;
  select * into s from inv_sesion(case when v_tipo = 'ajuste' then array['ADMIN'] else array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR'] end);
  v_empresa := s.s_empresa;
  if v_tipo = 'ajuste' and v_motivo not in ('conteo_fisico', 'inventario_inicial', 'correccion', 'otro') then
    raise exception 'Elegí el motivo del ajuste';
  end if;
  if v_tipo = 'perdida' and v_motivo not in ('vencimiento', 'rotura', 'devolucion_cliente', 'devolucion_proveedor', 'faltante', 'consumo_interno', 'otro') then
    raise exception 'Elegí el motivo de la pérdida';
  end if;
  if v_motivo = 'otro' and v_detalle is null then raise exception 'Contá el motivo en el detalle'; end if;

  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('ajuste:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero, estado into v_rep from ajustes_inventario where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero', v_rep.numero, 'estado', v_rep.estado, 'repetido', true);
    end if;
  end if;

  select * into v_dep from inv_deposito(v_empresa,
    coalesce(nullif(p->>'deposito_id', '')::uuid, deposito_por_defecto(v_empresa, s.s_sucursal)), true);
  if s.s_rol <> 'ADMIN' and s.s_sucursal is not null and v_dep.suc_id <> s.s_sucursal then
    raise exception 'Solo podés cargar pérdidas de los depósitos de tu sucursal';
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'El documento no tiene productos';
  end if;
  if jsonb_array_length(p->'items') > 500 then raise exception 'Máximo 500 productos por documento'; end if;

  v_numero := case v_tipo when 'ajuste' then 'AJ-' else 'PE-' end
    || lpad(inv_numero(v_empresa, v_tipo, (select max(substring(x.numero from '[0-9]+$')::bigint) from ajustes_inventario x
                                             where x.empresa_id = v_empresa and x.tipo = v_tipo))::text, 6, '0');
  insert into ajustes_inventario (empresa_id, tipo, numero, deposito_id, motivo, detalle, estado, created_by, usuario_nombre, idempotency_key)
    values (v_empresa, v_tipo, v_numero, v_dep.dep_id, v_motivo, v_detalle, 'pendiente', s.s_usuario, s.s_nombre, v_idem)
    returning id into v_id;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = v_empresa;
    if not found then raise exception 'Producto % no encontrado', v_orden; end if;
    if not prod.controla_stock then raise exception '"%" no controla stock', prod.nombre; end if;
    v_modo := case when v_tipo = 'perdida' then 'diferencia' else coalesce(nullif(it->>'modo', ''), 'diferencia') end;
    if v_modo not in ('conteo', 'diferencia') then raise exception '"%": modo inválido', prod.nombre; end if;
    v_cant := nullif(it->>'cantidad', '')::numeric;
    if v_cant is null then raise exception '"%": falta la cantidad', prod.nombre; end if;
    if v_modo = 'conteo' then
      if v_cant < 0 then raise exception '"%": el conteo no puede ser negativo', prod.nombre; end if;
      if prod.id = any (v_conteo) then raise exception '"%" está dos veces en el conteo', prod.nombre; end if;
      v_conteo := v_conteo || prod.id;
    elsif v_tipo = 'perdida' and v_cant <= 0 then
      raise exception '"%": la cantidad perdida tiene que ser mayor a 0', prod.nombre;
    elsif v_tipo = 'ajuste' and v_cant = 0 then
      raise exception '"%": la diferencia no puede ser 0', prod.nombre;
    end if;
    v_lote := nullif(it->>'lote_id', '')::uuid;
    if v_lote is not null and not exists (select 1 from lotes x where x.id = v_lote and x.producto_id = prod.id and x.deposito_id = v_dep.dep_id) then
      raise exception '"%": el lote elegido no está en %', prod.nombre, v_dep.dep_nombre;
    end if;
    insert into ajustes_items (empresa_id, ajuste_id, orden, producto_id, producto_nombre, producto_sku, unidad_medida, modo,
                               cantidad_contada, diferencia, costo_unitario, lote_id, lote_numero, vencimiento, nota)
      values (v_empresa, v_id, v_orden, prod.id, prod.nombre, prod.sku, prod.unidad_medida, v_modo,
              case when v_modo = 'conteo' then v_cant end,
              case when v_modo = 'conteo' then 0 when v_tipo = 'perdida' then -v_cant else v_cant end,
              coalesce(nullif(it->>'costo_unitario', '')::numeric, prod.costo_promedio, 0), v_lote,
              case when prod.controla_lotes then nullif(upper(btrim(coalesce(it->>'lote', ''))), '') end,
              case when prod.controla_lotes then nullif(it->>'vencimiento', '')::date end,
              nullif(left(btrim(coalesce(it->>'nota', '')), 200), ''));
  end loop;

  if s.s_rol = 'ADMIN' then
    r := inv_aplicar_ajuste(v_id, s.s_usuario, s.s_nombre, false);
    return r;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'estado', 'pendiente');
end;
$fn$;

create or replace function :"schema".aprobar_ajuste(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if not exists (select 1 from ajustes_inventario where id = p_id and empresa_id = s.s_empresa) then
    raise exception 'Documento no encontrado';
  end if;
  return inv_aplicar_ajuste(p_id, s.s_usuario, s.s_nombre, false);
end;
$fn$;

create or replace function :"schema".rechazar_ajuste(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí por qué se rechaza'; end if;
  select * into a from ajustes_inventario where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Documento no encontrado'; end if;
  if a.estado <> 'pendiente' then raise exception 'El documento % ya está %', a.numero, a.estado; end if;
  update ajustes_inventario set estado = 'rechazado', rechazado_por_nombre = s.s_nombre, rechazado_at = now(),
         rechazado_motivo = left(btrim(p_motivo), 500)
   where id = a.id;
  return jsonb_build_object('id', a.id, 'numero', a.numero, 'estado', 'rechazado');
end;
$fn$;

-- anular_ajuste(id, motivo) — ADMIN. Revierte lo aplicado (lo que entró sale del mismo
-- lote; lo que salió vuelve a sus lotes). Si ya se vendió o trasladó lo que entró, no se puede.
create or replace function :"schema".anular_ajuste(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a record;
  ai record;
  v_ref text;
  v_origen text;
  v_orig_mov text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into a from ajustes_inventario where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Documento no encontrado'; end if;
  if a.estado <> 'aplicado' then raise exception 'Solo se anula un documento aplicado (este está %)', a.estado; end if;
  if a.motivo = 'apertura' then raise exception 'El saldo de apertura no se anula'; end if;
  v_origen := case a.tipo when 'perdida' then 'anulacion_perdida' else 'anulacion_ajuste' end;
  v_orig_mov := case when a.tipo = 'perdida' then 'perdida' when a.motivo = 'inventario_inicial' then 'inventario_inicial' else 'ajuste' end;
  v_ref := left('Anulación ' || a.numero || ': ' || btrim(p_motivo), 200);
  for ai in select * from ajustes_items where ajuste_id = a.id and diferencia <> 0 order by orden desc loop
    perform inv_mover(a.empresa_id, ai.producto_id, a.deposito_id, -ai.diferencia, ai.costo_unitario, v_origen, a.tipo, a.id,
                      a.numero, v_ref, s.s_usuario, s.s_nombre);
    perform lotes_revertir(a.empresa_id, null, a.id, ai.id, case when ai.diferencia > 0 then 'ENTRADA' else 'SALIDA' end,
                           array[v_orig_mov], v_origen, v_ref);
  end loop;
  -- Compensaciones "sin lote" de una baja de lote ya vendido: también se revierten.
  perform lotes_revertir(a.empresa_id, null, a.id, null, 'ENTRADA', array[v_orig_mov], v_origen, v_ref);
  update ajustes_inventario set estado = 'anulado', anulado_por = s.s_usuario, anulado_por_nombre = s.s_nombre,
         anulado_at = now(), anulado_motivo = left(btrim(p_motivo), 500)
   where id = a.id;
  return jsonb_build_object('id', a.id, 'numero', a.numero, 'estado', 'anulado');
end;
$fn$;

-- Lista de ajustes y pérdidas (paginada).
create or replace function :"schema".listar_ajustes(
  p_tipo text default null, p_estado text default null, p_deposito uuid default null, p_q text default null,
  p_desde text default null, p_hasta text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(norm(coalesce(p_q, ''))), '');
  v_desde timestamptz := case when p_desde ~ '^\d{4}-\d{2}-\d{2}$' then (p_desde || 'T00:00:00-03:00')::timestamptz end;
  v_hasta timestamptz := case when p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then (p_hasta || 'T23:59:59.999-03:00')::timestamptz end;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  with f as (
    select a.* from ajustes_inventario a
     where a.empresa_id = v_emp
       and (coalesce(p_tipo, '') = '' or a.tipo = p_tipo)
       and (coalesce(p_estado, '') = '' or a.estado = p_estado)
       and (p_deposito is null or a.deposito_id = p_deposito)
       and (v_desde is null or a.created_at >= v_desde)
       and (v_hasta is null or a.created_at <= v_hasta)
       and (v_q is null
            or norm(concat_ws(' ', a.numero, a.detalle, a.usuario_nombre)) like '%' || v_q || '%'
            or exists (select 1 from ajustes_items i where i.ajuste_id = a.id
                        and (norm(i.producto_nombre) like '%' || v_q || '%' or norm(i.producto_sku) like '%' || v_q || '%')))
  ), pag as (
    select * from f order by created_at desc, id desc limit v_lim offset v_off
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'pendientes', (select count(*) from ajustes_inventario a where a.empresa_id = v_emp and a.estado = 'pendiente'),
    'totales', (select jsonb_build_object(
        'perdidas_valor', coalesce(sum(valor_salida) filter (where tipo = 'perdida' and estado = 'aplicado'), 0),
        'perdidas_unidades', coalesce(sum(total_salida) filter (where tipo = 'perdida' and estado = 'aplicado'), 0),
        'ajustes_entrada_valor', coalesce(sum(valor_entrada) filter (where tipo = 'ajuste' and estado = 'aplicado'), 0),
        'ajustes_salida_valor', coalesce(sum(valor_salida) filter (where tipo = 'ajuste' and estado = 'aplicado'), 0)) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'tipo', g.tipo, 'numero', g.numero, 'estado', g.estado, 'motivo', g.motivo, 'detalle', g.detalle,
        'deposito', jsonb_build_object('id', dd.id, 'nombre', dd.nombre, 'sucursal', ds.nombre),
        'items', (select count(*) from ajustes_items i where i.ajuste_id = g.id),
        'total_entrada', g.total_entrada, 'total_salida', g.total_salida, 'valor_entrada', g.valor_entrada,
        'valor_salida', g.valor_salida, 'usuario_nombre', g.usuario_nombre, 'created_at', g.created_at,
        'aplicado_por_nombre', g.aplicado_por_nombre, 'aplicado_at', g.aplicado_at
      ) order by g.created_at desc, g.id desc)
      from pag g join depositos dd on dd.id = g.deposito_id join sucursales ds on ds.id = dd.sucursal_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

create or replace function :"schema".ajuste_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  select to_jsonb(a) || jsonb_build_object(
    'deposito', jsonb_build_object('id', d.id, 'nombre', d.nombre, 'sucursal', su.nombre),
    'es_admin', s.s_rol = 'ADMIN',
    'items', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('lote_actual', l.numero) order by i.orden)
                         from ajustes_items i left join lotes l on l.id = i.lote_id where i.ajuste_id = a.id), '[]'::jsonb))
    into r
    from ajustes_inventario a join depositos d on d.id = a.deposito_id join sucursales su on su.id = d.sucursal_id
   where a.id = p_id and a.empresa_id = s.s_empresa;
  if r is null then raise exception 'Documento no encontrado'; end if;
  return r;
end;
$fn$;

-- dar_baja_lote (ficha del producto / Vencimientos): ahora es una PÉRDIDA documentada
-- (PE-) del lote puntual. p_cantidad NULL = todo el lote. Misma firma y salida que antes
-- + numero/estado del documento.
create or replace function :"schema".dar_baja_lote(p_lote_id uuid, p_cantidad numeric, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  l record;
  v_cant numeric;
  v_motivo text;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la baja'; end if;
  select * into l from lotes where id = p_lote_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Lote no encontrado'; end if;
  v_cant := coalesce(p_cantidad, l.cantidad);
  if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
  if v_cant > l.cantidad then
    raise exception 'Del lote % quedan %: no se pueden dar de baja %', l.numero, trim_scale(l.cantidad), trim_scale(v_cant);
  end if;
  v_motivo := case when p_motivo ~* '^vencid' then 'vencimiento'
                   when p_motivo ~* '^(rot|da[nñ])' then 'rotura'
                   when p_motivo ~* '^devuelto al proveedor' then 'devolucion_proveedor'
                   else 'otro' end;
  r := registrar_ajuste(jsonb_build_object(
         'tipo', 'perdida', 'deposito_id', l.deposito_id, 'motivo', v_motivo,
         'detalle', left('Lote ' || l.numero || ' (vence ' || to_char(l.vencimiento, 'DD/MM/YYYY') || '): ' || btrim(p_motivo), 500),
         'items', jsonb_build_array(jsonb_build_object('producto_id', l.producto_id, 'cantidad', v_cant, 'lote_id', l.id))));
  return jsonb_build_object('lote_id', l.id, 'numero', l.numero, 'cantidad', v_cant,
                            'quedan', (select cantidad from lotes where id = l.id),
                            'documento', r->>'numero', 'documento_id', r->>'id', 'estado', r->>'estado');
end;
$fn$;

-- El "Nuevo movimiento" manual ya no existe: todo cambio de stock es un documento.
drop function if exists :"schema".registrar_movimiento_lotes(uuid, text, numeric, numeric, text, text, text, text, uuid, text, date);
drop function if exists :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text, text, text, uuid);
drop function if exists :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text);
drop function if exists :"schema".lotes_saldo_sin_lote(uuid);

-- =============================================================================
-- 10. Importación de productos (Excel e importación inicial). Los datos del producto se
--     actualizan como antes; el STOCK de cada fila es el stock real en el depósito elegido
--     (p_deposito, por defecto el principal de la sucursal del usuario) y la diferencia
--     entra en UN documento AJ- (motivo importación / inventario inicial). p_documento:
--     seguir agregando al mismo documento (importaciones en tandas). Stock vacío = no se toca.
--     Productos con lotes: lo que entra queda "sin lote" (no trae vencimiento).
-- =============================================================================
drop function if exists :"schema".aplicar_importacion_productos(jsonb, text, boolean, text, text);
create or replace function :"schema".aplicar_importacion_productos(
  p_filas jsonb,
  p_modo text,
  p_crear_categorias boolean,
  p_origen text,
  p_referencia text,
  p_deposito uuid default null,
  p_documento uuid default null
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  v_dep record;
  v_doc uuid := p_documento;
  v_doc_numero text;
  v_doc_motivo text := case when p_modo = 'inicial' then 'inventario_inicial' else 'importacion' end;
  v_kardex_origen text := case when p_modo = 'inicial' then 'inventario_inicial' else 'ajuste' end;
  v_item_orden integer := 0;
  f jsonb;
  v_cat_nombre text;
  v_cat_id uuid;
  v_id uuid;
  v_prod record;
  v_sis numeric;
  v_stock numeric;
  v_delta numeric;
  v_costo numeric;
  v_item uuid;
  v_creados int := 0;
  v_actualizados int := 0;
  v_errores int := 0;
  v_mensajes text[] := '{}';
  v_cats_creadas int := 0;
  v_movs int := 0;
  v_ent numeric := 0;
  v_sal numeric := 0;
  v_vent numeric := 0;
  v_vsal numeric := 0;
  v_cats jsonb := '{}'::jsonb;
  v_ref text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;
  if p_modo not in ('excel', 'inicial') then raise exception 'Modo inválido'; end if;
  select * into v_dep from inv_deposito(v_empresa, coalesce(p_deposito, deposito_por_defecto(v_empresa, s.s_sucursal)), true);

  -- Documento de ajuste de la importación (el mismo para todas las tandas).
  if v_doc is not null then
    select numero into v_doc_numero from ajustes_inventario
     where id = v_doc and empresa_id = v_empresa and tipo = 'ajuste' and motivo = v_doc_motivo
       and deposito_id = v_dep.dep_id and estado = 'aplicado';
    if not found then raise exception 'Documento de importación inválido'; end if;
    select coalesce(max(orden), 0) into v_item_orden from ajustes_items where ajuste_id = v_doc;
  elsif exists (select 1 from jsonb_array_elements(p_filas) x where nullif(x->>'stock', '') is not null) then
    v_doc_numero := 'AJ-' || lpad(inv_numero(v_empresa, 'ajuste', (select max(substring(x.numero from '[0-9]+$')::bigint)
                      from ajustes_inventario x where x.empresa_id = v_empresa and x.tipo = 'ajuste'))::text, 6, '0');
    insert into ajustes_inventario (empresa_id, tipo, numero, deposito_id, motivo, detalle, estado, created_by, usuario_nombre,
                                    aplicado_por, aplicado_por_nombre, aplicado_at)
      values (v_empresa, 'ajuste', v_doc_numero, v_dep.dep_id, v_doc_motivo, nullif(left(btrim(coalesce(p_referencia, '')), 500), ''),
              'aplicado', s.s_usuario, s.s_nombre, s.s_usuario, s.s_nombre, now())
      returning id into v_doc;
  end if;
  v_ref := left(case when p_modo = 'inicial' then 'Inventario inicial ' else 'Importación ' end || coalesce(v_doc_numero, ''), 200);

  select coalesce(jsonb_object_agg(upper(btrim(c.nombre)), c.id), '{}'::jsonb) into v_cats
    from categorias_productos c where c.empresa_id = v_empresa;
  if p_crear_categorias then
    for v_cat_nombre in
      select distinct upper(btrim(x->>'categoria')) from jsonb_array_elements(p_filas) x
       where coalesce(btrim(x->>'categoria'), '') <> ''
    loop
      if not v_cats ? v_cat_nombre then
        insert into categorias_productos (empresa_id, nombre, activo)
          values (v_empresa, v_cat_nombre, true) returning id into v_cat_id;
        v_cats := v_cats || jsonb_build_object(v_cat_nombre, v_cat_id);
        v_cats_creadas := v_cats_creadas + 1;
      end if;
    end loop;
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    begin
      v_cat_nombre := nullif(upper(btrim(coalesce(f->>'categoria', ''))), '');
      v_cat_id := case when v_cat_nombre is null then null else (v_cats->>v_cat_nombre)::uuid end;
      v_stock := nullif(f->>'stock', '')::numeric;
      v_costo := nullif(f->>'costo', '')::numeric;
      if v_stock is not null and v_stock < 0 then raise exception 'El stock no puede ser negativo'; end if;

      if nullif(f->>'id', '') is not null then
        perform 1 from productos where id = (f->>'id')::uuid and empresa_id = v_empresa for update;
        if not found then raise exception 'El producto ya no existe'; end if;
        if p_modo = 'excel' then
          update productos set
            nombre = f->>'nombre',
            sku = coalesce(nullif(f->>'sku', ''), sku),
            codigo_barras = nullif(f->>'codigo_barras', ''),
            categoria_principal_id = v_cat_id,
            unidad_medida = coalesce(nullif(f->>'unidad', ''), 'Unidad'),
            costo_promedio = coalesce(v_costo, 0),
            precio_venta = coalesce(nullif(f->>'precio', '')::numeric, 0),
            stock_minimo = coalesce(nullif(f->>'stock_minimo', '')::numeric, 0),
            tipo_iva = coalesce(nullif(f->>'tipo_iva', ''), tipo_iva),
            activo = coalesce((f->>'activo')::boolean, true),
            updated_at = now()
          where id = (f->>'id')::uuid;
        else
          update productos set
            nombre = f->>'nombre',
            sku = coalesce(nullif(f->>'sku', ''), sku),
            codigo_barras = coalesce(nullif(f->>'codigo_barras', ''), codigo_barras),
            codigo_fabrica = coalesce(nullif(f->>'codigo_fabrica', ''), codigo_fabrica),
            categoria_principal_id = coalesce(v_cat_id, categoria_principal_id),
            unidad_medida = coalesce(nullif(f->>'unidad', ''), unidad_medida),
            costo_promedio = coalesce(v_costo, costo_promedio),
            costo_mayorista = coalesce(nullif(f->>'costo_mayorista', '')::numeric, costo_mayorista),
            precio_venta = coalesce(nullif(f->>'precio', '')::numeric, precio_venta),
            tipo_iva = coalesce(nullif(f->>'tipo_iva', ''), tipo_iva),
            updated_at = now()
          where id = (f->>'id')::uuid;
        end if;
        v_id := (f->>'id')::uuid;
        v_actualizados := v_actualizados + 1;
      else
        insert into productos (
          empresa_id, nombre, sku, codigo_barras, codigo_fabrica, categoria_principal_id, unidad_medida,
          costo_promedio, costo_mayorista, precio_venta, stock_minimo, tipo_iva, activo, es_vendible, controla_stock
        ) values (
          v_empresa, f->>'nombre', f->>'sku', nullif(f->>'codigo_barras', ''), nullif(f->>'codigo_fabrica', ''),
          v_cat_id, coalesce(nullif(f->>'unidad', ''), 'Unidad'),
          coalesce(v_costo, 0), nullif(f->>'costo_mayorista', '')::numeric,
          coalesce(nullif(f->>'precio', '')::numeric, 0),
          coalesce(nullif(f->>'stock_minimo', '')::numeric, 0),
          coalesce(nullif(f->>'tipo_iva', ''), '10%'),
          coalesce((f->>'activo')::boolean, true), true, true
        ) returning id into v_id;
        v_creados := v_creados + 1;
      end if;

      -- Stock real en el depósito → la diferencia va al documento de la importación.
      if v_stock is not null then
        select id, nombre, sku, unidad_medida, controla_stock, controla_lotes, costo_promedio into v_prod
          from productos where id = v_id;
        if v_prod.controla_stock then
          v_sis := coalesce((select cantidad from stock_depositos where producto_id = v_id and deposito_id = v_dep.dep_id), 0);
          v_delta := v_stock - v_sis;
          if v_delta <> 0 then
            v_item_orden := v_item_orden + 1;
            insert into ajustes_items (empresa_id, ajuste_id, orden, producto_id, producto_nombre, producto_sku, unidad_medida, modo,
                                       cantidad_contada, cantidad_sistema, diferencia, costo_unitario, valor)
              values (v_empresa, v_doc, v_item_orden, v_id, v_prod.nombre, v_prod.sku, v_prod.unidad_medida, 'conteo',
                      v_stock, v_sis, v_delta, coalesce(v_prod.costo_promedio, 0), round(v_delta * coalesce(v_prod.costo_promedio, 0)))
              returning id into v_item;
            perform inv_mover(v_empresa, v_id, v_dep.dep_id, v_delta, coalesce(v_prod.costo_promedio, 0), v_kardex_origen,
                              'ajuste', v_doc, v_doc_numero, v_ref, s.s_usuario, s.s_nombre);
            if v_prod.controla_lotes then
              if v_delta > 0 then
                perform lote_sin_lote(v_empresa, v_id, v_dep.dep_id, 'ENTRADA', v_delta, v_kardex_origen, v_ref, 'ajuste', v_doc, v_item);
              else
                update ajustes_items set lotes = lotes_consumir(v_empresa, v_id, v_dep.dep_id, -v_delta, v_kardex_origen, null, null,
                                                                 v_ref, 'ajuste', v_doc, v_item, null, true)
                 where id = v_item;
              end if;
            end if;
            v_movs := v_movs + 1;
            if v_delta > 0 then
              v_ent := v_ent + v_delta; v_vent := v_vent + round(v_delta * coalesce(v_prod.costo_promedio, 0));
            else
              v_sal := v_sal - v_delta; v_vsal := v_vsal - round(v_delta * coalesce(v_prod.costo_promedio, 0));
            end if;
          end if;
        end if;
      end if;
    exception when others then
      v_errores := v_errores + 1;
      if array_length(v_mensajes, 1) is null or array_length(v_mensajes, 1) < 50 then
        v_mensajes := v_mensajes || (coalesce(f->>'fila', '') ||
          case when f ? 'fila' then ': ' else '' end ||
          coalesce(f->>'nombre', '?') || ' — ' ||
          case when sqlstate = '23505' then 'SKU o código duplicado' else left(sqlerrm, 150) end);
      end if;
    end;
  end loop;

  if v_doc is not null then
    if not exists (select 1 from ajustes_items where ajuste_id = v_doc) then
      delete from ajustes_inventario where id = v_doc;
      v_doc := null; v_doc_numero := null;
    else
      update ajustes_inventario a set
        total_entrada = coalesce((select sum(diferencia) from ajustes_items where ajuste_id = a.id and diferencia > 0), 0),
        total_salida = coalesce((select -sum(diferencia) from ajustes_items where ajuste_id = a.id and diferencia < 0), 0),
        valor_entrada = coalesce((select sum(valor) from ajustes_items where ajuste_id = a.id and diferencia > 0), 0),
        valor_salida = coalesce((select -sum(valor) from ajustes_items where ajuste_id = a.id and diferencia < 0), 0)
       where a.id = v_doc;
    end if;
  end if;

  return jsonb_build_object(
    'creados', v_creados, 'actualizados', v_actualizados, 'errores', v_errores,
    'mensajes_error', to_jsonb(v_mensajes), 'categorias_creadas', v_cats_creadas,
    'movimientos_generados', v_movs, 'unidades_entrada', v_ent, 'unidades_salida', v_sal,
    'ajuste_id', v_doc, 'ajuste_numero', v_doc_numero, 'deposito', v_dep.dep_nombre
  );
end;
$fn$;

-- =============================================================================
-- 11. Al ACTIVAR lotes en un producto: lo que ya tenía en cada depósito queda "sin lote"
--     en ese depósito (la invariante se cumple desde el primer día).
-- =============================================================================
create or replace function :"schema".tg_productos_lotes_activar()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_dif numeric;
begin
  if not new.controla_lotes or (tg_op = 'UPDATE' and old.controla_lotes) then return null; end if;
  for r in select sd.deposito_id, sd.cantidad from stock_depositos sd where sd.producto_id = new.id loop
    v_dif := r.cantidad
           - coalesce((select sum(l.cantidad) from lotes l where l.producto_id = new.id and l.deposito_id = r.deposito_id), 0)
           - coalesce((select sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end)
                         from lotes_movimientos m where m.producto_id = new.id and m.deposito_id = r.deposito_id and m.lote_id is null), 0);
    if v_dif <> 0 then
      insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, motivo)
        values (new.empresa_id, new.id, null, r.deposito_id, case when v_dif > 0 then 'ENTRADA' else 'SALIDA' end, abs(v_dif),
                'sin_lote_inicial', 'Stock que tenía al activar lotes');
    end if;
  end loop;
  return null;
end;
$fn$;

-- =============================================================================
-- 12. Consultas
-- =============================================================================

-- Stock de un producto por depósito (ficha): cada depósito activo (o con stock) con sus
-- lotes, lo que está sin lote y lo que está en tránsito.
create or replace function :"schema".stock_producto(p_producto_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select jsonb_build_object(
    'producto_id', p.id, 'stock_total', p.stock_actual, 'controla_lotes', p.controla_lotes,
    'controla_stock', p.controla_stock, 'unidad_medida', p.unidad_medida,
    'hoy', (now() at time zone 'America/Asuncion')::date,
    'en_transito', coalesce((select sum(i.cantidad) from traslados_items i join traslados t on t.id = i.traslado_id
                              where i.producto_id = p.id and t.estado = 'en_transito'), 0),
    'depositos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'deposito_id', d.id, 'deposito', d.nombre, 'sucursal_id', su.id, 'sucursal', su.nombre,
          'es_principal', d.es_principal and su.es_principal, 'activo', d.activo and su.activa,
          'cantidad', coalesce(sd.cantidad, 0),
          'en_lotes', coalesce((select sum(l.cantidad) from lotes l where l.producto_id = p.id and l.deposito_id = d.id and l.cantidad > 0), 0),
          'lotes', coalesce((select jsonb_agg(jsonb_build_object(
                'id', l.id, 'numero', l.numero, 'vencimiento', l.vencimiento, 'cantidad', l.cantidad,
                'cantidad_inicial', l.cantidad_inicial, 'costo_unitario', l.costo_unitario, 'origen', l.origen,
                'created_at', l.created_at, 'compra_numero', c.numero_control, 'proveedor_nombre', c.proveedor_nombre)
                order by l.vencimiento, l.created_at)
              from lotes l left join compras c on c.id = l.compra_id
             where l.producto_id = p.id and l.deposito_id = d.id and l.cantidad > 0), '[]'::jsonb)
        ) order by su.es_principal desc, su.nombre, d.es_principal desc, d.nombre)
        from depositos d join sucursales su on su.id = d.sucursal_id
        left join stock_depositos sd on sd.deposito_id = d.id and sd.producto_id = p.id
       where d.empresa_id = v_emp and ((d.activo and su.activa) or coalesce(sd.cantidad, 0) <> 0)), '[]'::jsonb)
  ) into r
  from productos p where p.id = p_producto_id and p.empresa_id = v_emp;
  if r is null then raise exception 'Producto no encontrado'; end if;
  -- sin_lote por depósito = cantidad − Σ lotes
  select r || jsonb_build_object('depositos', coalesce(jsonb_agg(x.v || jsonb_build_object(
            'sin_lote', (x.v->>'cantidad')::numeric - (x.v->>'en_lotes')::numeric) order by x.n), '[]'::jsonb))
    into r from jsonb_array_elements(r->'depositos') with ordinality x(v, n);
  return r;
end;
$fn$;

-- Lotes de un producto (todas sus unidades en lotes, con el depósito de cada uno).
create or replace function :"schema".lotes_producto(p_producto_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  with p as (
    select id, stock_actual, controla_lotes, costo_promedio from productos
     where id = p_producto_id and empresa_id = empresa_actual()
  ),
  l as (
    select l.id, l.numero, l.vencimiento, l.cantidad, l.cantidad_inicial, l.costo_unitario, l.origen, l.created_at,
           c.numero_control as compra_numero, c.proveedor_nombre, l.deposito_id, d.nombre as deposito_nombre
      from lotes l left join compras c on c.id = l.compra_id join depositos d on d.id = l.deposito_id
     where l.producto_id = p_producto_id and l.empresa_id = empresa_actual() and l.cantidad > 0
  )
  select jsonb_build_object(
    'controla_lotes', coalesce((select controla_lotes from p), false),
    'stock_actual', coalesce((select stock_actual from p), 0),
    'en_lotes', coalesce((select sum(cantidad) from l), 0),
    'sin_lote', coalesce((select stock_actual from p), 0) - coalesce((select sum(cantidad) from l), 0),
    'hoy', (now() at time zone 'America/Asuncion')::date,
    'lotes', coalesce((select jsonb_agg(to_jsonb(l) order by l.vencimiento, l.created_at) from l), '[]'::jsonb)
  )
$$;

-- Pantalla Vencimientos (+ p_deposito): lotes con unidades vencidos o que vencen pronto.
drop function if exists :"schema".reporte_vencimientos(integer, text, text);
create or replace function :"schema".reporte_vencimientos(
  p_dias integer default 30, p_q text default null, p_estado text default null, p_deposito uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_dias integer := greatest(0, least(coalesce(p_dias, 30), 3650));
  v_q text := nullif(btrim(norm(coalesce(p_q, ''))), '');
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  with base as materialized (
    select l.id, l.producto_id, p.nombre as producto, p.sku, p.unidad_medida, l.numero, l.vencimiento,
           (l.vencimiento - v_hoy) as dias, l.cantidad,
           case when l.costo_unitario > 0 then l.costo_unitario else coalesce(p.costo_promedio, 0) end as costo,
           case when l.vencimiento < v_hoy then 'vencido' else 'por_vencer' end as estado,
           l.deposito_id, d.nombre as deposito, su.nombre as sucursal
      from lotes l
      join productos p on p.id = l.producto_id and p.empresa_id = v_emp
      join depositos d on d.id = l.deposito_id
      join sucursales su on su.id = d.sucursal_id
     where l.empresa_id = v_emp and l.cantidad > 0 and l.vencimiento <= v_hoy + v_dias
       and (p_deposito is null or l.deposito_id = p_deposito)
  ),
  filtrado as (
    select * from base b
     where (p_estado is null or p_estado = '' or b.estado = p_estado)
       and (v_q is null or norm(b.producto) like '%' || v_q || '%' or norm(b.sku) like '%' || v_q || '%'
            or norm(b.numero) like '%' || v_q || '%')
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'dias', v_dias,
    'hay_productos_con_lotes', exists (select 1 from productos where empresa_id = v_emp and controla_lotes),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'lote_id', f.id, 'producto_id', f.producto_id, 'producto', f.producto, 'sku', f.sku, 'unidad_medida', f.unidad_medida,
        'numero', f.numero, 'vencimiento', f.vencimiento, 'dias', f.dias, 'cantidad', f.cantidad,
        'costo', f.costo, 'valor', round(f.cantidad * f.costo), 'estado', f.estado,
        'deposito_id', f.deposito_id, 'deposito', f.deposito, 'sucursal', f.sucursal
      ) order by f.vencimiento, f.producto, f.numero) from filtrado f), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'vencidos_unidades', coalesce(sum(cantidad) filter (where estado = 'vencido'), 0),
        'vencidos_valor', coalesce(round(sum(cantidad * costo) filter (where estado = 'vencido')), 0),
        'vencidos_lotes', count(*) filter (where estado = 'vencido'),
        'por_vencer_unidades', coalesce(sum(cantidad) filter (where estado = 'por_vencer'), 0),
        'por_vencer_valor', coalesce(round(sum(cantidad * costo) filter (where estado = 'por_vencer')), 0),
        'por_vencer_lotes', count(*) filter (where estado = 'por_vencer')
      ) from base)
  ) into r;
  return r;
end;
$fn$;

-- Caja: el stock que muestra cada producto es el del depósito del que va a salir la venta
-- (el principal de la sucursal del usuario); stock_total = toda la empresa.
create or replace function :"schema".productos_pos(p_solo_nombre boolean default false)
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
  v_dep := deposito_por_defecto(v_emp, (select u.sucursal_id from usuarios u where u.auth_user_id = auth.uid() and u.activo limit 1));
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

-- Kardex (+ depósito y documento). p_origen: un origen o varios separados por coma.
-- p_deposito / p_sucursal acotan. Con p_producto: "saldo" = stock del depósito (o total)
-- después de cada movimiento, calculado hacia atrás desde el stock actual.
drop function if exists :"schema".listar_movimientos(text, text, text, uuid, text, text, integer, integer, boolean);
create or replace function :"schema".listar_movimientos(
  p_q text default null, p_tipo text default null, p_origen text default null, p_producto uuid default null,
  p_desde text default null, p_hasta text default null, p_limit integer default 25, p_offset integer default 0,
  p_total boolean default true, p_deposito uuid default null, p_sucursal uuid default null)
returns json
language plpgsql stable security definer set search_path = :"schema", public, extensions as $fn$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 5000);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_w text;
  v_cond text;
  v_origenes text[];
  v_total bigint;
  v_rows json;
  v_saldo text := 'null::numeric';
begin
  if v_emp is null then return json_build_object('rows', '[]'::json, 'total', 0); end if;
  v_w := format('m.empresa_id = %L', v_emp);
  if p_tipo in ('ENTRADA', 'SALIDA') then v_w := v_w || format(' and m.tipo = %L', p_tipo); end if;
  select array_agg(x) into v_origenes
    from unnest(string_to_array(coalesce(p_origen, ''), ',')) x
   where x in ('inventario_inicial', 'ajuste_manual', 'venta', 'anulacion_venta', 'compra', 'anulacion_compra',
               'traslado_salida', 'traslado_entrada', 'anulacion_traslado', 'ajuste', 'perdida',
               'anulacion_ajuste', 'anulacion_perdida', 'apertura');
  if v_origenes is not null then v_w := v_w || format(' and m.origen = any (%L::text[])', v_origenes); end if;
  if p_producto is not null then v_w := v_w || format(' and m.producto_id = %L', p_producto); end if;
  if p_deposito is not null then
    v_w := v_w || format(' and m.deposito_id = %L', p_deposito);
  elsif p_sucursal is not null then
    v_w := v_w || format(' and m.deposito_id in (select d.id from depositos d where d.sucursal_id = %L and d.empresa_id = %L)', p_sucursal, v_emp);
  end if;
  if p_desde ~ '^\d{4}-\d{2}-\d{2}$' then v_w := v_w || format(' and m.fecha >= %L::timestamptz', p_desde || 'T00:00:00-03:00'); end if;
  if p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then v_w := v_w || format(' and m.fecha <= %L::timestamptz', p_hasta || 'T23:59:59.999-03:00'); end if;
  if nullif(btrim(coalesce(p_q, '')), '') is not null then
    select string_agg('(' || g.cond || ')', ' and ' order by g.o) into v_cond
      from (select x.o, string_agg(format('m.busqueda ilike %L', '%' || v.t || '%'), ' or ' order by v.n)
                    || format(' or m.documento_numero ilike %L', '%' || max(v.t) || '%') as cond
              from jsonb_array_elements(variantes_busqueda(left(p_q, 200))) with ordinality x(grupo, o)
              cross join lateral jsonb_array_elements_text(x.grupo) with ordinality v(t, n)
             where v.t ~ '^[a-z0-9]+$'
             group by x.o) g;
    if v_cond is not null then v_w := v_w || ' and ' || v_cond; end if;
  end if;

  -- Saldo corrido del producto (en el depósito si se filtró uno; si no, el total).
  if p_producto is not null then
    v_saldo := case when p_deposito is not null then
        format('coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = %L and sd.deposito_id = %L), 0)
                - coalesce((select sum(case when m2.tipo = ''ENTRADA'' then m2.cantidad else -m2.cantidad end)
                              from movimientos_inventario m2
                             where m2.producto_id = %L and m2.deposito_id = %L and (m2.fecha, m2.id) > (x.fecha, x.id)), 0)',
               p_producto, p_deposito, p_producto, p_deposito)
      else
        format('coalesce((select p.stock_actual from productos p where p.id = %L), 0)
                - coalesce((select sum(case when m2.tipo = ''ENTRADA'' then m2.cantidad else -m2.cantidad end)
                              from movimientos_inventario m2
                             where m2.producto_id = %L and m2.origen <> ''apertura'' and (m2.fecha, m2.id) > (x.fecha, x.id)), 0)',
               p_producto, p_producto)
      end;
  end if;

  if coalesce(p_total, true) then
    execute 'select count(*) from movimientos_inventario m where ' || v_w into v_total;
  end if;
  execute format(
    'select coalesce(json_agg(r), ''[]''::json) from (
       select x.id, x.producto_id, x.producto_nombre, x.producto_sku, x.tipo, x.cantidad, x.costo_unitario,
              x.origen, x.referencia, x.proveedor, x.numero_factura, x.usuario_nombre, x.fecha,
              x.deposito_id, d.nombre as deposito_nombre, su.nombre as sucursal_nombre,
              x.documento_tipo, x.documento_id, x.documento_numero,
              x.deposito_contraparte_id, dc.nombre as contraparte_nombre,
              case when x.origen = ''apertura'' then null else %s end as saldo
         from (select m.id, m.fecha from movimientos_inventario m where %s
                order by m.fecha desc, m.id desc limit %s offset %s) k
         join movimientos_inventario x on x.id = k.id
         left join depositos d on d.id = x.deposito_id
         left join sucursales su on su.id = d.sucursal_id
         left join depositos dc on dc.id = x.deposito_contraparte_id
        order by k.fecha desc, k.id desc) r', v_saldo, v_w, v_lim, v_off) into v_rows;
  return json_build_object('rows', v_rows, 'total', v_total);
end;
$fn$;

-- =============================================================================
-- 13. Invariantes
-- =============================================================================

-- Lotes por depósito: stock del depósito = Σ lotes + saldo sin lote; cada lote = Σ sus movimientos.
create or replace function :"schema".verificar_lotes(p_producto uuid default null)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  with pr as (
    select p.id, p.nombre, sd.deposito_id, coalesce(sd.cantidad, 0) as stock_actual,
           coalesce((select sum(l.cantidad) from lotes l where l.producto_id = p.id and l.deposito_id = sd.deposito_id), 0) as en_lotes,
           coalesce((select sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end)
                       from lotes_movimientos m where m.producto_id = p.id and m.deposito_id = sd.deposito_id and m.lote_id is null), 0) as sin_lote
      from productos p join stock_depositos sd on sd.producto_id = p.id
     where p.empresa_id = empresa_actual() and p.controla_lotes and p.controla_stock
       and (p_producto is null or p.id = p_producto)
  ),
  ld as (
    select l.id, l.numero, l.producto_id, l.deposito_id, l.cantidad,
           coalesce(sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end), 0) as segun_movimientos
      from lotes l left join lotes_movimientos m on m.lote_id = l.id
     where l.empresa_id = empresa_actual() and (p_producto is null or l.producto_id = p_producto)
     group by l.id
    having l.cantidad <> coalesce(sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end), 0)
  )
  select jsonb_build_object(
    'ok', not exists (select 1 from pr where stock_actual <> en_lotes + sin_lote) and not exists (select 1 from ld),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'producto_id', id, 'nombre', nombre, 'deposito_id', deposito_id, 'stock_actual', stock_actual, 'en_lotes', en_lotes,
        'sin_lote', sin_lote, 'diferencia', stock_actual - en_lotes - sin_lote,
        'ok', stock_actual = en_lotes + sin_lote) order by nombre) from pr), '[]'::jsonb),
    'lotes_descuadrados', coalesce((select jsonb_agg(to_jsonb(ld)) from ld), '[]'::jsonb)
  )
$$;

-- Todo el inventario de la empresa: (1) total = Σ depósitos; (2) por depósito, Σ kardex =
-- stock; (3) lotes (verificar_lotes); (4) traslados: lo enviado = recibido + diferencias
-- (+ en tránsito); (5) sin stock en depósitos inactivos.
create or replace function :"schema".verificar_inventario()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_total jsonb;
  v_kardex jsonb;
  v_lotes jsonb;
  v_tras jsonb;
  v_inact jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('producto', p.nombre, 'stock_actual', p.stock_actual, 'suma_depositos', x.s)), '[]'::jsonb)
    into v_total
    from productos p
    left join lateral (select coalesce(sum(sd.cantidad), 0) as s from stock_depositos sd where sd.producto_id = p.id) x on true
   where p.empresa_id = v_emp and p.stock_actual <> x.s;

  select coalesce(jsonb_agg(jsonb_build_object('producto', p.nombre, 'deposito', d.nombre, 'stock', k.stock, 'kardex', k.kardex)), '[]'::jsonb)
    into v_kardex
    from (
      select coalesce(sd.producto_id, m.producto_id) as producto_id, coalesce(sd.deposito_id, m.deposito_id) as deposito_id,
             coalesce(sd.cantidad, 0) as stock, coalesce(m.kardex, 0) as kardex
        from (select * from stock_depositos where empresa_id = v_emp) sd
        full join (select producto_id, deposito_id, sum(case when tipo = 'ENTRADA' then cantidad else -cantidad end) as kardex
                     from movimientos_inventario where empresa_id = v_emp group by 1, 2) m
          on m.producto_id = sd.producto_id and m.deposito_id = sd.deposito_id
    ) k
    join productos p on p.id = k.producto_id join depositos d on d.id = k.deposito_id
   where k.stock <> k.kardex and p.controla_stock;

  v_lotes := verificar_lotes(null);

  select coalesce(jsonb_agg(jsonb_build_object('traslado', t.numero, 'producto', i.producto_nombre, 'enviado', i.cantidad,
                                               'recibido', i.cantidad_recibida, 'estado', t.estado)), '[]'::jsonb)
    into v_tras
    from traslados t join traslados_items i on i.traslado_id = t.id
   where t.empresa_id = v_emp and (
        (t.estado in ('recibido', 'recibido_con_diferencias') and i.cantidad_recibida is null)
     or (t.estado = 'recibido' and i.cantidad_recibida <> i.cantidad)
     or (t.estado = 'en_transito' and i.cantidad_recibida is not null)
     or (select coalesce(sum(case when m.tipo = 'SALIDA' then m.cantidad else -m.cantidad end), 0)
           from movimientos_inventario m where m.documento_id = t.id and m.producto_id = i.producto_id
            and m.origen in ('traslado_salida', 'anulacion_traslado'))
        <> case when t.estado = 'anulado' then 0 else i.cantidad end
     or (select coalesce(sum(m.cantidad), 0) from movimientos_inventario m
          where m.documento_id = t.id and m.producto_id = i.producto_id and m.origen = 'traslado_entrada')
        <> coalesce(i.cantidad_recibida, 0));

  select coalesce(jsonb_agg(jsonb_build_object('deposito', d.nombre, 'producto', p.nombre, 'cantidad', sd.cantidad)), '[]'::jsonb)
    into v_inact
    from stock_depositos sd join depositos d on d.id = sd.deposito_id join sucursales su on su.id = d.sucursal_id
    join productos p on p.id = sd.producto_id
   where sd.empresa_id = v_emp and sd.cantidad > 0 and not (d.activo and su.activa);

  return jsonb_build_object(
    'ok', jsonb_array_length(v_total) = 0 and jsonb_array_length(v_kardex) = 0 and (v_lotes->>'ok')::boolean
          and jsonb_array_length(v_tras) = 0 and jsonb_array_length(v_inact) = 0,
    'total_vs_depositos', v_total, 'kardex_vs_stock', v_kardex, 'lotes', v_lotes,
    'traslados', v_tras, 'stock_en_inactivos', v_inact);
end;
$fn$;

-- =============================================================================
-- 14. Saldo de apertura: lo que el kardex anterior no explicaba (datos previos al kardex)
--     queda en UN documento AJ- por empresa (motivo 'apertura', no mueve stock). Desde acá
--     Σ kardex = stock por depósito. Solo una vez por empresa.
-- =============================================================================
do $ape$
declare
  e record;
  v_dep uuid;
  v_id uuid;
  v_num text;
  v_orden integer;
  r record;
begin
  for e in select id from empresas
            where id::text = any (string_to_array(coalesce(current_setting('erp.inv_apertura', true), ''), ',')) loop
    continue when exists (select 1 from ajustes_inventario a where a.empresa_id = e.id and a.motivo = 'apertura');
    v_id := null;
    v_orden := 0;
    for r in
      select sd.producto_id, sd.deposito_id, p.nombre, p.sku, p.unidad_medida, coalesce(p.costo_promedio, 0) as costo,
             sd.cantidad, sd.cantidad - coalesce(k.kardex, 0) as dif
        from stock_depositos sd
        join productos p on p.id = sd.producto_id
        left join lateral (select sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end) as kardex
                             from movimientos_inventario m where m.producto_id = sd.producto_id and m.deposito_id = sd.deposito_id) k on true
       where sd.empresa_id = e.id and sd.cantidad - coalesce(k.kardex, 0) <> 0
       union all
      select m.producto_id, m.deposito_id, p.nombre, p.sku, p.unidad_medida, coalesce(p.costo_promedio, 0), 0,
             -sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end)
        from movimientos_inventario m join productos p on p.id = m.producto_id
       where m.empresa_id = e.id
         and not exists (select 1 from stock_depositos sd where sd.producto_id = m.producto_id and sd.deposito_id = m.deposito_id)
       group by m.producto_id, m.deposito_id, p.nombre, p.sku, p.unidad_medida, p.costo_promedio
      having sum(case when m.tipo = 'ENTRADA' then m.cantidad else -m.cantidad end) <> 0
       order by 3
    loop
      if v_id is null then
        select d.id into v_dep from depositos d join sucursales s on s.id = d.sucursal_id
         where d.empresa_id = e.id order by s.es_principal desc, d.es_principal desc, d.created_at limit 1;
        v_num := 'AJ-' || lpad(inv_numero(e.id, 'ajuste', (select max(substring(x.numero from '[0-9]+$')::bigint)
                   from ajustes_inventario x where x.empresa_id = e.id and x.tipo = 'ajuste'))::text, 6, '0');
        insert into ajustes_inventario (empresa_id, tipo, numero, deposito_id, motivo, detalle, estado, usuario_nombre,
                                        aplicado_por_nombre, aplicado_at)
          values (e.id, 'ajuste', v_num, v_dep, 'apertura',
                  'Saldo de apertura al pasar a depósitos: stock que había antes del historial de movimientos',
                  'aplicado', 'Sistema', 'Sistema', now())
          returning id into v_id;
      end if;
      v_orden := v_orden + 1;
      insert into ajustes_items (empresa_id, ajuste_id, orden, producto_id, producto_nombre, producto_sku, unidad_medida, modo,
                                 cantidad_contada, cantidad_sistema, diferencia, costo_unitario, valor)
        values (e.id, v_id, v_orden, r.producto_id, r.nombre, r.sku, r.unidad_medida, 'diferencia',
                null, r.cantidad - r.dif, r.dif, r.costo, round(r.dif * r.costo));
      -- Fecha anterior a todo el historial: el saldo corrido del kardex arranca de acá.
      insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario,
                                          origen, referencia, usuario_nombre, deposito_id, documento_tipo, documento_id,
                                          documento_numero, fecha, created_at)
        values (e.id, r.producto_id, r.nombre, r.sku, case when r.dif > 0 then 'ENTRADA' else 'SALIDA' end, abs(r.dif), r.costo,
                'apertura', 'Saldo de apertura ' || v_num, 'Sistema', r.deposito_id, 'ajuste', v_id, v_num,
                coalesce((select min(m.fecha) from movimientos_inventario m where m.producto_id = r.producto_id), now()) - interval '1 second',
                now());
    end loop;
    if v_id is not null then
      update ajustes_inventario a set
        total_entrada = coalesce((select sum(diferencia) from ajustes_items where ajuste_id = a.id and diferencia > 0), 0),
        total_salida = coalesce((select -sum(diferencia) from ajustes_items where ajuste_id = a.id and diferencia < 0), 0),
        valor_entrada = coalesce((select sum(valor) from ajustes_items where ajuste_id = a.id and diferencia > 0), 0),
        valor_salida = coalesce((select -sum(valor) from ajustes_items where ajuste_id = a.id and diferencia < 0), 0)
       where a.id = v_id;
    end if;
  end loop;
end
$ape$;

-- =============================================================================
-- 15. Seguridad: RLS de solo lectura + permisos
-- =============================================================================
alter table :"schema".sucursales enable row level security;
alter table :"schema".sucursales force row level security;
alter table :"schema".depositos enable row level security;
alter table :"schema".depositos force row level security;
alter table :"schema".stock_depositos enable row level security;
alter table :"schema".stock_depositos force row level security;
alter table :"schema".traslados enable row level security;
alter table :"schema".traslados force row level security;
alter table :"schema".traslados_items enable row level security;
alter table :"schema".traslados_items force row level security;
alter table :"schema".traslados_lotes enable row level security;
alter table :"schema".traslados_lotes force row level security;
alter table :"schema".ajustes_inventario enable row level security;
alter table :"schema".ajustes_inventario force row level security;
alter table :"schema".ajustes_items enable row level security;
alter table :"schema".ajustes_items force row level security;

drop policy if exists sucursales_lectura on :"schema".sucursales;
create policy sucursales_lectura on :"schema".sucursales for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists depositos_lectura on :"schema".depositos;
create policy depositos_lectura on :"schema".depositos for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists stock_depositos_lectura on :"schema".stock_depositos;
create policy stock_depositos_lectura on :"schema".stock_depositos for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists traslados_lectura on :"schema".traslados;
create policy traslados_lectura on :"schema".traslados for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists traslados_items_lectura on :"schema".traslados_items;
create policy traslados_items_lectura on :"schema".traslados_items for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists traslados_lotes_lectura on :"schema".traslados_lotes;
create policy traslados_lotes_lectura on :"schema".traslados_lotes for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists ajustes_lectura on :"schema".ajustes_inventario;
create policy ajustes_lectura on :"schema".ajustes_inventario for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists ajustes_items_lectura on :"schema".ajustes_items;
create policy ajustes_items_lectura on :"schema".ajustes_items for select to authenticated using (empresa_id = :"schema".empresa_actual());

-- Kardex y lotes: de ALL a solo lectura (se escriben solo por las funciones de arriba).
drop policy if exists movinv_propios on :"schema".movimientos_inventario;
create policy movinv_propios on :"schema".movimientos_inventario for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists lotes_propios on :"schema".lotes;
create policy lotes_propios on :"schema".lotes for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists lotes_mov_propios on :"schema".lotes_movimientos;
create policy lotes_mov_propios on :"schema".lotes_movimientos for select to authenticated using (empresa_id = :"schema".empresa_actual());

revoke all on :"schema".sucursales, :"schema".depositos, :"schema".stock_depositos, :"schema".traslados,
  :"schema".traslados_items, :"schema".traslados_lotes, :"schema".ajustes_inventario, :"schema".ajustes_items,
  :"schema".movimientos_inventario, :"schema".lotes, :"schema".lotes_movimientos
  from anon, authenticated;
grant select on :"schema".sucursales, :"schema".depositos, :"schema".stock_depositos, :"schema".traslados,
  :"schema".traslados_items, :"schema".traslados_lotes, :"schema".ajustes_inventario, :"schema".ajustes_items,
  :"schema".movimientos_inventario, :"schema".lotes, :"schema".lotes_movimientos
  to authenticated;
grant all on :"schema".sucursales, :"schema".depositos, :"schema".stock_depositos, :"schema".traslados,
  :"schema".traslados_items, :"schema".traslados_lotes, :"schema".ajustes_inventario, :"schema".ajustes_items
  to service_role;

-- Internas: nadie las llama desde afuera (solo las funciones SECURITY DEFINER de acá).
revoke execute on function :"schema".inv_sesion(text[]) from public, anon, authenticated;
revoke execute on function :"schema".inv_numero(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function :"schema".inv_deposito(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function :"schema".deposito_por_defecto(uuid, uuid) from public, anon, authenticated;
revoke execute on function :"schema".inv_mover(uuid, uuid, uuid, numeric, numeric, text, text, uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function :"schema".lote_entrada(uuid, uuid, uuid, text, date, numeric, numeric, text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function :"schema".lote_sin_lote(uuid, uuid, uuid, text, numeric, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function :"schema".lotes_consumir(uuid, uuid, uuid, numeric, text, uuid, uuid, text, text, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function :"schema".lotes_revertir(uuid, uuid, uuid, uuid, text, text[], text, text) from public, anon, authenticated;
revoke execute on function :"schema".inv_aplicar_ajuste(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function :"schema".tg_stock_depositos_total() from public, anon, authenticated;
revoke execute on function :"schema".tg_empresas_sucursal_inicial() from public, anon, authenticated;
revoke execute on function :"schema".tg_productos_lotes_activar() from public, anon, authenticated;

-- Públicas (validan empresa y rol adentro).
revoke execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid) from public, anon;
grant execute on function :"schema".crear_venta(uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid) to authenticated, service_role;
revoke execute on function :"schema".anular_venta(uuid) from public, anon;
grant execute on function :"schema".anular_venta(uuid) to authenticated, service_role;
revoke execute on function :"schema".registrar_compra(jsonb) from public, anon;
grant execute on function :"schema".registrar_compra(jsonb) to authenticated, service_role;
revoke execute on function :"schema".anular_compra(uuid, text) from public, anon;
grant execute on function :"schema".anular_compra(uuid, text) to authenticated, service_role;
revoke execute on function :"schema".guardar_sucursal(jsonb) from public, anon;
grant execute on function :"schema".guardar_sucursal(jsonb) to authenticated, service_role;
revoke execute on function :"schema".guardar_deposito(jsonb) from public, anon;
grant execute on function :"schema".guardar_deposito(jsonb) to authenticated, service_role;
revoke execute on function :"schema".asignar_sucursal_usuario(uuid, uuid) from public, anon;
grant execute on function :"schema".asignar_sucursal_usuario(uuid, uuid) to authenticated, service_role;
revoke execute on function :"schema".sucursales_depositos() from public, anon;
grant execute on function :"schema".sucursales_depositos() to authenticated, service_role;
revoke execute on function :"schema".crear_traslado(jsonb) from public, anon;
grant execute on function :"schema".crear_traslado(jsonb) to authenticated, service_role;
revoke execute on function :"schema".recibir_traslado(uuid, jsonb) from public, anon;
grant execute on function :"schema".recibir_traslado(uuid, jsonb) to authenticated, service_role;
revoke execute on function :"schema".anular_traslado(uuid, text) from public, anon;
grant execute on function :"schema".anular_traslado(uuid, text) to authenticated, service_role;
revoke execute on function :"schema".listar_traslados(text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function :"schema".listar_traslados(text, uuid, text, text, text, integer, integer) to authenticated, service_role;
revoke execute on function :"schema".traslado_detalle(uuid) from public, anon;
grant execute on function :"schema".traslado_detalle(uuid) to authenticated, service_role;
revoke execute on function :"schema".registrar_ajuste(jsonb) from public, anon;
grant execute on function :"schema".registrar_ajuste(jsonb) to authenticated, service_role;
revoke execute on function :"schema".aprobar_ajuste(uuid) from public, anon;
grant execute on function :"schema".aprobar_ajuste(uuid) to authenticated, service_role;
revoke execute on function :"schema".rechazar_ajuste(uuid, text) from public, anon;
grant execute on function :"schema".rechazar_ajuste(uuid, text) to authenticated, service_role;
revoke execute on function :"schema".anular_ajuste(uuid, text) from public, anon;
grant execute on function :"schema".anular_ajuste(uuid, text) to authenticated, service_role;
revoke execute on function :"schema".listar_ajustes(text, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function :"schema".listar_ajustes(text, text, uuid, text, text, text, integer, integer) to authenticated, service_role;
revoke execute on function :"schema".ajuste_detalle(uuid) from public, anon;
grant execute on function :"schema".ajuste_detalle(uuid) to authenticated, service_role;
revoke execute on function :"schema".dar_baja_lote(uuid, numeric, text) from public, anon;
grant execute on function :"schema".dar_baja_lote(uuid, numeric, text) to authenticated, service_role;
revoke execute on function :"schema".aplicar_importacion_productos(jsonb, text, boolean, text, text, uuid, uuid) from public, anon;
grant execute on function :"schema".aplicar_importacion_productos(jsonb, text, boolean, text, text, uuid, uuid) to authenticated, service_role;
revoke execute on function :"schema".stock_producto(uuid) from public, anon;
grant execute on function :"schema".stock_producto(uuid) to authenticated, service_role;
revoke execute on function :"schema".lotes_producto(uuid) from public, anon;
grant execute on function :"schema".lotes_producto(uuid) to authenticated, service_role;
revoke execute on function :"schema".reporte_vencimientos(integer, text, text, uuid) from public, anon;
grant execute on function :"schema".reporte_vencimientos(integer, text, text, uuid) to authenticated, service_role;
revoke execute on function :"schema".productos_pos(boolean) from public, anon;
grant execute on function :"schema".productos_pos(boolean) to authenticated, service_role;
revoke execute on function :"schema".listar_movimientos(text, text, text, uuid, text, text, integer, integer, boolean, uuid, uuid) from public, anon;
grant execute on function :"schema".listar_movimientos(text, text, text, uuid, text, text, integer, integer, boolean, uuid, uuid) to authenticated, service_role;
revoke execute on function :"schema".verificar_lotes(uuid) from public, anon;
grant execute on function :"schema".verificar_lotes(uuid) to authenticated, service_role;
revoke execute on function :"schema".verificar_inventario() from public, anon;
grant execute on function :"schema".verificar_inventario() to authenticated, service_role;

commit;
