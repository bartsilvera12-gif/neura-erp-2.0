-- =============================================================================
-- FABRICACIÓN POR TANDA (pedido del dueño, 29-oct-2026).
--
-- "Compran la materia prima y fabrican para vender": Bolsa de maní 250 g lleva una receta
-- (maní + bolsa); al darle FABRICAR descuenta las materias primas y suma stock del producto.
--
-- Tipo de producto nuevo (el 4º): 'fabricado'
--   · tiene receta Y stock propio (controla_stock siempre), se vende en caja como Reventa.
--   · su stock sube con Fabricar (o con un ajuste); al venderse sale SU stock (no la receta).
--   · puede ser ingrediente de otra receta (es un insumo con stock, no se explota).
--
-- recetas.por_tanda (nuevo): la receta se FABRICA por tanda en vez de descontarse al vender.
--   · Fabricado → siempre por tanda. Menú → nunca.
--   · Materia prima con receta (preparación, ej. Salsa de la casa) → se elige: "Se descuenta
--     al vender" (como hasta ahora: sin stock propio, se explota) o "Se fabrica por tanda"
--     (tiene stock y se usa como cualquier materia prima).
--   · tiene_receta(p) pasa a significar "se EXPLOTA al usarse" (receta que no es por tanda):
--     así crear_venta, la caja, el menú QR, los pedidos, extras y opciones tratan a un
--     fabricado / preparación por tanda como un producto con stock, sin redefinirlas.
--     receta_existe(p) = tiene ingredientes (lo usan las pantallas de recetas).
--   · receta_insumos / receta_insumos_sin: la explosión se corta en las recetas por tanda.
--
-- Fabricar (fabricar(p)): producto + depósito + cantidad a fabricar + lo que SALIÓ de verdad.
--   · Materias primas = receta_insumos(producto, cantidad planeada) (merma y sub-preparaciones
--     que se descuentan al vender incluidas). Si falta alguna en el depósito NO se fabrica
--     ("No alcanza la materia prima en Depósito central: falta Maní (hay 8 kg, se necesitan
--     10 kg)"), contando lo reservado por mesas abiertas.
--   · Salen con su costo PEPS (capas; FEFO si controlan lotes) → costo total de la tanda.
--   · Entran las unidades obtenidas al costo total ÷ obtenidas: capa "produccion" (o lote con
--     vencimiento, número de lote por defecto = número de la producción). La diferencia
--     planeada − obtenida es la MERMA DE PRODUCCIÓN (su costo queda repartido en lo obtenido).
--   · costo_promedio del producto: promedio ponderado como una compra.
--   · Numeración FAB-000001 (numeracion_maximos, receta 96). Idempotente por clave.
--   · Permiso nuevo: 'fabricar' (Inventario).
-- Anular (anular_produccion): con motivo; vuelve todo a las MISMAS capas / lotes. Si ya salieron
--   unidades de lo fabricado (vendidas, trasladadas) no se anula.
-- Consultas: fabricables(dep) · fabricar_previa(producto, cantidad, dep) · listar_producciones ·
--   produccion_detalle.
-- Parches (versión vigente): buscar_productos / listar_productos_inventario (p_tipo
--   'fabricado'), reporte_existencias, funciones_empresa / guardar_funciones_empresa (cuentan
--   los fabricados) y permisos_catalogo.
-- Semilla SOLO en erp_demo: Maní crudo, Bolsa 250 g y "Bolsa de maní 250 g" (fabricado).
--
-- IDEMPOTENTE. Va después de 96.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tipo 'fabricado', receta por tanda y orígenes nuevos
-- =============================================================================
alter table :"schema".productos drop constraint if exists productos_tipo_producto_check;
alter table :"schema".productos add constraint productos_tipo_producto_check
  check (tipo_producto in ('reventa', 'menu', 'materia_prima', 'fabricado'));
comment on column :"schema".productos.tipo_producto is
  'reventa (stock propio) · menu (sin stock: descuenta su receta al venderse) · materia_prima (se compra, no se vende; con receta = preparación) · fabricado (receta + stock propio: se fabrica por tanda y se vende). Recetas 72 y 97.';

alter table :"schema".recetas add column if not exists por_tanda boolean not null default false;
comment on column :"schema".recetas.por_tanda is
  'true = se fabrica por tanda (el producto tiene stock propio y no se explota al venderse ni como ingrediente). Fabricado siempre; Menú nunca; preparación a elección. Receta 97.';
update :"schema".recetas r set por_tanda = true
  from :"schema".productos p where p.id = r.producto_id and p.tipo_producto = 'fabricado' and not r.por_tanda;

alter table :"schema".movimientos_inventario drop constraint if exists movinv_origen_check;
alter table :"schema".movimientos_inventario add constraint movinv_origen_check check (origen in (
  'inventario_inicial', 'ajuste_manual', 'venta', 'anulacion_venta', 'compra', 'anulacion_compra', 'traslado_salida',
  'traslado_entrada', 'anulacion_traslado', 'ajuste', 'perdida', 'anulacion_ajuste', 'anulacion_perdida', 'apertura',
  'produccion', 'anulacion_produccion'));
alter table :"schema".movimientos_inventario drop constraint if exists movinv_documento_tipo_check;
alter table :"schema".movimientos_inventario add constraint movinv_documento_tipo_check
  check (documento_tipo is null or documento_tipo in ('compra', 'venta', 'traslado', 'ajuste', 'perdida', 'produccion'));
alter table :"schema".lotes_movimientos drop constraint if exists chk_lotes_mov_origen;
alter table :"schema".lotes_movimientos add constraint chk_lotes_mov_origen check (origen in (
  'compra', 'anulacion_compra', 'venta', 'anulacion_venta', 'ajuste_manual', 'baja_lote', 'sin_lote_inicial',
  'traslado_salida', 'traslado_entrada', 'anulacion_traslado', 'ajuste', 'inventario_inicial', 'perdida',
  'anulacion_ajuste', 'anulacion_perdida', 'produccion', 'anulacion_produccion'));
alter table :"schema".lotes drop constraint if exists chk_lotes_origen;
alter table :"schema".lotes add constraint chk_lotes_origen
  check (origen in ('compra', 'ajuste_manual', 'traslado', 'ajuste', 'inventario_inicial', 'produccion'));
alter table :"schema".capas_costo drop constraint if exists chk_capa_origen;
alter table :"schema".capas_costo add constraint chk_capa_origen
  check (origen in ('compra', 'stock_inicial', 'ajuste', 'traslado', 'anulacion', 'lote', 'produccion'));

-- =============================================================================
-- 2. Tablas de producción
-- =============================================================================
create table if not exists :"schema".producciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,
  producto_id uuid not null references :"schema".productos(id) on delete restrict,
  producto_nombre text not null,
  producto_sku text,
  unidad_medida text,
  deposito_id uuid not null references :"schema".depositos(id) on delete restrict,
  cantidad_planeada numeric not null,
  cantidad_obtenida numeric not null,
  costo_total numeric not null default 0,           -- Σ costo PEPS de las materias primas
  costo_unitario numeric not null default 0,        -- costo_total ÷ obtenida
  lote_id uuid references :"schema".lotes(id) on delete set null,
  lote_numero text,
  vencimiento date,
  notas text,
  estado text not null default 'confirmada',
  idempotency_key uuid,
  created_by uuid,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  anulado_por uuid,
  anulado_por_nombre text,
  anulado_at timestamptz,
  anulado_motivo text,
  constraint chk_prod_estado check (estado in ('confirmada', 'anulada')),
  constraint chk_prod_planeada check (cantidad_planeada > 0 and cantidad_planeada <= 10000000),
  constraint chk_prod_obtenida check (cantidad_obtenida > 0 and cantidad_obtenida <= 10000000),
  constraint chk_prod_notas check (notas is null or length(notas) <= 500),
  constraint uq_producciones_numero unique (empresa_id, numero)
);
create unique index if not exists producciones_idem_idx on :"schema".producciones (empresa_id, idempotency_key) where idempotency_key is not null;
create index if not exists producciones_lista_idx on :"schema".producciones (empresa_id, created_at desc);
create index if not exists producciones_producto_idx on :"schema".producciones (producto_id, created_at desc);

create table if not exists :"schema".producciones_insumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  produccion_id uuid not null references :"schema".producciones(id) on delete cascade,
  orden integer not null default 0,
  insumo_id uuid not null references :"schema".productos(id) on delete restrict,
  insumo_nombre text not null,
  insumo_sku text,
  unidad_medida text,
  cantidad numeric not null,
  costo_unitario numeric not null default 0,
  costo_total numeric not null default 0,
  movio_stock boolean not null default true,        -- false: el insumo no controla stock (solo costo)
  lotes jsonb,                                      -- lotes consumidos (insumos con lotes)
  constraint chk_prodins_cantidad check (cantidad > 0)
);
create index if not exists producciones_insumos_prod_idx on :"schema".producciones_insumos (produccion_id, orden);
create index if not exists producciones_insumos_insumo_idx on :"schema".producciones_insumos (insumo_id);

alter table :"schema".producciones enable row level security;
alter table :"schema".producciones force row level security;
alter table :"schema".producciones_insumos enable row level security;
alter table :"schema".producciones_insumos force row level security;
-- Se leen con las funciones (llevan costos).
revoke all on :"schema".producciones, :"schema".producciones_insumos from anon, authenticated;
grant all on :"schema".producciones, :"schema".producciones_insumos to service_role;

-- Numeración FAB-000001 con contador O(1) (receta 96).
insert into :"schema".numeracion_familias (familia, tabla, columna, modo, serie_modo, serie_col)
  values ('producciones.numero', 'producciones', 'numero', 'sufijo', '', null)
on conflict (familia) do nothing;
drop trigger if exists trg_num_producciones_numero on :"schema".producciones;
create trigger trg_num_producciones_numero after insert or delete or update of numero, empresa_id on :"schema".producciones
  for each row execute function :"schema".tg_numeracion_maximos('producciones.numero');
drop trigger if exists trg_num_producciones_numero_tr on :"schema".producciones;
create trigger trg_num_producciones_numero_tr after truncate on :"schema".producciones
  for each statement execute function :"schema".tg_numeracion_maximos('producciones.numero');
insert into :"schema".numeracion_maximos (empresa_id, familia, serie, ultimo)
  select e.id, 'producciones.numero', '', :"schema".numeracion_contar(e.id, 'producciones.numero', '') from :"schema".empresas e
on conflict (empresa_id, familia, serie) do update set ultimo = excluded.ultimo, updated_at = now()
  where numeracion_maximos.ultimo is distinct from excluded.ultimo;

-- =============================================================================
-- 3. Recetas: explosión cortada en las recetas por tanda
-- =============================================================================

-- "Se explota al usarse": tiene ingredientes y NO se fabrica por tanda (redefinida desde la 72).
create or replace function :"schema".tiene_receta(p_producto uuid)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select exists (select 1 from recetas r join recetas_items ri on ri.producto_id = r.producto_id
                  where r.producto_id = p_producto and not r.por_tanda)
$$;

-- Tiene receta cargada (cualquier modo).
create or replace function :"schema".receta_existe(p_producto uuid)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select exists (select 1 from recetas_items where producto_id = p_producto)
$$;

-- Se fabrica por tanda (y tiene ingredientes).
create or replace function :"schema".receta_por_tanda(p_producto uuid)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select exists (select 1 from recetas r join recetas_items ri on ri.producto_id = r.producto_id
                  where r.producto_id = p_producto and r.por_tanda)
$$;

-- Explosión (redefinida desde la 72): la receta de p_producto siempre; debajo, solo se
-- explotan las preparaciones que se descuentan al vender (una por tanda es un insumo con stock).
create or replace function :"schema".receta_insumos(p_producto uuid, p_cantidad numeric)
returns table (insumo_id uuid, cantidad numeric)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
#variable_conflict use_column
begin
  return query
  with recursive x(insumo, cant, nivel, ruta) as (
    select ri.insumo_id,
           p_cantidad / r.rendimiento * unidad_convertir(ri.cantidad, ri.unidad, i.unidad_medida) / (1 - ri.merma_pct / 100.0),
           1, array[r.producto_id, ri.insumo_id]
      from recetas r
      join recetas_items ri on ri.producto_id = r.producto_id
      join productos i on i.id = ri.insumo_id
     where r.producto_id = p_producto
    union all
    select ri.insumo_id,
           x.cant / r.rendimiento * unidad_convertir(ri.cantidad, ri.unidad, i.unidad_medida) / (1 - ri.merma_pct / 100.0),
           x.nivel + 1, x.ruta || ri.insumo_id
      from x
      join recetas r on r.producto_id = x.insumo and not r.por_tanda
      join recetas_items ri on ri.producto_id = r.producto_id
      join productos i on i.id = ri.insumo_id
     where x.nivel < 8 and not (ri.insumo_id = any (x.ruta))
  )
  select x.insumo, round(sum(x.cant), 4)
    from x
   where not tiene_receta(x.insumo)
   group by x.insumo
  having round(sum(x.cant), 4) > 0;
end;
$fn$;

-- Ídem sin los ingredientes quitados del plato (redefinida desde la 73).
create or replace function :"schema".receta_insumos_sin(p_producto uuid, p_cantidad numeric, p_quitar uuid[])
returns table (insumo_id uuid, cantidad numeric)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
#variable_conflict use_column
begin
  return query
  with recursive x(insumo, cant, nivel, ruta) as (
    select ri.insumo_id,
           p_cantidad / r.rendimiento * unidad_convertir(ri.cantidad, ri.unidad, i.unidad_medida) / (1 - ri.merma_pct / 100.0),
           1, array[r.producto_id, ri.insumo_id]
      from recetas r
      join recetas_items ri on ri.producto_id = r.producto_id
      join productos i on i.id = ri.insumo_id
     where r.producto_id = p_producto and not (ri.insumo_id = any (coalesce(p_quitar, '{}'::uuid[])))
    union all
    select ri.insumo_id,
           x.cant / r.rendimiento * unidad_convertir(ri.cantidad, ri.unidad, i.unidad_medida) / (1 - ri.merma_pct / 100.0),
           x.nivel + 1, x.ruta || ri.insumo_id
      from x
      join recetas r on r.producto_id = x.insumo and not r.por_tanda
      join recetas_items ri on ri.producto_id = r.producto_id
      join productos i on i.id = ri.insumo_id
     where x.nivel < 8 and not (ri.insumo_id = any (x.ruta))
  )
  select x.insumo, round(sum(x.cant), 4)
    from x
   where not tiene_receta(x.insumo)
   group by x.insumo
  having round(sum(x.cant), 4) > 0;
end;
$fn$;

-- Cuánto se puede fabricar con el stock del depósito (descontando p_reserva). null = ningún
-- ingrediente controla stock. Unidad → entero; kg / l → 3 decimales.
create or replace function :"schema".fabricar_alcanza(p_producto uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select case when unidad_dim(p.unidad_medida) in ('masa', 'volumen') then floor(x.v * 1000) / 1000 else floor(x.v) end
    from productos p,
         (select greatest(0, min((coalesce(sd.cantidad, 0) - coalesce((coalesce(p_reserva, '{}'::jsonb) ->> n.insumo_id::text)::numeric, 0)) / n.cantidad)) as v
            from receta_insumos(p_producto, 1) n
            join productos i on i.id = n.insumo_id and i.controla_stock
            left join stock_depositos sd on sd.producto_id = n.insumo_id and sd.deposito_id = p_deposito
           where n.cantidad > 0) x
   where p.id = p_producto and x.v is not null
$$;

-- Coherencia tipo ↔ banderas (redefinida desde la 74). 97: Fabricado (stock siempre) y la
-- preparación por tanda (conserva su stock); un fabricado o una preparación pueden ser ingrediente.
create or replace function :"schema".tg_productos_tipo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u text;
  v_rec boolean := tg_op = 'UPDATE' and exists (select 1 from recetas_items where producto_id = new.id);
  v_tanda boolean := tg_op = 'UPDATE' and exists (select 1 from recetas where producto_id = new.id and por_tanda);
  v_usos integer;
begin
  if new.tipo_producto = 'menu' then
    if coalesce(new.stock_actual, 0) <> 0 then
      raise exception '"%" tiene stock (%): un producto Menú no lleva stock propio (descuenta los ingredientes de su receta). Dejá el stock en 0 con un ajuste antes de pasarlo a Menú.',
        new.nombre, trim_scale(new.stock_actual);
    end if;
    new.controla_stock := false;
    new.controla_lotes := false;
    if v_tanda then update recetas set por_tanda = false where producto_id = new.id; end if;
  elsif new.tipo_producto = 'materia_prima' then
    new.es_vendible := false;
    new.en_menu_qr := false;
    new.estacion_id := null;
    v_u := unidad_normal(new.unidad_medida);
    if v_u is null then
      raise exception 'La unidad "%" no sirve para una materia prima: elegí Unidad, kg, g, l o ml', new.unidad_medida;
    end if;
    new.unidad_medida := v_u;
    if v_rec and not v_tanda then
      -- Preparación que se descuenta al vender: sin stock propio, se explota.
      new.controla_stock := false;
      new.controla_lotes := false;
    end if;
  elsif new.tipo_producto = 'fabricado' then
    new.controla_stock := true;
    v_u := unidad_normal(new.unidad_medida);
    if v_u is not null then new.unidad_medida := v_u; end if;
    -- Viene de Menú o de una preparación que se descuenta al vender: pasa a fabricarse por tanda.
    if v_rec and not v_tanda then update recetas set por_tanda = true where producto_id = new.id; end if;
  elsif v_rec then
    raise exception '"%" tiene receta: quitala en Inventario › Recetas antes de pasarlo a Reventa', new.nombre;
  end if;

  if tg_op = 'UPDATE' then
    select (select count(*) from recetas_items where insumo_id = new.id)
         + (select count(distinct o.grupo_id) from plato_opcion_items oi join plato_opciones o on o.id = oi.opcion_id where oi.insumo_id = new.id)
      into v_usos;
    if v_usos > 0 and new.tipo_producto not in ('materia_prima', 'fabricado') then
      raise exception '"%" es ingrediente de % receta(s) u opciones de platos: sacalo de ahí antes de cambiarle el tipo', new.nombre, v_usos;
    end if;
    if v_usos > 0 and unidad_dim(new.unidad_medida) is distinct from unidad_dim(old.unidad_medida) then
      raise exception '"%" es ingrediente de % receta(s) u opciones de platos en %: no se puede pasar a % (otra magnitud)',
        new.nombre, v_usos, old.unidad_medida, new.unidad_medida;
    end if;
  end if;
  return new;
end;
$fn$;
revoke all on function :"schema".tg_productos_tipo() from public, anon, authenticated;

-- Ingredientes válidos (redefinida desde la 72): lleva receta Menú, Materia prima o Fabricado;
-- son ingredientes las materias primas (y preparaciones) y los fabricados.
create or replace function :"schema".tg_recetas_items_validar()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_plato productos;
  v_ins productos;
begin
  select * into v_plato from productos where id = new.producto_id;
  select * into v_ins from productos where id = new.insumo_id;
  if v_ins.id is null or v_ins.empresa_id <> new.empresa_id or v_plato.empresa_id <> new.empresa_id then
    raise exception 'El ingrediente no es de esta empresa';
  end if;
  if v_plato.tipo_producto not in ('menu', 'materia_prima', 'fabricado') then
    raise exception 'Solo los productos Menú, Fabricado y las materias primas (preparaciones) llevan receta';
  end if;
  if v_ins.tipo_producto not in ('materia_prima', 'fabricado') then
    raise exception '"%" no es materia prima: en una receta van materias primas, preparaciones o productos fabricados', v_ins.nombre;
  end if;
  if unidad_dim(new.unidad) is distinct from unidad_dim(v_ins.unidad_medida) then
    raise exception '"%" se mide en %: no se puede cargar en %', v_ins.nombre, v_ins.unidad_medida, new.unidad;
  end if;
  if new.insumo_id = new.producto_id or exists (
       with recursive d(pid, n) as (
         select new.insumo_id, 0
         union
         select ri.insumo_id, d.n + 1 from d join recetas_items ri on ri.producto_id = d.pid where d.n < 20
       )
       select 1 from d where d.pid = new.producto_id) then
    raise exception 'Ciclo en la receta: "%" ya lleva "%" (directa o indirectamente), no puede ser su ingrediente',
      v_ins.nombre, v_plato.nombre;
  end if;
  return new;
end;
$fn$;
revoke all on function :"schema".tg_recetas_items_validar() from public, anon, authenticated;

-- =============================================================================
-- 4. Pantallas de recetas (redefinidas desde la 74)
-- =============================================================================
create or replace function :"schema".receta_detalle(p_producto uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_dep uuid;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  if not (tiene_permiso('ver_costos') or tiene_permiso('editar_productos')) then perform exigir_permiso('ver_costos'); end if;
  v_dep := deposito_por_defecto(s.s_empresa, s.s_sucursal);
  select jsonb_build_object(
    'producto', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'tipo_producto', p.tipo_producto,
                                   'unidad_medida', p.unidad_medida, 'precio_venta', p.precio_venta, 'descuento_pct', p.descuento_pct,
                                   'imagen_url', p.imagen_url, 'stock_actual', p.stock_actual, 'activo', p.activo,
                                   'controla_lotes', p.controla_lotes, 'costo_promedio', p.costo_promedio),
    'tiene_receta', receta_existe(p.id),
    'por_tanda', coalesce(rc.por_tanda, p.tipo_producto = 'fabricado'),                     -- 97
    'stock', coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = p.id and sd.deposito_id = v_dep), 0),
    'alcanza_fabricar', case when coalesce(rc.por_tanda, false) then fabricar_alcanza(p.id, v_dep) end,  -- 97
    'rendimiento', coalesce(rc.rendimiento, 1),
    'notas', rc.notas,
    'costo', receta_costo(p.id),
    'costo_rango', plato_costo_rango(p.id),
    'porciones', plato_porciones(p.id, v_dep),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'insumo_id', i.id, 'nombre', i.nombre, 'sku', i.sku, 'unidad_insumo', i.unidad_medida,
        'cantidad', ri.cantidad, 'unidad', ri.unidad, 'merma_pct', ri.merma_pct,
        'se_puede_quitar', ri.se_puede_quitar,
        'es_preparacion', tiene_receta(i.id),
        'por_tanda', receta_por_tanda(i.id) or i.tipo_producto = 'fabricado',                  -- 97
        'costo_unitario', case when tiene_receta(i.id) then receta_costo(i.id) else coalesce(i.costo_promedio, 0) end,
        'stock', coalesce(sd.cantidad, 0), 'controla_stock', i.controla_stock, 'activo', i.activo)
        order by ri.orden, i.nombre)
      from recetas_items ri join productos i on i.id = ri.insumo_id
      left join stock_depositos sd on sd.producto_id = i.id and sd.deposito_id = v_dep
      where ri.producto_id = p.id), '[]'::jsonb),
    'usado_en', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
      from recetas_items ri join productos u on u.id = ri.producto_id where ri.insumo_id = p.id), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(jsonb_build_object(
        'extra_id', x.id, 'nombre', x.nombre, 'precio_lista', x.precio, 'precio', pe.precio, 'maximo', pe.maximo,
        'activo', x.activo, 'insumo_nombre', i.nombre, 'cantidad', x.cantidad, 'unidad', x.unidad,
        'disponible', extra_disponible(p.id, x.id, v_dep))
        order by pe.orden, x.nombre)
      from plato_extras pe join extras x on x.id = pe.extra_id join productos i on i.id = x.insumo_id
      where pe.producto_id = p.id), '[]'::jsonb),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'nombre', g.nombre, 'obligatorio', g.obligatorio, 'minimo', g.minimo, 'maximo', g.maximo,
        'opciones', coalesce((select jsonb_agg(jsonb_build_object(
            'id', o.id, 'nombre', o.nombre, 'precio', o.precio, 'activo', o.activo,
            'costo', opcion_costo(o.id),
            'disponible', opcion_disponible(p.id, o.id, v_dep),
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                'insumo_id', i.id, 'nombre', i.nombre, 'sku', i.sku, 'unidad_insumo', i.unidad_medida,
                'cantidad', oi.cantidad, 'unidad', oi.unidad, 'merma_pct', oi.merma_pct,
                'es_preparacion', tiene_receta(i.id),
                'costo_unitario', case when tiene_receta(i.id) then receta_costo(i.id) else coalesce(i.costo_promedio, 0) end,
                'stock', coalesce(sd.cantidad, 0), 'controla_stock', i.controla_stock, 'activo', i.activo)
                order by oi.orden, i.nombre)
              from plato_opcion_items oi join productos i on i.id = oi.insumo_id
              left join stock_depositos sd on sd.producto_id = i.id and sd.deposito_id = v_dep
              where oi.opcion_id = o.id), '[]'::jsonb))
            order by o.orden, o.nombre) from plato_opciones o where o.grupo_id = g.id), '[]'::jsonb))
        order by g.orden, g.nombre)
      from plato_opcion_grupos g where g.producto_id = p.id), '[]'::jsonb))
    into r
    from productos p left join recetas rc on rc.producto_id = p.id
   where p.id = p_producto and p.empresa_id = s.s_empresa;
  if r is null then raise exception 'Producto no encontrado'; end if;
  return r;
end;
$fn$;

create or replace function :"schema".recetas_listar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_dep uuid;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  if not (tiene_permiso('ver_costos') or tiene_permiso('editar_productos')) then perform exigir_permiso('ver_costos'); end if;
  v_dep := deposito_por_defecto(s.s_empresa, s.s_sucursal);
  with base as (
    select p.id, p.nombre, p.sku, p.tipo_producto, p.unidad_medida, p.precio_venta, p.descuento_pct, p.imagen_url,
           p.categoria_principal_id, receta_existe(p.id) as con_receta,
           coalesce((select rr.por_tanda from recetas rr where rr.producto_id = p.id), p.tipo_producto = 'fabricado') as por_tanda
      from productos p
     where p.empresa_id = s.s_empresa and p.activo
       and (p.tipo_producto in ('menu', 'fabricado')
            or (p.tipo_producto = 'materia_prima' and exists (select 1 from recetas_items z where z.producto_id = p.id)))
  ),
  calc as (
    select b.*, rc.rendimiento,
           (select count(*) from recetas_items ri where ri.producto_id = b.id) as ingredientes,
           case when b.con_receta then receta_costo(b.id) end as costo,
           case when b.con_receta and b.tipo_producto = 'menu' then plato_costo_rango(b.id) end as rango,
           case when b.con_receta and not b.por_tanda then plato_porciones(b.id, v_dep) end as porciones,
           coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = b.id and sd.deposito_id = v_dep), 0) as stock,
           case when b.con_receta and b.por_tanda then fabricar_alcanza(b.id, v_dep) end as alcanza,
           -- Lo que falta para UNA unidad (se descuenta al vender) o para fabricar una (por tanda).
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from receta_insumos(b.id, 1) n join productos i on i.id = n.insumo_id
              left join stock_depositos sd on sd.producto_id = n.insumo_id and sd.deposito_id = v_dep
             where b.con_receta and i.controla_stock and coalesce(sd.cantidad, 0) < n.cantidad) as faltan,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from receta_insumos(b.id, 1) n join productos i on i.id = n.insumo_id
             where b.con_receta and not i.activo) as inactivos,
           (select string_agg('ninguna opción de «' || g.nombre || '» con stock', ', ' order by g.orden, g.nombre)
              from plato_opcion_grupos g
             where b.con_receta and b.tipo_producto = 'menu' and g.producto_id = b.id and g.obligatorio
               and exists (select 1 from plato_opciones o join plato_opcion_items oi on oi.opcion_id = o.id where o.grupo_id = g.id and o.activo)
               and not exists (select 1 from plato_opciones o where o.grupo_id = g.id and o.activo
                                 and opcion_disponible(b.id, o.id, v_dep))) as faltan_opciones,
           (select count(*) from recetas_items ri where ri.producto_id = b.id and ri.se_puede_quitar)
             + (select count(*) from plato_extras pe where pe.producto_id = b.id)
             + (select count(*) from plato_opcion_grupos g where g.producto_id = b.id) as modificadores
      from base b left join recetas rc on rc.producto_id = b.id
  )
  select jsonb_build_object(
    'deposito_id', v_dep,
    'deposito', (select d.nombre from depositos d where d.id = v_dep),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'sku', c.sku,
      'tipo', case c.tipo_producto when 'menu' then 'menu' when 'fabricado' then 'fabricado' else 'preparacion' end,
      'por_tanda', c.por_tanda, 'stock', c.stock, 'alcanza', c.alcanza,                       -- 97
      'unidad_medida', c.unidad_medida, 'precio_venta', c.precio_venta, 'descuento_pct', c.descuento_pct, 'imagen_url', c.imagen_url,
      'categoria_principal_id', c.categoria_principal_id,
      'rendimiento', coalesce(c.rendimiento, 1), 'ingredientes', c.ingredientes, 'costo', c.costo, 'porciones', c.porciones,
      'costo_desde', (c.rango->>'desde')::numeric, 'costo_hasta', (c.rango->>'hasta')::numeric,
      'faltan', coalesce(c.inactivos, c.faltan, c.faltan_opciones),
      'modificadores', c.modificadores,
      'estado', case when not c.con_receta then 'sin_receta'
                     when c.inactivos is not null or c.faltan is not null or c.faltan_opciones is not null then 'faltante'
                     else 'completa' end)
      order by case c.tipo_producto when 'menu' then 0 when 'fabricado' then 1 else 2 end, c.nombre), '[]'::jsonb))
    into r
    from calc c;
  return r;
end;
$fn$;

-- Guardar la receta (redefinida desde la 74). 97: Fabricado; por_tanda (preparaciones).
create or replace function :"schema".receta_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  prod productos;
  ins productos;
  it jsonb;
  gj jsonb;
  oj jsonb;
  v_id uuid := nullif(p->>'producto_id', '')::uuid;
  v_rend numeric := coalesce(nullif(p->>'rendimiento', '')::numeric, 1);
  v_notas text := left(nullif(btrim(coalesce(p->>'notas', '')), ''), 1000);
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_ins uuid;
  v_cant numeric;
  v_merma numeric;
  v_unidad text;
  v_vistos uuid[] := '{}';
  v_orden integer := 0;
  v_prof integer;
  v_tenia boolean;
  v_tanda_antes boolean;
  v_tanda boolean;
  v_ex uuid;
  v_max integer;
  v_pre numeric;
  v_gid uuid;
  v_oid uuid;
  v_gnom text;
  v_onom text;
  v_oblig boolean;
  v_min integer;
  v_gmax integer;
  v_gids uuid[] := '{}';
  v_oids uuid[];
  v_gnoms text[] := '{}';
  v_onoms text[];
  v_gorden integer := 0;
  v_oorden integer;
  v_nact integer;
  ij jsonb;
  v_iorden integer;
  v_ivistos uuid[];
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('editar_productos');
  if v_id is null then raise exception 'Falta el producto'; end if;
  select * into prod from productos where id = v_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if prod.tipo_producto not in ('menu', 'materia_prima', 'fabricado') then
    raise exception '"%" es de Reventa: llevan receta los productos Menú, los Fabricados y las materias primas (preparaciones)', prod.nombre;
  end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'Ingredientes inválidos'; end if;
  if jsonb_array_length(v_items) > 60 then raise exception 'Son demasiados ingredientes (hasta 60)'; end if;
  if v_rend <= 0 or v_rend > 100000 then raise exception 'El rendimiento tiene que ser mayor a 0'; end if;
  if p ? 'por_tanda' and jsonb_typeof(p->'por_tanda') <> 'boolean' then raise exception '"por_tanda" debe ser sí o no'; end if;
  v_tenia := receta_existe(prod.id);
  v_tanda_antes := coalesce((select r.por_tanda from recetas r where r.producto_id = prod.id), false);
  v_tanda := case prod.tipo_producto
               when 'fabricado' then true
               when 'menu' then false
               else coalesce((p->>'por_tanda')::boolean, v_tanda_antes) end;

  -- Sin ingredientes: se quita la receta (una preparación vuelve a ser materia prima con stock).
  if jsonb_array_length(v_items) = 0 then
    delete from recetas where producto_id = prod.id;
    if prod.tipo_producto = 'materia_prima' and v_tenia and not v_tanda_antes then
      update productos set controla_stock = true, updated_at = now() where id = prod.id;
    end if;
    return receta_detalle(prod.id);
  end if;

  -- Preparación que se descuenta al vender: no lleva stock propio.
  if prod.tipo_producto = 'materia_prima' and not v_tanda and (not v_tenia or v_tanda_antes)
     and coalesce(prod.stock_actual, 0) <> 0 then
    raise exception '"%" tiene stock (%): una preparación que se descuenta al vender no lleva stock propio. Dejalo en 0 con un ajuste o elegí "Se fabrica por tanda".',
      prod.nombre, cant_texto(prod.stock_actual, prod.unidad_medida);
  end if;

  insert into recetas (producto_id, empresa_id, rendimiento, notas, updated_at, updated_por, por_tanda)
    values (prod.id, s.s_empresa, v_rend, v_notas, now(), s.s_usuario, v_tanda)
  on conflict (producto_id) do update set rendimiento = excluded.rendimiento, notas = excluded.notas,
    updated_at = now(), updated_por = excluded.updated_por, por_tanda = excluded.por_tanda;
  delete from recetas_items where producto_id = prod.id;

  for it in select * from jsonb_array_elements(v_items) loop
    v_orden := v_orden + 1;
    begin
      v_ins := (it->>'insumo_id')::uuid;
      v_cant := (it->>'cantidad')::numeric;
      v_merma := coalesce(nullif(it->>'merma_pct', '')::numeric, 0);
    exception when others then
      raise exception 'Ingrediente % inválido', v_orden;
    end;
    select * into ins from productos where id = v_ins and empresa_id = s.s_empresa;
    if not found then raise exception 'Ingrediente % no encontrado', v_orden; end if;
    if v_ins = any (v_vistos) then raise exception '"%" está dos veces: juntá las cantidades en una línea', ins.nombre; end if;
    v_vistos := v_vistos || v_ins;
    if v_cant is null or v_cant <= 0 then raise exception 'Cargá la cantidad de "%"', ins.nombre; end if;
    if v_merma < 0 or v_merma > 90 then raise exception 'La merma de "%" va de 0 a 90 %%', ins.nombre; end if;
    v_unidad := coalesce(unidad_normal(nullif(it->>'unidad', '')), ins.unidad_medida);
    insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden, se_puede_quitar)
      values (s.s_empresa, prod.id, v_ins, v_cant, v_unidad, v_merma, v_orden,
              prod.tipo_producto = 'menu' and coalesce((it->>'se_puede_quitar')::boolean, false));
  end loop;

  select greatest(max(receta_profundidad(a.pid)),
                  max((select max(receta_profundidad(oi.insumo_id) + 1) from plato_opcion_items oi where oi.insumo_id = a.pid)))
    into v_prof from (
    with recursive a(pid) as (
      select prod.id
      union
      select ri.producto_id from a join recetas_items ri on ri.insumo_id = a.pid
    ) select pid from a) a;
  if v_prof > 5 then
    raise exception 'Hay demasiadas preparaciones una dentro de otra (% niveles, máximo 5)', v_prof;
  end if;

  -- Extras del plato (solo Menú). Se reemplaza la lista entera.
  if prod.tipo_producto = 'menu' and p ? 'extras' then
    if jsonb_typeof(p->'extras') <> 'array' then raise exception 'Extras inválidos'; end if;
    if jsonb_array_length(p->'extras') > 40 then raise exception 'Son demasiados extras (hasta 40)'; end if;
    delete from plato_extras where producto_id = prod.id;
    v_orden := 0;
    v_vistos := '{}';
    for it in select * from jsonb_array_elements(p->'extras') loop
      v_orden := v_orden + 1;
      begin
        v_ex := (it->>'extra_id')::uuid;
        v_max := coalesce(nullif(it->>'maximo', '')::integer, 3);
        v_pre := nullif(it->>'precio', '')::numeric;
      exception when others then
        raise exception 'Extra % inválido', v_orden;
      end;
      if not exists (select 1 from extras where id = v_ex and empresa_id = s.s_empresa) then
        raise exception 'Extra % no encontrado', v_orden;
      end if;
      if v_ex = any (v_vistos) then raise exception 'Hay un extra repetido en el plato'; end if;
      v_vistos := v_vistos || v_ex;
      if v_max < 1 or v_max > 20 then raise exception 'El máximo de cada extra va de 1 a 20'; end if;
      if v_pre is not null and (v_pre < 0 or v_pre > 100000000) then raise exception 'El precio de un extra no es válido'; end if;
      insert into plato_extras (producto_id, extra_id, empresa_id, precio, maximo, orden)
        values (prod.id, v_ex, s.s_empresa, round(v_pre), v_max, v_orden);
    end loop;
  end if;

  -- Grupos de opciones (solo Menú). Se conservan los ids que vienen; los que faltan se borran.
  if prod.tipo_producto = 'menu' and p ? 'grupos' then
    if jsonb_typeof(p->'grupos') <> 'array' then raise exception 'Opciones inválidas'; end if;
    if jsonb_array_length(p->'grupos') > 12 then raise exception 'Son demasiados grupos de opciones (hasta 12)'; end if;
    for gj in select * from jsonb_array_elements(p->'grupos') loop
      v_gorden := v_gorden + 1;
      begin
        v_gid := nullif(gj->>'id', '')::uuid;
        v_oblig := coalesce((gj->>'obligatorio')::boolean, false);
        v_min := coalesce(nullif(gj->>'minimo', '')::integer, case when v_oblig then 1 else 0 end);
        v_gmax := coalesce(nullif(gj->>'maximo', '')::integer, 1);
      exception when others then
        raise exception 'Grupo de opciones % inválido', v_gorden;
      end;
      v_gnom := btrim(coalesce(gj->>'nombre', ''));
      if length(v_gnom) < 1 or length(v_gnom) > 60 then raise exception 'Escribí el nombre de cada grupo de opciones (hasta 60 letras)'; end if;
      if lower(v_gnom) = any (v_gnoms) then raise exception 'Hay dos grupos "%"', v_gnom; end if;
      v_gnoms := v_gnoms || lower(v_gnom);
      if jsonb_typeof(gj->'opciones') <> 'array' or jsonb_array_length(gj->'opciones') = 0 then
        raise exception 'El grupo "%" no tiene opciones', v_gnom;
      end if;
      if jsonb_array_length(gj->'opciones') > 20 then raise exception 'El grupo "%" tiene demasiadas opciones (hasta 20)', v_gnom; end if;
      select count(*) into v_nact from jsonb_array_elements(gj->'opciones') o where coalesce((o->>'activo')::boolean, true);
      v_min := case when v_oblig then greatest(v_min, 1) else 0 end;
      if v_gmax < 1 or v_gmax > 20 then raise exception 'En "%" el máximo va de 1 a 20', v_gnom; end if;
      if v_min > v_gmax then raise exception 'En "%" el mínimo no puede pasar el máximo', v_gnom; end if;
      if v_oblig and v_nact < v_min then raise exception 'El grupo obligatorio "%" necesita al menos % opción(es) activas', v_gnom, v_min; end if;
      v_gmax := least(v_gmax, greatest(v_nact, 1));
      if v_gid is not null and exists (select 1 from plato_opcion_grupos where id = v_gid and producto_id = prod.id) then
        update plato_opcion_grupos set nombre = v_gnom, obligatorio = v_oblig, minimo = least(v_min, v_gmax), maximo = v_gmax, orden = v_gorden
         where id = v_gid;
      else
        insert into plato_opcion_grupos (empresa_id, producto_id, nombre, obligatorio, minimo, maximo, orden)
          values (s.s_empresa, prod.id, v_gnom, v_oblig, least(v_min, v_gmax), v_gmax, v_gorden)
          returning id into v_gid;
      end if;
      v_gids := v_gids || v_gid;
      v_oids := '{}';
      v_onoms := '{}';
      v_oorden := 0;
      for oj in select * from jsonb_array_elements(gj->'opciones') loop
        v_oorden := v_oorden + 1;
        begin
          v_oid := nullif(oj->>'id', '')::uuid;
          v_pre := coalesce(nullif(oj->>'precio', '')::numeric, 0);
        exception when others then
          raise exception 'Opción % de "%" inválida', v_oorden, v_gnom;
        end;
        v_onom := btrim(coalesce(oj->>'nombre', ''));
        if length(v_onom) < 1 or length(v_onom) > 60 then raise exception 'Escribí el nombre de cada opción de "%"', v_gnom; end if;
        if lower(v_onom) = any (v_onoms) then raise exception 'En "%" hay dos opciones "%"', v_gnom, v_onom; end if;
        v_onoms := v_onoms || lower(v_onom);
        if v_pre < 0 or v_pre > 100000000 then raise exception 'El precio de "%" no es válido', v_onom; end if;
        if v_oid is not null and exists (select 1 from plato_opciones where id = v_oid and grupo_id = v_gid) then
          update plato_opciones set nombre = v_onom, precio = round(v_pre), activo = coalesce((oj->>'activo')::boolean, true), orden = v_oorden
           where id = v_oid;
        else
          insert into plato_opciones (empresa_id, grupo_id, nombre, precio, activo, orden)
            values (s.s_empresa, v_gid, v_onom, round(v_pre), coalesce((oj->>'activo')::boolean, true), v_oorden)
            returning id into v_oid;
        end if;
        v_oids := v_oids || v_oid;

        if oj ? 'items' then
          if jsonb_typeof(oj->'items') <> 'array' then raise exception 'Ingredientes de "%" inválidos', v_onom; end if;
          if jsonb_array_length(oj->'items') > 20 then raise exception '"%" tiene demasiados ingredientes (hasta 20)', v_onom; end if;
          delete from plato_opcion_items where opcion_id = v_oid;
          v_iorden := 0;
          v_ivistos := '{}';
          for ij in select * from jsonb_array_elements(oj->'items') loop
            v_iorden := v_iorden + 1;
            begin
              v_ins := (ij->>'insumo_id')::uuid;
              v_cant := (ij->>'cantidad')::numeric;
              v_merma := coalesce(nullif(ij->>'merma_pct', '')::numeric, 0);
            exception when others then
              raise exception 'Ingrediente % de "%" inválido', v_iorden, v_onom;
            end;
            select * into ins from productos where id = v_ins and empresa_id = s.s_empresa;
            if not found then raise exception 'Ingrediente % de "%" no encontrado', v_iorden, v_onom; end if;
            if v_ins = any (v_ivistos) then raise exception 'En "%" "%" está dos veces: juntá las cantidades', v_onom, ins.nombre; end if;
            v_ivistos := v_ivistos || v_ins;
            if v_cant is null or v_cant <= 0 then raise exception 'Cargá la cantidad de "%" en "%"', ins.nombre, v_onom; end if;
            if v_merma < 0 or v_merma > 90 then raise exception 'La merma de "%" en "%" va de 0 a 90 %%', ins.nombre, v_onom; end if;
            v_unidad := coalesce(unidad_normal(nullif(ij->>'unidad', '')), ins.unidad_medida);
            insert into plato_opcion_items (empresa_id, opcion_id, insumo_id, cantidad, unidad, merma_pct, orden)
              values (s.s_empresa, v_oid, v_ins, v_cant, v_unidad, v_merma, v_iorden);
          end loop;
        end if;
      end loop;
      delete from plato_opciones where grupo_id = v_gid and not (id = any (v_oids));
    end loop;
    delete from plato_opcion_grupos where producto_id = prod.id and not (id = any (v_gids));
  end if;

  -- Banderas y costo. Por tanda: tiene stock propio y su costo es el de lo fabricado (si ya hay
  -- stock no se toca; sin stock queda el de la receta como referencia). Al vender: sin stock y
  -- costo = el de su receta.
  update productos
     set controla_stock = case when tipo_producto = 'materia_prima' then v_tanda
                               when tipo_producto = 'fabricado' then true else controla_stock end,
         controla_lotes = case when tipo_producto = 'materia_prima' and not v_tanda then false else controla_lotes end,
         costo_promedio = case when v_tanda and coalesce(stock_actual, 0) > 0 then costo_promedio
                               else round(receta_costo(id)) end,
         updated_at = now()
   where id = prod.id;
  return receta_detalle(prod.id);
end;
$fn$;

-- =============================================================================
-- 5. Capas y lotes: orígenes de producción (redefinidas desde la 79)
-- =============================================================================
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
    if p_origen in ('anulacion_venta', 'anulacion_traslado', 'anulacion_perdida', 'anulacion_ajuste', 'anulacion_produccion') then
      select r_cantidad, r_costo into v_cant, v_cost
        from capas_revertir(p_empresa, p_producto, p_deposito, p_doc_id, p_cantidad,
               case p_origen when 'anulacion_venta' then array['venta']
                             when 'anulacion_traslado' then array['traslado_salida']
                             when 'anulacion_perdida' then array['perdida']
                             when 'anulacion_produccion' then array['produccion']   -- 97: materias primas de vuelta
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
                       case p_origen when 'compra' then 'compra' when 'inventario_inicial' then 'stock_inicial'
                                     when 'produccion' then 'produccion' else 'ajuste' end,
                       null, p_doc_tipo, p_doc_id, p_doc_numero, p_compra, p_proveedor, p_proveedor_nombre, null, p_referencia, p_mov);
    return p_cantidad * v_costo;
  end if;
  -- SALIDA. Las anulaciones de una entrada sacan primero de las capas de ese documento
  -- (97: anular una producción saca lo fabricado de su propia capa).
  return capas_salida(p_empresa, p_producto, p_deposito, p_cantidad, p_origen, p_doc_tipo, p_doc_id, p_venta_item, p_mov,
                      case when p_origen in ('anulacion_compra', 'anulacion_ajuste', 'anulacion_perdida', 'anulacion_produccion') then p_doc_id end,
                      v_costo);
end;
$fn$;
revoke execute on function :"schema".capas_aplicar(uuid, uuid, uuid, text, numeric, numeric, numeric, text, text, uuid, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;

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
                 when p_origen = 'produccion' then 'produccion'
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
-- 6. Fabricar
-- =============================================================================

-- El producto se puede fabricar (devuelve la fila; si no, error claro).
create or replace function :"schema".fabricar_producto(p_empresa uuid, p_producto uuid, p_bloquear boolean default false)
returns :"schema".productos
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  prod productos;
begin
  if p_producto is null then raise exception 'Elegí qué producto fabricar'; end if;
  if p_bloquear then
    select * into prod from productos where id = p_producto and empresa_id = p_empresa for update;
  else
    select * into prod from productos where id = p_producto and empresa_id = p_empresa;
  end if;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not prod.activo then raise exception '"%" está inactivo', prod.nombre; end if;
  if prod.tipo_producto not in ('fabricado', 'materia_prima') then
    raise exception '"%" no se fabrica: solo los productos Fabricados y las preparaciones por tanda', prod.nombre;
  end if;
  if not receta_existe(prod.id) then
    raise exception '"%" no tiene receta: cargala en Inventario › Recetas para poder fabricarlo', prod.nombre;
  end if;
  if not receta_por_tanda(prod.id) then
    raise exception '"%" se descuenta al vender: en su receta elegí "Se fabrica por tanda" para fabricarlo', prod.nombre;
  end if;
  return prod;
end;
$fn$;
revoke execute on function :"schema".fabricar_producto(uuid, uuid, boolean) from public, anon, authenticated;

-- Productos que se pueden fabricar (para elegir en "Fabricar").
create or replace function :"schema".fabricables(p_deposito uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_dep uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('fabricar');
  v_dep := coalesce(p_deposito, deposito_por_defecto(s.s_empresa, s.s_sucursal));
  return jsonb_build_object('deposito_id', v_dep, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'tipo_producto', p.tipo_producto, 'unidad_medida', p.unidad_medida,
      'rendimiento', r.rendimiento, 'controla_lotes', p.controla_lotes, 'imagen_url', p.imagen_url,
      'stock', coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = p.id and sd.deposito_id = v_dep), 0),
      'alcanza', fabricar_alcanza(p.id, v_dep, mesa_reservas_json((select d.sucursal_id from depositos d where d.id = v_dep))))
      order by (p.tipo_producto <> 'fabricado'), p.nombre)
      from productos p join recetas r on r.producto_id = p.id and r.por_tanda
     where p.empresa_id = s.s_empresa and p.activo and p.tipo_producto in ('fabricado', 'materia_prima')
       and exists (select 1 from recetas_items ri where ri.producto_id = p.id)), '[]'::jsonb));
end;
$fn$;

-- Vista previa: qué materias primas se van a usar, si alcanzan y el costo estimado.
create or replace function :"schema".fabricar_previa(p_producto uuid, p_cantidad numeric default null, p_deposito uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  prod productos;
  v_dep record;
  v_cant numeric;
  v_res jsonb;
  v_costos boolean;
  v_items jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('fabricar');
  v_costos := tiene_permiso('ver_costos');
  prod := fabricar_producto(s.s_empresa, p_producto);
  select * into v_dep from inv_deposito(s.s_empresa, coalesce(p_deposito, deposito_por_defecto(s.s_empresa, s.s_sucursal)), true);
  v_cant := coalesce(nullif(p_cantidad, 0), (select r.rendimiento from recetas r where r.producto_id = prod.id), 1);
  if v_cant < 0 or v_cant > 10000000 then raise exception 'Cantidad inválida'; end if;
  v_res := mesa_reservas_json(v_dep.suc_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'insumo_id', i.id, 'nombre', i.nombre, 'sku', i.sku, 'unidad_medida', i.unidad_medida, 'cantidad', n.cantidad,
      'controla_stock', i.controla_stock, 'controla_lotes', i.controla_lotes,
      'hay', case when i.controla_stock then coalesce(sd.cantidad, 0) end,
      'reservado', case when i.controla_stock then nullif(coalesce((v_res ->> i.id::text)::numeric, 0), 0) end,
      'falta', case when i.controla_stock
                    then nullif(greatest(n.cantidad - (coalesce(sd.cantidad, 0) - coalesce((v_res ->> i.id::text)::numeric, 0)), 0), 0) end,
      'costo_unitario', case when v_costos then coalesce(i.costo_promedio, 0) end,
      'costo', case when v_costos then round(n.cantidad * coalesce(i.costo_promedio, 0)) end)
      order by i.nombre), '[]'::jsonb)
    into v_items
    from receta_insumos(prod.id, v_cant) n join productos i on i.id = n.insumo_id
    left join stock_depositos sd on sd.producto_id = n.insumo_id and sd.deposito_id = v_dep.dep_id;
  return jsonb_build_object(
    'producto', jsonb_build_object('id', prod.id, 'nombre', prod.nombre, 'sku', prod.sku, 'tipo_producto', prod.tipo_producto,
                                   'unidad_medida', prod.unidad_medida, 'controla_lotes', prod.controla_lotes,
                                   'rendimiento', (select r.rendimiento from recetas r where r.producto_id = prod.id),
                                   'stock', coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = prod.id and sd.deposito_id = v_dep.dep_id), 0)),
    'deposito', jsonb_build_object('id', v_dep.dep_id, 'nombre', v_dep.dep_nombre, 'sucursal', v_dep.suc_nombre),
    'cantidad', v_cant,
    'alcanza', fabricar_alcanza(prod.id, v_dep.dep_id, v_res),
    'items', v_items,
    'faltantes', (select count(*) from jsonb_array_elements(v_items) x where x->>'falta' is not null),
    'ver_costos', v_costos,
    'costo_estimado', case when v_costos then (select coalesce(sum((x->>'costo')::numeric), 0) from jsonb_array_elements(v_items) x) end);
end;
$fn$;

-- Fabricar: p = { producto_id, deposito_id?, cantidad, obtenida?, lote?, vencimiento?, notas?, idempotency_key? }
create or replace function :"schema".fabricar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_emp uuid;
  prod productos;
  v_dep record;
  v_cant numeric;
  v_obt numeric;
  v_notas text := nullif(left(btrim(coalesce(p->>'notas', '')), 500), '');
  v_idem uuid;
  v_rep record;
  v_id uuid;
  v_numero text;
  v_res jsonb;
  v_falta text;
  r record;
  v_orden integer := 0;
  v_cons jsonb;
  v_cost numeric;
  v_total numeric := 0;
  v_cu numeric;
  v_cpp numeric;
  v_lote uuid;
  v_lote_num text;
  v_venc date;
  v_ref text;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('fabricar');
  v_emp := s.s_empresa;
  begin
    v_cant := (p->>'cantidad')::numeric;
    v_obt := coalesce(nullif(p->>'obtenida', '')::numeric, v_cant);
    v_idem := nullif(p->>'idempotency_key', '')::uuid;
    v_venc := nullif(p->>'vencimiento', '')::date;
  exception when others then
    raise exception 'Datos inválidos para fabricar';
  end;

  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('produccion:' || v_emp::text || ':' || v_idem::text, 0));
    select id, numero, estado into v_rep from producciones where empresa_id = v_emp and idempotency_key = v_idem;
    if found then
      return produccion_detalle(v_rep.id) || jsonb_build_object('repetido', true);
    end if;
  end if;

  prod := fabricar_producto(v_emp, nullif(p->>'producto_id', '')::uuid, true);
  if v_cant is null or v_cant <= 0 then raise exception 'Cargá cuánto vas a fabricar'; end if;
  if v_cant > 10000000 then raise exception 'La cantidad es demasiado grande'; end if;
  if v_obt is null or v_obt <= 0 then
    raise exception 'Cargá cuánto salió (mayor a 0). Si no salió nada, cargalo como pérdida de las materias primas.';
  end if;
  if v_obt > v_cant * 10 then raise exception 'Lo que salió (%) no puede ser tanto más que lo planeado (%)', trim_scale(v_obt), trim_scale(v_cant); end if;
  if unidad_normal(prod.unidad_medida) = 'Unidad' and v_obt <> trunc(v_obt) then
    raise exception '"%" se cuenta por unidad: lo que salió tiene que ser un número entero', prod.nombre;
  end if;

  select * into v_dep from inv_deposito(v_emp, coalesce(nullif(p->>'deposito_id', '')::uuid, deposito_por_defecto(v_emp, s.s_sucursal)), true);
  if s.s_rol <> 'ADMIN' and s.s_sucursal is not null and v_dep.suc_id <> s.s_sucursal then
    raise exception 'Solo podés fabricar en los depósitos de tu sucursal';
  end if;
  if prod.controla_lotes then
    if v_venc is null then raise exception '"%" controla lotes: cargá el vencimiento de lo fabricado', prod.nombre; end if;
    v_lote_num := nullif(upper(btrim(coalesce(p->>'lote', ''))), '');
  end if;

  -- ¿Alcanzan las materias primas? (descontando lo reservado por mesas abiertas)
  v_res := mesa_reservas_json(v_dep.suc_id);
  select string_agg(format('%s (hay %s%s, se necesitan %s)', i.nombre,
                           cant_texto(greatest(coalesce(sd.cantidad, 0) - coalesce((v_res ->> i.id::text)::numeric, 0), 0), i.unidad_medida),
                           case when coalesce((v_res ->> i.id::text)::numeric, 0) > 0
                                then ' libres; ' || cant_texto((v_res ->> i.id::text)::numeric, i.unidad_medida) || ' reservados en mesas' else '' end,
                           cant_texto(n.cantidad, i.unidad_medida)), ' · ' order by i.nombre)
    into v_falta
    from receta_insumos(prod.id, v_cant) n join productos i on i.id = n.insumo_id
    left join stock_depositos sd on sd.producto_id = n.insumo_id and sd.deposito_id = v_dep.dep_id
   where i.controla_stock
     and coalesce(sd.cantidad, 0) - coalesce((v_res ->> i.id::text)::numeric, 0) < n.cantidad;
  if v_falta is not null then
    raise exception 'No alcanza la materia prima en %: falta %', v_dep.dep_nombre, v_falta;
  end if;

  v_numero := 'FAB-' || lpad(inv_numero(v_emp, 'produccion', numeracion_max(v_emp, 'producciones.numero'))::text, 6, '0');
  insert into producciones (empresa_id, numero, producto_id, producto_nombre, producto_sku, unidad_medida, deposito_id,
                            cantidad_planeada, cantidad_obtenida, lote_numero, vencimiento, notas, idempotency_key,
                            created_by, usuario_nombre)
    values (v_emp, v_numero, prod.id, prod.nombre, prod.sku, prod.unidad_medida, v_dep.dep_id, v_cant, v_obt,
            case when prod.controla_lotes then coalesce(v_lote_num, v_numero) end, case when prod.controla_lotes then v_venc end,
            v_notas, v_idem, s.s_usuario, s.s_nombre)
    returning id into v_id;
  v_ref := left('Producción ' || v_numero || ' · ' || prod.nombre, 200);

  -- Salen las materias primas (PEPS; FEFO si tienen lotes) y se acumula su costo real.
  for r in
    select n.insumo_id, n.cantidad, i.nombre, i.sku, i.unidad_medida, i.controla_stock, i.controla_lotes,
           coalesce(i.costo_promedio, 0) as cp
      from receta_insumos(prod.id, v_cant) n join productos i on i.id = n.insumo_id
     order by i.nombre
  loop
    v_orden := v_orden + 1;
    v_cons := null;
    if r.controla_stock then
      if r.controla_lotes then
        v_cons := lotes_consumir(v_emp, r.insumo_id, v_dep.dep_id, r.cantidad, 'produccion', null, null, v_ref,
                                 'produccion', v_id, null, null, false);
      end if;
      perform inv_mover(v_emp, r.insumo_id, v_dep.dep_id, -r.cantidad, r.cp, 'produccion', 'produccion', v_id, v_numero, v_ref,
                        s.s_usuario, s.s_nombre);
      v_cost := coalesce((select sum(c.cantidad * c.costo_unitario) from capas_consumos c
                           where c.documento_id = v_id and c.producto_id = r.insumo_id and c.origen = 'produccion'), 0)
              + coalesce((select sum((x->>'cantidad')::numeric * coalesce(nullif(nullif(x->>'costo', '')::numeric, 0), r.cp))
                            from jsonb_array_elements(coalesce(v_cons, '[]'::jsonb)) x where x->>'lote_id' is not null), 0);
    else
      v_cost := r.cantidad * r.cp;
    end if;
    insert into producciones_insumos (empresa_id, produccion_id, orden, insumo_id, insumo_nombre, insumo_sku, unidad_medida,
                                      cantidad, costo_unitario, costo_total, movio_stock, lotes)
      values (v_emp, v_id, v_orden, r.insumo_id, r.nombre, r.sku, r.unidad_medida, r.cantidad,
              round(v_cost / r.cantidad, 4), round(v_cost, 2), r.controla_stock, v_cons);
    v_total := v_total + v_cost;
  end loop;
  if v_orden = 0 then raise exception 'La receta de "%" no tiene ingredientes', prod.nombre; end if;

  -- Entra lo que salió, al costo de la tanda repartido en lo obtenido (la merma va en el costo).
  v_cu := round(v_total / v_obt, 4);
  v_cpp := case when greatest(coalesce(prod.stock_actual, 0), 0) + v_obt > 0
                then round((greatest(coalesce(prod.stock_actual, 0), 0) * coalesce(prod.costo_promedio, 0) + v_obt * v_cu)
                           / (greatest(coalesce(prod.stock_actual, 0), 0) + v_obt), 2)
                else v_cu end;
  update productos set costo_promedio = v_cpp, updated_at = now() where id = prod.id;
  perform inv_mover(v_emp, prod.id, v_dep.dep_id, v_obt, v_cu, 'produccion', 'produccion', v_id, v_numero,
                    v_ref || case when prod.controla_lotes
                                  then ' · Lote ' || coalesce(v_lote_num, v_numero) || ' vence ' || to_char(v_venc, 'DD/MM/YYYY') else '' end,
                    s.s_usuario, s.s_nombre);
  if prod.controla_lotes then
    v_lote := lote_entrada(v_emp, prod.id, v_dep.dep_id, coalesce(v_lote_num, v_numero), v_venc, v_obt, v_cu, 'produccion',
                           null, v_ref, 'produccion', v_id, null);
  end if;

  update producciones set costo_total = round(v_total, 2), costo_unitario = v_cu, lote_id = v_lote where id = v_id;
  return produccion_detalle(v_id);
end;
$fn$;

-- Anular: vuelve todo a las mismas capas / lotes. Si ya salió parte de lo fabricado, no.
create or replace function :"schema".anular_produccion(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a producciones;
  prod productos;
  it record;
  v_hay numeric;
  v_ref text;
  v_cpp numeric;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR']);
  perform exigir_permiso('fabricar');
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into a from producciones where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Producción no encontrada'; end if;
  if a.estado <> 'confirmada' then raise exception 'La producción % ya está anulada', a.numero; end if;
  if s.s_rol <> 'ADMIN' and s.s_sucursal is not null
     and (select d.sucursal_id from depositos d where d.id = a.deposito_id) <> s.s_sucursal then
    raise exception 'Solo podés anular producciones de los depósitos de tu sucursal';
  end if;
  select * into prod from productos where id = a.producto_id for update;
  v_hay := coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = a.producto_id and sd.deposito_id = a.deposito_id), 0);
  if v_hay < a.cantidad_obtenida then
    raise exception 'De "%" quedan % en el depósito y se fabricaron %: ya salió parte de esta producción (venta, traslado…), no se puede anular',
      a.producto_nombre, cant_texto(v_hay, a.unidad_medida), cant_texto(a.cantidad_obtenida, a.unidad_medida);
  end if;
  v_ref := left('Anulación ' || a.numero || ': ' || btrim(p_motivo), 200);

  -- Sale lo fabricado (de su propio lote / su propia capa) y el promedio vuelve a como estaba.
  -- Si al fabricarlo no controlaba lotes y ahora sí, esas unidades son el saldo "sin lote".
  perform lotes_revertir(a.empresa_id, null, a.id, null, 'ENTRADA', array['produccion'], 'anulacion_produccion', v_ref);
  if prod.controla_lotes and not exists (select 1 from lotes_movimientos lm
                                          where lm.documento_id = a.id and lm.producto_id = a.producto_id
                                            and lm.tipo = 'ENTRADA' and lm.origen = 'produccion') then
    perform lote_sin_lote(a.empresa_id, a.producto_id, a.deposito_id, 'SALIDA', a.cantidad_obtenida, 'anulacion_produccion',
                          v_ref, 'produccion', a.id, null);
  end if;
  v_cpp := case when coalesce(prod.stock_actual, 0) - a.cantidad_obtenida > 0
                then greatest(round((prod.stock_actual * coalesce(prod.costo_promedio, 0) - a.cantidad_obtenida * a.costo_unitario)
                                    / (prod.stock_actual - a.cantidad_obtenida), 2), 0)
                else prod.costo_promedio end;
  update productos set costo_promedio = v_cpp, updated_at = now() where id = prod.id;
  perform inv_mover(a.empresa_id, a.producto_id, a.deposito_id, -a.cantidad_obtenida, a.costo_unitario, 'anulacion_produccion',
                    'produccion', a.id, a.numero, v_ref, s.s_usuario, s.s_nombre);

  -- Vuelven las materias primas (a sus lotes y a sus capas).
  perform lotes_revertir(a.empresa_id, null, a.id, null, 'SALIDA', array['produccion'], 'anulacion_produccion', v_ref);
  for it in select * from producciones_insumos where produccion_id = a.id and movio_stock order by orden loop
    if it.lotes is null and exists (select 1 from productos x where x.id = it.insumo_id and x.controla_lotes and x.controla_stock) then
      perform lote_sin_lote(a.empresa_id, it.insumo_id, a.deposito_id, 'ENTRADA', it.cantidad, 'anulacion_produccion',
                            v_ref, 'produccion', a.id, null);
    end if;
    perform inv_mover(a.empresa_id, it.insumo_id, a.deposito_id, it.cantidad, it.costo_unitario, 'anulacion_produccion',
                      'produccion', a.id, a.numero, v_ref, s.s_usuario, s.s_nombre);
  end loop;

  update producciones set estado = 'anulada', anulado_por = s.s_usuario, anulado_por_nombre = s.s_nombre,
         anulado_at = now(), anulado_motivo = left(btrim(p_motivo), 500)
   where id = a.id;
  return produccion_detalle(a.id);
end;
$fn$;

create or replace function :"schema".produccion_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_costos boolean;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  if not (tiene_permiso('fabricar') or tiene_permiso('ver_costos')) then perform exigir_permiso('fabricar'); end if;
  v_costos := tiene_permiso('ver_costos');
  select jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'estado', a.estado, 'created_at', a.created_at, 'usuario_nombre', a.usuario_nombre,
    'producto', jsonb_build_object('id', a.producto_id, 'nombre', a.producto_nombre, 'sku', a.producto_sku,
                                   'unidad_medida', a.unidad_medida, 'tipo_producto', p.tipo_producto),
    'deposito', jsonb_build_object('id', d.id, 'nombre', d.nombre, 'sucursal', su.nombre),
    'cantidad_planeada', a.cantidad_planeada, 'cantidad_obtenida', a.cantidad_obtenida,
    'merma', a.cantidad_planeada - a.cantidad_obtenida,
    'merma_pct', case when a.cantidad_planeada > a.cantidad_obtenida
                      then round((a.cantidad_planeada - a.cantidad_obtenida) / a.cantidad_planeada * 100, 1) end,
    'costo_total', case when v_costos then a.costo_total end,
    'costo_unitario', case when v_costos then a.costo_unitario end,
    'lote_numero', a.lote_numero, 'vencimiento', a.vencimiento, 'notas', a.notas,
    'anulado_por_nombre', a.anulado_por_nombre, 'anulado_at', a.anulado_at, 'anulado_motivo', a.anulado_motivo,
    'ver_costos', v_costos,
    'puede_anular', a.estado = 'confirmada' and s.s_rol in ('ADMIN', 'SUPERVISOR') and tiene_permiso('fabricar'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'insumo_id', i.insumo_id, 'nombre', i.insumo_nombre, 'sku', i.insumo_sku, 'unidad_medida', i.unidad_medida,
        'cantidad', i.cantidad, 'movio_stock', i.movio_stock,
        'costo_unitario', case when v_costos then i.costo_unitario end,
        'costo_total', case when v_costos then i.costo_total end,
        'lotes', (select jsonb_agg(jsonb_build_object('numero', x->>'numero', 'vencimiento', x->>'vencimiento', 'cantidad', (x->>'cantidad')::numeric))
                    from jsonb_array_elements(coalesce(i.lotes, '[]'::jsonb)) x where x->>'lote_id' is not null))
        order by i.orden) from producciones_insumos i where i.produccion_id = a.id), '[]'::jsonb))
    into r
    from producciones a join depositos d on d.id = a.deposito_id join sucursales su on su.id = d.sucursal_id
    left join productos p on p.id = a.producto_id
   where a.id = p_id and a.empresa_id = s.s_empresa;
  if r is null then raise exception 'Producción no encontrada'; end if;
  return r;
end;
$fn$;

create or replace function :"schema".listar_producciones(
  p_q text default null, p_estado text default null, p_deposito uuid default null, p_producto uuid default null,
  p_desde text default null, p_hasta text default null, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_costos boolean;
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(norm(p_q));
  v_doc text[] := q_documento(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_solo boolean := false;
  v_desde timestamptz := case when p_desde ~ '^\d{4}-\d{2}-\d{2}$' then (p_desde || 'T00:00:00-03:00')::timestamptz end;
  v_hasta timestamptz := case when p_hasta ~ '^\d{4}-\d{2}-\d{2}$' then (p_hasta || 'T23:59:59.999-03:00')::timestamptz end;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  if not (tiene_permiso('fabricar') or tiene_permiso('ver_costos')) then perform exigir_permiso('fabricar'); end if;
  v_costos := tiene_permiso('ver_costos');
  if v_doc is not null then
    v_solo := exists (select 1 from producciones a where a.empresa_id = s.s_empresa and (doc_igual(a.numero, v_doc) or doc_serie(a.numero, v_doc)));
  end if;
  with t as (
    select a.*,
           case when v_busca then concat_ws(' ', norm(a.numero), compacto(a.numero), norm(a.producto_nombre), compacto(a.producto_nombre),
                    norm(a.producto_sku), compacto(a.producto_sku), norm(a.notas), norm(a.usuario_nombre), norm(a.lote_numero),
                    (select string_agg(concat_ws(' ', norm(i.insumo_nombre), norm(i.insumo_sku)), ' ')
                       from producciones_insumos i where i.produccion_id = a.id)) end as _t
      from producciones a
     where a.empresa_id = s.s_empresa
       and (coalesce(p_estado, '') = '' or a.estado = p_estado)
       and (p_deposito is null or a.deposito_id = p_deposito)
       and (p_producto is null or a.producto_id = p_producto)
       and (v_desde is null or a.created_at >= v_desde)
       and (v_hasta is null or a.created_at <= v_hasta)
  ), f as (
    select t.*,
           case when not v_busca then 0 when doc_igual(t.numero, v_doc) then 3000
                else relevancia_busqueda(norm(t.producto_nombre), t._t, v_q, v_tk) end as _score
      from t
     where not v_busca
        or (v_solo and doc_igual(t.numero, v_doc))
        or (not v_solo and coincide_busqueda(t._t, v_tk))
  ), pag as (
    select * from f order by _score desc, created_at desc, id desc limit v_lim offset v_off
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'ver_costos', v_costos,
    'puede_fabricar', tiene_permiso('fabricar'),
    'totales', (select jsonb_build_object(
        'producciones', count(*) filter (where estado = 'confirmada'),
        'costo', case when v_costos then coalesce(sum(costo_total) filter (where estado = 'confirmada'), 0) end) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'numero', g.numero, 'estado', g.estado, 'created_at', g.created_at, 'usuario_nombre', g.usuario_nombre,
        'producto', jsonb_build_object('id', g.producto_id, 'nombre', g.producto_nombre, 'sku', g.producto_sku, 'unidad_medida', g.unidad_medida),
        'deposito', jsonb_build_object('id', dd.id, 'nombre', dd.nombre, 'sucursal', ds.nombre),
        'cantidad_planeada', g.cantidad_planeada, 'cantidad_obtenida', g.cantidad_obtenida,
        'merma', g.cantidad_planeada - g.cantidad_obtenida,
        'costo_total', case when v_costos then g.costo_total end,
        'costo_unitario', case when v_costos then g.costo_unitario end,
        'lote_numero', g.lote_numero, 'vencimiento', g.vencimiento,
        'insumos', (select count(*) from producciones_insumos i where i.produccion_id = g.id)
      ) order by g._score desc, g.created_at desc, g.id desc)
      from pag g join depositos dd on dd.id = g.deposito_id join sucursales ds on ds.id = dd.sucursal_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

revoke all on function :"schema".receta_existe(uuid) from public, anon, authenticated;
revoke all on function :"schema".receta_por_tanda(uuid) from public, anon, authenticated;
revoke all on function :"schema".fabricar_alcanza(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".fabricables(uuid) from public, anon;
revoke all on function :"schema".fabricar_previa(uuid, numeric, uuid) from public, anon;
revoke all on function :"schema".fabricar(jsonb) from public, anon;
revoke all on function :"schema".anular_produccion(uuid, text) from public, anon;
revoke all on function :"schema".produccion_detalle(uuid) from public, anon;
revoke all on function :"schema".listar_producciones(text, text, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function
  :"schema".receta_existe(uuid), :"schema".receta_por_tanda(uuid), :"schema".fabricar_alcanza(uuid, uuid, jsonb)
  to service_role;
grant execute on function
  :"schema".fabricables(uuid), :"schema".fabricar_previa(uuid, numeric, uuid), :"schema".fabricar(jsonb),
  :"schema".anular_produccion(uuid, text), :"schema".produccion_detalle(uuid),
  :"schema".listar_producciones(text, text, uuid, uuid, text, text, integer, integer)
  to authenticated, service_role;

-- =============================================================================
-- 7. Parches sobre la versión vigente (cada patrón tiene que aparecer, o ya estar aplicado)
-- =============================================================================
do $do$
declare
  c record;
  v_def text;
  v_nueva text;
begin
  -- Carga pg_trgm en la sesión: buscar_productos lleva SET pg_trgm.* y sin la extensión
  -- cargada el parámetro es un "placeholder" que este rol no puede fijar.
  perform extensions.similarity('a', 'b');
  for c in select * from (values
      ('buscar_productos',          $a$in ('reventa', 'menu', 'materia_prima')$a$, $b$in ('reventa', 'menu', 'materia_prima', 'fabricado')$b$),
      ('listar_productos_inventario', $a$in ('reventa', 'menu', 'materia_prima')$a$, $b$in ('reventa', 'menu', 'materia_prima', 'fabricado')$b$),
      ('reporte_existencias',       $a$p_tipo in ('reventa', 'materia_prima')$a$, $b$p_tipo in ('reventa', 'materia_prima', 'fabricado')$b$),
      ('funciones_empresa',         $a$tipo_producto in ('menu', 'materia_prima')$a$, $b$tipo_producto in ('menu', 'materia_prima', 'fabricado')$b$),
      ('guardar_funciones_empresa', $a$tipo_producto in ('menu', 'materia_prima')$a$, $b$tipo_producto in ('menu', 'materia_prima', 'fabricado')$b$),
      ('guardar_funciones_empresa', $a$de tipo Menú o Materia prima$a$, $b$de tipo Menú, Materia prima o Fabricado$b$)
    ) x(fn, patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = c.fn;
    if v_def is null then raise exception 'Parche 97: no existe %', c.fn; end if;
    if position(c.nuevo in v_def) > 0 then continue; end if;   -- ya aplicado
    if position(c.patron in v_def) = 0 then raise exception 'Parche 97: % no tiene el patrón esperado', c.fn; end if;
    v_nueva := replace(v_def, c.patron, c.nuevo);
    execute v_nueva;
  end loop;

  -- Permiso nuevo en el catálogo (después de "Recibir traslados").
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'permisos_catalogo';
  if position('''fabricar''' in v_def) = 0 then
    v_nueva := regexp_replace(v_def, '(\(''recibir_traslados'',[^\n]*\n)',
                              E'\\1    (''fabricar'',                   ''Fabricar productos'',                            ''Inventario''),\n');
    if v_nueva = v_def then raise exception 'Parche 97: permisos_catalogo no tiene el patrón esperado'; end if;
    execute v_nueva;
  end if;
end;
$do$;

commit;

-- =============================================================================
-- 8. Semilla (solo erp_demo): maní a granel + bolsa → "Bolsa de maní 250 g" (fabricado)
-- =============================================================================
select (:'schema' = 'erp_demo') as es_demo \gset
\if :es_demo
begin;
set local search_path to :"schema", public;
do $seed$
declare
  e record;
  d record;
  v_cat uuid;
  v_id uuid;
  v_fab uuid;
  mp record;
begin
  for e in select id from empresas loop
    select id into v_cat from categorias_productos where empresa_id = e.id and lower(btrim(nombre)) = 'insumos';
    for mp in select * from (values
        ('MP-MANI',    'Maní crudo', 'kg', 18000, 25),
        ('MP-BOLSA250', 'Bolsa para 250 g', 'Unidad', 150, 300)
      ) x(sku, nombre, unidad, costo, stock)
    loop
      select id into v_id from productos where empresa_id = e.id and sku = mp.sku;
      if v_id is null then
        insert into productos (empresa_id, nombre, sku, costo_promedio, precio_venta, unidad_medida, tipo_producto,
                               controla_stock, es_vendible, categoria_principal_id, tipo_iva, stock_minimo)
          values (e.id, mp.nombre, mp.sku, mp.costo, 0, mp.unidad, 'materia_prima', true, false, v_cat, '10%',
                  round(mp.stock * 0.2))
          returning id into v_id;
        for d in select dp.id from depositos dp join sucursales su on su.id = dp.sucursal_id
                  where dp.empresa_id = e.id and dp.activo and su.activa and dp.es_principal loop
          perform inv_mover(e.id, v_id, d.id, mp.stock, mp.costo, 'inventario_inicial', null, null, null,
                            'Stock inicial de demo (receta 97)', null, 'Sistema');
        end loop;
      end if;
    end loop;

    select id into v_fab from productos where empresa_id = e.id and sku = 'FAB-MANI250';
    if v_fab is null then
      insert into productos (empresa_id, nombre, sku, costo_promedio, precio_venta, unidad_medida, tipo_producto,
                             controla_stock, es_vendible, tipo_iva, stock_minimo, descripcion)
        values (e.id, 'Bolsa de maní 250 g', 'FAB-MANI250', 0, 9000, 'Unidad', 'fabricado', true, true, '10%', 10,
                'Fabricado: maní tostado embolsado (receta 97)')
        returning id into v_fab;
      insert into recetas (producto_id, empresa_id, rendimiento, por_tanda, notas)
        values (v_fab, e.id, 1, true, 'Maní tostado: ~4 % de merma al tostar')
        on conflict (producto_id) do nothing;
      insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden)
        select e.id, v_fab, p.id, x.cant, x.uni, x.merma, x.ord
          from (values ('MP-MANI', 250::numeric, 'g', 4::numeric, 1), ('MP-BOLSA250', 1::numeric, 'Unidad', 0::numeric, 2)) x(sku, cant, uni, merma, ord)
          join productos p on p.empresa_id = e.id and p.sku = x.sku
        on conflict (producto_id, insumo_id) do nothing;
      update productos set costo_promedio = round(receta_costo(id)) where id = v_fab;
    end if;
  end loop;
end;
$seed$;
commit;
\endif
