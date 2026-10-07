-- =============================================================================
-- Módulo CAJA (núcleo): apertura -> venta/POS -> arqueo -> cierre.
-- Portado fiel desde distribuidorajm, re-plomado a 2.0 (parametrizado por :schema,
-- RLS deny-by-default, empresa_id). SIN repartos/camiones (módulo opcional aparte).
-- Columnas que referenciaban módulos no traídos (categorías, proveedores, repartos,
-- contabilidad, facturación, devoluciones) quedan como uuid sueltos, sin FK.
-- IDEMPOTENTE.
-- =============================================================================

-- --- Productos (catálogo que vende la caja) ---
create table if not exists :"schema".productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  sku text not null,
  costo_promedio numeric not null default 0,
  precio_venta numeric not null default 0,
  precio_mayorista numeric,
  cantidad_minima_mayorista numeric,
  precio_distribuidor numeric,
  stock_actual numeric not null default 0,
  stock_minimo numeric not null default 0,
  unidad_medida text not null default 'Unidad',
  activo boolean not null default true,
  es_vendible boolean not null default true,
  controla_stock boolean not null default true,
  codigo_barras text,
  imagen_url text,
  imagen_path text,
  descripcion text,
  destacado boolean not null default false,
  categoria_principal_id uuid,          -- (módulo categorías, no traído)
  proveedor_principal_id uuid,          -- (módulo proveedores, no traído)
  tipo_producto text not null default 'reventa',
  tipo_iva text not null default '10%',
  descuento_pct numeric not null default 0,   -- % de descuento del producto; la caja lo aplica sola
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint productos_descuento_rango check (descuento_pct >= 0 and descuento_pct <= 100),
  constraint productos_tipo_iva_check check (tipo_iva = any (array['EXENTA','5%','10%'])),
  constraint productos_tipo_producto_check check (tipo_producto = any (array['reventa','repuesto','servicio']))
);
create index if not exists productos_empresa_idx on :"schema".productos(empresa_id);
create index if not exists productos_sku_idx on :"schema".productos(empresa_id, sku);

-- --- Cajas (apertura / estado / cierre / arqueo en JSON) ---
create table if not exists :"schema".cajas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  estado text not null default 'abierta',
  numero_caja integer not null default 1,
  abierta_por uuid,
  cerrada_por uuid,
  fecha_apertura timestamptz not null default now(),
  fecha_cierre timestamptz,
  monto_apertura numeric not null default 0,
  monto_cierre_contado numeric,
  monto_esperado_efectivo numeric,
  diferencia numeric,
  observacion_apertura text,
  observacion_cierre text,
  arqueo_apertura_json jsonb,
  arqueo_cierre_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cajas_estado_check check (estado = any (array['abierta','en_cierre','cerrada']))
);
create index if not exists cajas_empresa_estado_idx on :"schema".cajas(empresa_id, estado);

-- --- Movimientos de caja (ingresos / egresos / retiros / ajustes) ---
create table if not exists :"schema".caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  caja_id uuid not null references :"schema".cajas(id) on delete cascade,
  tipo text not null,
  concepto text not null,
  monto numeric not null,
  medio_pago text not null default 'efectivo',
  categoria text,
  usuario_id uuid,
  usuario_email text,
  observacion text,
  venta_id uuid,                        -- se liga a ventas más abajo
  fecha date,
  factura_numero text,
  anulado_at timestamptz,
  anulado_por uuid,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  constraint caja_mov_tipo_check check (tipo = any (array['ingreso','egreso','retiro','ajuste'])),
  constraint caja_mov_medio_check check (medio_pago = any (array['efectivo','otro','tarjeta','transferencia','cheque','pos']))
);
create index if not exists caja_mov_caja_idx on :"schema".caja_movimientos(caja_id);
create index if not exists caja_mov_empresa_idx on :"schema".caja_movimientos(empresa_id);

-- --- Ventas (POS) ---
create table if not exists :"schema".ventas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  caja_id uuid references :"schema".cajas(id) on delete set null,
  numero_control text not null,
  moneda text not null default 'GS',
  tipo_cambio numeric not null default 1,
  subtotal numeric not null default 0,
  monto_iva numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'completada',
  tipo_venta text not null default 'CONTADO',
  plazo_dias integer,
  metodo_pago text,
  observaciones text,
  fecha timestamptz not null default now(),
  created_by uuid,
  usuario_nombre text,
  idempotency_key text,
  anulada_at timestamptz,
  anulada_por uuid,
  anulada_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ventas_estado_check check (estado = any (array['pendiente','completada','anulada','parcialmente_devuelta','devuelta_total'])),
  constraint ventas_moneda_check check (moneda = any (array['GS','USD'])),
  constraint ventas_tipo_venta_check check (tipo_venta = any (array['CONTADO','CREDITO']))
);
create index if not exists ventas_empresa_fecha_idx on :"schema".ventas(empresa_id, fecha desc);
create index if not exists ventas_caja_idx on :"schema".ventas(caja_id);
create unique index if not exists ventas_idempotency_idx on :"schema".ventas(empresa_id, idempotency_key) where idempotency_key is not null;

-- liga el movimiento de caja a la venta (ambas ya existen)
alter table :"schema".caja_movimientos
  drop constraint if exists caja_mov_venta_fk,
  add constraint caja_mov_venta_fk foreign key (venta_id) references :"schema".ventas(id) on delete set null;

-- --- Items de la venta ---
create table if not exists :"schema".ventas_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  venta_id uuid not null references :"schema".ventas(id) on delete cascade,
  producto_id uuid references :"schema".productos(id) on delete set null,
  producto_nombre text not null,
  sku text,
  cantidad numeric not null,
  precio_venta_original numeric not null,
  precio_venta numeric not null,
  tipo_precio text not null default 'minorista',
  tipo_iva text not null default '10%',
  subtotal numeric not null,
  monto_iva numeric not null,
  total_linea numeric not null,
  es_manual boolean not null default false,
  costo_unitario numeric,
  created_at timestamptz not null default now(),
  constraint vitems_tipo_iva_check check (tipo_iva = any (array['EXENTA','5%','10%'])),
  constraint vitems_tipo_precio_check check (tipo_precio = any (array['minorista','mayorista','distribuidor','costo']))
);
create index if not exists vitems_venta_idx on :"schema".ventas_items(venta_id);
create index if not exists vitems_empresa_idx on :"schema".ventas_items(empresa_id);

-- --- Detalle de pagos de la venta (pago mixto) ---
create table if not exists :"schema".ventas_pagos_detalle (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  venta_id uuid not null references :"schema".ventas(id) on delete cascade,
  metodo_pago text not null,
  monto numeric not null default 0,
  referencia text,
  titular text,
  fecha_pago timestamptz not null default now(),
  observacion text,
  created_at timestamptz not null default now(),
  constraint vpd_metodo_check check (metodo_pago = any (array['efectivo','transferencia','cheque','tarjeta','tarjeta_debito','tarjeta_credito','pos','pos_debito','pos_credito','qr','billetera','otro']))
);
create index if not exists vpd_venta_idx on :"schema".ventas_pagos_detalle(venta_id);

-- =============================================================================
-- Actualización de schemas creados con una versión anterior de esta receta
-- (los "create table if not exists" de arriba no tocan tablas que ya existen).
--   · POS como medio de cobro de la caja
--   · tarjeta / POS con débito y crédito en el detalle de pagos (pago mixto)
--   · descuento por producto (Inventario), que la caja aplica al vender
-- =============================================================================
alter table :"schema".caja_movimientos drop constraint if exists caja_mov_medio_check;
alter table :"schema".caja_movimientos add constraint caja_mov_medio_check
  check (medio_pago = any (array['efectivo','otro','tarjeta','transferencia','cheque','pos']));

alter table :"schema".ventas_pagos_detalle drop constraint if exists vpd_metodo_check;
alter table :"schema".ventas_pagos_detalle add constraint vpd_metodo_check
  check (metodo_pago = any (array['efectivo','transferencia','cheque','tarjeta','tarjeta_debito','tarjeta_credito','pos','pos_debito','pos_credito','qr','billetera','otro']));

alter table :"schema".productos add column if not exists descuento_pct numeric not null default 0;
alter table :"schema".productos drop constraint if exists productos_descuento_rango;
alter table :"schema".productos add constraint productos_descuento_rango check (descuento_pct >= 0 and descuento_pct <= 100);

-- =============================================================================
-- RLS deny-by-default + políticas por empresa (misma lógica que el core).
-- =============================================================================
alter table :"schema".productos            enable row level security;
alter table :"schema".productos            force  row level security;
alter table :"schema".cajas                enable row level security;
alter table :"schema".cajas                force  row level security;
alter table :"schema".caja_movimientos     enable row level security;
alter table :"schema".caja_movimientos     force  row level security;
alter table :"schema".ventas               enable row level security;
alter table :"schema".ventas               force  row level security;
alter table :"schema".ventas_items         enable row level security;
alter table :"schema".ventas_items         force  row level security;
alter table :"schema".ventas_pagos_detalle enable row level security;
alter table :"schema".ventas_pagos_detalle force  row level security;

drop policy if exists productos_propios on :"schema".productos;
create policy productos_propios on :"schema".productos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists cajas_propias on :"schema".cajas;
create policy cajas_propias on :"schema".cajas to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists caja_mov_propios on :"schema".caja_movimientos;
create policy caja_mov_propios on :"schema".caja_movimientos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists ventas_propias on :"schema".ventas;
create policy ventas_propias on :"schema".ventas to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists vitems_propios on :"schema".ventas_items;
create policy vitems_propios on :"schema".ventas_items to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists vpd_propios on :"schema".ventas_pagos_detalle;
create policy vpd_propios on :"schema".ventas_pagos_detalle to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());

-- Permisos de tabla (RLS filtra las filas).
grant select, insert, update, delete on
  :"schema".productos, :"schema".cajas, :"schema".caja_movimientos,
  :"schema".ventas, :"schema".ventas_items, :"schema".ventas_pagos_detalle
  to authenticated, service_role;
