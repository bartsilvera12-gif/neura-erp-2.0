-- =============================================================================
-- TIPOS DE PRODUCTO Y RECETAS (pedido del dueño, 23-oct-2026).
--
-- Tipo de producto (productos.tipo_producto) — solo 3:
--   · reventa        como siempre: stock propio, se compra y se vende.
--   · menu           plato / producto elaborado: SIN stock propio (controla_stock = false). Al
--                    venderse descuenta los ingredientes de su receta. Sin receta NO se vende.
--   · materia_prima  insumo: se compra y tiene stock (compras, movimientos, ajustes, stock mínimo)
--                    pero NO se vende (es_vendible = false, fuera del menú QR; crear_venta lo
--                    rechaza). Unidad normalizada: Unidad, kg, g, l o ml.
--   Migración: 'repuesto' y 'servicio' (no se usaban: los 30 productos de erp_demo eran reventa)
--   pasan a 'reventa'. Un trigger (tg_productos_tipo) mantiene las banderas coherentes con el tipo.
--
-- Recetas (recetas + recetas_items)
--   · Lleva receta un producto Menú o una Materia prima. Una materia prima CON receta es una
--     PREPARACIÓN (ej. "Salsa de la casa"): no lleva stock propio (controla_stock = false; para
--     ponerle receta su stock tiene que estar en 0) y al vender se EXPLOTA hasta las materias
--     primas sin receta (recursivo, hasta 5 niveles). Una preparación se puede usar como
--     ingrediente de otras recetas.
--   · rendimiento: cuántas unidades (porciones, o la unidad de la preparación: 1 kg de salsa)
--     produce la receta. Default 1.
--   · Cada ingrediente: cantidad NETA (lo que va al plato) en Unidad / kg / g / l / ml (se
--     convierte a la unidad del ingrediente: g↔kg, ml↔l) y merma %.
--     MERMA: cantidad descontada (bruta) = neta / (1 − merma%). Ej. 150 g de carne con 10 % de
--     merma descuenta 166,7 g. Merma de 0 a 90 %.
--   · Ciclos: impedidos en la base (trigger en recetas_items) y en la UI. Profundidad máx. 5.
--
-- Venta (crear_venta, redefinida desde la 67, vigente)
--   · Materia prima → error. Menú sin receta → error ("cargá su receta").
--   · Menú con receta: si falta un ingrediente NO se vende ("Falta Carne molida para Hamburguesa
--     clásica: hay 0,3 kg, se necesitan 0,45 kg"). Si alcanza, descuenta cada materia prima del
--     depósito de la caja (movimiento 'venta' como el resto, lotes FEFO con lotes_consumir si el
--     insumo controla lotes) y lo deja en ventas_items_insumos. CMV del plato = Σ costos de los
--     ingredientes al momento (ventas_items.costo_unitario).
--   · anular_venta (redefinida) devuelve también los ingredientes (y los lotes, como siempre).
--
-- Disponibilidad (porciones posibles = mín. stock del depósito ÷ necesidad por porción)
--   · Caja › Nueva venta (productos_pos): el plato viene con controla_stock = true y stock_actual =
--     porciones posibles (0 si no tiene receta, con sin_receta = true): la caja ya muestra
--     "Sin stock" y bloquea el cobro.
--   · Menú QR (mesa_menu_publico / mesa_pedido_publico_crear): se OCULTAN los platos que no se
--     pueden preparar, contando lo ya reservado por pedidos aceptados en cuentas abiertas.
--   · Pedidos de mesas: al ACEPTAR (mesa_pedido_accion, redefinida desde la 70) se valida que
--     alcance contando lo reservado por otras cuentas abiertas de la sucursal (sin cobrar).
--
-- Búsquedas: buscar_productos y listar_productos_inventario suman p_tipo ('reventa', 'menu',
-- 'materia_prima', 'stock' = todo menos Menú, 'vendible' = todo menos Materia prima).
-- Presupuestos: el trigger de líneas rechaza materias primas.
--
-- Semilla SOLO en erp_demo: MENU-* → Menú; materias primas con stock y costo (ambos depósitos
-- principales); preparación "Salsa de la casa"; recetas de los 7 platos.
--
-- IDEMPOTENTE. Va después de 71.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tipo de producto
-- =============================================================================
alter table :"schema".productos drop constraint if exists productos_tipo_producto_check;
update :"schema".productos set tipo_producto = 'reventa' where tipo_producto not in ('reventa', 'menu', 'materia_prima');
alter table :"schema".productos add constraint productos_tipo_producto_check
  check (tipo_producto in ('reventa', 'menu', 'materia_prima'));
comment on column :"schema".productos.tipo_producto is
  'reventa (stock propio) · menu (sin stock: descuenta su receta al venderse) · materia_prima (se compra, no se vende; con receta = preparación). Receta 72.';

-- =============================================================================
-- 2. Unidades de medida (Unidad, kg, g, l, ml) y conversión
-- =============================================================================
create or replace function :"schema".unidad_normal(p text)
returns text language sql immutable set search_path = :"schema", public as $$
  select case
    when lower(btrim(coalesce(p, ''))) in ('', 'unidad', 'unidades', 'u', 'u.', 'un', 'und', 'unid', 'unid.') then 'Unidad'
    when lower(btrim(p)) in ('kg', 'kgs', 'kg.', 'kilo', 'kilos', 'kilogramo', 'kilogramos') then 'kg'
    when lower(btrim(p)) in ('g', 'gr', 'gr.', 'grs', 'gramo', 'gramos') then 'g'
    when lower(btrim(p)) in ('l', 'lt', 'lts', 'litro', 'litros') then 'l'
    when lower(btrim(p)) in ('ml', 'mililitro', 'mililitros', 'cc') then 'ml'
    else null end
$$;

-- Dimensión de la unidad: masa / volumen / unidad (null = unidad no convertible).
create or replace function :"schema".unidad_dim(p text)
returns text language sql immutable set search_path = :"schema", public as $$
  select case unidad_normal(p) when 'kg' then 'masa' when 'g' then 'masa' when 'l' then 'volumen' when 'ml' then 'volumen'
                               when 'Unidad' then 'unidad' else null end
$$;

create or replace function :"schema".unidad_factor(p text)
returns numeric language sql immutable set search_path = :"schema", public as $$
  select case unidad_normal(p) when 'kg' then 1000 when 'l' then 1000 else 1 end::numeric
$$;

create or replace function :"schema".unidad_convertir(p_cant numeric, p_de text, p_a text)
returns numeric language plpgsql immutable set search_path = :"schema", public as $fn$
begin
  if unidad_dim(p_de) is null or unidad_dim(p_a) is null or unidad_dim(p_de) <> unidad_dim(p_a) then
    raise exception 'No se puede pasar de "%" a "%"', coalesce(p_de, '—'), coalesce(p_a, '—');
  end if;
  return p_cant * unidad_factor(p_de) / unidad_factor(p_a);
end;
$fn$;

-- "0,45 kg" / "3 u." para los mensajes.
create or replace function :"schema".cant_texto(p_cant numeric, p_unidad text)
returns text language sql immutable set search_path = :"schema", public as $$
  select replace(trim_scale(round(coalesce(p_cant, 0), 3))::text, '.', ',') || ' ' ||
         case when coalesce(unidad_normal(p_unidad), p_unidad) = 'Unidad' then 'u.' else coalesce(unidad_normal(p_unidad), p_unidad) end
$$;

-- =============================================================================
-- 3. Tablas
-- =============================================================================
create table if not exists :"schema".recetas (
  producto_id uuid primary key references :"schema".productos(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  rendimiento numeric not null default 1,
  notas text,
  updated_at timestamptz not null default now(),
  updated_por uuid,
  constraint chk_recetas_rendimiento check (rendimiento > 0 and rendimiento <= 100000),
  constraint chk_recetas_notas check (notas is null or length(notas) <= 1000)
);
create index if not exists recetas_empresa_idx on :"schema".recetas (empresa_id);

create table if not exists :"schema".recetas_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".recetas(producto_id) on delete cascade,
  insumo_id uuid not null references :"schema".productos(id) on delete restrict,
  cantidad numeric not null,
  unidad text not null,
  merma_pct numeric not null default 0,
  orden integer not null default 0,
  constraint chk_ri_cantidad check (cantidad > 0 and cantidad <= 1000000),
  constraint chk_ri_merma check (merma_pct >= 0 and merma_pct <= 90),
  constraint chk_ri_unidad check (unidad in ('Unidad', 'kg', 'g', 'l', 'ml')),
  constraint chk_ri_no_si_mismo check (insumo_id <> producto_id),
  constraint uq_recetas_items unique (producto_id, insumo_id)
);
create index if not exists recetas_items_insumo_idx on :"schema".recetas_items (insumo_id);
create index if not exists recetas_items_empresa_idx on :"schema".recetas_items (empresa_id);

-- Lo que descontó cada plato vendido (para anular y para auditar el CMV).
create table if not exists :"schema".ventas_items_insumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  venta_id uuid not null references :"schema".ventas(id) on delete cascade,
  venta_item_id uuid not null references :"schema".ventas_items(id) on delete cascade,
  insumo_id uuid not null references :"schema".productos(id) on delete restrict,
  cantidad numeric not null,
  costo_unitario numeric not null default 0,
  deposito_id uuid references :"schema".depositos(id) on delete set null,
  descontado boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_vii_cantidad check (cantidad > 0)
);
create index if not exists ventas_items_insumos_venta_idx on :"schema".ventas_items_insumos (venta_id);
create index if not exists ventas_items_insumos_insumo_idx on :"schema".ventas_items_insumos (insumo_id);

alter table :"schema".recetas enable row level security;
alter table :"schema".recetas force row level security;
alter table :"schema".recetas_items enable row level security;
alter table :"schema".recetas_items force row level security;
alter table :"schema".ventas_items_insumos enable row level security;
alter table :"schema".ventas_items_insumos force row level security;

drop policy if exists recetas_propias on :"schema".recetas;
create policy recetas_propias on :"schema".recetas for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists recetas_items_propios on :"schema".recetas_items;
create policy recetas_items_propios on :"schema".recetas_items for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists ventas_items_insumos_propios on :"schema".ventas_items_insumos;
create policy ventas_items_insumos_propios on :"schema".ventas_items_insumos for select to authenticated
  using (empresa_id = :"schema".empresa_actual());

revoke all on :"schema".recetas, :"schema".recetas_items, :"schema".ventas_items_insumos from anon, authenticated;
grant select on :"schema".recetas, :"schema".recetas_items, :"schema".ventas_items_insumos to authenticated;
grant all on :"schema".recetas, :"schema".recetas_items, :"schema".ventas_items_insumos to service_role;

-- =============================================================================
-- 4. Helpers de recetas
-- =============================================================================
create or replace function :"schema".tiene_receta(p_producto uuid)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select exists (select 1 from recetas_items where producto_id = p_producto)
$$;

-- Explosión: materias primas (sin receta) que lleva p_cantidad del producto, en la unidad de
-- cada materia prima, con merma (bruto = neto / (1 − merma)) y rendimiento. Recursivo.
create or replace function :"schema".receta_insumos(p_producto uuid, p_cantidad numeric)
returns table (insumo_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
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
      join recetas r on r.producto_id = x.insumo
      join recetas_items ri on ri.producto_id = r.producto_id
      join productos i on i.id = ri.insumo_id
     where x.nivel < 8 and not (ri.insumo_id = any (x.ruta))
  )
  select x.insumo, round(sum(x.cant), 4)
    from x
   where not exists (select 1 from recetas_items z where z.producto_id = x.insumo)
   group by x.insumo
  having round(sum(x.cant), 4) > 0
$$;

-- Costo de UNA unidad del producto según su receta (costo promedio actual de cada insumo).
create or replace function :"schema".receta_costo(p_producto uuid)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(round(sum(r.cantidad * coalesce(i.costo_promedio, 0)), 2), 0)
    from receta_insumos(p_producto, 1) r join productos i on i.id = r.insumo_id
$$;

-- Niveles de receta debajo del producto (1 = solo materias primas).
create or replace function :"schema".receta_profundidad(p_producto uuid)
returns integer language sql stable security definer set search_path = :"schema", public as $$
  with recursive d(pid, n) as (
    select p_producto, 0
    union
    select ri.insumo_id, d.n + 1 from d join recetas_items ri on ri.producto_id = d.pid where d.n < 12
  )
  select coalesce(max(n), 0) from d
$$;

-- Lo que consume del stock vender p_cantidad de un producto: sus materias primas (si tiene
-- receta) o él mismo (si controla stock). Solo lo que controla stock.
create or replace function :"schema".necesidad_stock(p_producto uuid, p_cantidad numeric)
returns table (producto_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select r.insumo_id, r.cantidad
    from receta_insumos(p_producto, p_cantidad) r join productos i on i.id = r.insumo_id
   where i.controla_stock and tiene_receta(p_producto)
  union all
  select p.id, p_cantidad from productos p
   where p.id = p_producto and p.controla_stock and not tiene_receta(p.id)
$$;

-- Reservado por las mesas de una sucursal: pedidos aceptados (o más) de cuentas abiertas, sin
-- cobrar. { producto_id: cantidad } en la unidad de stock de cada producto.
create or replace function :"schema".mesa_reservas_json(p_sucursal uuid, p_excluir_pedido uuid default null)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(jsonb_object_agg(x.producto_id::text, x.cant), '{}'::jsonb)
    from (
      select n.producto_id, sum(n.cantidad) as cant
        from mesa_pedido_items i
        join mesa_pedidos p on p.id = i.pedido_id
        join mesa_cuentas c on c.id = p.cuenta_id
        join mesas m on m.id = p.mesa_id
        cross join lateral necesidad_stock(i.producto_id, i.cantidad) n
       where c.estado = 'abierta' and p.estado not in ('nuevo', 'rechazado')
         and m.sucursal_id = p_sucursal and p.id is distinct from p_excluir_pedido
         and i.producto_id is not null
       group by n.producto_id
    ) x
$$;

-- Porciones posibles de un producto con receta en un depósito (descontando p_reserva).
-- 0 = Menú sin receta; null = no consume nada con control de stock (sin límite).
create or replace function :"schema".plato_porciones(p_producto uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select case
    when p.tipo_producto = 'menu' and not tiene_receta(p.id) then 0
    else (select greatest(0, floor(min((coalesce(sd.cantidad, 0) - coalesce((coalesce(p_reserva, '{}'::jsonb) ->> n.producto_id::text)::numeric, 0)) / n.cantidad)))
            from necesidad_stock(p.id, 1) n
            left join stock_depositos sd on sd.producto_id = n.producto_id and sd.deposito_id = p_deposito
           where n.cantidad > 0)
    end
    from productos p where p.id = p_producto
$$;

-- Primer faltante (texto para el usuario) para vender p_items [{producto_id, cantidad}] desde
-- p_deposito, contando p_reserva. null = alcanza todo.
create or replace function :"schema".stock_faltante(p_deposito uuid, p_items jsonb, p_reserva jsonb default '{}'::jsonb)
returns text language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  r record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return null; end if;
  select p.nombre, p.tipo_producto into r
    from jsonb_array_elements(p_items) e join productos p on p.id = (e->>'producto_id')::uuid
   where p.tipo_producto = 'materia_prima' or (p.tipo_producto = 'menu' and not tiene_receta(p.id))
   limit 1;
  if found then
    if r.tipo_producto = 'materia_prima' then
      return format('"%s" es materia prima: no se vende (se usa en las recetas)', r.nombre);
    end if;
    return format('"%s" no tiene receta: cargala en Inventario › Recetas para poder venderlo', r.nombre);
  end if;

  select i.nombre as insumo, i.unidad_medida as unidad, x.cant, x.platos, x.de_receta,
         coalesce(sd.cantidad, 0) as hay,
         coalesce((coalesce(p_reserva, '{}'::jsonb) ->> x.producto_id::text)::numeric, 0) as reservado
    into r
    from (
      select n.producto_id, sum(n.cantidad) as cant,
             string_agg(distinct pp.nombre, ', ') filter (where pp.id <> n.producto_id) as platos,
             bool_or(pp.id <> n.producto_id) as de_receta
        from jsonb_array_elements(p_items) e
        join productos pp on pp.id = (e->>'producto_id')::uuid
        cross join lateral necesidad_stock(pp.id, (e->>'cantidad')::numeric) n
       group by n.producto_id
    ) x
    join productos i on i.id = x.producto_id
    left join stock_depositos sd on sd.producto_id = x.producto_id and sd.deposito_id = p_deposito
   where coalesce(sd.cantidad, 0) - coalesce((coalesce(p_reserva, '{}'::jsonb) ->> x.producto_id::text)::numeric, 0) < x.cant
   order by i.nombre
   limit 1;
  if not found then return null; end if;
  if r.reservado > 0 then
    return format('Falta %s%s: hay %s libres (%s ya reservados en mesas abiertas), se necesitan %s',
      r.insumo, case when r.de_receta then ' para ' || r.platos else '' end,
      cant_texto(greatest(r.hay - r.reservado, 0), r.unidad), cant_texto(r.reservado, r.unidad), cant_texto(r.cant, r.unidad));
  end if;
  return format('Falta %s%s: hay %s, se necesitan %s',
    r.insumo, case when r.de_receta then ' para ' || r.platos else '' end,
    cant_texto(greatest(r.hay, 0), r.unidad), cant_texto(r.cant, r.unidad));
end;
$fn$;

-- =============================================================================
-- 5. Triggers de coherencia
-- =============================================================================
create or replace function :"schema".tg_productos_tipo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u text;
  v_rec boolean := tg_op = 'UPDATE' and exists (select 1 from recetas_items where producto_id = new.id);
  v_usos integer;
begin
  if new.tipo_producto = 'menu' then
    if coalesce(new.stock_actual, 0) <> 0 then
      raise exception '"%" tiene stock (%): un producto Menú no lleva stock propio (descuenta los ingredientes de su receta). Dejá el stock en 0 con un ajuste antes de pasarlo a Menú.',
        new.nombre, trim_scale(new.stock_actual);
    end if;
    new.controla_stock := false;
    new.controla_lotes := false;
  elsif new.tipo_producto = 'materia_prima' then
    new.es_vendible := false;
    new.en_menu_qr := false;
    new.estacion_id := null;
    v_u := unidad_normal(new.unidad_medida);
    if v_u is null then
      raise exception 'La unidad "%" no sirve para una materia prima: elegí Unidad, kg, g, l o ml', new.unidad_medida;
    end if;
    new.unidad_medida := v_u;
    if v_rec then
      -- Preparación (materia prima con receta): sin stock propio, se explota al vender.
      new.controla_stock := false;
      new.controla_lotes := false;
    end if;
  elsif v_rec then
    raise exception '"%" tiene receta: quitala en Inventario › Recetas antes de pasarlo a Reventa', new.nombre;
  end if;

  if tg_op = 'UPDATE' then
    select count(*) into v_usos from recetas_items where insumo_id = new.id;
    if v_usos > 0 and new.tipo_producto <> 'materia_prima' then
      raise exception '"%" es ingrediente de % receta(s): sacalo de esas recetas antes de cambiarle el tipo', new.nombre, v_usos;
    end if;
    if v_usos > 0 and unidad_dim(new.unidad_medida) is distinct from unidad_dim(old.unidad_medida) then
      raise exception '"%" es ingrediente de % receta(s) en %: no se puede pasar a % (otra magnitud)',
        new.nombre, v_usos, old.unidad_medida, new.unidad_medida;
    end if;
  end if;
  return new;
end;
$fn$;
revoke all on function :"schema".tg_productos_tipo() from public, anon, authenticated;
drop trigger if exists trg_productos_tipo on :"schema".productos;
create trigger trg_productos_tipo
  before insert or update of tipo_producto, controla_stock, controla_lotes, es_vendible, en_menu_qr, estacion_id, unidad_medida
  on :"schema".productos for each row execute function :"schema".tg_productos_tipo();

-- Ingredientes: de la misma empresa, materia prima, unidad compatible y SIN ciclos.
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
  if v_plato.tipo_producto not in ('menu', 'materia_prima') then
    raise exception 'Solo los productos Menú y las materias primas (preparaciones) llevan receta';
  end if;
  if v_ins.tipo_producto <> 'materia_prima' then
    raise exception '"%" no es materia prima: en una receta solo van materias primas (o preparaciones)', v_ins.nombre;
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
drop trigger if exists trg_recetas_items_validar on :"schema".recetas_items;
create trigger trg_recetas_items_validar
  before insert or update on :"schema".recetas_items
  for each row execute function :"schema".tg_recetas_items_validar();

-- Presupuestos: tampoco materias primas (receta 64 + 72).
create or replace function :"schema".tg_presupuestos_items_solo_productos()
returns trigger
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_tipo text;
  v_nombre text;
begin
  if new.producto_id is null then
    raise exception 'En un presupuesto solo van productos del inventario (línea "%")', coalesce(new.descripcion, 'sin descripción')
      using errcode = 'check_violation';
  end if;
  select tipo_producto, nombre into v_tipo, v_nombre from productos where id = new.producto_id and empresa_id = new.empresa_id;
  if not found then
    raise exception 'El producto de la línea "%" no es de esta empresa', coalesce(new.descripcion, 'sin descripción')
      using errcode = 'check_violation';
  end if;
  if v_tipo = 'materia_prima' then
    raise exception '"%" es materia prima: no se vende ni se cotiza', v_nombre using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
revoke all on function :"schema".tg_presupuestos_items_solo_productos() from public, anon, authenticated;

-- =============================================================================
-- 6. API de recetas
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
                                   'imagen_url', p.imagen_url, 'stock_actual', p.stock_actual, 'activo', p.activo),
    'tiene_receta', tiene_receta(p.id),
    'rendimiento', coalesce(rc.rendimiento, 1),
    'notas', rc.notas,
    'costo', receta_costo(p.id),
    'porciones', plato_porciones(p.id, v_dep),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'insumo_id', i.id, 'nombre', i.nombre, 'sku', i.sku, 'unidad_insumo', i.unidad_medida,
        'cantidad', ri.cantidad, 'unidad', ri.unidad, 'merma_pct', ri.merma_pct,
        'es_preparacion', tiene_receta(i.id),
        'costo_unitario', case when tiene_receta(i.id) then receta_costo(i.id) else coalesce(i.costo_promedio, 0) end,
        'stock', coalesce(sd.cantidad, 0), 'controla_stock', i.controla_stock, 'activo', i.activo)
        order by ri.orden, i.nombre)
      from recetas_items ri join productos i on i.id = ri.insumo_id
      left join stock_depositos sd on sd.producto_id = i.id and sd.deposito_id = v_dep
      where ri.producto_id = p.id), '[]'::jsonb),
    'usado_en', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
      from recetas_items ri join productos u on u.id = ri.producto_id where ri.insumo_id = p.id), '[]'::jsonb))
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
           p.categoria_principal_id, tiene_receta(p.id) as con_receta
      from productos p
     where p.empresa_id = s.s_empresa and p.activo
       and (p.tipo_producto = 'menu' or (p.tipo_producto = 'materia_prima' and exists (select 1 from recetas_items z where z.producto_id = p.id)))
  ),
  calc as (
    select b.*, rc.rendimiento,
           (select count(*) from recetas_items ri where ri.producto_id = b.id) as ingredientes,
           case when b.con_receta then receta_costo(b.id) end as costo,
           case when b.con_receta then plato_porciones(b.id, v_dep) end as porciones,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from necesidad_stock(b.id, 1) n join productos i on i.id = n.producto_id
              left join stock_depositos sd on sd.producto_id = n.producto_id and sd.deposito_id = v_dep
             where b.con_receta and coalesce(sd.cantidad, 0) < n.cantidad) as faltan,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from receta_insumos(b.id, 1) n join productos i on i.id = n.insumo_id
             where b.con_receta and not i.activo) as inactivos
      from base b left join recetas rc on rc.producto_id = b.id
  )
  select jsonb_build_object(
    'deposito_id', v_dep,
    'deposito', (select d.nombre from depositos d where d.id = v_dep),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'sku', c.sku, 'tipo', case when c.tipo_producto = 'menu' then 'menu' else 'preparacion' end,
      'unidad_medida', c.unidad_medida, 'precio_venta', c.precio_venta, 'descuento_pct', c.descuento_pct, 'imagen_url', c.imagen_url,
      'categoria_principal_id', c.categoria_principal_id,
      'rendimiento', coalesce(c.rendimiento, 1), 'ingredientes', c.ingredientes, 'costo', c.costo, 'porciones', c.porciones,
      'faltan', coalesce(c.inactivos, c.faltan),
      'estado', case when not c.con_receta then 'sin_receta'
                     when c.inactivos is not null or c.faltan is not null then 'faltante'
                     else 'completa' end)
      order by (c.tipo_producto <> 'menu'), c.nombre), '[]'::jsonb))
    into r
    from calc c;
  return r;
end;
$fn$;

-- p = { producto_id, rendimiento, notas, items: [{ insumo_id, cantidad, unidad, merma_pct }] }
-- items vacío = quitar la receta.
create or replace function :"schema".receta_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  prod productos;
  ins productos;
  it jsonb;
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
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('editar_productos');
  if v_id is null then raise exception 'Falta el producto'; end if;
  select * into prod from productos where id = v_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if prod.tipo_producto not in ('menu', 'materia_prima') then
    raise exception '"%" es de Reventa: solo los productos Menú y las materias primas (preparaciones) llevan receta', prod.nombre;
  end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'Ingredientes inválidos'; end if;
  if jsonb_array_length(v_items) > 60 then raise exception 'Son demasiados ingredientes (hasta 60)'; end if;
  if v_rend <= 0 or v_rend > 100000 then raise exception 'El rendimiento tiene que ser mayor a 0'; end if;
  v_tenia := tiene_receta(prod.id);

  -- Sin ingredientes: se quita la receta (una preparación vuelve a ser materia prima con stock).
  if jsonb_array_length(v_items) = 0 then
    delete from recetas where producto_id = prod.id;
    if prod.tipo_producto = 'materia_prima' and v_tenia then
      update productos set controla_stock = true, updated_at = now() where id = prod.id;
    end if;
    return receta_detalle(prod.id);
  end if;

  if prod.tipo_producto = 'materia_prima' and not v_tenia and coalesce(prod.stock_actual, 0) <> 0 then
    raise exception '"%" tiene stock (%): una preparación con receta no lleva stock propio. Dejalo en 0 con un ajuste antes de cargarle la receta.',
      prod.nombre, cant_texto(prod.stock_actual, prod.unidad_medida);
  end if;

  insert into recetas (producto_id, empresa_id, rendimiento, notas, updated_at, updated_por)
    values (prod.id, s.s_empresa, v_rend, v_notas, now(), s.s_usuario)
  on conflict (producto_id) do update set rendimiento = excluded.rendimiento, notas = excluded.notas,
    updated_at = now(), updated_por = excluded.updated_por;
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
    insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden)
      values (s.s_empresa, prod.id, v_ins, v_cant, v_unidad, v_merma, v_orden);
  end loop;

  -- Profundidad: la de esta receta y la de las que la usan (hasta 5 niveles).
  select max(receta_profundidad(a.pid)) into v_prof from (
    with recursive a(pid) as (
      select prod.id
      union
      select ri.producto_id from a join recetas_items ri on ri.insumo_id = a.pid
    ) select pid from a) a;
  if v_prof > 5 then
    raise exception 'Hay demasiadas preparaciones una dentro de otra (% niveles, máximo 5)', v_prof;
  end if;

  -- Preparación: sin stock propio. Costo del producto = el de su receta (para listas y márgenes).
  update productos
     set controla_stock = case when tipo_producto = 'materia_prima' then false else controla_stock end,
         controla_lotes = case when tipo_producto = 'materia_prima' then false else controla_lotes end,
         costo_promedio = round(receta_costo(id)), updated_at = now()
   where id = prod.id;
  return receta_detalle(prod.id);
end;
$fn$;

-- =============================================================================
-- 7. Búsquedas con filtro de tipo (se cambia la firma: se borran las anteriores)
-- =============================================================================
-- pg_trgm cargado en la sesión: así el SET de la función es un parámetro conocido (como en la 58).
do $$ begin perform extensions.similarity('a', 'b'); end $$;
drop function if exists :"schema".buscar_productos(text, text, boolean, boolean, integer, integer);
create or replace function :"schema".buscar_productos(p_q text, p_categoria text DEFAULT NULL::text, p_inactivos boolean DEFAULT false, p_solo_vendibles boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_tipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO :"schema", 'public', 'extensions'
 SET pg_trgm.word_similarity_threshold = '0.39'
AS $function$
declare
  v_emp uuid := empresa_actual();
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := trim(norm(p_q));
  v_qc text := compacto(p_q);
  v_crudo text := trim(coalesce(p_q, ''));
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_n integer := coalesce(cardinality(v_tk), 0);
  v_w text;
  v_cand text;
  v_coincide text;
  v_tok text;
  v_ws text := '';
  v_exacto text := 'false';
  v_ids uuid[];
  v_score text;
  r jsonb;
begin
  -- Filtros fijos (igual que antes: activos, vendibles, categoría con sus subcategorías).
  v_w := format('p.empresa_id = %L', v_emp);
  if not coalesce(p_inactivos, false) then v_w := v_w || ' and p.activo'; end if;
  if coalesce(p_solo_vendibles, false) then v_w := v_w || ' and p.es_vendible'; end if;
  -- 72: tipo de producto.
  if p_tipo in ('reventa', 'menu', 'materia_prima') then
    v_w := v_w || format(' and p.tipo_producto = %L', p_tipo);
  elsif p_tipo = 'stock' then
    v_w := v_w || ' and p.tipo_producto <> ''menu''';
  elsif p_tipo = 'vendible' then
    v_w := v_w || ' and p.tipo_producto <> ''materia_prima''';
  end if;
  if p_categoria = '__sin__' then
    v_w := v_w || ' and p.categoria_principal_id is null';
  elsif p_categoria is not null then
    -- = categoria_coincide(): la categoría o una subcategoría suya.
    v_w := v_w || format(' and p.categoria_principal_id in (select c.id from categorias_productos c where c.id::text = %L or c.parent_id::text = %L)',
                         p_categoria, p_categoria);
  end if;

  if v_n > 0 then
    select string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                           then format('(p.busqueda like %L or %L <%% p.busqueda)', '%' || t || '%', t)
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o),
           string_agg(case when length(t) >= 4 and t ~ '[a-z]'
                           then format('(p.busqueda like %L or p._ws%s >= 0.4)', '%' || t || '%', o)
                           else format('p.busqueda like %L', '%' || t || '%') end, ' and ' order by o),
           string_agg(format('(case when p.busqueda_nombre ~ %L then 40 when p.busqueda_nombre ~ %L then 30 when p.busqueda like %L then 20 else 0 end)',
                             '(^|[^a-z0-9])' || t || '($|[^a-z0-9])', '(^|[^a-z0-9])' || t, '%' || t || '%'), ' + ' order by o)
             || ' + 50 * ((' || string_agg(format('p._ws%s::float8', o), ' + ' order by o) || ') / ' || v_n || '::float8)',
           string_agg(format(', word_similarity(%L, p.busqueda) as _ws%s', t, o), '' order by o)
      into v_cand, v_coincide, v_tok, v_ws
      from unnest(v_tk) with ordinality x(t, o);
    v_w := v_w || ' and ' || v_cand;
  end if;

  -- SKU o código de barras exacto primero (lector de códigos).
  if v_qc <> '' then
    select array_agg(id) into v_ids from productos where empresa_id = v_emp and compacto(sku) = v_qc;
    v_exacto := format('(p.codigo_barras = %L or (strpos(p.busqueda, %L) > 0 and p.id = any(%L::uuid[])))', v_crudo, v_qc, coalesce(v_ids, '{}'));
  end if;
  v_score := format(
    '((case when p.busqueda_nombre = %L then 400 when p.busqueda_nombre like %L then 300 when p.busqueda_nombre like %L then 200 else 0 end) + coalesce(%s, 0))::real',
    v_q, v_q || '%', '%' || v_q || '%', coalesce(v_tok, 'null'));

  execute format(
    'with hits as materialized (
       select p.id, p.nombre, case when %s then 1000 else %s end as _score
         from (select p.id, p.nombre, p.busqueda, p.busqueda_nombre, p.codigo_barras %s
                 from productos p where %s offset 0) p
        where %s
     ),
     pag as (select * from hits order by _score desc, nombre, id limit %s offset %s)
     select jsonb_build_object(
       ''total'', (select count(*) from hits),
       ''rows'', coalesce((select jsonb_agg(to_jsonb(x) - ''busqueda'' - ''busqueda_nombre'' - ''empresa_id'' order by pag._score desc, pag.nombre, pag.id)
                             from pag join productos x on x.id = pag.id), ''[]''::jsonb))',
    v_exacto, v_score, v_ws, v_w, coalesce(v_coincide, 'true'), v_lim, v_off) into r;
  return r;
end;
$function$;

drop function if exists :"schema".listar_productos_inventario(text, boolean, integer, integer);
create or replace function :"schema".listar_productos_inventario(p_categoria text DEFAULT NULL::text, p_inactivos boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_tipo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO :"schema", 'public'
AS $function$
declare
  v_emp uuid := empresa_actual();
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_w text;
  v_total bigint;
  v_rows json;
begin
  if v_emp is null then return json_build_object('rows', '[]'::json, 'total', 0); end if;
  v_w := format('p.empresa_id = %L', v_emp);
  if not coalesce(p_inactivos, false) then v_w := v_w || ' and p.activo'; end if;
  -- 72: tipo de producto.
  if p_tipo in ('reventa', 'menu', 'materia_prima') then
    v_w := v_w || format(' and p.tipo_producto = %L', p_tipo);
  elsif p_tipo = 'stock' then
    v_w := v_w || ' and p.tipo_producto <> ''menu''';
  elsif p_tipo = 'vendible' then
    v_w := v_w || ' and p.tipo_producto <> ''materia_prima''';
  end if;
  if p_categoria = '__sin__' then
    v_w := v_w || ' and p.categoria_principal_id is null';
  elsif p_categoria ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_w := v_w || format(
      ' and p.categoria_principal_id in (select c.id from categorias_productos c where c.empresa_id = %L and (c.id = %L or c.parent_id = %L))',
      v_emp, p_categoria, p_categoria);
  end if;

  execute 'select count(*) from productos p where ' || v_w into v_total;
  execute format(
    'select coalesce(json_agg(r), ''[]''::json) from (
       select x.id, x.nombre, x.sku, x.codigo_barras, x.categoria_principal_id, x.proveedor_principal_id,
              x.costo_promedio, x.precio_venta, x.precio_mayorista, x.precio_distribuidor, x.descuento_pct,
              x.stock_actual, x.stock_minimo, x.unidad_medida, x.tipo_iva, x.tipo_producto, x.controla_stock,
              x.controla_lotes, x.es_vendible, x.activo, x.imagen_url
         from (select p.id, p.nombre from productos p where %s order by p.nombre, p.id limit %s offset %s) k
         join productos x on x.id = k.id
        order by k.nombre, k.id) r', v_w, v_lim, v_off) into v_rows;
  return json_build_object('rows', v_rows, 'total', v_total);
end;
$function$;

-- =============================================================================
-- 8. Caja: catálogo con porciones posibles de los platos
-- =============================================================================
create or replace function :"schema".productos_pos(p_solo_nombre boolean DEFAULT false, p_deposito uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
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
       where p.empresa_id = v_emp and p.activo and p.es_vendible and p.tipo_producto <> 'materia_prima'
       order by p.nombre, p.id) r;
    return json_build_object('productos', v_prod, 'vencidos', '[]'::json);
  end if;
  if p_deposito is not null then
    select id into v_dep from depositos where id = p_deposito and empresa_id = v_emp;
    if v_dep is null then raise exception 'Depósito no encontrado'; end if;
  else
    v_dep := deposito_por_defecto(v_emp, (select u.sucursal_id from usuarios u where u.auth_user_id = auth.uid() and u.activo limit 1));
  end if;
  -- 72: un plato (Menú) viene con controla_stock = true y stock_actual = porciones posibles en
  -- este depósito (0 sin receta: sin_receta = true). Si no consume nada con stock, sin control.
  select coalesce(json_agg(r), '[]'::json) into v_prod from (
    select p.id, p.nombre, p.sku, p.codigo_barras, p.precio_venta, p.precio_mayorista, p.precio_distribuidor,
           p.descuento_pct,
           case when p.tipo_producto = 'menu' then coalesce(pp.porciones, 0) else coalesce(sd.cantidad, 0) end as stock_actual,
           case when p.tipo_producto = 'menu' then coalesce(pp.porciones, 0) else p.stock_actual end as stock_total,
           p.unidad_medida, p.tipo_iva,
           case when p.tipo_producto = 'menu' then pp.porciones is not null else p.controla_stock end as controla_stock,
           p.imagen_url, p.tipo_producto,
           (p.tipo_producto = 'menu' and not tiene_receta(p.id)) as sin_receta
      from productos p
      left join stock_depositos sd on sd.producto_id = p.id and sd.deposito_id = v_dep
      left join lateral (select plato_porciones(p.id, v_dep) as porciones) pp on p.tipo_producto = 'menu'
     where p.empresa_id = v_emp and p.activo and p.es_vendible and p.tipo_producto <> 'materia_prima'
     order by p.nombre, p.id) r;
  select coalesce(json_agg(v), '[]'::json) into v_venc from (
    select l.producto_id, sum(l.cantidad) as vencido
      from lotes l
     where l.empresa_id = v_emp and l.deposito_id = v_dep and l.cantidad > 0
       and l.vencimiento < (now() at time zone 'America/Asuncion')::date
     group by l.producto_id) v;
  return json_build_object('productos', v_prod, 'vencidos', v_venc, 'deposito_id', v_dep);
end;
$function$;

-- =============================================================================
-- 9. crear_venta (redefinida desde la vigente de la 67) — recetas y bloqueo sin stock
-- =============================================================================
CREATE OR REPLACE FUNCTION :"schema".crear_venta(p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text, p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric DEFAULT 0, p_plazo_dias integer DEFAULT NULL::integer, p_deposito_id uuid DEFAULT NULL::uuid, p_caja_id uuid DEFAULT NULL::uuid, p_tipo_documento text DEFAULT 'ticket'::text, p_cliente_ocasional boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
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
  v_doc text := lower(coalesce(nullif(btrim(p_tipo_documento), ''), 'ticket'));  -- 66
  v_ocasional boolean := coalesce(p_cliente_ocasional, false);                    -- 67
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
  -- 55: permisos del perfil sobre el precio.
  v_puede_precio boolean;
  v_tope numeric;
  v_ref numeric;
  v_piso numeric;
  v_manual boolean;
  -- 72: recetas.
  v_receta boolean;
  v_costo_rec numeric;
  v_msg text;
  ins record;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_empresa := s.s_empresa;
  v_usuario := s.s_usuario;

  if v_tipo not in ('CONTADO', 'CREDITO') then raise exception 'Condición de venta inválida'; end if;
  if v_doc not in ('factura', 'ticket') then raise exception 'Tipo de documento inválido (factura o ticket)'; end if;
  -- 67: cliente ocasional (X): sin cliente y solo al contado.
  if v_ocasional and p_cliente_id is not null then
    raise exception 'Elegí un cliente o "Cliente ocasional (X)", no los dos';
  end if;
  if v_ocasional and v_tipo = 'CREDITO' then
    raise exception 'La venta a crédito necesita un cliente: el "Cliente ocasional (X)" es solo al contado.';
  end if;
  -- 55: crédito, descuentos y precio manual dependen del perfil (tope % del perfil).
  if v_tipo = 'CREDITO' then perform exigir_permiso('vender_credito'); end if;
  v_puede_precio := tiene_permiso('descuentos_precio');
  v_tope := (select x.p_tope from perfil_sesion() x);
  if coalesce(p_descuento_pct, 0) > 0 then
    if not v_puede_precio then perform exigir_permiso('descuentos_precio'); end if;
    if v_tope is not null and p_descuento_pct > v_tope then
      raise exception 'El descuento (% %%) supera el tope de tu perfil (% %%)', trim_scale(p_descuento_pct), trim_scale(v_tope) using errcode = '42501';
    end if;
  end if;
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
  -- 66: sin RUC no hay factura (ticket sí, aun sin cliente). 67: salvo cliente ocasional (X).
  if v_doc = 'factura' and not v_ocasional then perform exigir_ruc_factura(p_cliente_id); end if;
  if v_tipo = 'CREDITO' then
    if p_cliente_id is null then raise exception 'La venta a crédito necesita un cliente'; end if;
    if p_plazo_dias is not null and (p_plazo_dias < 1 or p_plazo_dias > 3650) then
      raise exception 'El plazo del crédito tiene que estar entre 1 y 3650 días';
    end if;
  end if;

  -- Depósito del que sale el stock: el de la caja (o el elegido, validado como antes).
  if p_deposito_id is not null then
    select * into v_dep_info from inv_deposito(v_empresa, p_deposito_id, true);
    if not alcance_todas() and s.s_sucursal is not null and v_dep_info.suc_id <> s.s_sucursal then  -- 55
      raise exception 'Solo podés vender desde los depósitos de tu sucursal';
    end if;
    v_dep := p_deposito_id;
  else
    select * into v_dep_info from inv_deposito(v_empresa, v_caja.deposito_id, true);
    v_dep := v_caja.deposito_id;
  end if;

  -- Numeración: varias cajas venden a la vez → se serializa (misma llave que suscripciones).
  perform pg_advisory_xact_lock(hashtext('ventas_numero_' || v_empresa::text));
  v_numero := siguiente_numero_venta(v_empresa);  -- 61: prefijo y numeración de Configuración › Facturación

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio,
                      subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago,
                      caja_id, created_by, usuario_nombre, fecha, observaciones, idempotency_key, deposito_id,
                      sucursal_id, punto_venta_id, tipo_documento, receptor_ocasional)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', v_tipo,
            case when v_tipo = 'CREDITO' then p_plazo_dias else null end,
            case when v_tipo = 'CREDITO' then 'credito' else null end,
            v_caja.id, auth.uid(), s.s_nombre, now(), p_observaciones, nullif(p_idempotency_key, ''), v_dep,
            v_caja.sucursal_id, v_caja.punto_venta_id, v_doc, v_ocasional)
    returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un ítem'; end if;

    select * into prod from productos
      where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no existe en esta empresa', it->>'producto_id'; end if;

    -- 72: materia prima no se vende; Menú solo con receta y con todos sus ingredientes.
    if prod.tipo_producto = 'materia_prima' then
      raise exception '"%" es materia prima: no se vende (se usa en las recetas)', prod.nombre;
    end if;
    v_receta := tiene_receta(prod.id);
    if prod.tipo_producto = 'menu' and not v_receta then
      raise exception '"%" no tiene receta: cargala en Inventario › Recetas para poder venderlo', prod.nombre;
    end if;
    v_costo_rec := null;
    if v_receta then
      v_msg := stock_faltante(v_dep, jsonb_build_array(jsonb_build_object('producto_id', prod.id, 'cantidad', v_cant)));
      if v_msg is not null then raise exception '%', v_msg; end if;
      select coalesce(sum(r.cantidad * coalesce(i.costo_promedio, 0)), 0) into v_costo_rec
        from receta_insumos(prod.id, v_cant) r join productos i on i.id = r.insumo_id;
    end if;

    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then coalesce(round(v_costo_rec / v_cant), prod.costo_promedio)
                  else prod.precio_venta end;
    v_precio_override := nullif(it->>'precio_unitario', '')::numeric;
    v_precio := case when v_precio_override is not null and v_precio_override > 0
                     then v_precio_override else v_precio_lista end;
    v_precio := round(v_precio
                      * (1 - greatest(0, least(coalesce((it->>'descuento_pct')::numeric, 0), 100)) / 100.0)
                      * v_factor);
    -- 55: precio manual, precio de costo o más descuento que el del producto (Inventario)
    -- necesitan "descuentos y precios"; el descuento extra no puede pasar el tope del perfil.
    v_ref := case when coalesce(it->>'tipo_precio', 'minorista') = 'costo' then prod.precio_venta else v_precio_lista end;
    v_piso := coalesce(v_ref, 0) * (1 - greatest(0, least(coalesce(prod.descuento_pct, 0), 100)) / 100.0);
    v_manual := coalesce(it->>'tipo_precio', 'minorista') = 'costo'
             or (v_precio_override is not null and v_precio_override > 0 and v_precio_override is distinct from v_precio_lista)
             or v_precio < round(v_piso) - 1;
    if v_manual then
      if not v_puede_precio then
        raise exception 'Tu perfil no permite cambiar precios ni dar descuentos en caja ("%")', prod.nombre
          using errcode = '42501', hint = 'permiso:descuentos_precio';
      end if;
      if v_tope is not null and v_piso > 0 and v_precio + 1 < v_piso * (1 - v_tope / 100.0) then
        raise exception '"%": el descuento (% %%) supera el tope de tu perfil (% %%)',
          prod.nombre, trim_scale(round((1 - v_precio / v_piso) * 100, 1)), trim_scale(v_tope) using errcode = '42501';
      end if;
    end if;

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
              v_sub, v_iva, v_total_linea,
              case when v_receta then round(v_costo_rec / v_cant, 4) else prod.costo_promedio end)
      returning id into v_item;

    if v_receta then
      -- 72: descuenta las materias primas explotadas (con merma) del depósito de la caja.
      for ins in
        select r.insumo_id, r.cantidad, coalesce(i.costo_promedio, 0) as costo, i.controla_stock, i.controla_lotes
          from receta_insumos(prod.id, v_cant) r join productos i on i.id = r.insumo_id
         order by r.insumo_id
      loop
        insert into ventas_items_insumos (empresa_id, venta_id, venta_item_id, insumo_id, cantidad, costo_unitario, deposito_id, descontado)
          values (v_empresa, v_venta, v_item, ins.insumo_id, ins.cantidad, ins.costo, v_dep, ins.controla_stock);
        if ins.controla_stock then
          perform inv_mover(v_empresa, ins.insumo_id, v_dep, -ins.cantidad, ins.costo, 'venta', 'venta',
                            v_venta, v_numero, 'Venta ' || v_numero || ' · ' || prod.nombre, v_usuario, s.s_nombre);
          if ins.controla_lotes then
            perform lotes_consumir(v_empresa, ins.insumo_id, v_dep, ins.cantidad, 'venta', v_venta, v_item, null, 'venta', v_venta, v_item);
          end if;
        end if;
      end loop;
      -- El costo del plato en la ficha sigue al de su receta.
      update productos set costo_promedio = round(v_costo_rec / v_cant)
       where id = prod.id and costo_promedio is distinct from round(v_costo_rec / v_cant);
    elsif prod.controla_stock then
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

  -- 67: el trigger del receptor controla acá el tope de la factura a cliente ocasional.
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
                            'vuelto', v_vuelto_total, 'caja_id', v_caja.id, 'tipo_documento', v_doc,
                            'cliente_ocasional', v_ocasional);
end;
$function$;

-- =============================================================================
-- 10. anular_venta (redefinida desde la vigente de la 55): devuelve también los ingredientes
-- =============================================================================
CREATE OR REPLACE FUNCTION :"schema".anular_venta(p_venta_id uuid, p_motivo text DEFAULT NULL::text, p_caja_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
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
  perform exigir_permiso('anular_ventas');  -- 55

  select * into v_venta from ventas where id = p_venta_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_venta.estado = 'anulada' then
    return jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada', 'reusada', true);
  end if;
  if not (alcance_todas() or tiene_permiso('anular_ventas_cerradas')) and v_venta.sucursal_id is not null
     and v_venta.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(v_empresa)) then
    raise exception 'La venta es de otra sucursal: no la podés anular';
  end if;

  if v_venta.caja_id is not null then
    select c.id, c.estado, c.numero_caja into v_turno from cajas c where c.id = v_venta.caja_id;
    v_cerrado := v_turno.estado <> 'abierta';
  end if;

  if v_cerrado then
    if not tiene_permiso('anular_ventas_cerradas') then  -- 55
      raise exception 'La venta es de % (turno N° %), que ya se cerró: tu perfil no permite anular ventas de turnos cerrados',
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
               and not exists (select 1 from ventas_items_insumos x where x.venta_item_id = vi.id)  -- 72
             order by vi.producto_id loop
    perform inv_mover(v_empresa, it.producto_id, v_dep, it.cantidad, coalesce(it.costo_unitario, 0), 'anulacion_venta',
                      'venta', v_venta.id, v_venta.numero_control, 'Anulación ' || v_venta.numero_control,
                      s.s_usuario, s.s_nombre);
  end loop;
  -- 72: los ingredientes de los platos vuelven al depósito del que salieron.
  for it in select x.insumo_id, coalesce(x.deposito_id, v_dep) as dep, sum(x.cantidad) as cantidad, max(x.costo_unitario) as costo
              from ventas_items_insumos x
             where x.venta_id = p_venta_id and x.empresa_id = v_empresa and x.descontado
             group by x.insumo_id, coalesce(x.deposito_id, v_dep)
             order by x.insumo_id loop
    perform inv_mover(v_empresa, it.insumo_id, it.dep, it.cantidad, coalesce(it.costo, 0), 'anulacion_venta',
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

-- =============================================================================
-- 11. Menú QR (redefinidas desde la 68): fuera materias primas y platos que no alcanzan
-- =============================================================================
CREATE OR REPLACE FUNCTION :"schema".mesa_menu_publico(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
declare
  m mesas;
  v_emp record;
  v_dep uuid;
  v_res jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into m from mesas where token = p_token;
  if not found then return null; end if;
  select coalesce(nullif(btrim(e.nombre_fantasia), ''), e.nombre) as nombre, e.logo_url into v_emp from empresas e where e.id = m.empresa_id;
  if not m.activa then
    return jsonb_build_object('activa', false, 'mesa', m.nombre, 'empresa', v_emp.nombre, 'logo_url', v_emp.logo_url);
  end if;
  -- 72: depósito de la sucursal de la mesa y lo ya reservado por otras cuentas abiertas.
  v_dep := deposito_por_defecto(m.empresa_id, m.sucursal_id);
  v_res := mesa_reservas_json(m.sucursal_id, null);
  return jsonb_build_object(
    'activa', true,
    'mesa', m.nombre,
    'zona', m.zona,
    'sucursal', (select su.nombre from sucursales su where su.id = m.sucursal_id),
    'empresa', v_emp.nombre,
    'logo_url', v_emp.logo_url,
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'descripcion', left(p.descripcion, 300), 'imagen_url', p.imagen_url,
        'precio', mesa_precio(p.precio_venta, p.descuento_pct),
        'precio_lista', case when coalesce(p.descuento_pct, 0) > 0 then p.precio_venta end,
        'categoria', coalesce(cp.nombre, 'Otros'))
        order by coalesce(cp.nombre, 'zzz'), p.nombre)
      from productos p left join categorias_productos cp on cp.id = p.categoria_principal_id
      where p.empresa_id = m.empresa_id and p.en_menu_qr and p.activo and coalesce(p.es_vendible, true)
        and p.tipo_producto <> 'materia_prima'
        and coalesce(p.precio_venta, 0) > 0
        and not (coalesce(p.controla_stock, false) and coalesce(p.stock_actual, 0) <= 0)
        and (not (p.tipo_producto = 'menu' or tiene_receta(p.id)) or coalesce(plato_porciones(p.id, v_dep, v_res), 1) >= 1)), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION :"schema".mesa_pedido_publico_crear(p_token text, p_items jsonb, p_nota text DEFAULT NULL::text, p_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
declare
  m mesas;
  c mesa_cuentas;
  it jsonb;
  prod record;
  v_cant numeric;
  v_precio numeric;
  v_total numeric := 0;
  v_ped mesa_pedidos;
  v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 500);
  v_nombre text := left(nullif(btrim(coalesce(p_nombre, '')), ''), 60);
  v_item_nota text;
  v_ids uuid[] := '{}';
  v_pid uuid;
  v_dep uuid;
  v_res jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Mesa no encontrada'; end if;
  -- La fila de la mesa serializa los pedidos de esa mesa (y el límite por minuto).
  select * into m from mesas where token = p_token for update;
  if not found then raise exception 'Mesa no encontrada'; end if;
  if not m.activa then raise exception 'Esta mesa no está recibiendo pedidos por QR. Pedile a quien te atiende.'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Son demasiados productos en un solo pedido (hasta 30)'; end if;

  if (select count(*) from mesa_pedidos where mesa_id = m.id and creado_at > now() - interval '1 minute') >= 4 then
    raise exception 'Mandaste varios pedidos seguidos: esperá un minuto y probá de nuevo';
  end if;
  if (select count(*) from mesa_pedidos where mesa_id = m.id and estado = 'nuevo') >= 6 then
    raise exception 'Hay varios pedidos de esta mesa esperando: en un momento los atienden';
  end if;

  -- 72: platos con receta: que alcance (contando lo ya reservado por cuentas abiertas).
  v_dep := deposito_por_defecto(m.empresa_id, m.sucursal_id);
  v_res := mesa_reservas_json(m.sucursal_id, null);

  -- Cuenta abierta de la mesa (o una nueva).
  select * into c from mesa_cuentas where mesa_id = m.id and estado = 'abierta' for update;
  if not found then
    insert into mesa_cuentas (empresa_id, mesa_id) values (m.empresa_id, m.id) returning * into c;
  end if;

  insert into mesa_pedidos (empresa_id, cuenta_id, mesa_id, numero, nombre_cliente, nota)
    values (m.empresa_id, c.id, m.id,
            inv_numero(m.empresa_id, 'mesa_pedido', (select coalesce(max(numero), 0) from mesa_pedidos where empresa_id = m.empresa_id)),
            v_nombre, v_nota)
    returning * into v_ped;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid := (it->>'producto_id')::uuid;
    exception when others then
      raise exception 'Hay un producto inválido en el pedido';
    end;
    if v_pid = any (v_ids) then raise exception 'Hay un producto repetido en el pedido'; end if;
    v_ids := v_ids || v_pid;
    begin
      v_cant := (it->>'cantidad')::numeric;
    exception when others then
      raise exception 'Cantidad inválida';
    end;
    if v_cant is null or v_cant <> trunc(v_cant) or v_cant < 1 or v_cant > 50 then
      raise exception 'La cantidad de cada producto va de 1 a 50';
    end if;
    select p.id, p.nombre, p.precio_venta, p.descuento_pct into prod
      from productos p
     where p.id = v_pid and p.empresa_id = m.empresa_id and p.en_menu_qr and p.activo and coalesce(p.es_vendible, true)
       and p.tipo_producto <> 'materia_prima'
       and coalesce(p.precio_venta, 0) > 0
       and not (coalesce(p.controla_stock, false) and coalesce(p.stock_actual, 0) <= 0)
       and (not (p.tipo_producto = 'menu' or tiene_receta(p.id)) or coalesce(plato_porciones(p.id, v_dep, v_res), v_cant) >= v_cant);
    if not found then raise exception 'Un producto del pedido ya no está disponible: actualizá el menú'; end if;
    v_precio := mesa_precio(prod.precio_venta, prod.descuento_pct);
    v_item_nota := left(nullif(btrim(coalesce(it->>'nota', '')), ''), 200);
    insert into mesa_pedido_items (empresa_id, pedido_id, producto_id, producto_nombre, cantidad, precio_unitario, total, nota)
      values (m.empresa_id, v_ped.id, prod.id, prod.nombre, v_cant, v_precio, round(v_cant * v_precio), v_item_nota);
    v_total := v_total + round(v_cant * v_precio);
  end loop;

  update mesa_pedidos set total = v_total where id = v_ped.id;
  return jsonb_build_object('seguimiento', v_ped.seguimiento, 'numero', v_ped.numero, 'estado', 'nuevo', 'total', v_total);
end;
$function$;

-- =============================================================================
-- 12. Pedidos de mesas (redefinida desde la 70): al aceptar, que alcance el stock
-- =============================================================================
CREATE OR REPLACE FUNCTION :"schema".mesa_pedido_accion(p_id uuid, p_accion text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
declare
  s record;
  p mesa_pedidos;
  v_suc uuid;
  v_cuenta text;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
  v_caja boolean := tiene_permiso('pedidos_mesas');
  v_cocina boolean := tiene_permiso('cocina');
  v_con_comandas boolean;
  n integer;
  v_msg text;
begin
  select * into s from mesa_sesion();
  select * into p from mesa_pedidos where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  select m.sucursal_id into v_suc from mesas m where m.id = p.mesa_id;
  if s.s_sucursal is not null and v_suc <> s.s_sucursal then raise exception 'Ese pedido es de otra sucursal'; end if;
  select estado into v_cuenta from mesa_cuentas where id = p.cuenta_id;
  if v_cuenta <> 'abierta' then raise exception 'La cuenta de esa mesa ya se cerró'; end if;
  v_con_comandas := exists (select 1 from mesa_comandas where pedido_id = p.id);

  if p_accion = 'aceptar' then
    if not v_caja then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado <> 'nuevo' then raise exception 'Ese pedido ya fue atendido'; end if;
    -- 72: tiene que alcanzar el stock del depósito de la sucursal, contando lo ya aceptado en
    -- otras cuentas abiertas (sin cobrar). Se serializa por sucursal para no aceptar dos veces lo último.
    perform pg_advisory_xact_lock(hashtext('mesas_stock_' || v_suc::text));
    v_msg := stock_faltante(
      deposito_por_defecto(s.s_empresa, v_suc),
      (select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad)), '[]'::jsonb)
         from mesa_pedido_items i where i.pedido_id = p.id and i.producto_id is not null),
      mesa_reservas_json(v_suc, p.id));
    if v_msg is not null then
      raise exception 'No alcanza para aceptar el pedido: %. Rechazalo (el cliente ve el motivo) o cargá stock.', v_msg;
    end if;
    update mesa_pedidos set estado = 'aceptado', aceptado_at = now(), aceptado_por = s.s_usuario, aceptado_por_nombre = s.s_nombre,
           updated_at = now() where id = p.id;
    -- Se divide en comandas por estación (snapshot de la estación de cada ítem).
    perform mesa_pedido_comandas_crear(p.id);
  elsif p_accion = 'rechazar' then
    if not v_caja then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('nuevo', 'aceptado') then raise exception 'Ese pedido ya se está preparando: no se puede rechazar'; end if;
    if v_motivo is null then raise exception 'Escribí el motivo (lo ve el cliente en su celular)'; end if;
    delete from mesa_comandas where pedido_id = p.id;
    update mesa_pedidos set estado = 'rechazado', rechazado_at = now(), rechazado_por = s.s_usuario, motivo_rechazo = v_motivo,
           updated_at = now() where id = p.id;
  elsif p_accion = 'preparar' then
    if not (v_cocina or v_caja) then perform exigir_permiso('cocina'); end if;
    if p.estado <> 'aceptado' then raise exception 'Solo un pedido aceptado pasa a "en preparación"'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'en_preparacion', preparando_at = now(), updated_at = now()
       where pedido_id = p.id and estado = 'aceptado';
      perform mesa_pedido_derivar(p.id);
    else
      update mesa_pedidos set estado = 'en_preparacion', preparando_at = now(), updated_at = now() where id = p.id;
    end if;
  elsif p_accion = 'listo' then
    if not (v_cocina or v_caja) then perform exigir_permiso('cocina'); end if;
    if p.estado not in ('aceptado', 'en_preparacion') then raise exception 'Ese pedido no está en preparación'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'listo', preparando_at = coalesce(preparando_at, now()), listo_at = now(), updated_at = now()
       where pedido_id = p.id and estado in ('aceptado', 'en_preparacion');
      perform mesa_pedido_derivar(p.id);
    else
      update mesa_pedidos set estado = 'listo', preparando_at = coalesce(preparando_at, now()), listo_at = now(), updated_at = now()
        where id = p.id;
    end if;
  elsif p_accion = 'entregar' then
    if not (v_cocina or v_caja) then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('aceptado', 'en_preparacion', 'listo') then raise exception 'Ese pedido no se puede marcar como entregado'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'entregado', preparando_at = coalesce(preparando_at, now()), listo_at = coalesce(listo_at, now()),
             entregado_at = now(), updated_at = now()
       where pedido_id = p.id and estado <> 'entregado';
      perform mesa_pedido_derivar(p.id);
    else
      update mesa_pedidos set estado = 'entregado', listo_at = coalesce(listo_at, now()), entregado_at = now(), updated_at = now()
        where id = p.id;
    end if;
  elsif p_accion = 'entregar_listos' then
    if not (v_cocina or v_caja) then perform exigir_permiso('pedidos_mesas'); end if;
    if p.estado not in ('aceptado', 'en_preparacion', 'listo') then raise exception 'Ese pedido no se puede marcar como entregado'; end if;
    if v_con_comandas then
      update mesa_comandas set estado = 'entregado', entregado_at = now(), updated_at = now()
       where pedido_id = p.id and estado = 'listo';
      get diagnostics n = row_count;
      if n = 0 then raise exception 'Ese pedido no tiene partes listas para entregar'; end if;
      perform mesa_pedido_derivar(p.id);
    else
      if p.estado <> 'listo' then raise exception 'Ese pedido no tiene partes listas para entregar'; end if;
      update mesa_pedidos set estado = 'entregado', entregado_at = now(), updated_at = now() where id = p.id;
    end if;
  else
    raise exception 'Acción inválida';
  end if;
  return mesa_pedido_json(p.id);
end;
$function$;

-- =============================================================================
-- 13. Semilla (solo erp_demo): platos → Menú, materias primas con stock, Salsa de la casa y recetas
-- =============================================================================
select (:'schema' = 'erp_demo') as es_demo \gset
\if :es_demo
do $seed$
declare
  e record;
  d record;
  v_cat uuid;
  v_id uuid;
  mp record;
  rc record;
  v_plato uuid;
  v_ins uuid;
begin
  for e in select id from empresas loop
    update productos set tipo_producto = 'menu', updated_at = now()
     where empresa_id = e.id and sku like 'MENU-%' and tipo_producto <> 'menu' and coalesce(stock_actual, 0) = 0;

    select id into v_cat from categorias_productos where empresa_id = e.id and lower(btrim(nombre)) = 'insumos';
    if v_cat is null then
      insert into categorias_productos (empresa_id, nombre, descripcion, color)
        values (e.id, 'Insumos', 'Materias primas de la cocina (se compran, no se venden)', '#a16207')
        returning id into v_cat;
    end if;

    -- Materias primas: sku, nombre, unidad, costo (Gs. por unidad), stock por depósito principal.
    for mp in select * from (values
        ('MP-PANHAMB', 'Pan de hamburguesa', 'Unidad', 1500, 60),
        ('MP-CARMOL',  'Carne molida', 'kg', 45000, 15),
        ('MP-QUESO',   'Queso en fetas', 'Unidad', 1200, 100),
        ('MP-LECHUGA', 'Lechuga', 'kg', 12000, 5),
        ('MP-TOMATE',  'Tomate', 'kg', 10000, 8),
        ('MP-CEBOLLA', 'Cebolla', 'kg', 8000, 5),
        ('MP-PAPA',    'Papa', 'kg', 6000, 30),
        ('MP-ACEITE',  'Aceite de girasol (cocina)', 'l', 16000, 20),
        ('MP-HARINA',  'Harina 000 (cocina)', 'kg', 5000, 25),
        ('MP-MUZZA',   'Muzzarella', 'kg', 55000, 8),
        ('MP-SALTOM',  'Salsa de tomate', 'kg', 15000, 5),
        ('MP-HUEVO',   'Huevo', 'Unidad', 1000, 120),
        ('MP-LECHE',   'Leche (cocina)', 'l', 7000, 15),
        ('MP-AZUCAR',  'Azúcar (cocina)', 'kg', 6500, 10),
        ('MP-DDL',     'Dulce de leche', 'kg', 30000, 4),
        ('MP-PANARA',  'Pan árabe', 'Unidad', 2500, 40),
        ('MP-LOMITO',  'Lomito de res', 'kg', 75000, 8),
        ('MP-CARMILA', 'Carne para milanesa', 'kg', 55000, 8),
        ('MP-PANRALL', 'Pan rallado', 'kg', 12000, 5),
        ('MP-MAYO',    'Mayonesa', 'kg', 25000, 3),
        ('MP-AJO',     'Ajo', 'kg', 30000, 1),
        ('MP-PEREJIL', 'Perejil', 'kg', 20000, 1)
      ) x(sku, nombre, unidad, costo, stock)
    loop
      select id into v_id from productos where empresa_id = e.id and sku = mp.sku;
      if v_id is null then
        insert into productos (empresa_id, nombre, sku, costo_promedio, precio_venta, unidad_medida, tipo_producto,
                               controla_stock, es_vendible, categoria_principal_id, tipo_iva, stock_minimo)
          values (e.id, mp.nombre, mp.sku, mp.costo, 0, mp.unidad, 'materia_prima', true, false, v_cat, '10%',
                  round(mp.stock * 0.2, 1))
          returning id into v_id;
        for d in select dp.id from depositos dp join sucursales su on su.id = dp.sucursal_id
                  where dp.empresa_id = e.id and dp.activo and su.activa and dp.es_principal loop
          perform inv_mover(e.id, v_id, d.id, mp.stock, mp.costo, 'inventario_inicial', null, null, null,
                            'Stock inicial de demo (receta 72)', null, 'Sistema');
        end loop;
      end if;
    end loop;

    -- Preparación: Salsa de la casa (materia prima con receta, sin stock propio). Rinde 1 kg.
    select id into v_id from productos where empresa_id = e.id and sku = 'MP-SALSA';
    if v_id is null then
      insert into productos (empresa_id, nombre, sku, costo_promedio, precio_venta, unidad_medida, tipo_producto,
                             controla_stock, es_vendible, categoria_principal_id, tipo_iva, descripcion)
        values (e.id, 'Salsa de la casa', 'MP-SALSA', 0, 0, 'kg', 'materia_prima', false, false, v_cat, '10%',
                'Preparación: mayonesa, ajo, perejil y aceite')
        returning id into v_id;
    end if;

    -- Recetas (solo las que todavía no tienen): plato, rendimiento, ingrediente, cantidad, unidad, merma %.
    for rc in select * from (values
        ('MP-SALSA',  1, 'MP-MAYO',     0.7,  'kg', 0),
        ('MP-SALSA',  1, 'MP-AJO',      40,   'g', 15),
        ('MP-SALSA',  1, 'MP-PEREJIL',  30,   'g', 20),
        ('MP-SALSA',  1, 'MP-ACEITE',   250,  'ml', 0),
        ('MENU-HAMB', 1, 'MP-PANHAMB',  1,    'Unidad', 0),
        ('MENU-HAMB', 1, 'MP-CARMOL',   150,  'g', 10),
        ('MENU-HAMB', 1, 'MP-QUESO',    1,    'Unidad', 0),
        ('MENU-HAMB', 1, 'MP-LECHUGA',  30,   'g', 15),
        ('MENU-HAMB', 1, 'MP-TOMATE',   40,   'g', 15),
        ('MENU-HAMB', 1, 'MP-SALSA',    30,   'g', 0),
        ('MENU-LOMI', 1, 'MP-PANARA',   1,    'Unidad', 0),
        ('MENU-LOMI', 1, 'MP-LOMITO',   180,  'g', 10),
        ('MENU-LOMI', 1, 'MP-QUESO',    1,    'Unidad', 0),
        ('MENU-LOMI', 1, 'MP-HUEVO',    1,    'Unidad', 0),
        ('MENU-LOMI', 1, 'MP-LECHUGA',  30,   'g', 15),
        ('MENU-LOMI', 1, 'MP-TOMATE',   40,   'g', 15),
        ('MENU-LOMI', 1, 'MP-SALSA',    40,   'g', 0),
        ('MENU-PIZZ', 1, 'MP-HARINA',   300,  'g', 2),
        ('MENU-PIZZ', 1, 'MP-MUZZA',    250,  'g', 5),
        ('MENU-PIZZ', 1, 'MP-SALTOM',   120,  'g', 0),
        ('MENU-PIZZ', 1, 'MP-ACEITE',   15,   'ml', 0),
        ('MENU-EMPA', 1, 'MP-HARINA',   60,   'g', 2),
        ('MENU-EMPA', 1, 'MP-CARMOL',   50,   'g', 10),
        ('MENU-EMPA', 1, 'MP-CEBOLLA',  20,   'g', 15),
        ('MENU-EMPA', 1, 'MP-ACEITE',   30,   'ml', 0),
        ('MENU-MILA', 1, 'MP-CARMILA',  200,  'g', 10),
        ('MENU-MILA', 1, 'MP-PANRALL',  60,   'g', 0),
        ('MENU-MILA', 1, 'MP-HUEVO',    1,    'Unidad', 0),
        ('MENU-MILA', 1, 'MP-PAPA',     250,  'g', 20),
        ('MENU-MILA', 1, 'MP-LECHE',    50,   'ml', 0),
        ('MENU-MILA', 1, 'MP-ACEITE',   50,   'ml', 0),
        ('MENU-PAPA', 1, 'MP-PAPA',     300,  'g', 20),
        ('MENU-PAPA', 1, 'MP-ACEITE',   60,   'ml', 0),
        ('MENU-FLAN', 8, 'MP-LECHE',    1,    'l', 0),
        ('MENU-FLAN', 8, 'MP-HUEVO',    6,    'Unidad', 0),
        ('MENU-FLAN', 8, 'MP-AZUCAR',   200,  'g', 0),
        ('MENU-FLAN', 8, 'MP-DDL',      250,  'g', 0)
      ) x(plato, rend, insumo, cantidad, unidad, merma)
    loop
      select id into v_plato from productos where empresa_id = e.id and sku = rc.plato;
      select id into v_ins from productos where empresa_id = e.id and sku = rc.insumo;
      if v_plato is null or v_ins is null then continue; end if;
      if exists (select 1 from recetas r where r.producto_id = v_plato and r.updated_por is not null) then continue; end if;
      insert into recetas (producto_id, empresa_id, rendimiento) values (v_plato, e.id, rc.rend)
        on conflict (producto_id) do nothing;
      insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden)
        values (e.id, v_plato, v_ins, rc.cantidad, rc.unidad, rc.merma,
                (select count(*) + 1 from recetas_items z where z.producto_id = v_plato))
        on conflict (producto_id, insumo_id) do nothing;
    end loop;

    -- Costo de los platos y la preparación = el de su receta.
    update productos p set costo_promedio = round(receta_costo(p.id))
     where p.empresa_id = e.id and exists (select 1 from recetas_items z where z.producto_id = p.id);
  end loop;
end;
$seed$;
\endif

-- =============================================================================
-- 14. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".unidad_convertir(numeric, text, text) from public, anon;
revoke all on function :"schema".receta_insumos(uuid, numeric) from public, anon, authenticated;
revoke all on function :"schema".receta_costo(uuid) from public, anon, authenticated;
revoke all on function :"schema".receta_profundidad(uuid) from public, anon, authenticated;
revoke all on function :"schema".necesidad_stock(uuid, numeric) from public, anon, authenticated;
revoke all on function :"schema".mesa_reservas_json(uuid, uuid) from public, anon, authenticated;
revoke all on function :"schema".plato_porciones(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".stock_faltante(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function :"schema".tiene_receta(uuid) from public, anon, authenticated;
revoke all on function :"schema".receta_detalle(uuid) from public, anon;
revoke all on function :"schema".recetas_listar() from public, anon;
revoke all on function :"schema".receta_guardar(jsonb) from public, anon;
revoke all on function :"schema".buscar_productos(text, text, boolean, boolean, integer, integer, text) from public, anon;
revoke all on function :"schema".listar_productos_inventario(text, boolean, integer, integer, text) from public, anon;

grant execute on function
  :"schema".receta_insumos(uuid, numeric),
  :"schema".receta_costo(uuid),
  :"schema".receta_profundidad(uuid),
  :"schema".necesidad_stock(uuid, numeric),
  :"schema".mesa_reservas_json(uuid, uuid),
  :"schema".plato_porciones(uuid, uuid, jsonb),
  :"schema".stock_faltante(uuid, jsonb, jsonb),
  :"schema".tiene_receta(uuid)
  to service_role;
grant execute on function
  :"schema".unidad_normal(text),
  :"schema".unidad_dim(text),
  :"schema".unidad_factor(text),
  :"schema".unidad_convertir(numeric, text, text),
  :"schema".cant_texto(numeric, text),
  :"schema".receta_detalle(uuid),
  :"schema".recetas_listar(),
  :"schema".receta_guardar(jsonb),
  :"schema".buscar_productos(text, text, boolean, boolean, integer, integer, text),
  :"schema".listar_productos_inventario(text, boolean, integer, integer, text)
  to authenticated, service_role;

commit;
