-- =============================================================================
-- CAPAS DE COSTO PEPS ("cuánto queda de cada compra") — pedido del dueño, 27-oct-2026.
--
-- Si compro 50 leches a Gs. 5.000 y después 50 a Gs. 6.000, cada compra es una CAPA con
-- su costo, sus unidades compradas y las que QUEDAN. Las salidas consumen la capa más vieja
-- primero (PEPS) y el costo de la venta (CMV) es el costo de lo que salió, no el promedio.
-- Vale para todo producto que controla stock (Reventa y Materia prima). Los platos de Menú
-- no tienen stock: su costo es el PEPS de los ingredientes que descuenta su receta.
--
-- Modelo (por producto + DEPÓSITO, como el stock desde la receta 50):
--   · capas_costo      una capa por entrada con costo: compra / recepción de OC, stock
--                      inicial (alta del producto o importación), ajuste positivo, traslado
--                      recibido (la capa VIAJA: mismo costo, misma fecha de origen y
--                      capa_origen_id a la capa del depósito de salida), devolución sin consumo
--                      registrado (venta vieja anulada → capa "anulación" al costo de la línea).
--   · capas_consumos   qué capa (y cuánto) consumió cada salida: venta (con venta_item_id),
--                      ajuste/pérdida, traslado, anulación de compra. Las anulaciones devuelven
--                      a las MISMAS capas (revertido) y el traslado recibido recrea en destino
--                      lo que salió del origen (trasladado). capa_id NULL = FALTANTE: salió más
--                      de lo que cubrían las capas (se costea al promedio); la próxima entrada
--                      lo salda (saldado) antes de crear capa nueva.
--
-- LOTES (receta 44): EL LOTE ES LA CAPA. Un producto con controla_lotes ya tiene en `lotes`
--   su costo por entrada y el orden de salida FEFO (no se toca: lo siguen haciendo
--   lotes_consumir / lotes_revertir). Para esos productos capas_costo guarda SOLO las
--   unidades "sin lote" de cada depósito (stock previo a activar lotes, importaciones,
--   faltantes), alimentadas desde lotes_movimientos con lote_id NULL. Así no se duplica nada:
--   el costo de venta de una unidad con lote = costo de SU lote; sin lote = PEPS de las capas.
--   lote_entrada se redefine para que dos entradas al MISMO lote (mismo número y vencimiento)
--   promedien su costo (antes quedaba el de la primera).
--
-- Ganchos (NO se redefinen crear_venta, anular_venta, registrar_compra, traslados ni ajustes):
--   · BEFORE INSERT en movimientos_inventario (todo movimiento de stock pasa por inv_mover):
--     productos SIN lotes → aplica la entrada/salida a las capas y deja en el kardex el costo
--     PEPS de lo que salió (o el de la capa a la que volvió).
--   · AFTER INSERT en lotes_movimientos: productos CON lotes → venta de un lote = costo del
--     lote; unidades sin lote = capas.
--   · AFTER INSERT en ventas_items: anota la línea en curso (GUC erp.capas_vi) para que la
--     salida de stock que sigue (producto o ingredientes de la receta) le corrija el costo:
--     ventas_items.costo_unitario = costo PEPS (delta contra el promedio que puso crear_venta)
--     y ventas_items_insumos.costo_unitario igual por ingrediente. Reportes de ganancia, CMV,
--     estado de cuenta y medios de pago ya leen ventas_items.costo_unitario: quedan en PEPS.
--   · AFTER UPDATE OF controla_lotes en productos: al activar lotes las capas se ajustan al
--     saldo sin lote; al desactivarlos cada lote con unidades pasa a ser una capa.
--   productos.costo_promedio se sigue calculando igual (informativo y valores por defecto).
--
-- Consultas: capas_producto(id, agotadas) (ficha "Costo por compra") · capas_valor(...) (valor
--   del stock por capas: lo usan dashboard_inicio, reporte_perdidas y sucursales_depositos,
--   parcheadas abajo en su versión vigente) · verificar_capas(producto?) (invariante).
-- INVARIANTE por producto + depósito: stock = Σ capas.quedan + Σ lotes (si controla lotes)
--   − faltantes pendientes. Además cada capa: quedan = compradas − Σ (consumos − revertido).
-- Migración (UNA vez por empresa, marca en capas_migracion): por producto + depósito con
--   stock, UNA capa "Stock inicial" al costo promedio actual (con lotes: el saldo sin lote).
-- Tablas de solo lectura para la sesión: se leen con las funciones (piden "ver costos").
-- IDEMPOTENTE. Hoy = America/Asuncion. Va después de 78.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
create table if not exists :"schema".capas_costo (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,          -- orden de entrada (PEPS a igual fecha)
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id) on delete cascade,
  deposito_id uuid not null references :"schema".depositos(id) on delete restrict,
  fecha date not null,                              -- fecha de la entrada (un traslado conserva la de origen)
  origen text not null,
  cantidad_inicial numeric not null,                -- compradas / entradas
  quedan numeric not null,
  costo_unitario numeric not null default 0,        -- Gs., IVA incluido (como costo_promedio)
  compra_id uuid references :"schema".compras(id) on delete set null,
  proveedor_id uuid,
  proveedor_nombre text,
  documento_tipo text,
  documento_id uuid,
  documento_numero text,
  capa_origen_id uuid references :"schema".capas_costo(id) on delete set null,  -- traslado: capa del depósito de salida
  referencia text,
  movimiento_id uuid,                               -- fila del kardex que la creó (si hubo)
  created_at timestamptz not null default now(),
  constraint chk_capa_cantidad check (cantidad_inicial > 0),
  constraint chk_capa_quedan check (quedan >= 0 and quedan <= cantidad_inicial),
  constraint chk_capa_origen check (origen in ('compra', 'stock_inicial', 'ajuste', 'traslado', 'anulacion', 'lote'))
);
create index if not exists capas_peps_idx on :"schema".capas_costo (producto_id, deposito_id, fecha, seq) where quedan > 0;
create index if not exists capas_producto_idx on :"schema".capas_costo (producto_id, created_at desc);
create index if not exists capas_documento_idx on :"schema".capas_costo (documento_id) where documento_id is not null;

create table if not exists :"schema".capas_consumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id) on delete cascade,
  deposito_id uuid not null references :"schema".depositos(id) on delete restrict,
  capa_id uuid references :"schema".capas_costo(id) on delete cascade,  -- NULL = faltante (sin capa que lo cubra)
  cantidad numeric not null,
  costo_unitario numeric not null default 0,
  origen text not null,                             -- venta, traslado_salida, ajuste, perdida, anulacion_compra…
  documento_tipo text,
  documento_id uuid,
  venta_item_id uuid,
  movimiento_id uuid,
  revertido numeric not null default 0,             -- devuelto a la capa por una anulación
  trasladado numeric not null default 0,            -- recreado en el depósito de destino
  saldado numeric not null default 0,               -- faltante cubierto por una entrada posterior
  created_at timestamptz not null default now(),
  constraint chk_capa_cons_cantidad check (cantidad > 0),
  constraint chk_capa_cons_partes check (revertido >= 0 and trasladado >= 0 and saldado >= 0
                                         and revertido + trasladado + saldado <= cantidad)
);
create index if not exists capas_cons_doc_idx on :"schema".capas_consumos (documento_id, producto_id) where documento_id is not null;
create index if not exists capas_cons_capa_idx on :"schema".capas_consumos (capa_id) where capa_id is not null;
create index if not exists capas_cons_faltante_idx on :"schema".capas_consumos (producto_id, deposito_id) where capa_id is null;
create index if not exists capas_cons_item_idx on :"schema".capas_consumos (venta_item_id) where venta_item_id is not null;

-- Empresas ya migradas (la capa "Stock inicial" se crea una sola vez).
create table if not exists :"schema".capas_migracion (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  migrado_at timestamptz not null default now()
);

alter table :"schema".capas_costo     enable row level security;
alter table :"schema".capas_costo     force  row level security;
alter table :"schema".capas_consumos  enable row level security;
alter table :"schema".capas_consumos  force  row level security;
alter table :"schema".capas_migracion enable row level security;
alter table :"schema".capas_migracion force  row level security;
-- Costos: la sesión no las lee directo (capas_producto pide "ver costos").
revoke all on :"schema".capas_costo, :"schema".capas_consumos, :"schema".capas_migracion from anon, authenticated;
grant all on :"schema".capas_costo, :"schema".capas_consumos, :"schema".capas_migracion to service_role;

-- =============================================================================
-- 2. Primitivas (SECURITY DEFINER, no expuestas a la sesión)
-- =============================================================================

-- Entrada: primero salda faltantes pendientes del producto en el depósito; con lo que sobra
-- crea la capa. Devuelve el id de la capa (null si todo fue a saldar faltantes).
create or replace function :"schema".capa_crear(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_cantidad numeric, p_costo numeric, p_origen text,
  p_fecha date default null, p_doc_tipo text default null, p_doc_id uuid default null, p_doc_numero text default null,
  p_compra uuid default null, p_proveedor uuid default null, p_proveedor_nombre text default null,
  p_capa_origen uuid default null, p_referencia text default null, p_mov uuid default null
) returns uuid
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_resta numeric := p_cantidad;
  f record;
  v_toma numeric;
  v_id uuid;
begin
  if p_cantidad is null or p_cantidad <= 0 then return null; end if;
  for f in
    select c.id, c.cantidad - c.revertido - c.saldado - c.trasladado as pend
      from capas_consumos c
     where c.producto_id = p_producto and c.deposito_id = p_deposito and c.capa_id is null
       and c.cantidad - c.revertido - c.saldado - c.trasladado > 0
     order by c.created_at, c.id
     for update
  loop
    exit when v_resta <= 0;
    v_toma := least(f.pend, v_resta);
    update capas_consumos set saldado = saldado + v_toma where id = f.id;
    v_resta := v_resta - v_toma;
  end loop;
  if v_resta <= 0 then return null; end if;
  insert into capas_costo (empresa_id, producto_id, deposito_id, fecha, origen, cantidad_inicial, quedan, costo_unitario,
                           compra_id, proveedor_id, proveedor_nombre, documento_tipo, documento_id, documento_numero,
                           capa_origen_id, referencia, movimiento_id)
    values (p_empresa, p_producto, p_deposito, coalesce(p_fecha, (now() at time zone 'America/Asuncion')::date), p_origen,
            v_resta, v_resta, round(greatest(coalesce(p_costo, 0), 0), 4),
            p_compra, p_proveedor, nullif(left(btrim(coalesce(p_proveedor_nombre, '')), 120), ''), p_doc_tipo, p_doc_id,
            nullif(left(btrim(coalesce(p_doc_numero, '')), 60), ''), p_capa_origen, nullif(left(btrim(coalesce(p_referencia, '')), 200), ''), p_mov)
    returning id into v_id;
  return v_id;
end;
$fn$;

-- Salida PEPS: la capa más vieja primero (p_preferir: primero las capas de ESE documento,
-- ej. la anulación de una compra saca las unidades de su propia capa). Lo que las capas no
-- cubren queda como faltante al p_costo_faltante. Devuelve el costo total de lo que salió.
create or replace function :"schema".capas_salida(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_cantidad numeric, p_origen text,
  p_doc_tipo text, p_doc_id uuid, p_venta_item uuid, p_mov uuid, p_preferir uuid, p_costo_faltante numeric
) returns numeric
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_resta numeric := p_cantidad;
  c record;
  v_toma numeric;
  v_total numeric := 0;
begin
  if p_cantidad is null or p_cantidad <= 0 then return 0; end if;
  for c in
    select x.id, x.quedan, x.costo_unitario from capas_costo x
     where x.producto_id = p_producto and x.deposito_id = p_deposito and x.quedan > 0
     order by (p_preferir is not null and x.documento_id is not distinct from p_preferir) desc, x.fecha, x.seq
     for update
  loop
    exit when v_resta <= 0;
    v_toma := least(c.quedan, v_resta);
    update capas_costo set quedan = quedan - v_toma where id = c.id;
    insert into capas_consumos (empresa_id, producto_id, deposito_id, capa_id, cantidad, costo_unitario, origen,
                                documento_tipo, documento_id, venta_item_id, movimiento_id)
      values (p_empresa, p_producto, p_deposito, c.id, v_toma, c.costo_unitario, p_origen, p_doc_tipo, p_doc_id, p_venta_item, p_mov);
    v_total := v_total + v_toma * c.costo_unitario;
    v_resta := v_resta - v_toma;
  end loop;
  if v_resta > 0 then
    insert into capas_consumos (empresa_id, producto_id, deposito_id, capa_id, cantidad, costo_unitario, origen,
                                documento_tipo, documento_id, venta_item_id, movimiento_id)
      values (p_empresa, p_producto, p_deposito, null, v_resta, round(greatest(coalesce(p_costo_faltante, 0), 0), 4), p_origen,
              p_doc_tipo, p_doc_id, p_venta_item, p_mov);
    v_total := v_total + v_resta * greatest(coalesce(p_costo_faltante, 0), 0);
  end if;
  return v_total;
end;
$fn$;

-- Anulación: devuelve a las MISMAS capas lo que consumió el documento (hasta p_cantidad).
-- Un faltante devuelto: lo que seguía pendiente se cancela; lo que ya se había saldado vuelve
-- como capa nueva al costo del faltante. Devuelve (cantidad devuelta, costo).
create or replace function :"schema".capas_revertir(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_doc uuid, p_cantidad numeric, p_origenes text[], p_mov uuid,
  out r_cantidad numeric, out r_costo numeric
) language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_resta numeric := p_cantidad;
  r record;
  v_toma numeric;
  v_libre numeric;
begin
  r_cantidad := 0; r_costo := 0;
  if p_doc is null or p_cantidad is null or p_cantidad <= 0 then return; end if;
  for r in
    select c.* from capas_consumos c
     where c.documento_id = p_doc and c.producto_id = p_producto and c.deposito_id = p_deposito
       and c.origen = any (p_origenes) and c.cantidad - c.revertido - c.trasladado > 0
     order by c.created_at desc, c.id desc
     for update
  loop
    exit when v_resta <= 0;
    v_toma := least(r.cantidad - r.revertido - r.trasladado, v_resta);
    if r.capa_id is not null then
      update capas_costo set quedan = quedan + v_toma where id = r.capa_id;
      update capas_consumos set revertido = revertido + v_toma where id = r.id;
    else
      v_libre := greatest(r.cantidad - r.revertido - r.saldado - r.trasladado, 0);
      update capas_consumos set revertido = revertido + v_toma, saldado = saldado - greatest(v_toma - v_libre, 0) where id = r.id;
      if v_toma > v_libre then
        perform capa_crear(p_empresa, p_producto, p_deposito, v_toma - v_libre, r.costo_unitario, 'anulacion', null,
                           r.documento_tipo, r.documento_id, null, null, null, null, null, 'Devolución de un faltante', p_mov);
      end if;
    end if;
    r_cantidad := r_cantidad + v_toma;
    r_costo := r_costo + v_toma * r.costo_unitario;
    v_resta := v_resta - v_toma;
  end loop;
end;
$fn$;

-- Traslado recibido: recrea en el destino lo que salió del origen con ESE documento, capa
-- por capa (mismo costo, misma fecha de origen, capa_origen_id). Lo que falte (traslados
-- enviados antes de esta receta) entra al costo del traslado. Devuelve el costo total.
create or replace function :"schema".capas_trasladar(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_doc uuid, p_doc_numero text, p_cantidad numeric, p_costo numeric, p_mov uuid
) returns numeric
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_resta numeric := p_cantidad;
  r record;
  v_toma numeric;
  v_total numeric := 0;
begin
  if p_cantidad is null or p_cantidad <= 0 then return 0; end if;
  if p_doc is not null then
    for r in
      select c.id, c.capa_id, c.cantidad, c.revertido, c.trasladado, c.costo_unitario,
             o.fecha as o_fecha, o.compra_id as o_compra, o.proveedor_id as o_prov, o.proveedor_nombre as o_prov_nombre
        from capas_consumos c left join capas_costo o on o.id = c.capa_id
       where c.documento_id = p_doc and c.producto_id = p_producto and c.origen = 'traslado_salida'
         and c.cantidad - c.revertido - c.trasladado > 0
       order by c.created_at, c.id
       for update of c
    loop
      exit when v_resta <= 0;
      v_toma := least(r.cantidad - r.revertido - r.trasladado, v_resta);
      perform capa_crear(p_empresa, p_producto, p_deposito, v_toma, r.costo_unitario, 'traslado', r.o_fecha, 'traslado', p_doc,
                         p_doc_numero, r.o_compra, r.o_prov, r.o_prov_nombre, r.capa_id, null, p_mov);
      update capas_consumos set trasladado = trasladado + v_toma where id = r.id;
      v_total := v_total + v_toma * r.costo_unitario;
      v_resta := v_resta - v_toma;
    end loop;
  end if;
  if v_resta > 0 then
    perform capa_crear(p_empresa, p_producto, p_deposito, v_resta, p_costo, 'traslado', null, 'traslado', p_doc, p_doc_numero,
                       null, null, null, null, null, p_mov);
    v_total := v_total + v_resta * greatest(coalesce(p_costo, 0), 0);
  end if;
  return v_total;
end;
$fn$;

-- EL despachador: aplica un movimiento de stock a las capas según su origen. Devuelve el
-- costo total (entrada: lo que entró valorizado; salida: el costo PEPS de lo que salió).
create or replace function :"schema".capas_aplicar(
  p_empresa uuid, p_producto uuid, p_deposito uuid, p_tipo text, p_cantidad numeric, p_costo numeric, p_costo_prom numeric,
  p_origen text, p_doc_tipo text, p_doc_id uuid, p_doc_numero text, p_venta_item uuid,
  p_compra uuid, p_proveedor uuid, p_proveedor_nombre text, p_referencia text, p_mov uuid
) returns numeric
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_costo numeric := greatest(coalesce(nullif(p_costo, 0), p_costo_prom, 0), 0);
  v_cant numeric;
  v_cost numeric;
  v_resta numeric;
begin
  if p_cantidad is null or p_cantidad <= 0 then return 0; end if;
  if p_tipo = 'ENTRADA' then
    if p_origen = 'traslado_entrada' then
      return capas_trasladar(p_empresa, p_producto, p_deposito, p_doc_id, p_doc_numero, p_cantidad, v_costo, p_mov);
    end if;
    if p_origen in ('anulacion_venta', 'anulacion_traslado', 'anulacion_perdida', 'anulacion_ajuste') then
      select r_cantidad, r_costo into v_cant, v_cost
        from capas_revertir(p_empresa, p_producto, p_deposito, p_doc_id, p_cantidad,
               case p_origen when 'anulacion_venta' then array['venta']
                             when 'anulacion_traslado' then array['traslado_salida']
                             when 'anulacion_perdida' then array['perdida']
                             else array['ajuste', 'inventario_inicial'] end, p_mov);
      v_resta := p_cantidad - v_cant;
      if v_resta > 0 then
        perform capa_crear(p_empresa, p_producto, p_deposito, v_resta, v_costo, 'anulacion', null, p_doc_tipo, p_doc_id,
                           p_doc_numero, null, null, null, null, p_referencia, p_mov);
        v_cost := v_cost + v_resta * v_costo;
      end if;
      return v_cost;
    end if;
    perform capa_crear(p_empresa, p_producto, p_deposito, p_cantidad, v_costo,
                       case p_origen when 'compra' then 'compra' when 'inventario_inicial' then 'stock_inicial' else 'ajuste' end,
                       null, p_doc_tipo, p_doc_id, p_doc_numero, p_compra, p_proveedor, p_proveedor_nombre, null, p_referencia, p_mov);
    return p_cantidad * v_costo;
  end if;
  -- SALIDA. Las anulaciones de una entrada sacan primero de las capas de ese documento.
  return capas_salida(p_empresa, p_producto, p_deposito, p_cantidad, p_origen, p_doc_tipo, p_doc_id, p_venta_item, p_mov,
                      case when p_origen in ('anulacion_compra', 'anulacion_ajuste', 'anulacion_perdida') then p_doc_id end,
                      v_costo);
end;
$fn$;

-- Costo de una línea de venta: crear_venta la guardó al costo promedio; acá se corrige con
-- el delta (costo real de lo que salió − cantidad × costo supuesto). Sirve para el producto
-- de la línea y para cada ingrediente de su receta (ventas_items_insumos).
create or replace function :"schema".capas_costo_venta(
  p_venta_item uuid, p_venta uuid, p_producto uuid, p_cantidad numeric, p_total numeric, p_costo_supuesto numeric
) returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_delta numeric := coalesce(p_total, 0) - coalesce(p_cantidad, 0) * coalesce(p_costo_supuesto, 0);
begin
  if p_venta_item is null or v_delta = 0 then return; end if;
  update ventas_items set costo_unitario = round(coalesce(costo_unitario, 0) + v_delta / nullif(cantidad, 0), 4)
   where id = p_venta_item and (p_venta is null or venta_id = p_venta) and cantidad > 0;
  if found then
    update ventas_items_insumos set costo_unitario = round(coalesce(costo_unitario, 0) + v_delta / nullif(cantidad, 0), 4)
     where venta_item_id = p_venta_item and insumo_id = p_producto and cantidad > 0;
  end if;
end;
$fn$;

revoke execute on function :"schema".capa_crear(uuid, uuid, uuid, numeric, numeric, text, date, text, uuid, text, uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function :"schema".capas_salida(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function :"schema".capas_revertir(uuid, uuid, uuid, uuid, numeric, text[], uuid) from public, anon, authenticated;
revoke execute on function :"schema".capas_trasladar(uuid, uuid, uuid, uuid, text, numeric, numeric, uuid) from public, anon, authenticated;
revoke execute on function :"schema".capas_aplicar(uuid, uuid, uuid, text, numeric, numeric, numeric, text, text, uuid, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function :"schema".capas_costo_venta(uuid, uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;

-- =============================================================================
-- 3. Ganchos
-- =============================================================================

-- Línea de venta en curso: la salida de stock que sigue (inv_mover) es de esta línea.
create or replace function :"schema".tg_ventas_items_capas()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform set_config('erp.capas_vi', new.id::text, true);
  return null;
end;
$fn$;
drop trigger if exists trg_ventas_items_capas on :"schema".ventas_items;
create trigger trg_ventas_items_capas after insert on :"schema".ventas_items
  for each row execute function :"schema".tg_ventas_items_capas();

-- Kardex (productos SIN lotes): cada movimiento de inv_mover entra o sale de las capas y el
-- kardex queda con el costo real (PEPS) de lo que salió o volvió.
create or replace function :"schema".tg_movinv_capas()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  pr record;
  v_vi uuid;
  v_supuesto numeric := coalesce(new.costo_unitario, 0);
  v_total numeric;
begin
  select p.controla_lotes, p.controla_stock, coalesce(p.costo_promedio, 0) as cp into pr
    from productos p where p.id = new.producto_id;
  if not found or (pr.controla_lotes and pr.controla_stock) then return new; end if;  -- con lotes: lotes_movimientos
  if new.origen = 'venta' and new.tipo = 'SALIDA' then
    v_vi := nullif(current_setting('erp.capas_vi', true), '')::uuid;
  end if;
  v_total := capas_aplicar(new.empresa_id, new.producto_id, new.deposito_id, new.tipo, new.cantidad, new.costo_unitario, pr.cp,
                           new.origen, new.documento_tipo, new.documento_id, new.documento_numero, v_vi,
                           new.compra_id, new.proveedor_id, new.proveedor, new.referencia, new.id);
  if new.cantidad > 0 then new.costo_unitario := round(v_total / new.cantidad, 2); end if;
  if v_vi is not null then
    perform capas_costo_venta(v_vi, new.documento_id, new.producto_id, new.cantidad, v_total, v_supuesto);
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_movinv_capas on :"schema".movimientos_inventario;
create trigger trg_movinv_capas before insert on :"schema".movimientos_inventario
  for each row when (new.origen <> 'apertura') execute function :"schema".tg_movinv_capas();

-- Lotes (productos CON lotes): la venta de un lote cuesta lo que costó el lote; las unidades
-- sin lote (lote_id NULL) entran y salen de las capas.
create or replace function :"schema".tg_lotes_mov_capas()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  pr record;
  v_costo numeric;
  v_total numeric;
  v_venta boolean := new.origen = 'venta' and new.tipo = 'SALIDA' and new.venta_item_id is not null;
begin
  select p.controla_lotes, p.controla_stock, coalesce(p.costo_promedio, 0) as cp into pr
    from productos p where p.id = new.producto_id;
  if not found or not (pr.controla_lotes and pr.controla_stock) then return null; end if;
  if new.lote_id is not null then
    if v_venta then
      select coalesce(nullif(l.costo_unitario, 0), pr.cp) into v_costo from lotes l where l.id = new.lote_id;
      perform capas_costo_venta(new.venta_item_id, new.venta_id, new.producto_id, new.cantidad, new.cantidad * coalesce(v_costo, pr.cp), pr.cp);
    end if;
    return null;
  end if;
  if new.origen = 'sin_lote_inicial' then return null; end if;  -- lo acomoda tg_productos_capas_lotes
  v_total := capas_aplicar(new.empresa_id, new.producto_id, new.deposito_id, new.tipo, new.cantidad, pr.cp, pr.cp,
                           new.origen, new.documento_tipo, coalesce(new.documento_id, new.venta_id), null, new.venta_item_id,
                           new.compra_id, null, null, new.motivo, null);
  if v_venta then
    perform capas_costo_venta(new.venta_item_id, new.venta_id, new.producto_id, new.cantidad, v_total, pr.cp);
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_lotes_mov_capas on :"schema".lotes_movimientos;
create trigger trg_lotes_mov_capas after insert on :"schema".lotes_movimientos
  for each row when (new.lote_id is null or new.origen = 'venta') execute function :"schema".tg_lotes_mov_capas();

-- Activar / desactivar lotes en un producto.
create or replace function :"schema".tg_productos_capas_lotes()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  l record;
  v_obj numeric;
  v_act numeric;
begin
  if not coalesce(new.controla_stock, false) then return null; end if;
  if new.controla_lotes and not coalesce(old.controla_lotes, false) then
    -- Las capas pasan a ser el saldo SIN lote de cada depósito (stock − Σ lotes).
    for r in select sd.deposito_id, sd.cantidad from stock_depositos sd where sd.producto_id = new.id loop
      v_obj := r.cantidad - coalesce((select sum(x.cantidad) from lotes x
                                       where x.producto_id = new.id and x.deposito_id = r.deposito_id and x.cantidad > 0), 0);
      v_act := coalesce((select sum(c.quedan) from capas_costo c where c.producto_id = new.id and c.deposito_id = r.deposito_id), 0)
             - coalesce((select sum(f.cantidad - f.revertido - f.saldado - f.trasladado) from capas_consumos f
                          where f.producto_id = new.id and f.deposito_id = r.deposito_id and f.capa_id is null), 0);
      if v_act > v_obj then
        perform capas_salida(new.empresa_id, new.id, r.deposito_id, v_act - v_obj, 'activar_lotes', null, null, null, null, null,
                             coalesce(new.costo_promedio, 0));
      elsif v_act < v_obj then
        perform capa_crear(new.empresa_id, new.id, r.deposito_id, v_obj - v_act, coalesce(new.costo_promedio, 0), 'ajuste',
                           null, null, null, null, null, null, null, null, 'Saldo sin lote al activar lotes', null);
      end if;
    end loop;
  elsif coalesce(old.controla_lotes, false) and not new.controla_lotes then
    -- Cada lote con unidades pasa a ser una capa (con su costo y su fecha de entrada).
    for l in select * from lotes x where x.producto_id = new.id and x.cantidad > 0 order by x.vencimiento, x.created_at, x.id loop
      perform capa_crear(new.empresa_id, new.id, l.deposito_id, l.cantidad, coalesce(nullif(l.costo_unitario, 0), new.costo_promedio, 0),
                         'lote', (l.created_at at time zone 'America/Asuncion')::date, null, null, null, l.compra_id, null, null, null,
                         'Lote ' || l.numero || ' (vence ' || to_char(l.vencimiento, 'DD/MM/YYYY') || ')', null);
    end loop;
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_productos_capas_lotes on :"schema".productos;
create trigger trg_productos_capas_lotes after update of controla_lotes on :"schema".productos
  for each row when (old.controla_lotes is distinct from new.controla_lotes)
  execute function :"schema".tg_productos_capas_lotes();

-- =============================================================================
-- 4. lote_entrada — REDEFINIDA desde la 50 (misma firma). Única diferencia: dos entradas
--    al MISMO lote (número + vencimiento + depósito) promedian el costo del lote.
-- =============================================================================
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
    set costo_unitario = case when lotes.cantidad > 0 and coalesce(excluded.costo_unitario, 0) > 0 and coalesce(lotes.costo_unitario, 0) > 0
                              then round((lotes.cantidad * lotes.costo_unitario + excluded.cantidad * excluded.costo_unitario)
                                         / (lotes.cantidad + excluded.cantidad), 2)
                              when coalesce(excluded.costo_unitario, 0) > 0 then excluded.costo_unitario
                              else lotes.costo_unitario end,
        cantidad = lotes.cantidad + excluded.cantidad,
        cantidad_inicial = lotes.cantidad_inicial + excluded.cantidad
  returning id into v_id;
  insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, compra_id, motivo,
                                 documento_tipo, documento_id, documento_item_id)
    values (p_empresa, p_producto, v_id, p_deposito, 'ENTRADA', p_cantidad, p_origen, p_compra, left(p_motivo, 300),
            p_doc_tipo, p_doc_id, p_doc_item);
  return v_id;
end;
$fn$;
revoke execute on function :"schema".lote_entrada(uuid, uuid, uuid, text, date, numeric, numeric, text, uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- 5. Valor del stock por capas (Σ quedan × costo de cada capa + lotes; lo que las capas no
--    expliquen, al promedio). Lo usan los reportes de abajo.
-- =============================================================================
create or replace function :"schema".capas_valor(p_producto uuid, p_deposito uuid, p_cantidad numeric, p_costo_prom numeric)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(c.v, 0) + coalesce(l.v, 0)
       + (coalesce(p_cantidad, 0) - coalesce(c.q, 0) - coalesce(l.q, 0)) * coalesce(p_costo_prom, 0)
    from (select sum(x.quedan * x.costo_unitario) as v, sum(x.quedan) as q from capas_costo x
           where x.producto_id = p_producto and x.deposito_id = p_deposito and x.quedan > 0
             and x.empresa_id = coalesce(empresa_actual(), x.empresa_id)) c,
         (select sum(x.cantidad * coalesce(nullif(x.costo_unitario, 0), p_costo_prom, 0)) as v, sum(x.cantidad) as q
            from lotes x join productos pp on pp.id = x.producto_id and pp.controla_lotes
           where x.producto_id = p_producto and x.deposito_id = p_deposito and x.cantidad > 0
             and x.empresa_id = coalesce(empresa_actual(), x.empresa_id)) l
$$;
grant execute on function :"schema".capas_valor(uuid, uuid, numeric, numeric) to authenticated, service_role;

-- Reportes con "valor del stock" (versión VIGENTE de cada uno, parcheada en el lugar):
-- dashboard_inicio (Inicio), reporte_perdidas (impacto en el inventario) y
-- sucursales_depositos (valor por depósito). Idempotente: si ya no tiene el texto, no cambia.
do $patch$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.proname in ('dashboard_inicio', 'reporte_perdidas', 'sucursales_depositos')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'sd.cantidad * coalesce(p.costo_promedio, 0)',
                     'capas_valor(sd.producto_id, sd.deposito_id, sd.cantidad, p.costo_promedio)');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end
$patch$;

-- =============================================================================
-- 6. Ficha del producto: "Costo por compra"
--   capas_producto(id, agotadas) → { producto_id, controla_lotes, unidad_medida, costo_promedio,
--     stock_total, hoy, resumen: { unidades, valor, costo_proxima, deposito_proxima },
--     depositos: [{ deposito_id, deposito, unidades, valor, costo_proxima }],
--     capas: [{ id, tipo: capa|lote, fecha, origen, compra_id, compra_numero, proveedor,
--               documento_tipo, documento_numero, deposito_id, deposito, deposito_origen,
--               costo_unitario, compradas, quedan, valor, lote_numero, vencimiento, vencido,
--               orden (1 = la próxima que sale en su depósito), referencia }],
--     agotadas: N (capas/lotes ya agotados), faltante, descuadre }
--   Sin "ver costos" (ni "editar productos") → sin permiso.
-- =============================================================================
create or replace function :"schema".capas_producto(p_producto_id uuid, p_agotadas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  pr record;
  v_dep_def uuid;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if not (tiene_permiso('ver_costos') or tiene_permiso('editar_productos')) then perform exigir_permiso('ver_costos'); end if;
  select p.id, p.controla_lotes and p.controla_stock as con_lotes, p.controla_stock, coalesce(p.costo_promedio, 0) as cp,
         p.unidad_medida, p.stock_actual
    into pr from productos p where p.id = p_producto_id and p.empresa_id = v_emp;
  if not found then raise exception 'Producto no encontrado'; end if;
  v_dep_def := deposito_por_defecto(v_emp, (select u.sucursal_id from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1));

  with todas as (
    select 'capa'::text as tipo, c.id, c.fecha, c.created_at, c.origen, c.compra_id, co.numero_control as compra_numero,
           coalesce(c.proveedor_nombre, co.proveedor_nombre) as proveedor, c.documento_tipo, c.documento_numero,
           c.deposito_id, d.nombre as deposito, od.nombre as deposito_origen, c.costo_unitario,
           c.cantidad_inicial as compradas, c.quedan, null::text as lote_numero, null::date as vencimiento, false as vencido,
           c.referencia,
           -- orden de salida: con lotes, primero los lotes vigentes (FEFO) y después lo sin lote
           1 as grupo, c.fecha as k1, c.seq::numeric as k2
      from capas_costo c
      join depositos d on d.id = c.deposito_id
      left join compras co on co.id = c.compra_id
      left join capas_costo oc on oc.id = c.capa_origen_id
      left join depositos od on od.id = oc.deposito_id
     where c.producto_id = pr.id and c.empresa_id = v_emp
    union all
    select 'lote', l.id, (l.created_at at time zone 'America/Asuncion')::date, l.created_at,
           case l.origen when 'compra' then 'compra' when 'traslado' then 'traslado' when 'inventario_inicial' then 'stock_inicial' else 'ajuste' end,
           l.compra_id, co.numero_control, co.proveedor_nombre, null, null,
           l.deposito_id, d.nombre, null, coalesce(nullif(l.costo_unitario, 0), pr.cp),
           l.cantidad_inicial, l.cantidad, l.numero, l.vencimiento, l.vencimiento < v_hoy, null,
           case when l.vencimiento < v_hoy then 2 else 0 end, l.vencimiento, extract(epoch from l.created_at)::numeric
      from lotes l
      join depositos d on d.id = l.deposito_id
      left join compras co on co.id = l.compra_id
     where pr.con_lotes and l.producto_id = pr.id and l.empresa_id = v_emp
  ),
  vig as (
    select t.*, row_number() over (partition by t.deposito_id order by t.grupo, t.k1, t.k2) as orden
      from todas t where t.quedan > 0
  ),
  deps as (
    select v.deposito_id, max(v.deposito) as deposito, sum(v.quedan) as unidades, round(sum(v.quedan * v.costo_unitario)) as valor,
           max(v.costo_unitario) filter (where v.orden = 1 and not v.vencido) as costo_proxima
      from vig v group by v.deposito_id
  ),
  falt as (
    select coalesce(sum(f.cantidad - f.revertido - f.saldado - f.trasladado), 0) as q
      from capas_consumos f where f.producto_id = pr.id and f.capa_id is null
  ),
  prox as (
    select d.* from deps d where d.costo_proxima is not null
     order by (d.deposito_id = v_dep_def) desc, d.unidades desc limit 1
  )
  select jsonb_build_object(
    'producto_id', pr.id, 'controla_lotes', pr.con_lotes, 'controla_stock', pr.controla_stock,
    'unidad_medida', pr.unidad_medida, 'costo_promedio', pr.cp, 'stock_total', pr.stock_actual, 'hoy', v_hoy,
    'resumen', jsonb_build_object(
        'unidades', coalesce((select sum(unidades) from deps), 0),
        'valor', coalesce((select sum(valor) from deps), 0),
        'costo_proxima', (select costo_proxima from prox),
        'deposito_proxima', (select deposito from prox)),
    'depositos', coalesce((select jsonb_agg(jsonb_build_object('deposito_id', d.deposito_id, 'deposito', d.deposito,
                              'unidades', d.unidades, 'valor', d.valor, 'costo_proxima', d.costo_proxima)
                            order by (d.deposito_id = v_dep_def) desc, d.deposito) from deps d), '[]'::jsonb),
    'capas', coalesce((select jsonb_agg(x.j order by x.agotada, x.dep_def desc, x.deposito, x.orden, x.fecha desc, x.created_at desc)
                         from (select jsonb_build_object(
                                 'id', t.id, 'tipo', t.tipo, 'fecha', t.fecha, 'origen', t.origen, 'compra_id', t.compra_id,
                                 'compra_numero', t.compra_numero, 'proveedor', t.proveedor, 'documento_tipo', t.documento_tipo,
                                 'documento_numero', t.documento_numero, 'deposito_id', t.deposito_id, 'deposito', t.deposito,
                                 'deposito_origen', t.deposito_origen, 'costo_unitario', t.costo_unitario, 'compradas', t.compradas,
                                 'quedan', t.quedan, 'valor', round(t.quedan * t.costo_unitario), 'lote_numero', t.lote_numero,
                                 'vencimiento', t.vencimiento, 'vencido', t.vencido, 'referencia', t.referencia,
                                 'orden', v.orden) as j,
                                 t.quedan <= 0 as agotada, t.deposito_id = v_dep_def as dep_def, t.deposito,
                                 coalesce(v.orden, 0) as orden, t.fecha, t.created_at
                                 from todas t left join vig v on v.id = t.id
                                where t.quedan > 0 or p_agotadas
                                order by t.quedan <= 0, t.fecha desc
                                limit 500) x), '[]'::jsonb),
    'agotadas', (select count(*) from todas t where t.quedan <= 0),
    'faltante', (select q from falt),
    'descuadre', coalesce(pr.stock_actual, 0) - coalesce((select sum(unidades) from deps), 0) + (select q from falt)
  ) into r;
  return r;
end;
$fn$;
grant execute on function :"schema".capas_producto(uuid, boolean) to authenticated, service_role;

-- =============================================================================
-- 7. INVARIANTE: por producto + depósito, stock = Σ capas + Σ lotes − faltantes; y cada capa,
--    quedan = compradas − Σ (consumido − revertido). Sin empresa en la sesión (psql como
--    postgres) revisa todas las empresas.
-- =============================================================================
create or replace function :"schema".verificar_capas(p_producto uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  r jsonb;
begin
  if v_emp is null and session_user not in ('postgres', 'supabase_admin') then raise exception 'No hay empresa en la sesión'; end if;
  with base as (
    select sd.empresa_id, sd.producto_id, sd.deposito_id from stock_depositos sd
    union select c.empresa_id, c.producto_id, c.deposito_id from capas_costo c where c.quedan > 0
    union select f.empresa_id, f.producto_id, f.deposito_id from capas_consumos f where f.capa_id is null
  ),
  pd as (
    select b.empresa_id, b.producto_id, b.deposito_id, p.nombre, p.controla_lotes,
           coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = b.producto_id and sd.deposito_id = b.deposito_id), 0) as stock,
           coalesce((select sum(c.quedan) from capas_costo c where c.producto_id = b.producto_id and c.deposito_id = b.deposito_id), 0) as en_capas,
           case when p.controla_lotes then coalesce((select sum(l.cantidad) from lotes l
                                                      where l.producto_id = b.producto_id and l.deposito_id = b.deposito_id), 0) else 0 end as en_lotes,
           coalesce((select sum(f.cantidad - f.revertido - f.saldado - f.trasladado) from capas_consumos f
                      where f.producto_id = b.producto_id and f.deposito_id = b.deposito_id and f.capa_id is null), 0) as faltante
      from base b join productos p on p.id = b.producto_id and p.controla_stock
     where (v_emp is null or b.empresa_id = v_emp) and (p_producto is null or b.producto_id = p_producto)
  ),
  dif as (select * from pd where stock <> en_capas + en_lotes - faltante),
  cd as (
    select c.id, c.producto_id, c.deposito_id, c.cantidad_inicial, c.quedan,
           c.cantidad_inicial - coalesce((select sum(x.cantidad - x.revertido) from capas_consumos x where x.capa_id = c.id), 0) as segun_consumos
      from capas_costo c
     where (v_emp is null or c.empresa_id = v_emp) and (p_producto is null or c.producto_id = p_producto)
  )
  select jsonb_build_object(
    'ok', not exists (select 1 from dif) and not exists (select 1 from cd where quedan <> segun_consumos),
    'revisados', (select count(*) from pd),
    'diferencias', coalesce((select jsonb_agg(jsonb_build_object(
        'producto_id', producto_id, 'producto', nombre, 'deposito_id', deposito_id, 'stock', stock, 'en_capas', en_capas,
        'en_lotes', en_lotes, 'faltante', faltante, 'diferencia', stock - (en_capas + en_lotes - faltante)) order by nombre) from dif), '[]'::jsonb),
    'capas_descuadradas', coalesce((select jsonb_agg(to_jsonb(cd)) from cd where quedan <> segun_consumos), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;
grant execute on function :"schema".verificar_capas(uuid) to authenticated, service_role;

-- =============================================================================
-- 8. Migración (UNA vez por empresa): el stock que ya hay queda como UNA capa "Stock
--    inicial" por producto + depósito al costo promedio actual. Con lotes: los lotes ya son
--    sus capas; el saldo sin lote es la capa (o un faltante si los lotes dicen más).
-- =============================================================================
do $mig$
declare
  e record;
  r record;
  v_obj numeric;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  for e in select x.id from empresas x where not exists (select 1 from capas_migracion m where m.empresa_id = x.id) loop
    for r in
      select sd.producto_id, sd.deposito_id, sd.cantidad, p.controla_lotes, coalesce(p.costo_promedio, 0) as cp
        from stock_depositos sd join productos p on p.id = sd.producto_id
       where sd.empresa_id = e.id and p.controla_stock and sd.cantidad <> 0
         and not exists (select 1 from capas_costo c where c.producto_id = sd.producto_id and c.deposito_id = sd.deposito_id)
         and not exists (select 1 from capas_consumos c where c.producto_id = sd.producto_id and c.deposito_id = sd.deposito_id)
    loop
      v_obj := r.cantidad - case when r.controla_lotes
                                 then coalesce((select sum(l.cantidad) from lotes l
                                                 where l.producto_id = r.producto_id and l.deposito_id = r.deposito_id and l.cantidad > 0), 0)
                                 else 0 end;
      if v_obj > 0 then
        insert into capas_costo (empresa_id, producto_id, deposito_id, fecha, origen, cantidad_inicial, quedan, costo_unitario, referencia)
          values (e.id, r.producto_id, r.deposito_id, v_hoy, 'stock_inicial', v_obj, v_obj, round(r.cp, 4),
                  'Stock al activar el costo por compra (al costo promedio)');
      elsif v_obj < 0 then
        insert into capas_consumos (empresa_id, producto_id, deposito_id, capa_id, cantidad, costo_unitario, origen)
          values (e.id, r.producto_id, r.deposito_id, null, -v_obj, round(r.cp, 4), 'stock_inicial');
      end if;
    end loop;
    insert into capas_migracion (empresa_id) values (e.id);
  end loop;
end
$mig$;

commit;
