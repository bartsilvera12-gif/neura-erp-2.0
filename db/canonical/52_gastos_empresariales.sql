-- =============================================================================
-- GASTOS EMPRESARIALES — un solo módulo con todo lo que sale de plata de la empresa:
-- compras de mercadería (recetas 22/23/32/42/44/47/49/50, SIN cambios acá) + gastos
-- operativos (receta 48, que esta receta amplía).
--
-- Modelo nuevo / ampliado:
--   · gasto_categorias  ahora JERÁRQUICAS: rubro (es_rubro, sin padre) › subcategoría
--                       (padre_id). La subcategoría dice si es costo FIJO o VARIABLE, si su
--                       IVA es DEDUCIBLE (crédito fiscal) y si es de PERSONAL (pide empleado).
--                       Las líneas de un gasto siempre van a una subcategoría.
--   · gastos            + sucursal_id (centro de costo), moneda GS/USD con tipo_cambio y
--                       total_gs, con_comprobante (false = sin comprobante fiscal: propina,
--                       peaje, viático, sueldo → no deducible), deducible, cuenta_bancaria_id
--                       (cuenta propia de donde salió una transferencia/cheque/tarjeta),
--                       recurrente_id / periodo / fecha_programada (borrador generado de una
--                       plantilla) y `fecha` (la fecha del gasto, para listas y resúmenes).
--   · gasto_items       + sucursal_id (imputación por línea; por defecto la del gasto),
--                       empleado_id (líneas de personal) y deducible.
--   · gastos_adjuntos   varios adjuntos por gasto (reemplaza al comprobante único; los
--                       existentes se migran). El archivo lo sube la API al bucket "compras".
--   · empleados         mínimo: nombre, CI, cargo, sucursal (sin liquidación de IPS).
--   · cuentas_bancarias cuentas PROPIAS (banco, número, moneda, titular, alias).
--   · gastos_recurrentes plantillas (alquiler, internet, sueldos…) con día de vencimiento y
--                       sus líneas. NADA se genera solo: "Generar gastos del mes" crea los
--                       BORRADORES del período (uno por plantilla y período).
--   · gastos_presupuestos monto previsto por (mes, categoría) — categoría null = compras de
--                       mercadería — para ver gastado vs previsto.
--
-- Funciones (todas SECURITY DEFINER, search_path fijo; validan empresa Y rol ADMIN adentro
-- con inv_sesion de la receta 50):
--   REDEFINE (48): gasto_escribir (nueva firma, interna), guardar_gasto, confirmar_gasto,
--     anular_gasto, eliminar_gasto (devuelve `paths`), listar_gastos (nueva firma con
--     filtros), gasto_detalle.  NO toca listar_cuentas_pagar / estado_cuenta_proveedor ni
--     ninguna función de compras ni de caja.
--   NUEVAS: gastos_catalogo_inicial (interna), tg_empresas_gastos_catalogo, gastos_catalogos,
--     guardar_gasto_categoria, guardar_empleado, guardar_cuenta_bancaria,
--     gasto_adjunto_agregar, gasto_adjunto_quitar, guardar_gasto_recurrente,
--     eliminar_gasto_recurrente, listar_gastos_recurrentes, generar_gastos_recurrentes,
--     gastos_proximos_vencimientos, presupuesto_gastos, guardar_presupuesto_gastos,
--     gastos_resumen (agregados: compras de mercadería + gastos operativos por categoría,
--     sucursal, mes, proveedor, fijo/variable y presupuesto; la reusa Reportes).
--
-- Caja: un gasto al contado en EFECTIVO sale de la caja abierta de la sucursal del gasto
-- (caja_abierta_para de la receta 51, marcado "-- FASE2: caja por sucursal"; p.caja_id
-- elige una si hay varias). Requiere la 51 aplicada antes.
--
-- Seguridad: gastos, gasto_items, gasto_categorias pasan a SOLO LECTURA para la sesión
-- (antes ALL); las tablas nuevas también. Se escriben solo por las funciones de abajo.
-- Migración: categorías planas → subcategorías bajo un rubro; gastos existentes → Casa
-- central, GS, con comprobante; comprobante único → gastos_adjuntos. IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================

-- ── Categorías jerárquicas ──────────────────────────────────────────────────
alter table :"schema".gasto_categorias add column if not exists padre_id uuid references :"schema".gasto_categorias(id) on delete restrict;
alter table :"schema".gasto_categorias add column if not exists es_rubro boolean not null default false;
alter table :"schema".gasto_categorias add column if not exists tipo_costo text not null default 'variable';
alter table :"schema".gasto_categorias add column if not exists deducible_iva boolean not null default true;
alter table :"schema".gasto_categorias add column if not exists es_personal boolean not null default false;
alter table :"schema".gasto_categorias add column if not exists updated_at timestamptz not null default now();
alter table :"schema".gasto_categorias drop constraint if exists chk_gasto_cat_tipo_costo;
alter table :"schema".gasto_categorias add constraint chk_gasto_cat_tipo_costo check (tipo_costo in ('fijo', 'variable'));
-- El nombre es único dentro de su rubro (antes era único en toda la empresa).
drop index if exists :"schema".uq_gasto_categorias_nombre;
create unique index if not exists uq_gasto_categorias_nombre2 on :"schema".gasto_categorias
  (empresa_id, coalesce(padre_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nombre)));
create index if not exists gasto_categorias_padre_idx on :"schema".gasto_categorias (padre_id);

-- ── Empleados (mínimo) ──────────────────────────────────────────────────────
create table if not exists :"schema".empleados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  ci text,
  cargo text,
  sucursal_id uuid references :"schema".sucursales(id) on delete set null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_empleado_nombre check (btrim(nombre) <> '')
);
create unique index if not exists uq_empleados_ci on :"schema".empleados (empresa_id, regexp_replace(ci, '[^0-9A-Za-z]', '', 'g'))
  where ci is not null;
create index if not exists empleados_empresa_idx on :"schema".empleados (empresa_id, activo, nombre);

-- ── Cuentas bancarias PROPIAS ───────────────────────────────────────────────
create table if not exists :"schema".cuentas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  banco_id uuid references :"schema".bancos(id) on delete set null,
  banco_nombre text not null,
  numero text not null,
  moneda text not null default 'GS',
  titular text,
  alias text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_cuenta_bancaria_moneda check (moneda in ('GS', 'USD')),
  constraint chk_cuenta_bancaria_numero check (btrim(numero) <> '')
);
create unique index if not exists uq_cuentas_bancarias on :"schema".cuentas_bancarias
  (empresa_id, lower(banco_nombre), regexp_replace(numero, '[^0-9A-Za-z]', '', 'g'));

-- ── Plantillas de gastos recurrentes ────────────────────────────────────────
create table if not exists :"schema".gastos_recurrentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  proveedor_id uuid references :"schema".proveedores(id),
  sucursal_id uuid references :"schema".sucursales(id) on delete set null,
  con_comprobante boolean not null default true,
  tipo_comprobante text,
  tipo_pago text not null default 'contado',
  plazo_dias integer,
  medio_pago text,
  cuenta_bancaria_id uuid references :"schema".cuentas_bancarias(id) on delete set null,
  moneda text not null default 'GS',
  tipo_cambio numeric not null default 1,
  dia_vencimiento integer not null default 10,
  items jsonb not null default '[]'::jsonb,        -- [{ categoria_id, descripcion, monto, iva_tipo, sucursal_id?, empleado_id? }]
  total numeric not null default 0,                -- suma de las líneas (0 = monto variable, se completa)
  descripcion text,
  activo boolean not null default true,
  vigente_desde date,                              -- primer período (mes) que genera
  vigente_hasta date,                              -- último período (null = sin fin)
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_recurrente_nombre check (btrim(nombre) <> ''),
  constraint chk_recurrente_dia check (dia_vencimiento between 1 and 31),
  constraint chk_recurrente_tipo_pago check (tipo_pago in ('contado', 'credito')),
  constraint chk_recurrente_medio check (medio_pago is null or medio_pago in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  constraint chk_recurrente_moneda check (moneda in ('GS', 'USD')),
  constraint chk_recurrente_cambio check (tipo_cambio > 0)
);
create index if not exists gastos_recurrentes_empresa_idx on :"schema".gastos_recurrentes (empresa_id, activo);

-- ── Gastos: columnas nuevas ─────────────────────────────────────────────────
alter table :"schema".gastos add column if not exists sucursal_id uuid references :"schema".sucursales(id);
alter table :"schema".gastos add column if not exists moneda text not null default 'GS';
alter table :"schema".gastos add column if not exists tipo_cambio numeric not null default 1;
alter table :"schema".gastos add column if not exists total_gs numeric not null default 0;
alter table :"schema".gastos add column if not exists con_comprobante boolean not null default true;
alter table :"schema".gastos add column if not exists deducible boolean not null default true;
alter table :"schema".gastos add column if not exists cuenta_bancaria_id uuid references :"schema".cuentas_bancarias(id);
alter table :"schema".gastos add column if not exists recurrente_id uuid references :"schema".gastos_recurrentes(id) on delete set null;
alter table :"schema".gastos add column if not exists periodo date;
alter table :"schema".gastos add column if not exists fecha_programada date;
alter table :"schema".gastos add column if not exists fecha date;
alter table :"schema".gastos drop constraint if exists chk_gasto_moneda;
alter table :"schema".gastos add constraint chk_gasto_moneda check (moneda in ('GS', 'USD'));
alter table :"schema".gastos drop constraint if exists chk_gasto_cambio;
alter table :"schema".gastos add constraint chk_gasto_cambio check (tipo_cambio > 0);
-- Un borrador por plantilla y período (si se elimina o se anula, se puede volver a generar).
create unique index if not exists uq_gastos_recurrente_periodo on :"schema".gastos (recurrente_id, periodo)
  where recurrente_id is not null and estado <> 'anulado';
create index if not exists gastos_fecha_idx on :"schema".gastos (empresa_id, fecha desc, created_at desc);
create index if not exists gastos_sucursal_idx on :"schema".gastos (empresa_id, sucursal_id);
create index if not exists gastos_programados_idx on :"schema".gastos (empresa_id, fecha_programada) where estado = 'borrador';

alter table :"schema".gasto_items add column if not exists sucursal_id uuid references :"schema".sucursales(id);
alter table :"schema".gasto_items add column if not exists empleado_id uuid references :"schema".empleados(id) on delete set null;
alter table :"schema".gasto_items add column if not exists deducible boolean not null default true;
create index if not exists gasto_items_categoria_idx on :"schema".gasto_items (categoria_id);

-- ── Adjuntos (varios por gasto) ─────────────────────────────────────────────
create table if not exists :"schema".gastos_adjuntos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  gasto_id uuid not null references :"schema".gastos(id) on delete cascade,
  nombre text not null,
  storage_path text not null,
  mime text,
  size bigint,
  subido_por uuid,
  subido_por_nombre text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_gastos_adjuntos_path on :"schema".gastos_adjuntos (storage_path);
create index if not exists gastos_adjuntos_gasto_idx on :"schema".gastos_adjuntos (gasto_id, created_at);

-- ── Presupuesto mensual por categoría ───────────────────────────────────────
create table if not exists :"schema".gastos_presupuestos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  periodo date not null,                           -- primer día del mes
  categoria_id uuid references :"schema".gasto_categorias(id) on delete cascade,   -- null = compras de mercadería
  monto numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint chk_presupuesto_monto check (monto >= 0),
  constraint chk_presupuesto_periodo check (extract(day from periodo) = 1)
);
create unique index if not exists uq_gastos_presupuestos on :"schema".gastos_presupuestos
  (empresa_id, periodo, coalesce(categoria_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- =============================================================================
-- 2. Catálogo inicial de rubros y subcategorías (y migración de las planas)
-- =============================================================================
create or replace function :"schema".gastos_catalogo_inicial(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_rubro uuid;
  v_sub uuid;
  v_padre uuid;
begin
  for r in select * from (values
    ('Local', 10, false), ('Servicios', 20, false), ('Personal', 30, true), ('Comercial y marketing', 40, false),
    ('Movilidad', 50, false), ('Impuestos y tasas', 60, false), ('Administración', 70, false)
  ) as t(nombre, orden, personal) loop
    if not exists (select 1 from gasto_categorias where empresa_id = p_empresa and es_rubro and lower(btrim(nombre)) = lower(r.nombre)) then
      insert into gasto_categorias (empresa_id, nombre, orden, es_rubro, padre_id, es_personal, tipo_costo, deducible_iva)
      values (p_empresa, r.nombre, r.orden, true, null, r.personal, 'variable', not r.personal);
    end if;
  end loop;

  for r in select * from (values
    ('Local', 'Alquiler', 1, 'fijo', true),
    ('Local', 'Servicios básicos (luz, agua)', 2, 'fijo', true),
    ('Local', 'Mantenimiento y reparaciones', 3, 'variable', true),
    ('Local', 'Limpieza', 4, 'variable', true),
    ('Local', 'Seguros', 5, 'fijo', true),
    ('Servicios', 'Internet y telefonía', 1, 'fijo', true),
    ('Servicios', 'Honorarios profesionales', 2, 'variable', true),
    ('Servicios', 'Software y suscripciones', 3, 'fijo', true),
    ('Personal', 'Sueldos y jornales', 1, 'fijo', false),
    ('Personal', 'IPS patronal', 2, 'fijo', false),
    ('Personal', 'Aguinaldo', 3, 'variable', false),
    ('Personal', 'Bonificaciones y comisiones', 4, 'variable', false),
    ('Comercial y marketing', 'Publicidad y marketing', 1, 'variable', true),
    ('Movilidad', 'Combustible y movilidad', 1, 'variable', true),
    ('Movilidad', 'Peajes y estacionamiento', 2, 'variable', false),
    ('Movilidad', 'Viáticos', 3, 'variable', false),
    ('Impuestos y tasas', 'Impuestos, tasas y patentes', 1, 'variable', false),
    ('Administración', 'Papelería y útiles', 1, 'variable', true),
    ('Administración', 'Gastos bancarios', 2, 'variable', true),
    ('Administración', 'Propinas y atenciones', 3, 'variable', false),
    ('Administración', 'Otros gastos', 99, 'variable', true)
  ) as t(rubro, nombre, orden, tipo, deducible) loop
    select id into v_rubro from gasto_categorias where empresa_id = p_empresa and es_rubro and lower(btrim(nombre)) = lower(r.rubro);
    -- ¿Ya existe con ese nombre? (categoría plana de la receta 48 o ya migrada)
    select id, padre_id into v_sub, v_padre from gasto_categorias
     where empresa_id = p_empresa and not es_rubro and lower(btrim(nombre)) = lower(r.nombre)
     order by (padre_id is null) desc limit 1;
    if v_sub is null then
      insert into gasto_categorias (empresa_id, nombre, orden, es_rubro, padre_id, tipo_costo, deducible_iva, es_personal)
      values (p_empresa, r.nombre, r.orden, false, v_rubro, r.tipo, r.deducible, r.rubro = 'Personal');
    elsif v_padre is null then
      -- Plana → subcategoría (solo la primera vez: después se respeta lo que edite la empresa).
      update gasto_categorias set padre_id = v_rubro, tipo_costo = r.tipo, deducible_iva = r.deducible,
             es_personal = (r.rubro = 'Personal'), updated_at = now()
       where id = v_sub;
    end if;
    v_sub := null;
    v_padre := null;
  end loop;

  -- Categorías planas que creó la empresa (no están en la lista) → bajo Administración.
  select id into v_rubro from gasto_categorias where empresa_id = p_empresa and es_rubro and lower(nombre) = 'administración';
  update gasto_categorias set padre_id = v_rubro, updated_at = now()
   where empresa_id = p_empresa and not es_rubro and padre_id is null;
end;
$fn$;

do $mig$
declare e record;
begin
  for e in select id from empresas loop
    perform gastos_catalogo_inicial(e.id);
  end loop;
end
$mig$;

alter table :"schema".gasto_categorias drop constraint if exists chk_gasto_cat_nivel;
alter table :"schema".gasto_categorias add constraint chk_gasto_cat_nivel
  check ((es_rubro and padre_id is null) or (not es_rubro and padre_id is not null));

-- Empresas nuevas: su catálogo (después de que el trigger de la receta 50 cree la Casa central).
create or replace function :"schema".tg_empresas_gastos_catalogo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform gastos_catalogo_inicial(new.id);
  return null;
end;
$fn$;
drop trigger if exists trg_empresas_gastos_catalogo on :"schema".empresas;
create trigger trg_empresas_gastos_catalogo after insert on :"schema".empresas
  for each row execute function :"schema".tg_empresas_gastos_catalogo();

-- =============================================================================
-- 3. Migración de los gastos existentes (sin perder nada)
-- =============================================================================
-- Solo lo que todavía no se migró (sucursal null = gasto de la receta 48): re-ejecutar no pisa nada.
update :"schema".gasto_items i
   set deducible = (g.con_comprobante and i.iva_tipo <> 'exenta'
                    and coalesce((select c.deducible_iva from :"schema".gasto_categorias c where c.id = i.categoria_id), true))
  from :"schema".gastos g
 where g.id = i.gasto_id and i.sucursal_id is null;
update :"schema".gastos g set deducible = exists (select 1 from :"schema".gasto_items i where i.gasto_id = g.id and i.deducible)
 where g.sucursal_id is null;
update :"schema".gastos g set sucursal_id = s.id
  from :"schema".sucursales s
 where s.empresa_id = g.empresa_id and s.es_principal and g.sucursal_id is null;
update :"schema".gastos set fecha = coalesce(fecha_comprobante, fecha_programada, (created_at at time zone 'America/Asuncion')::date)
 where fecha is null;
update :"schema".gastos set total_gs = round(total * tipo_cambio) where total_gs = 0 and total <> 0;
update :"schema".gasto_items i set sucursal_id = g.sucursal_id
  from :"schema".gastos g where g.id = i.gasto_id and i.sucursal_id is null;
-- Comprobante único → adjuntos (las columnas viejas quedan como estaban, ya no se escriben).
insert into :"schema".gastos_adjuntos (empresa_id, gasto_id, nombre, storage_path, mime, size, subido_por_nombre, created_at)
select g.empresa_id, g.id, coalesce(g.comprobante_nombre, 'comprobante'), g.comprobante_path, g.comprobante_mime, g.comprobante_size,
       g.usuario_nombre, g.updated_at
  from :"schema".gastos g
 where g.comprobante_path is not null
on conflict (storage_path) do nothing;

-- =============================================================================
-- 4. Gastos operativos — escritura (redefine las de la receta 48)
-- =============================================================================
drop function if exists :"schema".gasto_escribir(uuid, jsonb);
drop function if exists :"schema".listar_gastos(text, text, date, date, integer, integer);

-- Sucursal por defecto de un gasto: la del usuario o la principal.
create or replace function :"schema".gasto_sucursal_defecto(p_empresa uuid, p_sucursal uuid)
returns uuid language sql stable security definer set search_path = :"schema", public as $$
  select id from sucursales where empresa_id = p_empresa and activa
   order by (id = p_sucursal) desc, es_principal desc, created_at limit 1
$$;

-- Escribe cabecera + líneas + totales de un BORRADOR (interna).
-- p = { proveedor_id?, sucursal_id?, con_comprobante?, descripcion?, tipo_comprobante?, numero_comprobante?,
--       timbrado?, fecha_comprobante?, tipo_pago?, plazo_dias?, fecha_vencimiento?, medio_pago?,
--       referencia_pago?, cuenta_bancaria_id?, moneda?, tipo_cambio?, observacion?,
--       items: [{ categoria_id?, descripcion, monto, iva_tipo, sucursal_id?, empleado_id? }] }
create or replace function :"schema".gasto_escribir(p_id uuid, p jsonb, p_empresa uuid, p_sucursal_usuario uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := p_empresa;
  v_prov_id uuid;
  v_prov_nombre text;
  v_prov_ruc text;
  it jsonb;
  v_orden integer := 0;
  v_monto numeric;
  v_iva text;
  cat record;
  v_desc text;
  v_tipo_pago text := nullif(btrim(coalesce(p->>'tipo_pago', '')), '');
  v_medio text := nullif(btrim(coalesce(p->>'medio_pago', '')), '');
  v_moneda text := coalesce(nullif(btrim(coalesce(p->>'moneda', '')), ''), 'GS');
  v_tc numeric;
  v_dec integer;
  v_con boolean := coalesce((nullif(p->>'con_comprobante', ''))::boolean, true);
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_isuc uuid;
  v_emple uuid;
  v_cuenta uuid := nullif(p->>'cuenta_bancaria_id', '')::uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  perform 1 from gastos where id = p_id and empresa_id = v_emp and estado = 'borrador';
  if not found then raise exception 'Solo se editan los borradores'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' then raise exception 'Faltan las líneas del gasto'; end if;
  if jsonb_array_length(p->'items') > 100 then raise exception 'Máximo 100 líneas por documento'; end if;
  if v_tipo_pago is not null and v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición inválida'; end if;
  if v_medio is not null and v_medio not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then raise exception 'Medio de pago inválido'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  v_dec := case when v_moneda = 'USD' then 2 else 0 end;
  if v_moneda = 'USD' then
    v_tc := nullif(p->>'tipo_cambio', '')::numeric;
    if v_tc is null or v_tc <= 0 then raise exception 'Cargá el tipo de cambio del dólar'; end if;
    if v_tc > 100000 then raise exception 'El tipo de cambio parece incorrecto'; end if;
  else
    v_tc := 1;
  end if;

  if v_suc is not null then
    perform 1 from sucursales where id = v_suc and empresa_id = v_emp;
    if not found then raise exception 'Sucursal no encontrada'; end if;
  else
    v_suc := gasto_sucursal_defecto(v_emp, p_sucursal_usuario);
  end if;

  if nullif(p->>'proveedor_id', '') is not null then
    select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre), ruc into v_prov_id, v_prov_nombre, v_prov_ruc
      from proveedores where id = (p->>'proveedor_id')::uuid and empresa_id = v_emp;
    if not found then raise exception 'Proveedor no encontrado'; end if;
  end if;

  if v_cuenta is not null then
    perform 1 from cuentas_bancarias where id = v_cuenta and empresa_id = v_emp;
    if not found then raise exception 'Cuenta bancaria no encontrada'; end if;
  end if;

  delete from gasto_items where gasto_id = p_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_desc := btrim(coalesce(it->>'descripcion', ''));
    v_monto := round(coalesce(nullif(it->>'monto', '')::numeric, 0), v_dec);
    v_iva := coalesce(nullif(it->>'iva_tipo', ''), '10%');
    if v_iva = '10' then v_iva := '10%'; elsif v_iva = '5' then v_iva := '5%'; elsif lower(v_iva) in ('exenta', 'exento') then v_iva := 'exenta'; end if;
    if v_iva not in ('10%', '5%', 'exenta') then raise exception 'Tipo de IVA inválido en una línea (10 %%, 5 %% o exenta)'; end if;
    if not v_con then v_iva := 'exenta'; end if;   -- sin comprobante fiscal no se discrimina IVA
    if v_monto < 0 then raise exception 'El monto de una línea no puede ser negativo'; end if;
    cat := null;
    if nullif(it->>'categoria_id', '') is not null then
      select c.id, c.nombre, c.es_rubro, c.deducible_iva into cat
        from gasto_categorias c where c.id = (it->>'categoria_id')::uuid and c.empresa_id = v_emp;
      if cat.id is null then raise exception 'Una categoría de gasto no existe'; end if;
      if cat.es_rubro then raise exception 'Elegí una subcategoría de "%" (no el rubro)', cat.nombre; end if;
    end if;
    v_isuc := nullif(it->>'sucursal_id', '')::uuid;
    if v_isuc is not null then
      perform 1 from sucursales where id = v_isuc and empresa_id = v_emp;
      if not found then raise exception 'Sucursal de una línea no encontrada'; end if;
    end if;
    v_emple := nullif(it->>'empleado_id', '')::uuid;
    if v_emple is not null then
      perform 1 from empleados where id = v_emple and empresa_id = v_emp;
      if not found then raise exception 'Empleado no encontrado'; end if;
    end if;
    -- Una línea totalmente vacía no se guarda.
    if v_desc = '' and v_monto = 0 and cat.id is null then continue; end if;
    v_orden := v_orden + 1;
    insert into gasto_items (empresa_id, gasto_id, orden, categoria_id, categoria_nombre, descripcion, monto, iva_tipo, monto_iva,
                             sucursal_id, empleado_id, deducible)
    values (v_emp, p_id, v_orden, cat.id, cat.nombre, left(coalesce(nullif(v_desc, ''), cat.nombre, ''), 300), v_monto, v_iva,
            case v_iva when '10%' then round(v_monto / 11, v_dec) when '5%' then round(v_monto / 21, v_dec) else 0 end,
            coalesce(v_isuc, v_suc), v_emple, v_con and coalesce(cat.deducible_iva, true) and v_iva <> 'exenta');
  end loop;

  update gastos g set
    proveedor_id = v_prov_id,
    proveedor_nombre = v_prov_nombre,
    proveedor_ruc = v_prov_ruc,
    sucursal_id = v_suc,
    con_comprobante = v_con,
    moneda = v_moneda,
    tipo_cambio = v_tc,
    descripcion = left(nullif(btrim(p->>'descripcion'), ''), 500),
    tipo_comprobante = case when v_con then left(nullif(btrim(p->>'tipo_comprobante'), ''), 60) end,
    numero_comprobante = left(nullif(btrim(p->>'numero_comprobante'), ''), 40),
    timbrado = case when v_con then left(nullif(regexp_replace(coalesce(p->>'timbrado', ''), '\s+', '', 'g'), ''), 20) end,
    fecha_comprobante = nullif(p->>'fecha_comprobante', '')::date,
    fecha = coalesce(nullif(p->>'fecha_comprobante', '')::date, g.fecha_programada, v_hoy),
    tipo_pago = v_tipo_pago,
    plazo_dias = case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
    fecha_vencimiento = case when v_tipo_pago = 'credito' then nullif(p->>'fecha_vencimiento', '')::date end,
    medio_pago = case when v_tipo_pago = 'contado' then v_medio end,
    referencia_pago = case when v_tipo_pago = 'contado' then left(nullif(btrim(p->>'referencia_pago'), ''), 120) end,
    cuenta_bancaria_id = case when v_tipo_pago = 'contado' and v_medio in ('transferencia', 'cheque', 'tarjeta') then v_cuenta end,
    observacion = left(nullif(btrim(p->>'observacion'), ''), 1000),
    total_10 = t.t10, iva_10 = t.i10, total_5 = t.t5, iva_5 = t.i5, exenta = t.ex,
    monto_iva = t.i10 + t.i5, total = t.t10 + t.t5 + t.ex, subtotal = t.t10 + t.t5 + t.ex - t.i10 - t.i5,
    total_gs = round((t.t10 + t.t5 + t.ex) * v_tc),
    deducible = t.ded,
    updated_at = now()
  from (select coalesce(sum(monto) filter (where iva_tipo = '10%'), 0) as t10,
               coalesce(sum(monto_iva) filter (where iva_tipo = '10%'), 0) as i10,
               coalesce(sum(monto) filter (where iva_tipo = '5%'), 0) as t5,
               coalesce(sum(monto_iva) filter (where iva_tipo = '5%'), 0) as i5,
               coalesce(sum(monto) filter (where iva_tipo = 'exenta'), 0) as ex,
               coalesce(bool_or(deducible), false) as ded
          from gasto_items where gasto_id = p_id) t
  where g.id = p_id;

  update gastos g set busqueda = concat_ws(' ', norm(g.numero), norm(g.proveedor_nombre), compacto(g.proveedor_ruc),
           norm(g.numero_comprobante), compacto(g.numero_comprobante), norm(g.tipo_comprobante), norm(g.descripcion),
           (select string_agg(norm(i.descripcion) || ' ' || norm(i.categoria_nombre) || ' ' || coalesce(norm(e.nombre), ''), ' ')
              from gasto_items i left join empleados e on e.id = i.empleado_id where i.gasto_id = g.id))
   where g.id = p_id;
end;
$fn$;

-- Alta o edición de un BORRADOR. p = { id?, idempotency_key?, ...gasto_escribir } → { id, estado }
create or replace function :"schema".guardar_gasto(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_estado text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_id is not null then
    select estado into v_estado from gastos where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Gasto no encontrado'; end if;
    if v_estado <> 'borrador' then raise exception 'Solo se editan los borradores'; end if;
  else
    if v_idem is not null then
      select id into v_id from gastos where empresa_id = s.s_empresa and idempotency_key = v_idem;
      if found then return jsonb_build_object('id', v_id, 'estado', (select estado from gastos where id = v_id), 'repetido', true); end if;
    end if;
    insert into gastos (empresa_id, estado, idempotency_key, created_by, usuario_nombre)
    values (s.s_empresa, 'borrador', v_idem, auth.uid(), s.s_nombre)
    returning id into v_id;
  end if;
  perform gasto_escribir(v_id, p, s.s_empresa, s.s_sucursal);
  return jsonb_build_object('id', v_id, 'estado', 'borrador');
end;
$fn$;

-- Guarda y CONFIRMA (nuevo o borrador) en un paso atómico. → { id, numero, total, cxp_id, caja_id }
create or replace function :"schema".confirmar_gasto(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_emp uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  g gastos;
  v_falta text[] := '{}';
  v_lineas integer;
  v_mal integer;
  v_sin_empleado integer;
  v_numero text;
  v_venc date;
  v_caja uuid;
  v_cxp uuid;
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_emp := s.s_empresa;

  if v_id is not null then
    select * into g from gastos where id = v_id and empresa_id = v_emp for update;
    if not found then raise exception 'Gasto no encontrado'; end if;
    if g.estado <> 'borrador' then raise exception 'Este gasto ya está %', case g.estado when 'confirmado' then 'confirmado' else 'anulado' end; end if;
  else
    -- Idempotencia: un doble clic o un reintento devuelve el ya confirmado.
    if v_idem is not null then
      select * into g from gastos where empresa_id = v_emp and idempotency_key = v_idem;
      if found then
        if g.estado = 'confirmado' then
          return jsonb_build_object('id', g.id, 'numero', g.numero, 'total', g.total, 'repetido', true);
        end if;
        v_id := g.id;
      end if;
    end if;
    if v_id is null then
      insert into gastos (empresa_id, estado, idempotency_key, created_by, usuario_nombre)
      values (v_emp, 'borrador', v_idem, auth.uid(), s.s_nombre)
      returning id into v_id;
    end if;
  end if;

  perform gasto_escribir(v_id, p, v_emp, s.s_sucursal);
  select * into g from gastos where id = v_id;

  -- Requisitos para confirmar. Con comprobante fiscal: los mismos que el sistema actual.
  if g.con_comprobante then
    if g.proveedor_id is null then v_falta := v_falta || 'proveedor'::text; end if;
    if g.tipo_comprobante is null then v_falta := v_falta || 'tipo de comprobante'::text; end if;
    if g.numero_comprobante is null then v_falta := v_falta || 'número de comprobante'::text; end if;
    if gasto_requiere_timbrado(g.tipo_comprobante) and g.timbrado is null then v_falta := v_falta || 'timbrado'::text; end if;
  elsif g.tipo_pago = 'credito' and g.proveedor_id is null then
    v_falta := v_falta || 'proveedor (a crédito se le debe a alguien)'::text;
  end if;
  if g.fecha_comprobante is null then v_falta := v_falta || case when g.con_comprobante then 'fecha del comprobante' else 'fecha del gasto' end; end if;
  if g.tipo_pago is null then v_falta := v_falta || 'condición (contado o crédito)'::text; end if;
  if g.tipo_pago = 'contado' and g.medio_pago is null then v_falta := v_falta || 'medio de pago'::text; end if;
  if g.tipo_pago = 'contado' and g.medio_pago in ('transferencia', 'cheque') and g.cuenta_bancaria_id is null
     and exists (select 1 from cuentas_bancarias where empresa_id = v_emp and activa) then
    v_falta := v_falta || 'cuenta bancaria de origen'::text;
  end if;
  if cardinality(v_falta) > 0 then raise exception 'Faltan datos para confirmar: %', array_to_string(v_falta, ', '); end if;
  if g.fecha_comprobante > v_hoy then raise exception 'La fecha % no puede ser futura', case when g.con_comprobante then 'del comprobante' else 'del gasto' end; end if;

  select count(*), count(*) filter (where categoria_id is null or btrim(descripcion) = '' or monto <= 0)
    into v_lineas, v_mal from gasto_items where gasto_id = v_id;
  if v_lineas = 0 then raise exception 'Cargá al menos una línea'; end if;
  if v_mal > 0 then raise exception 'Cada línea necesita subcategoría, descripción y un monto mayor a cero'; end if;
  select count(*) into v_sin_empleado
    from gasto_items i join gasto_categorias c on c.id = i.categoria_id
   where i.gasto_id = v_id and c.es_personal and i.empleado_id is null
     and exists (select 1 from empleados e where e.empresa_id = v_emp and e.activo);
  if v_sin_empleado > 0 then raise exception 'Las líneas de personal llevan el empleado'; end if;
  if g.total <= 0 then raise exception 'El total tiene que ser mayor a cero'; end if;

  if g.tipo_pago = 'credito' then
    v_venc := coalesce(g.fecha_vencimiento, g.fecha_comprobante + coalesce(g.plazo_dias, 30));
    if v_venc < g.fecha_comprobante then raise exception 'El vencimiento no puede ser anterior a la fecha del comprobante'; end if;
  end if;

  if g.tipo_pago = 'contado' and g.medio_pago = 'efectivo' then
    if g.moneda <> 'GS' then
      raise exception 'El efectivo de la caja es en guaraníes: un gasto en dólares al contado va por transferencia, cheque, tarjeta u otro medio';
    end if;
    -- FASE2: caja por sucursal — la caja abierta de la sucursal del gasto (receta 51,
    -- caja_abierta_para); p.caja_id elige una en particular si hay varias abiertas.
    v_caja := caja_abierta_para(null, g.sucursal_id, nullif(p->>'caja_id', '')::uuid);
    if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
  end if;

  v_numero := 'GS-' || lpad(inv_numero(v_emp, 'gasto', coalesce((
                select max(substring(numero from '[0-9]+$')::bigint) from gastos where empresa_id = v_emp and numero is not null), 0))::text, 6, '0');

  begin
    update gastos set estado = 'confirmado', numero = v_numero, fecha_vencimiento = v_venc, caja_id = v_caja,
           confirmado_at = now(), confirmado_por = s.s_nombre, updated_at = now(),
           busqueda = concat_ws(' ', norm(v_numero), busqueda)
     where id = v_id;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_gastos_comprobante' then
      raise exception using errcode = '23505', message = format('Ya hay un gasto confirmado con el comprobante %s %s de este proveedor', g.tipo_comprobante, g.numero_comprobante);
    end if;
    raise;
  end;

  if g.tipo_pago = 'credito' then
    insert into cuentas_por_pagar (empresa_id, compra_id, gasto_id, proveedor_id, numero, fecha_emision, vencimiento, moneda, monto)
    values (v_emp, null, v_id, g.proveedor_id, coalesce(g.numero_comprobante, v_numero), g.fecha_comprobante, v_venc, g.moneda, g.total)
    returning id into v_cxp;
  elsif v_caja is not null then
    insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, gasto_id, observacion)
    values (v_emp, v_caja, 'egreso', left('Gasto ' || v_numero || ' · ' || coalesce(g.proveedor_nombre, g.descripcion, 'sin comprobante'), 200),
            round(g.total), 'efectivo', 'gasto', s.s_usuario, v_hoy, v_id,
            left(coalesce(g.tipo_comprobante || ' ' || g.numero_comprobante, g.descripcion, ''), 200));
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'total', g.total, 'moneda', g.moneda, 'cxp_id', v_cxp, 'caja_id', v_caja);
end;
$fn$;

-- Anular un confirmado (motivo obligatorio): la deuda con el proveedor y el egreso de caja se anulan.
create or replace function :"schema".anular_gasto(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g gastos;
  cx cuentas_por_pagar;
  v_caja_estado text;
  v_ops text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo de la anulación (mínimo 3 caracteres)'; end if;
  select * into g from gastos where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Gasto no encontrado'; end if;
  if g.estado = 'anulado' then raise exception 'El gasto ya está anulado'; end if;
  if g.estado <> 'confirmado' then raise exception 'Un borrador no se anula: se elimina'; end if;

  select * into cx from cuentas_por_pagar where gasto_id = g.id for update;
  if found then
    if cx.pagado > 0 then
      select string_agg(distinct k.numero, ', ') into v_ops
        from pagos_proveedores_aplicaciones a join pagos_proveedores k on k.id = a.pago_id
       where a.cxp_id = cx.id and k.anulado_at is null;
      raise exception 'Este gasto ya tiene pagos al proveedor (%): anulá primero esos pagos', coalesce(v_ops, 'órdenes de pago');
    end if;
    update cuentas_por_pagar set estado = 'anulada', updated_at = now() where id = cx.id;
  end if;

  if exists (select 1 from caja_movimientos where gasto_id = g.id and anulado_at is null) then
    select c.estado into v_caja_estado from caja_movimientos m join cajas c on c.id = m.caja_id
     where m.gasto_id = g.id and m.anulado_at is null limit 1;
    if v_caja_estado <> 'abierta' then raise exception 'El efectivo salió de una caja que ya se cerró: no se puede anular'; end if;
    update caja_movimientos set anulado_at = now(), anulado_por = s.s_usuario, anulado_motivo = left('Gasto anulado: ' || btrim(p_motivo), 200)
     where gasto_id = g.id and anulado_at is null;
  end if;

  update gastos set estado = 'anulado', anulado_at = now(), anulado_por = s.s_nombre, anulado_motivo = left(btrim(p_motivo), 500), updated_at = now()
   where id = g.id;
  return jsonb_build_object('id', g.id, 'numero', g.numero);
end;
$fn$;

-- Eliminar un borrador. → { id, paths } (la API borra los archivos del bucket).
create or replace function :"schema".eliminar_gasto(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g gastos;
  v_paths jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select * into g from gastos where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Gasto no encontrado'; end if;
  if g.estado <> 'borrador' then raise exception 'Solo se eliminan los borradores (un confirmado se anula)'; end if;
  select coalesce(jsonb_agg(distinct x.p), '[]'::jsonb) into v_paths
    from (select storage_path as p from gastos_adjuntos where gasto_id = g.id
          union select g.comprobante_path where g.comprobante_path is not null) x;
  delete from gastos where id = g.id;
  return jsonb_build_object('id', g.id, 'paths', v_paths);
end;
$fn$;

-- =============================================================================
-- 5. Gastos operativos — lectura
-- =============================================================================

-- Lista paginada con filtros y totales de la vista en la misma consulta.
--   p_categoria: rubro o subcategoría · p_tipo_costo: 'fijo' | 'variable' · p_deducible: true/false
--   p_origen: 'recurrente' (generados de plantillas) | 'personal' (con líneas de personal)
create or replace function :"schema".listar_gastos(
  p_q text default null, p_estado text default null, p_desde date default null, p_hasta date default null,
  p_sucursal uuid default null, p_categoria uuid default null, p_proveedor uuid default null,
  p_tipo_costo text default null, p_deducible boolean default null, p_origen text default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  with par as (select tokens_busqueda(p_q) as tk),
  cats as (   -- la categoría elegida y, si es un rubro, sus subcategorías
    select id from gasto_categorias where empresa_id = s.s_empresa and p_categoria is not null and (id = p_categoria or padre_id = p_categoria)
  ),
  base as (
    select g.* from gastos g where g.empresa_id = s.s_empresa
  ),
  filtradas as (
    select b.* from base b, par
     where (p_estado is null or b.estado = p_estado)
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (p_proveedor is null or b.proveedor_id = p_proveedor)
       and (p_deducible is null or b.deducible = p_deducible)
       and (p_sucursal is null or b.sucursal_id = p_sucursal
            or exists (select 1 from gasto_items i where i.gasto_id = b.id and i.sucursal_id = p_sucursal))
       and (p_categoria is null or exists (select 1 from gasto_items i where i.gasto_id = b.id and i.categoria_id in (select id from cats)))
       and (p_tipo_costo is null or exists (select 1 from gasto_items i join gasto_categorias c on c.id = i.categoria_id
                                             where i.gasto_id = b.id and c.tipo_costo = p_tipo_costo))
       and (p_origen is null
            or (p_origen = 'recurrente' and b.recurrente_id is not null)
            or (p_origen = 'personal' and exists (select 1 from gasto_items i join gasto_categorias c on c.id = i.categoria_id
                                                   where i.gasto_id = b.id and c.es_personal))
            or (p_origen = 'sin_comprobante' and not b.con_comprobante))
       and (cardinality(par.tk) = 0 or coincide_busqueda(coalesce(b.busqueda, ''), par.tk))
  ),
  pagina as (
    select * from filtradas order by fecha desc, created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_monto', (select coalesce(sum(total_gs), 0) from filtradas where estado = 'confirmado'),
    'total_iva', (select coalesce(sum(round(monto_iva * tipo_cambio)), 0) from filtradas where estado = 'confirmado' and deducible),
    'total_borradores', (select coalesce(sum(total_gs), 0) from filtradas where estado = 'borrador'),
    'resumen', (select jsonb_build_object('total', count(*), 'borrador', count(*) filter (where estado = 'borrador'),
                  'confirmado', count(*) filter (where estado = 'confirmado'), 'anulado', count(*) filter (where estado = 'anulado'))
                  from base),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'numero', x.numero, 'estado', x.estado, 'fecha', x.fecha,
        'proveedor_id', x.proveedor_id, 'proveedor_nombre', x.proveedor_nombre, 'proveedor_ruc', x.proveedor_ruc,
        'tipo_comprobante', x.tipo_comprobante, 'numero_comprobante', x.numero_comprobante, 'timbrado', x.timbrado,
        'con_comprobante', x.con_comprobante, 'deducible', x.deducible,
        'descripcion', x.descripcion, 'tipo_pago', x.tipo_pago, 'medio_pago', x.medio_pago, 'fecha_vencimiento', x.fecha_vencimiento,
        'fecha_programada', x.fecha_programada, 'recurrente_id', x.recurrente_id,
        'moneda', x.moneda, 'tipo_cambio', x.tipo_cambio, 'total', x.total, 'total_gs', x.total_gs, 'monto_iva', x.monto_iva,
        'sucursal_id', x.sucursal_id, 'sucursal_nombre', (select su.nombre from sucursales su where su.id = x.sucursal_id),
        'adjuntos', (select count(*) from gastos_adjuntos a where a.gasto_id = x.id),
        'categorias', (select string_agg(distinct coalesce(rb.nombre || ' › ', '') || i.categoria_nombre, ', ')
                         from gasto_items i left join gasto_categorias c on c.id = i.categoria_id
                         left join gasto_categorias rb on rb.id = c.padre_id where i.gasto_id = x.id),
        'tipos_costo', (select string_agg(distinct c.tipo_costo, ',') from gasto_items i join gasto_categorias c on c.id = i.categoria_id where i.gasto_id = x.id),
        'cxp', (select jsonb_build_object('id', c.id, 'saldo', c.saldo, 'pagado', c.pagado, 'estado', c.estado)
                  from cuentas_por_pagar c where c.gasto_id = x.id),
        'anulado_motivo', x.anulado_motivo, 'usuario_nombre', x.usuario_nombre, 'confirmado_por', x.confirmado_por, 'created_at', x.created_at
      ) order by x.fecha desc, x.created_at desc) from pagina x), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- Detalle: cabecera, líneas (con rubro, sucursal y empleado), adjuntos, su cuenta a pagar
-- (con pagos), su egreso de caja y la plantilla de la que salió.
create or replace function :"schema".gasto_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select jsonb_build_object(
    'gasto', to_jsonb(g) - 'busqueda' - 'idempotency_key' - 'comprobante_path'
             || jsonb_build_object(
                  'sucursal_nombre', (select su.nombre from sucursales su where su.id = g.sucursal_id),
                  'cuenta_bancaria', (select jsonb_build_object('id', cb.id, 'banco', cb.banco_nombre, 'numero', cb.numero, 'moneda', cb.moneda, 'alias', cb.alias)
                                        from cuentas_bancarias cb where cb.id = g.cuenta_bancaria_id),
                  'recurrente_nombre', (select gr.nombre from gastos_recurrentes gr where gr.id = g.recurrente_id)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'categoria_id', i.categoria_id, 'categoria_nombre', i.categoria_nombre,
                 'rubro_id', c.padre_id, 'rubro_nombre', rb.nombre, 'tipo_costo', c.tipo_costo, 'es_personal', coalesce(c.es_personal, false),
                 'descripcion', i.descripcion, 'monto', i.monto, 'iva_tipo', i.iva_tipo, 'monto_iva', i.monto_iva, 'deducible', i.deducible,
                 'sucursal_id', i.sucursal_id, 'sucursal_nombre', su.nombre, 'empleado_id', i.empleado_id, 'empleado_nombre', e.nombre) order by i.orden)
               from gasto_items i
               left join gasto_categorias c on c.id = i.categoria_id
               left join gasto_categorias rb on rb.id = c.padre_id
               left join sucursales su on su.id = i.sucursal_id
               left join empleados e on e.id = i.empleado_id
              where i.gasto_id = g.id), '[]'::jsonb),
    'adjuntos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'mime', a.mime, 'size', a.size,
                    'subido_por', a.subido_por_nombre, 'created_at', a.created_at) order by a.created_at)
                  from gastos_adjuntos a where a.gasto_id = g.id), '[]'::jsonb),
    'cxp', (select jsonb_build_object('id', c.id, 'monto', c.monto, 'pagado', c.pagado, 'saldo', c.saldo, 'estado', c.estado,
                  'vencimiento', c.vencimiento, 'moneda', c.moneda,
                  'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'numero', k.numero, 'fecha', k.fecha, 'monto', a.monto,
                                        'anulado', k.anulado_at is not null) order by k.fecha)
                                       from pagos_proveedores_aplicaciones a join pagos_proveedores k on k.id = a.pago_id where a.cxp_id = c.id), '[]'::jsonb))
              from cuentas_por_pagar c where c.gasto_id = g.id),
    'caja', (select jsonb_build_object('caja_id', m.caja_id, 'numero_caja', cj.numero_caja, 'monto', m.monto, 'anulado', m.anulado_at is not null)
               from caja_movimientos m join cajas cj on cj.id = m.caja_id where m.gasto_id = g.id order by m.created_at limit 1)
  ) into r
  from gastos g where g.id = p_id and g.empresa_id = s.s_empresa;
  return r;
end;
$fn$;

-- =============================================================================
-- 6. Catálogos: categorías, empleados, cuentas bancarias (ADMIN)
-- =============================================================================

-- Todo lo que necesita el formulario en UNA consulta + lo último usado por proveedor
-- (categoría, sucursal, comprobante, timbrado, condición) para autocompletar.
create or replace function :"schema".gastos_catalogos(p_todas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select jsonb_build_object(
    'rubros', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rb.id, 'nombre', rb.nombre, 'orden', rb.orden, 'activo', rb.activo, 'es_personal', rb.es_personal,
        'subcategorias', coalesce((select jsonb_agg(jsonb_build_object(
            'id', c.id, 'nombre', c.nombre, 'orden', c.orden, 'activo', c.activo, 'tipo_costo', c.tipo_costo,
            'deducible_iva', c.deducible_iva, 'es_personal', c.es_personal or rb.es_personal,
            'usos', (select count(*) from gasto_items i where i.categoria_id = c.id)) order by c.orden, c.nombre)
          from gasto_categorias c where c.padre_id = rb.id and (p_todas or c.activo)), '[]'::jsonb)
      ) order by rb.orden, rb.nombre)
      from gasto_categorias rb where rb.empresa_id = s.s_empresa and rb.es_rubro and (p_todas or rb.activo)), '[]'::jsonb),
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre, 'es_principal', su.es_principal, 'activa', su.activa)
                              order by su.es_principal desc, su.nombre)
                            from sucursales su where su.empresa_id = s.s_empresa and (p_todas or su.activa)), '[]'::jsonb),
    'empleados', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'ci', e.ci, 'cargo', e.cargo,
                              'sucursal_id', e.sucursal_id, 'activo', e.activo) order by e.activo desc, e.nombre)
                           from empleados e where e.empresa_id = s.s_empresa and (p_todas or e.activo)), '[]'::jsonb),
    'cuentas_bancarias', coalesce((select jsonb_agg(jsonb_build_object('id', cb.id, 'banco_id', cb.banco_id, 'banco_nombre', cb.banco_nombre,
                              'numero', cb.numero, 'moneda', cb.moneda, 'titular', cb.titular, 'alias', cb.alias, 'activa', cb.activa)
                              order by cb.activa desc, cb.banco_nombre, cb.numero)
                           from cuentas_bancarias cb where cb.empresa_id = s.s_empresa and (p_todas or cb.activa)), '[]'::jsonb),
    'bancos', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre) order by b.orden, b.nombre)
                        from bancos b where b.empresa_id = s.s_empresa and b.activo), '[]'::jsonb),
    'ultimos', coalesce((select jsonb_object_agg(u.proveedor_id, jsonb_build_object(
                  'categoria_id', u.categoria_id, 'sucursal_id', u.sucursal_id, 'tipo_comprobante', u.tipo_comprobante,
                  'timbrado', u.timbrado, 'tipo_pago', u.tipo_pago, 'medio_pago', u.medio_pago, 'plazo_dias', u.plazo_dias,
                  'iva_tipo', u.iva_tipo, 'descripcion', u.descripcion, 'cuenta_bancaria_id', u.cuenta_bancaria_id, 'moneda', u.moneda))
                from (select distinct on (g.proveedor_id) g.proveedor_id, i.categoria_id, g.sucursal_id, g.tipo_comprobante, g.timbrado,
                             g.tipo_pago, g.medio_pago, g.plazo_dias, i.iva_tipo, i.descripcion, g.cuenta_bancaria_id, g.moneda
                        from gastos g join gasto_items i on i.gasto_id = g.id and i.orden = 1
                       where g.empresa_id = s.s_empresa and g.proveedor_id is not null and g.estado <> 'anulado'
                       order by g.proveedor_id, g.fecha desc, g.created_at desc) u), '{}'::jsonb),
    'mi_sucursal_id', gasto_sucursal_defecto(s.s_empresa, s.s_sucursal)
  ) into r;
  return r;
end;
$fn$;

-- p = { id?, nombre, padre_id? (null = rubro), tipo_costo?, deducible_iva?, es_personal?, activo?, orden? } → { id }
create or replace function :"schema".guardar_gasto_categoria(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := regexp_replace(btrim(coalesce(p->>'nombre', '')), '\s+', ' ', 'g');
  v_padre uuid := nullif(p->>'padre_id', '')::uuid;
  v_tipo text := coalesce(nullif(p->>'tipo_costo', ''), 'variable');
  v_activo boolean := coalesce((nullif(p->>'activo', ''))::boolean, true);
  prev gasto_categorias;
  pad gasto_categorias;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if length(v_nombre) < 2 or length(v_nombre) > 80 then raise exception 'Escribí el nombre (2 a 80 caracteres)'; end if;
  if v_tipo not in ('fijo', 'variable') then raise exception 'Tipo inválido (fijo o variable)'; end if;
  if v_padre is not null then
    select * into pad from gasto_categorias where id = v_padre and empresa_id = s.s_empresa;
    if pad.id is null or not pad.es_rubro then raise exception 'Elegí un rubro válido'; end if;
  end if;
  if v_id is not null then
    select * into prev from gasto_categorias where id = v_id and empresa_id = s.s_empresa for update;
    if prev.id is null then raise exception 'Categoría no encontrada'; end if;
    if prev.es_rubro <> (v_padre is null) then raise exception 'Un rubro no se convierte en subcategoría (ni al revés)'; end if;
  end if;
  if exists (select 1 from gasto_categorias where empresa_id = s.s_empresa and id is distinct from v_id
              and coalesce(padre_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_padre, '00000000-0000-0000-0000-000000000000'::uuid)
              and lower(btrim(nombre)) = lower(v_nombre)) then
    raise exception 'Ya existe "%" %', v_nombre, case when v_padre is null then 'como rubro' else 'en ese rubro' end;
  end if;
  if v_id is null then
    insert into gasto_categorias (empresa_id, nombre, padre_id, es_rubro, tipo_costo, deducible_iva, es_personal, activo, orden)
    values (s.s_empresa, v_nombre, v_padre, v_padre is null, v_tipo, coalesce((nullif(p->>'deducible_iva', ''))::boolean, true),
            coalesce((nullif(p->>'es_personal', ''))::boolean, coalesce(pad.es_personal, false)), v_activo,
            coalesce(nullif(p->>'orden', '')::integer, 50))
    returning id into v_id;
  else
    update gasto_categorias set nombre = v_nombre, padre_id = v_padre, tipo_costo = v_tipo,
           deducible_iva = coalesce((nullif(p->>'deducible_iva', ''))::boolean, deducible_iva),
           es_personal = coalesce((nullif(p->>'es_personal', ''))::boolean, es_personal),
           activo = v_activo, orden = coalesce(nullif(p->>'orden', '')::integer, orden), updated_at = now()
     where id = v_id;
    -- Desactivar un rubro desactiva sus subcategorías (los gastos viejos no cambian).
    if prev.es_rubro and not v_activo then update gasto_categorias set activo = false, updated_at = now() where padre_id = v_id; end if;
  end if;
  return jsonb_build_object('id', v_id, 'nombre', v_nombre);
end;
$fn$;

-- p = { id?, nombre, ci?, cargo?, sucursal_id?, activo? } → { id }
create or replace function :"schema".guardar_empleado(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := regexp_replace(btrim(coalesce(p->>'nombre', '')), '\s+', ' ', 'g');
  v_ci text := nullif(regexp_replace(coalesce(p->>'ci', ''), '\s+', '', 'g'), '');
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if length(v_nombre) < 2 then raise exception 'Escribí el nombre del empleado'; end if;
  if v_suc is not null and not exists (select 1 from sucursales where id = v_suc and empresa_id = s.s_empresa) then
    raise exception 'Sucursal no encontrada';
  end if;
  begin
    if v_id is null then
      insert into empleados (empresa_id, nombre, ci, cargo, sucursal_id, activo)
      values (s.s_empresa, left(v_nombre, 120), left(v_ci, 20), left(nullif(btrim(p->>'cargo'), ''), 80), v_suc, true)
      returning id into v_id;
    else
      update empleados set nombre = left(v_nombre, 120), ci = left(v_ci, 20), cargo = left(nullif(btrim(p->>'cargo'), ''), 80),
             sucursal_id = v_suc, activo = coalesce((nullif(p->>'activo', ''))::boolean, activo), updated_at = now()
       where id = v_id and empresa_id = s.s_empresa;
      if not found then raise exception 'Empleado no encontrado'; end if;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_empleados_ci' then raise exception 'Ya hay un empleado con la CI %', v_ci; end if;
    raise;
  end;
  return jsonb_build_object('id', v_id, 'nombre', v_nombre);
end;
$fn$;

-- p = { id?, banco_id?, banco_nombre?, numero, moneda, titular?, alias?, activa? } → { id }
create or replace function :"schema".guardar_cuenta_bancaria(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_banco uuid := nullif(p->>'banco_id', '')::uuid;
  v_banco_nombre text := nullif(btrim(coalesce(p->>'banco_nombre', '')), '');
  v_numero text := nullif(btrim(coalesce(p->>'numero', '')), '');
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cons text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if v_banco is not null then
    select nombre into v_banco_nombre from bancos where id = v_banco and empresa_id = s.s_empresa;
    if v_banco_nombre is null then raise exception 'Banco no encontrado'; end if;
  end if;
  if v_banco_nombre is null then raise exception 'Elegí o escribí el banco'; end if;
  if v_numero is null then raise exception 'Escribí el número de cuenta'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  begin
    if v_id is null then
      insert into cuentas_bancarias (empresa_id, banco_id, banco_nombre, numero, moneda, titular, alias, activa)
      values (s.s_empresa, v_banco, left(v_banco_nombre, 80), left(v_numero, 40), v_moneda, left(nullif(btrim(p->>'titular'), ''), 120),
              left(nullif(btrim(p->>'alias'), ''), 60), true)
      returning id into v_id;
    else
      update cuentas_bancarias set banco_id = v_banco, banco_nombre = left(v_banco_nombre, 80), numero = left(v_numero, 40), moneda = v_moneda,
             titular = left(nullif(btrim(p->>'titular'), ''), 120), alias = left(nullif(btrim(p->>'alias'), ''), 60),
             activa = coalesce((nullif(p->>'activa', ''))::boolean, activa), updated_at = now()
       where id = v_id and empresa_id = s.s_empresa;
      if not found then raise exception 'Cuenta no encontrada'; end if;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_cuentas_bancarias' then raise exception 'Esa cuenta ya está cargada'; end if;
    raise;
  end;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- =============================================================================
-- 7. Adjuntos (la API sube/borra el archivo; acá queda la fila)
-- =============================================================================
create or replace function :"schema".gasto_adjunto_agregar(p_gasto uuid, p_nombre text, p_path text, p_mime text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_estado text;
  v_id uuid;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select estado into v_estado from gastos where id = p_gasto and empresa_id = s.s_empresa;
  if v_estado is null then raise exception 'Gasto no encontrado'; end if;
  if v_estado = 'anulado' then raise exception 'El gasto está anulado'; end if;
  -- La ruta la arma el servidor: siempre dentro de {empresa}/{gasto}/.
  if p_path is null or left(p_path, length(s.s_empresa::text || '/' || p_gasto::text || '/')) <> s.s_empresa::text || '/' || p_gasto::text || '/' then
    raise exception 'Ruta de archivo inválida';
  end if;
  if (select count(*) from gastos_adjuntos where gasto_id = p_gasto) >= 20 then raise exception 'Máximo 20 adjuntos por gasto'; end if;
  insert into gastos_adjuntos (empresa_id, gasto_id, nombre, storage_path, mime, size, subido_por, subido_por_nombre)
  values (s.s_empresa, p_gasto, left(coalesce(nullif(btrim(p_nombre), ''), 'adjunto'), 200), p_path, p_mime, p_size, s.s_usuario, s.s_nombre)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'nombre', p_nombre, 'mime', p_mime, 'size', p_size, 'subido_por', s.s_nombre, 'created_at', now());
end;
$fn$;

-- → { id, storage_path } (la API borra el archivo)
create or replace function :"schema".gasto_adjunto_quitar(p_gasto uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_estado text;
  v_path text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select estado into v_estado from gastos where id = p_gasto and empresa_id = s.s_empresa;
  if v_estado is null then raise exception 'Gasto no encontrado'; end if;
  if v_estado = 'anulado' then raise exception 'El gasto está anulado'; end if;
  delete from gastos_adjuntos where id = p_id and gasto_id = p_gasto returning storage_path into v_path;
  if v_path is null then raise exception 'Adjunto no encontrado'; end if;
  return jsonb_build_object('id', p_id, 'storage_path', v_path);
end;
$fn$;

-- =============================================================================
-- 8. Gastos recurrentes (plantillas) y vencimientos
-- =============================================================================

-- p = { id?, nombre, proveedor_id?, sucursal_id?, con_comprobante?, tipo_comprobante?, tipo_pago, plazo_dias?,
--       medio_pago?, cuenta_bancaria_id?, moneda?, tipo_cambio?, dia_vencimiento, descripcion?, activo?,
--       vigente_desde?, vigente_hasta?, items: [{ categoria_id, descripcion, monto (0 = a completar), iva_tipo, sucursal_id?, empleado_id? }] }
create or replace function :"schema".guardar_gasto_recurrente(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := btrim(coalesce(p->>'nombre', ''));
  v_tipo_pago text := coalesce(nullif(p->>'tipo_pago', ''), 'contado');
  v_medio text := nullif(p->>'medio_pago', '');
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_tc numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then coalesce(nullif(p->>'tipo_cambio', '')::numeric, 0) else 1 end;
  v_dia integer := coalesce(nullif(p->>'dia_vencimiento', '')::integer, 10);
  v_prov uuid := nullif(p->>'proveedor_id', '')::uuid;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_cuenta uuid := nullif(p->>'cuenta_bancaria_id', '')::uuid;
  v_con boolean := coalesce((nullif(p->>'con_comprobante', ''))::boolean, true);
  v_items jsonb := '[]'::jsonb;
  it jsonb;
  cat record;
  v_monto numeric;
  v_iva text;
  v_total numeric := 0;
  v_desde date := date_trunc('month', coalesce(nullif(p->>'vigente_desde', '')::date, (now() at time zone 'America/Asuncion')::date))::date;
  v_hasta date := date_trunc('month', nullif(p->>'vigente_hasta', '')::date)::date;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if length(v_nombre) < 2 then raise exception 'Escribí un nombre (ej. Alquiler del local)'; end if;
  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición inválida'; end if;
  if v_medio is not null and v_medio not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then raise exception 'Medio de pago inválido'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_tc <= 0 then raise exception 'Cargá el tipo de cambio de referencia'; end if;
  if v_dia not between 1 and 31 then raise exception 'El día de vencimiento va de 1 a 31'; end if;
  if v_hasta is not null and v_hasta < v_desde then raise exception 'La vigencia termina antes de empezar'; end if;
  if v_prov is not null and not exists (select 1 from proveedores where id = v_prov and empresa_id = s.s_empresa) then raise exception 'Proveedor no encontrado'; end if;
  if v_tipo_pago = 'credito' and v_prov is null then raise exception 'A crédito elegí el proveedor'; end if;
  if v_con and v_prov is null then raise exception 'Con comprobante fiscal elegí el proveedor (o marcalo "sin comprobante")'; end if;
  if v_suc is not null and not exists (select 1 from sucursales where id = v_suc and empresa_id = s.s_empresa) then raise exception 'Sucursal no encontrada'; end if;
  if v_cuenta is not null and not exists (select 1 from cuentas_bancarias where id = v_cuenta and empresa_id = s.s_empresa) then raise exception 'Cuenta bancaria no encontrada'; end if;
  if v_medio = 'efectivo' and v_moneda <> 'GS' then raise exception 'El efectivo de la caja es en guaraníes'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Cargá al menos una línea'; end if;
  if jsonb_array_length(p->'items') > 50 then raise exception 'Máximo 50 líneas'; end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    select c.id, c.nombre, c.es_rubro into cat from gasto_categorias c
     where c.id = nullif(it->>'categoria_id', '')::uuid and c.empresa_id = s.s_empresa;
    if cat.id is null then raise exception 'Cada línea necesita su subcategoría'; end if;
    if cat.es_rubro then raise exception 'Elegí una subcategoría de "%" (no el rubro)', cat.nombre; end if;
    v_monto := round(coalesce(nullif(it->>'monto', '')::numeric, 0), case when v_moneda = 'USD' then 2 else 0 end);
    if v_monto < 0 then raise exception 'Monto negativo'; end if;
    v_iva := coalesce(nullif(it->>'iva_tipo', ''), '10%');
    if v_iva not in ('10%', '5%', 'exenta') then raise exception 'Tipo de IVA inválido'; end if;
    if not v_con then v_iva := 'exenta'; end if;
    if nullif(it->>'empleado_id', '') is not null and not exists (select 1 from empleados where id = (it->>'empleado_id')::uuid and empresa_id = s.s_empresa) then
      raise exception 'Empleado no encontrado';
    end if;
    if nullif(it->>'sucursal_id', '') is not null and not exists (select 1 from sucursales where id = (it->>'sucursal_id')::uuid and empresa_id = s.s_empresa) then
      raise exception 'Sucursal de una línea no encontrada';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'categoria_id', cat.id, 'descripcion', left(coalesce(nullif(btrim(it->>'descripcion'), ''), cat.nombre), 300),
      'monto', v_monto, 'iva_tipo', v_iva, 'sucursal_id', nullif(it->>'sucursal_id', ''), 'empleado_id', nullif(it->>'empleado_id', '')));
    v_total := v_total + v_monto;
  end loop;

  if v_id is null then
    insert into gastos_recurrentes (empresa_id, nombre, proveedor_id, sucursal_id, con_comprobante, tipo_comprobante, tipo_pago, plazo_dias,
                                    medio_pago, cuenta_bancaria_id, moneda, tipo_cambio, dia_vencimiento, items, total, descripcion, activo,
                                    vigente_desde, vigente_hasta, created_by)
    values (s.s_empresa, left(v_nombre, 120), v_prov, v_suc, v_con, case when v_con then left(nullif(btrim(p->>'tipo_comprobante'), ''), 60) end,
            v_tipo_pago, case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
            case when v_tipo_pago = 'contado' then v_medio end, case when v_tipo_pago = 'contado' then v_cuenta end,
            v_moneda, v_tc, v_dia, v_items, v_total, left(nullif(btrim(p->>'descripcion'), ''), 500), true, v_desde, v_hasta, auth.uid())
    returning id into v_id;
  else
    update gastos_recurrentes set nombre = left(v_nombre, 120), proveedor_id = v_prov, sucursal_id = v_suc, con_comprobante = v_con,
           tipo_comprobante = case when v_con then left(nullif(btrim(p->>'tipo_comprobante'), ''), 60) end,
           tipo_pago = v_tipo_pago, plazo_dias = case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
           medio_pago = case when v_tipo_pago = 'contado' then v_medio end,
           cuenta_bancaria_id = case when v_tipo_pago = 'contado' then v_cuenta end,
           moneda = v_moneda, tipo_cambio = v_tc, dia_vencimiento = v_dia, items = v_items, total = v_total,
           descripcion = left(nullif(btrim(p->>'descripcion'), ''), 500),
           activo = coalesce((nullif(p->>'activo', ''))::boolean, activo), vigente_desde = v_desde, vigente_hasta = v_hasta, updated_at = now()
     where id = v_id and empresa_id = s.s_empresa;
    if not found then raise exception 'Plantilla no encontrada'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'total', v_total);
end;
$fn$;

-- Sin gastos generados se borra; con historia se desactiva (los gastos quedan).
create or replace function :"schema".eliminar_gasto_recurrente(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform 1 from gastos_recurrentes where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Plantilla no encontrada'; end if;
  if exists (select 1 from gastos where recurrente_id = p_id) then
    update gastos_recurrentes set activo = false, updated_at = now() where id = p_id;
    return jsonb_build_object('id', p_id, 'accion', 'desactivada');
  end if;
  delete from gastos_recurrentes where id = p_id;
  return jsonb_build_object('id', p_id, 'accion', 'eliminada');
end;
$fn$;

-- Fecha programada de una plantilla en un período (el día se ajusta al último del mes).
create or replace function :"schema".gasto_recurrente_fecha(p_periodo date, p_dia integer)
returns date language sql immutable as $$
  select (date_trunc('month', p_periodo)::date
          + (least(p_dia, extract(day from (date_trunc('month', p_periodo) + interval '1 month - 1 day'))::integer) - 1))::date
$$;

-- Plantillas con su estado en el período (generado o no) y totales.
create or replace function :"schema".listar_gastos_recurrentes(p_periodo date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_per date := date_trunc('month', coalesce(p_periodo, (now() at time zone 'America/Asuncion')::date))::date;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  with pl as (
    select gr.*,
           (gr.activo and gr.vigente_desde <= v_per and (gr.vigente_hasta is null or gr.vigente_hasta >= v_per)) as aplica,
           gasto_recurrente_fecha(v_per, gr.dia_vencimiento) as fecha_periodo,
           (select jsonb_build_object('id', g.id, 'numero', g.numero, 'estado', g.estado, 'total', g.total, 'total_gs', g.total_gs)
              from gastos g where g.recurrente_id = gr.id and g.periodo = v_per and g.estado <> 'anulado' limit 1) as generado,
           (select max(g.periodo) from gastos g where g.recurrente_id = gr.id and g.estado <> 'anulado') as ultimo_periodo
      from gastos_recurrentes gr where gr.empresa_id = s.s_empresa
  )
  select jsonb_build_object(
    'periodo', v_per,
    'plantillas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'nombre', pl.nombre, 'descripcion', pl.descripcion, 'activo', pl.activo, 'aplica', pl.aplica,
        'proveedor_id', pl.proveedor_id, 'proveedor_nombre', (select coalesce(nullif(btrim(pr.nombre_comercial), ''), pr.nombre) from proveedores pr where pr.id = pl.proveedor_id),
        'sucursal_id', pl.sucursal_id, 'sucursal_nombre', (select su.nombre from sucursales su where su.id = pl.sucursal_id),
        'con_comprobante', pl.con_comprobante, 'tipo_comprobante', pl.tipo_comprobante, 'tipo_pago', pl.tipo_pago, 'plazo_dias', pl.plazo_dias,
        'medio_pago', pl.medio_pago, 'cuenta_bancaria_id', pl.cuenta_bancaria_id, 'moneda', pl.moneda, 'tipo_cambio', pl.tipo_cambio,
        'dia_vencimiento', pl.dia_vencimiento, 'items', pl.items, 'total', pl.total, 'vigente_desde', pl.vigente_desde, 'vigente_hasta', pl.vigente_hasta,
        'categorias', (select string_agg(distinct coalesce(rb.nombre || ' › ', '') || c.nombre, ', ')
                         from jsonb_array_elements(pl.items) x join gasto_categorias c on c.id = (x->>'categoria_id')::uuid
                         left join gasto_categorias rb on rb.id = c.padre_id),
        'fecha_periodo', pl.fecha_periodo, 'generado', pl.generado, 'ultimo_periodo', pl.ultimo_periodo
      ) order by pl.activo desc, pl.dia_vencimiento, pl.nombre) from pl), '[]'::jsonb),
    'resumen', (select jsonb_build_object(
        'activas', count(*) filter (where activo),
        'aplican', count(*) filter (where aplica),
        'generadas', count(*) filter (where aplica and generado is not null),
        'pendientes', count(*) filter (where aplica and generado is null),
        'previsto_mes', coalesce(sum(round(total * tipo_cambio)) filter (where aplica), 0),
        'a_completar', count(*) filter (where aplica and total = 0)) from pl)
  ) into r;
  return r;
end;
$fn$;

-- "Generar gastos del mes": crea los BORRADORES del período de las plantillas que aplican y
-- todavía no lo tienen (p_ids limita a esas). Nunca confirma nada. → { periodo, creados, ya_estaban }
create or replace function :"schema".generar_gastos_recurrentes(p_periodo date, p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_per date := date_trunc('month', p_periodo)::date;
  pl gastos_recurrentes;
  v_id uuid;
  v_fecha date;
  v_creados jsonb := '[]'::jsonb;
  v_ya integer := 0;
  v_mes text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if p_periodo is null then raise exception 'Elegí el mes'; end if;
  if v_per > date_trunc('month', (now() at time zone 'America/Asuncion')::date + interval '2 months')::date then
    raise exception 'Solo se generan gastos hasta dos meses adelante';
  end if;
  v_mes := (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from v_per)::integer]
           || ' ' || extract(year from v_per)::integer;

  for pl in select * from gastos_recurrentes
             where empresa_id = s.s_empresa and activo and vigente_desde <= v_per and (vigente_hasta is null or vigente_hasta >= v_per)
               and (p_ids is null or id = any (p_ids))
             order by dia_vencimiento, nombre
             for update loop
    if exists (select 1 from gastos where recurrente_id = pl.id and periodo = v_per and estado <> 'anulado') then
      v_ya := v_ya + 1;
      continue;
    end if;
    v_fecha := gasto_recurrente_fecha(v_per, pl.dia_vencimiento);
    insert into gastos (empresa_id, estado, created_by, usuario_nombre, recurrente_id, periodo, fecha_programada, fecha)
    values (s.s_empresa, 'borrador', auth.uid(), s.s_nombre, pl.id, v_per, v_fecha, v_fecha)
    returning id into v_id;
    perform gasto_escribir(v_id, jsonb_build_object(
      'proveedor_id', pl.proveedor_id, 'sucursal_id', pl.sucursal_id, 'con_comprobante', pl.con_comprobante,
      'tipo_comprobante', pl.tipo_comprobante, 'tipo_pago', pl.tipo_pago, 'plazo_dias', pl.plazo_dias,
      'fecha_vencimiento', case when pl.tipo_pago = 'credito' then v_fecha end,
      'medio_pago', pl.medio_pago, 'cuenta_bancaria_id', pl.cuenta_bancaria_id, 'moneda', pl.moneda, 'tipo_cambio', pl.tipo_cambio,
      'descripcion', pl.nombre || ' · ' || v_mes, 'observacion', pl.descripcion, 'items', pl.items), s.s_empresa, s.s_sucursal);
    v_creados := v_creados || jsonb_build_array(jsonb_build_object('id', v_id, 'plantilla', pl.nombre, 'fecha', v_fecha, 'total', pl.total, 'moneda', pl.moneda));
  end loop;
  return jsonb_build_object('periodo', v_per, 'creados', v_creados, 'ya_estaban', v_ya);
end;
$fn$;

-- Próximos vencimientos (y lo vencido): borradores programados, plantillas sin generar del
-- mes actual y el próximo, y deudas con proveedores (gastos y compras) por vencer.
create or replace function :"schema".gastos_proximos_vencimientos(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_lim date;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_lim := v_hoy + least(greatest(coalesce(p_dias, 30), 1), 120);
  with items as (
    select 'borrador'::text as tipo, g.fecha_programada as fecha, coalesce(g.descripcion, 'Gasto programado') as concepto,
           g.proveedor_nombre as proveedor, g.moneda, g.total as monto, g.total_gs as monto_gs, g.id as gasto_id, null::uuid as compra_id,
           g.recurrente_id, null::uuid as cxp_id
      from gastos g
     where g.empresa_id = s.s_empresa and g.estado = 'borrador' and g.fecha_programada is not null and g.fecha_programada <= v_lim
    union all
    select 'programado', gasto_recurrente_fecha(per.p, gr.dia_vencimiento), gr.nombre,
           (select coalesce(nullif(btrim(pr.nombre_comercial), ''), pr.nombre) from proveedores pr where pr.id = gr.proveedor_id),
           gr.moneda, gr.total, round(gr.total * gr.tipo_cambio), null, null, gr.id, null
      from gastos_recurrentes gr
      cross join (values (date_trunc('month', v_hoy)::date), ((date_trunc('month', v_hoy) + interval '1 month')::date)) as per(p)
     where gr.empresa_id = s.s_empresa and gr.activo and gr.vigente_desde <= per.p and (gr.vigente_hasta is null or gr.vigente_hasta >= per.p)
       and gasto_recurrente_fecha(per.p, gr.dia_vencimiento) <= v_lim
       and not exists (select 1 from gastos g where g.recurrente_id = gr.id and g.periodo = per.p and g.estado <> 'anulado')
    union all
    select 'a_pagar', x.vencimiento, coalesce('Gasto ' || g.numero || coalesce(' · ' || g.descripcion, ''), 'Compra ' || c.numero_control),
           pr.nombre, x.moneda, x.saldo, case when x.moneda = 'USD' then round(x.saldo * coalesce(g.tipo_cambio, c.tipo_cambio, 1)) else x.saldo end,
           x.gasto_id, x.compra_id, null, x.id
      from cuentas_por_pagar x
      join proveedores pr on pr.id = x.proveedor_id
      left join gastos g on g.id = x.gasto_id
      left join compras c on c.id = x.compra_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0 and x.vencimiento <= v_lim
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'hasta', v_lim,
    'total_gs', coalesce((select sum(monto_gs) from items), 0),
    'vencido_gs', coalesce((select sum(monto_gs) from items where fecha < v_hoy), 0),
    'rows', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('vencido', i.fecha < v_hoy, 'dias', i.fecha - v_hoy) order by i.fecha, i.concepto)
                      from (select * from items order by fecha, concepto limit 200) i), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 9. Presupuesto mensual por categoría
-- =============================================================================

-- Rubros y subcategorías con lo previsto y lo gastado del mes (y lo previsto del mes anterior
-- para "Copiar del mes anterior"). categoria_id null = compras de mercadería.
create or replace function :"schema".presupuesto_gastos(p_periodo date)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_per date := date_trunc('month', coalesce(p_periodo, (now() at time zone 'America/Asuncion')::date))::date;
  v_fin date;
  v_ant date;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_fin := (v_per + interval '1 month - 1 day')::date;
  v_ant := (v_per - interval '1 month')::date;
  with gastado as (
    select i.categoria_id, sum(round(i.monto * g.tipo_cambio)) as monto
      from gastos g join gasto_items i on i.gasto_id = g.id
     where g.empresa_id = s.s_empresa and g.estado = 'confirmado' and g.fecha between v_per and v_fin
     group by i.categoria_id
  ),
  pres as (select categoria_id, monto from gastos_presupuestos where empresa_id = s.s_empresa and periodo = v_per),
  pant as (select categoria_id, monto from gastos_presupuestos where empresa_id = s.s_empresa and periodo = v_ant)
  select jsonb_build_object(
    'periodo', v_per,
    'mercaderia', jsonb_build_object(
       'previsto', (select monto from pres where categoria_id is null),
       'anterior', (select monto from pant where categoria_id is null),
       'gastado', (select coalesce(sum(round(c.total * case when c.moneda = 'USD' then c.tipo_cambio else 1 end)), 0)
                     from compras c where c.empresa_id = s.s_empresa and c.estado = 'registrada'
                      and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between v_per and v_fin)),
    'rubros', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rb.id, 'nombre', rb.nombre,
        'previsto', (select monto from pres where categoria_id = rb.id),
        'anterior', (select monto from pant where categoria_id = rb.id),
        'gastado', coalesce((select sum(gs.monto) from gastado gs join gasto_categorias c on c.id = gs.categoria_id where c.padre_id = rb.id), 0),
        'subcategorias', coalesce((select jsonb_agg(jsonb_build_object(
            'id', c.id, 'nombre', c.nombre, 'tipo_costo', c.tipo_costo,
            'previsto', (select monto from pres where categoria_id = c.id),
            'anterior', (select monto from pant where categoria_id = c.id),
            'gastado', coalesce((select monto from gastado where categoria_id = c.id), 0)) order by c.orden, c.nombre)
          from gasto_categorias c where c.padre_id = rb.id and (c.activo or exists (select 1 from pres where categoria_id = c.id))), '[]'::jsonb)
      ) order by rb.orden, rb.nombre)
      from gasto_categorias rb where rb.empresa_id = s.s_empresa and rb.es_rubro and rb.activo), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- Reemplaza el presupuesto del mes. p_items = [{ categoria_id (null = mercadería), monto }]; monto 0 o vacío = sin presupuesto.
create or replace function :"schema".guardar_presupuesto_gastos(p_periodo date, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_per date := date_trunc('month', p_periodo)::date;
  it jsonb;
  v_cat uuid;
  v_monto numeric;
  v_n integer := 0;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if p_periodo is null then raise exception 'Elegí el mes'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Faltan los montos'; end if;
  delete from gastos_presupuestos where empresa_id = s.s_empresa and periodo = v_per;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cat := nullif(it->>'categoria_id', '')::uuid;
    v_monto := round(coalesce(nullif(it->>'monto', '')::numeric, 0));
    if v_monto < 0 then raise exception 'Un monto previsto es negativo'; end if;
    if v_monto = 0 then continue; end if;
    if v_cat is not null and not exists (select 1 from gasto_categorias where id = v_cat and empresa_id = s.s_empresa) then
      raise exception 'Categoría no encontrada';
    end if;
    insert into gastos_presupuestos (empresa_id, periodo, categoria_id, monto) values (s.s_empresa, v_per, v_cat, v_monto)
    on conflict (empresa_id, periodo, coalesce(categoria_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set monto = excluded.monto, updated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('periodo', v_per, 'categorias', v_n);
end;
$fn$;

-- =============================================================================
-- 10. RESUMEN del módulo (y base del "estado de cuenta empresa" de Reportes)
--   gastos_resumen(desde, hasta, sucursal) — todo en Gs. (USD × tipo de cambio del documento):
--   totales (compras de mercadería + gastos operativos, IVA crédito fiscal, no deducible, fijo /
--   variable, deuda con proveedores), el período anterior de igual largo, por rubro (con
--   subcategorías y presupuesto), por mes (6 meses hasta `hasta`, o el rango si es más largo),
--   por sucursal, top proveedores y presupuesto vs gastado.
--   Compras: estado 'registrada', fecha de factura, sucursal del depósito; costo variable.
--   Gastos: confirmados, por LÍNEA (cada línea tiene su sucursal y su subcategoría).
-- =============================================================================
create or replace function :"schema".gastos_resumen(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date;
  v_hasta date;
  v_ant_desde date;
  v_ant_hasta date;
  v_mes_ini date;
  v_meses integer;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_desde := coalesce(p_desde, date_trunc('month', v_hoy)::date);
  v_hasta := coalesce(p_hasta, v_hoy);
  if v_hasta < v_desde then raise exception 'El rango de fechas está invertido'; end if;
  if v_hasta - v_desde > 3700 then raise exception 'El rango máximo es de 10 años'; end if;
  -- Período anterior comparable: si el rango arranca el 1° de un mes, los mismos días del mes
  -- (o meses) anterior (1–15 oct ↔ 1–15 sep); si no, el mismo largo justo antes.
  if extract(day from v_desde) = 1 then
    v_ant_desde := (v_desde - make_interval(months => greatest(1, (extract(year from age(v_hasta + 1, v_desde)) * 12
                                                                     + extract(month from age(v_hasta + 1, v_desde)))::integer)))::date;
    v_ant_hasta := least((v_ant_desde + (v_hasta - v_desde)), v_desde - 1);
    if (v_hasta + 1) = (date_trunc('month', v_hasta) + interval '1 month')::date then
      -- rango de meses completos → meses completos anteriores
      v_ant_hasta := v_desde - 1;
    end if;
  else
    v_ant_hasta := v_desde - 1;
    v_ant_desde := v_desde - (v_hasta - v_desde) - 1;
  end if;
  v_meses := least(greatest((extract(year from age(date_trunc('month', v_hasta), date_trunc('month', v_desde))) * 12
                             + extract(month from age(date_trunc('month', v_hasta), date_trunc('month', v_desde))))::integer + 1, 6), 24);
  v_mes_ini := (date_trunc('month', v_hasta) - make_interval(months => v_meses - 1))::date;

  with mov as (
    -- Compras de mercadería (receta 49/50): una fila por compra.
    select 'compra'::text as origen, c.id as doc_id, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           d.sucursal_id, c.proveedor_id, c.proveedor_nombre, null::uuid as categoria_id, null::uuid as rubro_id,
           'variable'::text as tipo_costo,
           round(c.total * case when c.moneda = 'USD' then c.tipo_cambio else 1 end) as monto,
           round(c.monto_iva * case when c.moneda = 'USD' then c.tipo_cambio else 1 end) as iva,
           true as deducible
      from compras c left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada'
    union all
    -- Gastos operativos: una fila por línea.
    select 'gasto', g.id, g.fecha, coalesce(i.sucursal_id, g.sucursal_id), g.proveedor_id, g.proveedor_nombre, i.categoria_id, c.padre_id,
           coalesce(c.tipo_costo, 'variable'), round(i.monto * g.tipo_cambio), round(i.monto_iva * g.tipo_cambio), i.deducible
      from gastos g join gasto_items i on i.gasto_id = g.id left join gasto_categorias c on c.id = i.categoria_id
     where g.empresa_id = s.s_empresa and g.estado = 'confirmado'
  ),
  suc as (select * from mov where p_sucursal is null or sucursal_id = p_sucursal),
  per as (select * from suc where fecha between v_desde and v_hasta),
  ant as (select * from suc where fecha between v_ant_desde and v_ant_hasta),
  pres as (
    select p.categoria_id, coalesce(c.padre_id, c.id) as rubro_id, sum(p.monto) as monto
      from gastos_presupuestos p left join gasto_categorias c on c.id = p.categoria_id
     where p.empresa_id = s.s_empresa and p.periodo between date_trunc('month', v_desde)::date and date_trunc('month', v_hasta)::date
     group by p.categoria_id, coalesce(c.padre_id, c.id)
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'sucursal_id', p_sucursal,
    'totales', (select jsonb_build_object(
        'total', coalesce(sum(monto), 0),
        'compras', coalesce(sum(monto) filter (where origen = 'compra'), 0),
        'operativos', coalesce(sum(monto) filter (where origen = 'gasto'), 0),
        'iva_credito', coalesce(sum(iva) filter (where deducible), 0),
        'no_deducible', coalesce(sum(monto) filter (where not deducible), 0),
        'fijo', coalesce(sum(monto) filter (where tipo_costo = 'fijo'), 0),
        'variable', coalesce(sum(monto) filter (where tipo_costo = 'variable'), 0),
        'docs_compras', count(distinct doc_id) filter (where origen = 'compra'),
        'docs_gastos', count(distinct doc_id) filter (where origen = 'gasto')) from per),
    'anterior', (select jsonb_build_object('desde', v_ant_desde, 'hasta', v_ant_hasta,
        'total', coalesce(sum(monto), 0),
        'compras', coalesce(sum(monto) filter (where origen = 'compra'), 0),
        'operativos', coalesce(sum(monto) filter (where origen = 'gasto'), 0)) from ant),
    'deuda', (select jsonb_build_object(
        'saldo_gs', coalesce(sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(g.tipo_cambio, c.tipo_cambio, 1)) else x.saldo end), 0),
        'vencido_gs', coalesce(sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(g.tipo_cambio, c.tipo_cambio, 1)) else x.saldo end)
                               filter (where x.vencimiento < v_hoy), 0),
        'cuentas', count(*))
      from cuentas_por_pagar x left join gastos g on g.id = x.gasto_id left join compras c on c.id = x.compra_id
      left join depositos d on d.id = c.deposito_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (p_sucursal is null or coalesce(g.sucursal_id, d.sucursal_id) = p_sucursal)),
    'borradores', (select jsonb_build_object('cantidad', count(*), 'total_gs', coalesce(sum(total_gs), 0))
                     from gastos g where g.empresa_id = s.s_empresa and g.estado = 'borrador'
                      and (p_sucursal is null or g.sucursal_id = p_sucursal)),
    'por_rubro', coalesce((
      select jsonb_agg(x order by (x->>'total')::numeric desc) from (
        select jsonb_build_object('id', null, 'nombre', 'Compras de mercadería', 'mercaderia', true,
                 'total', coalesce(sum(monto), 0), 'fijo', 0, 'variable', coalesce(sum(monto), 0),
                 'presupuesto', (select sum(monto) from pres where categoria_id is null),
                 'subcategorias', '[]'::jsonb) as x
          from per where origen = 'compra' having count(*) > 0 or exists (select 1 from pres where categoria_id is null)
        union all
        select jsonb_build_object('id', rb.id, 'nombre', rb.nombre, 'mercaderia', false,
                 'total', coalesce(t.total, 0), 'fijo', coalesce(t.fijo, 0), 'variable', coalesce(t.variable, 0),
                 'presupuesto', (select sum(monto) from pres where rubro_id = rb.id),
                 'subcategorias', coalesce((select jsonb_agg(jsonb_build_object('id', sc.categoria_id, 'nombre', c.nombre, 'total', sc.total)
                                                  order by sc.total desc)
                                             from (select categoria_id, sum(monto) as total from per where rubro_id = rb.id group by categoria_id) sc
                                             join gasto_categorias c on c.id = sc.categoria_id), '[]'::jsonb))
          from gasto_categorias rb
          left join (select rubro_id, sum(monto) as total, sum(monto) filter (where tipo_costo = 'fijo') as fijo,
                            sum(monto) filter (where tipo_costo = 'variable') as variable
                       from per where origen = 'gasto' group by rubro_id) t on t.rubro_id = rb.id
         where rb.empresa_id = s.s_empresa and rb.es_rubro
           and (coalesce(t.total, 0) > 0 or exists (select 1 from pres where rubro_id = rb.id))
      ) q), '[]'::jsonb),
    'por_mes', (select jsonb_agg(jsonb_build_object('mes', m.mes,
        'compras', coalesce((select sum(monto) from suc where origen = 'compra' and date_trunc('month', fecha)::date = m.mes), 0),
        'operativos', coalesce((select sum(monto) from suc where origen = 'gasto' and date_trunc('month', fecha)::date = m.mes), 0),
        'presupuesto', (select sum(p.monto) from gastos_presupuestos p where p.empresa_id = s.s_empresa and p.periodo = m.mes)) order by m.mes)
      from (select (v_mes_ini + make_interval(months => k))::date as mes from generate_series(0, v_meses - 1) k) m),
    'por_sucursal', coalesce((select jsonb_agg(jsonb_build_object('id', x.sucursal_id, 'nombre', coalesce(su.nombre, 'Sin sucursal'),
                         'compras', x.compras, 'operativos', x.operativos, 'total', x.compras + x.operativos) order by x.compras + x.operativos desc)
        from (select sucursal_id, coalesce(sum(monto) filter (where origen = 'compra'), 0) as compras,
                     coalesce(sum(monto) filter (where origen = 'gasto'), 0) as operativos
                from per group by sucursal_id) x left join sucursales su on su.id = x.sucursal_id), '[]'::jsonb),
    'top_proveedores', coalesce((select jsonb_agg(jsonb_build_object('id', x.proveedor_id, 'nombre', x.nombre,
                         'compras', x.compras, 'operativos', x.operativos, 'total', x.total) order by x.total desc)
        from (select proveedor_id, max(coalesce(proveedor_nombre, 'Sin proveedor')) as nombre,
                     coalesce(sum(monto) filter (where origen = 'compra'), 0) as compras,
                     coalesce(sum(monto) filter (where origen = 'gasto'), 0) as operativos, sum(monto) as total
                from per where proveedor_id is not null   -- sueldos, peajes… sin proveedor no son "proveedores"
               group by proveedor_id order by sum(monto) desc limit 8) x), '[]'::jsonb),
    'presupuesto', (select jsonb_build_object(
        'previsto', coalesce((select sum(monto) from pres), 0),
        'gastado_presupuestado', coalesce((select sum(p2.monto) from per p2
                                            where (p2.origen = 'compra' and exists (select 1 from pres where categoria_id is null))
                                               or (p2.origen = 'gasto' and exists (select 1 from pres where rubro_id = p2.rubro_id))), 0))),
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre) order by su.es_principal desc, su.nombre)
                            from sucursales su where su.empresa_id = s.s_empresa and su.activa), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 11. Seguridad: tablas de SOLO LECTURA para la sesión + permisos de funciones
-- =============================================================================
do $sec$
declare t text;
begin
  foreach t in array array['gasto_categorias', 'gastos', 'gasto_items', 'empleados', 'cuentas_bancarias',
                           'gastos_recurrentes', 'gastos_adjuntos', 'gastos_presupuestos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('drop policy if exists %I on %I', t || '_lectura', t);
    execute format('create policy %I on %I for select to authenticated using (empresa_id = empresa_actual())', t || '_lectura', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end
$sec$;

-- Internas.
revoke execute on function :"schema".gasto_escribir(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
revoke execute on function :"schema".gastos_catalogo_inicial(uuid) from public, anon, authenticated;
revoke execute on function :"schema".tg_empresas_gastos_catalogo() from public, anon, authenticated;
revoke execute on function :"schema".gasto_sucursal_defecto(uuid, uuid) from public, anon, authenticated;

-- Públicas (validan empresa y rol ADMIN adentro).
do $grants$
declare f text;
begin
  foreach f in array array[
    'guardar_gasto(jsonb)', 'confirmar_gasto(jsonb)', 'anular_gasto(uuid, text)', 'eliminar_gasto(uuid)',
    'listar_gastos(text, text, date, date, uuid, uuid, uuid, text, boolean, text, integer, integer)', 'gasto_detalle(uuid)',
    'gastos_catalogos(boolean)', 'guardar_gasto_categoria(jsonb)', 'guardar_empleado(jsonb)', 'guardar_cuenta_bancaria(jsonb)',
    'gasto_adjunto_agregar(uuid, text, text, text, bigint)', 'gasto_adjunto_quitar(uuid, uuid)',
    'guardar_gasto_recurrente(jsonb)', 'eliminar_gasto_recurrente(uuid)', 'listar_gastos_recurrentes(date)',
    'generar_gastos_recurrentes(date, uuid[])', 'gastos_proximos_vencimientos(integer)',
    'presupuesto_gastos(date)', 'guardar_presupuesto_gastos(date, jsonb)', 'gastos_resumen(date, date, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$grants$;
grant execute on function :"schema".gasto_recurrente_fecha(date, integer) to authenticated, service_role;

commit;
