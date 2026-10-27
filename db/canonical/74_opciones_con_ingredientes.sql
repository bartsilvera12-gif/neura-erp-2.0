-- =============================================================================
-- OPCIONES CON INGREDIENTES (pedido del dueño, 27-oct-2026).
--
-- Hasta la 73 las "Opciones a elegir" solo cambiaban el precio. Ahora cada opción puede llevar
-- sus propios ingredientes (plato_opcion_items: materia prima o preparación, cantidad NETA +
-- unidad + merma %, como recetas_items). Ej.: grupo "Acompañamiento" con Papas fritas (papa 200 g
-- merma 15 % + aceite 20 ml) y Aros de cebolla (cebolla 150 g merma 10 % + rebozador 50 g +
-- aceite 25 ml). Si el cliente elige aros se descuentan cebolla, rebozador y aceite, NO papa.
--
-- Explosión de una línea vendida / pedida (plato_insumos, redefinida desde la 73):
--   receta base − quitados + extras + ingredientes de las opciones elegidas
--   (× cantidad de la línea; merma de cada ingrediente de la opción: bruto = neto / (1 − merma);
--   una preparación se explota con SU receta). La opción NO se divide por el rendimiento de la
--   receta: sus cantidades son por plato.
--   Como todo pasa por plato_insumos / necesidad_mods, ya lo cuentan sin cambios: crear_venta
--   (descuento + ventas_items_insumos + CMV real), anular_venta (devuelve ventas_items_insumos,
--   exacto), stock_faltante, mesa_reservas_json, aceptar pedido de mesa y el pedido del menú QR.
--   Los ingredientes de la opción se leen al momento (como la receta base): el snapshot de la
--   línea guarda solo la opción elegida. Opción borrada → solo la receta base.
--
-- Disponibilidad:
--   · opcion_porciones: platos que alcanzan con la receta base + esa opción.
--   · plato_porciones (redefinida desde la 72): por cada grupo OBLIGATORIO con ingredientes,
--     las porciones de la mejor opción (la k-ésima mejor si el mínimo es k). Si ninguna opción
--     alcanza → 0: el plato no se vende y sale del menú QR (como los demás sin stock).
--   · plato_mods_catalogo (redefinida desde la 73): cada opción trae `disponible` (false = "Sin
--     stock", deshabilitada en el menú QR y en la caja).
--
-- Costo (Inventario › Recetas): receta_detalle / recetas_listar traen costo base y, si hay grupos
--   obligatorios con ingredientes, costo_desde (opción más barata de cada grupo) y costo_hasta
--   (la más cara). El costo de cada opción viene en receta_detalle.
--
-- Cuentas de mesa abiertas con líneas viejas (pedidas antes de que existiera el grupo):
--   · línea SIN snapshot (modificadores null) = solo la receta base actual (sin opción: no
--     descuenta la guarnición). Ya se cobraba sin exigir las opciones (73, erp.mods_sin_exigir).
--   · línea CON snapshot pero sin el grupo nuevo (ej. "jugosa" sin acompañamiento): se cobra igual.
--     mesa_cuenta_cobrar_caja (redefinida) pone en erp.mods_sin_exigir_claves la combinación
--     (producto#clave) de cada línea de la cuenta y plato_mods_resolver (redefinida) no le exige
--     los obligatorios. Descuenta lo que eligió (base + sus modificadores).
--
-- Redefine desde su última versión vigente: plato_insumos (73), plato_porciones (72),
-- plato_mods_catalogo (73), plato_mods_resolver (73), mesa_cuenta_cobrar_caja (73),
-- receta_detalle / recetas_listar / receta_guardar (73), tg_productos_tipo (72). Sin cambios de
-- firma. Nuevas: plato_opcion_items, opcion_insumos, opcion_costo, opcion_porciones,
-- plato_costo_rango, tg_plato_opcion_items_validar.
--
-- Semilla SOLO en erp_demo: Rebozador (materia prima); Hamburguesa clásica con grupo obligatorio
-- "Acompañamiento" (Papas fritas / Aros de cebolla); Milanesa: la guarnición (papa + leche) sale
-- de la base y pasa a las opciones Puré / Papas fritas → se renombra "Milanesa con guarnición".
--
-- IDEMPOTENTE. Va después de 73.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tabla: ingredientes de cada opción
-- =============================================================================
create table if not exists :"schema".plato_opcion_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  opcion_id uuid not null references :"schema".plato_opciones(id) on delete cascade,
  insumo_id uuid not null references :"schema".productos(id) on delete restrict,
  cantidad numeric not null,
  unidad text not null,
  merma_pct numeric not null default 0,
  orden integer not null default 0,
  constraint chk_poi_cantidad check (cantidad > 0 and cantidad <= 1000000),
  constraint chk_poi_merma check (merma_pct >= 0 and merma_pct <= 90),
  constraint chk_poi_unidad check (unidad in ('Unidad', 'kg', 'g', 'l', 'ml')),
  constraint uq_plato_opcion_items unique (opcion_id, insumo_id)
);
create index if not exists plato_opcion_items_insumo_idx on :"schema".plato_opcion_items (insumo_id);
create index if not exists plato_opcion_items_empresa_idx on :"schema".plato_opcion_items (empresa_id);

alter table :"schema".plato_opcion_items enable row level security;
alter table :"schema".plato_opcion_items force row level security;
drop policy if exists plato_opcion_items_propios on :"schema".plato_opcion_items;
create policy plato_opcion_items_propios on :"schema".plato_opcion_items for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
revoke all on :"schema".plato_opcion_items from anon, authenticated;
grant select on :"schema".plato_opcion_items to authenticated;
grant all on :"schema".plato_opcion_items to service_role;

-- Misma empresa, plato Menú, materia prima (o preparación), unidad compatible, sin ciclos y
-- profundidad (el plato + la opción + la preparación: hasta 5 niveles).
create or replace function :"schema".tg_plato_opcion_items_validar()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_plato productos;
  v_ins productos;
  v_emp_op uuid;
begin
  select o.empresa_id into v_emp_op from plato_opciones o where o.id = new.opcion_id;
  select p.* into v_plato
    from plato_opciones o join plato_opcion_grupos g on g.id = o.grupo_id join productos p on p.id = g.producto_id
   where o.id = new.opcion_id;
  select * into v_ins from productos where id = new.insumo_id;
  if v_ins.id is null or v_plato.id is null or v_ins.empresa_id <> new.empresa_id
     or v_plato.empresa_id <> new.empresa_id or v_emp_op <> new.empresa_id then
    raise exception 'El ingrediente no es de esta empresa';
  end if;
  if v_plato.tipo_producto <> 'menu' then
    raise exception 'Solo los platos (Menú) llevan opciones con ingredientes';
  end if;
  if v_ins.tipo_producto <> 'materia_prima' then
    raise exception '"%" no es materia prima: en una opción solo van materias primas (o preparaciones)', v_ins.nombre;
  end if;
  if unidad_dim(new.unidad) is distinct from unidad_dim(v_ins.unidad_medida) then
    raise exception '"%" se mide en %: no se puede cargar en %', v_ins.nombre, v_ins.unidad_medida, new.unidad;
  end if;
  if new.insumo_id = v_plato.id or exists (
       with recursive d(pid, n) as (
         select new.insumo_id, 0
         union
         select ri.insumo_id, d.n + 1 from d join recetas_items ri on ri.producto_id = d.pid where d.n < 20
       )
       select 1 from d where d.pid = v_plato.id) then
    raise exception 'Ciclo: "%" ya lleva "%", no puede ser ingrediente de una de sus opciones', v_ins.nombre, v_plato.nombre;
  end if;
  if receta_profundidad(new.insumo_id) + 1 > 5 then
    raise exception '"%" tiene demasiadas preparaciones una dentro de otra para usarla en una opción (máximo 5 niveles)', v_ins.nombre;
  end if;
  return new;
end;
$fn$;
revoke all on function :"schema".tg_plato_opcion_items_validar() from public, anon, authenticated;
drop trigger if exists trg_plato_opcion_items_validar on :"schema".plato_opcion_items;
create trigger trg_plato_opcion_items_validar
  before insert or update on :"schema".plato_opcion_items
  for each row execute function :"schema".tg_plato_opcion_items_validar();

-- Un producto usado en una opción tampoco puede dejar de ser materia prima ni cambiar de
-- magnitud (redefinida desde la 72: cuenta recetas + opciones de platos).
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
    select (select count(*) from recetas_items where insumo_id = new.id)
         + (select count(distinct o.grupo_id) from plato_opcion_items oi join plato_opciones o on o.id = oi.opcion_id where oi.insumo_id = new.id)  -- 74
      into v_usos;
    if v_usos > 0 and new.tipo_producto <> 'materia_prima' then
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

-- =============================================================================
-- 2. Explosión, costo y disponibilidad de las opciones
-- =============================================================================

-- Materias primas de p_cantidad platos con esa opción (con merma; una preparación se explota).
create or replace function :"schema".opcion_insumos(p_opcion uuid, p_cantidad numeric)
returns table (insumo_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
  with e as (
    select oi.insumo_id as ins,
           p_cantidad * unidad_convertir(oi.cantidad, oi.unidad, i.unidad_medida) / (1 - oi.merma_pct / 100.0) as cant
      from plato_opcion_items oi join productos i on i.id = oi.insumo_id
     where oi.opcion_id = p_opcion
  )
  select t.insumo_id, round(sum(t.cantidad), 4)
    from (
      select r.insumo_id, r.cantidad from e cross join lateral receta_insumos(e.ins, e.cant) r where tiene_receta(e.ins)
      union all
      select e.ins, e.cant from e where not tiene_receta(e.ins)
    ) t
   group by t.insumo_id
  having round(sum(t.cantidad), 4) > 0
$$;

-- Costo de los ingredientes de una opción para UN plato.
create or replace function :"schema".opcion_costo(p_opcion uuid)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(round(sum(r.cantidad * coalesce(i.costo_promedio, 0)), 2), 0)
    from opcion_insumos(p_opcion, 1) r join productos i on i.id = r.insumo_id
$$;

-- Materias primas de p_cantidad platos con sus modificadores (redefinida desde la 73):
-- receta − quitados + extras + ingredientes de las opciones elegidas (solo opciones del plato).
create or replace function :"schema".plato_insumos(p_producto uuid, p_cantidad numeric, p_mods jsonb)
returns table (insumo_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select t.insumo_id, round(sum(t.cantidad), 4)
    from (
      select r.insumo_id, r.cantidad from receta_insumos_sin(p_producto, p_cantidad, mods_quitar_ids(p_mods)) r
      union all
      select xi.insumo_id, xi.cantidad
        from mods_extras_lista(p_mods) x
        cross join lateral extra_insumos(x.extra_id, p_cantidad * x.cantidad) xi
       where x.cantidad > 0
      union all
      -- 74: ingredientes de las opciones elegidas.
      select oi.insumo_id, oi.cantidad
        from unnest(mods_opcion_ids(p_mods)) u(id)
        join plato_opciones o on o.id = u.id
        join plato_opcion_grupos g on g.id = o.grupo_id and g.producto_id = p_producto
        cross join lateral opcion_insumos(o.id, p_cantidad) oi
    ) t
   group by t.insumo_id
  having round(sum(t.cantidad), 4) > 0
$$;

-- Platos que alcanzan con la receta base + esa opción (descontando p_reserva).
-- null = no consume nada con control de stock (sin límite).
create or replace function :"schema".opcion_porciones(p_producto uuid, p_opcion uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select greatest(0, floor(min((coalesce(sd.cantidad, 0) - coalesce((coalesce(p_reserva, '{}'::jsonb) ->> n.producto_id::text)::numeric, 0)) / n.cantidad)))
    from necesidad_mods(p_producto, 1, jsonb_build_object('opciones', jsonb_build_array(p_opcion::text))) n
    left join stock_depositos sd on sd.producto_id = n.producto_id and sd.deposito_id = p_deposito
   where n.cantidad > 0
$$;

-- Porciones posibles (redefinida desde la 72). 0 = Menú sin receta; null = sin límite.
-- 74: cada grupo obligatorio con ingredientes limita a lo que da su mejor opción (la k-ésima
-- mejor si el mínimo es k). Ninguna opción alcanza → 0.
create or replace function :"schema".plato_porciones(p_producto uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns numeric language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_tipo text;
  v_res numeric;
  g record;
  v_arr numeric[];
  v_g numeric;
begin
  select tipo_producto into v_tipo from productos where id = p_producto;
  if not found then return null; end if;
  if v_tipo = 'menu' and not tiene_receta(p_producto) then return 0; end if;
  select greatest(0, floor(min((coalesce(sd.cantidad, 0) - coalesce((coalesce(p_reserva, '{}'::jsonb) ->> n.producto_id::text)::numeric, 0)) / n.cantidad)))
    into v_res
    from necesidad_stock(p_producto, 1) n
    left join stock_depositos sd on sd.producto_id = n.producto_id and sd.deposito_id = p_deposito
   where n.cantidad > 0;
  if v_tipo <> 'menu' or v_res = 0 then return v_res; end if;
  for g in
    select gr.id, greatest(gr.minimo, 1) as k
      from plato_opcion_grupos gr
     where gr.producto_id = p_producto and gr.obligatorio
       and exists (select 1 from plato_opciones o join plato_opcion_items oi on oi.opcion_id = o.id
                    where o.grupo_id = gr.id and o.activo)
  loop
    select array_agg(t.v order by t.v desc) into v_arr
      from (select coalesce(opcion_porciones(p_producto, o.id, p_deposito, p_reserva), 1e15) as v
              from plato_opciones o where o.grupo_id = g.id and o.activo) t;
    if coalesce(cardinality(v_arr), 0) < g.k then
      v_g := 0;
    else
      v_g := nullif(v_arr[g.k], 1e15);
    end if;
    v_res := least(v_res, v_g);  -- least ignora los null
    if v_res = 0 then return 0; end if;
  end loop;
  return v_res;
end;
$fn$;

-- ¿La opción alcanza para UN plato? (sin ingredientes propios: depende solo de la base).
create or replace function :"schema".opcion_disponible(p_producto uuid, p_opcion uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select case when not exists (select 1 from plato_opcion_items oi where oi.opcion_id = p_opcion) then true
              else coalesce(opcion_porciones(p_producto, p_opcion, p_deposito, p_reserva), 1) >= 1 end
$$;

-- Costo con opciones: { desde, hasta } (base + la opción más barata / más cara de cada grupo
-- obligatorio con ingredientes; k opciones si el mínimo es k). null = no hay tales grupos.
create or replace function :"schema".plato_costo_rango(p_producto uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select case when count(*) = 0 then null
              else jsonb_build_object('desde', receta_costo(p_producto) + sum(t.lo), 'hasta', receta_costo(p_producto) + sum(t.hi)) end
    from (
      select (select coalesce(sum(a.c), 0) from (select opcion_costo(o.id) as c from plato_opciones o
                                                  where o.grupo_id = g.id and o.activo order by 1 asc limit greatest(g.minimo, 1)) a) as lo,
             (select coalesce(sum(b.c), 0) from (select opcion_costo(o.id) as c from plato_opciones o
                                                  where o.grupo_id = g.id and o.activo order by 1 desc limit greatest(g.minimo, 1)) b) as hi
        from plato_opcion_grupos g
       where g.producto_id = p_producto and g.obligatorio
         and exists (select 1 from plato_opciones o join plato_opcion_items oi on oi.opcion_id = o.id
                      where o.grupo_id = g.id and o.activo)
    ) t
$$;

-- =============================================================================
-- 3. Catálogo y validación de modificadores (redefinidas desde la 73)
-- =============================================================================
-- { quitar: [{producto_id, nombre}], extras: [{extra_id, nombre, precio, maximo, disponible}],
--   grupos: [{id, nombre, obligatorio, minimo, maximo, opciones: [{id, nombre, precio, disponible}]}] }
create or replace function :"schema".plato_mods_catalogo(p_producto uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  q jsonb;
  e jsonb;
  g jsonb;
begin
  if not plato_tiene_mods(p_producto) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.id, 'nombre', i.nombre) order by ri.orden, i.nombre), '[]'::jsonb) into q
    from recetas_items ri join productos i on i.id = ri.insumo_id
   where ri.producto_id = p_producto and ri.se_puede_quitar;
  select coalesce(jsonb_agg(jsonb_build_object(
           'extra_id', x.id, 'nombre', x.nombre, 'precio', coalesce(pe.precio, x.precio), 'maximo', pe.maximo,
           'disponible', least(pe.maximo, extra_disponible(p_producto, x.id, p_deposito, p_reserva)))
           order by pe.orden, x.nombre), '[]'::jsonb) into e
    from plato_extras pe join extras x on x.id = pe.extra_id and x.activo
   where pe.producto_id = p_producto;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', gr.id, 'nombre', gr.nombre, 'obligatorio', gr.obligatorio, 'minimo', gr.minimo, 'maximo', gr.maximo,
           'opciones', (select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'precio', o.precio,
                                                            'disponible', opcion_disponible(p_producto, o.id, p_deposito, p_reserva))  -- 74
                               order by o.orden, o.nombre)
                          from plato_opciones o where o.grupo_id = gr.id and o.activo))
           order by gr.orden, gr.nombre), '[]'::jsonb) into g
    from plato_opcion_grupos gr
   where gr.producto_id = p_producto and exists (select 1 from plato_opciones o where o.grupo_id = gr.id and o.activo);
  return jsonb_build_object('quitar', q, 'extras', e, 'grupos', g);
end;
$fn$;

-- Valida los modificadores pedidos para un plato y devuelve
--   { mods: snapshot | null, texto, precio (por unidad), clave }.
-- p_exigir = false: no exige las opciones obligatorias (líneas viejas de cuentas de mesa).
-- 74: tampoco las exige si la combinación (producto#clave) está en erp.mods_sin_exigir_claves
-- (lo pone mesa_cuenta_cobrar_caja con las líneas de la cuenta, ya validadas al pedirlas).
create or replace function :"schema".plato_mods_resolver(p_producto uuid, p_mods jsonb, p_exigir boolean default true)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_nombre text;
  v_q uuid[];
  v_o uuid[];
  x jsonb;
  r record;
  v_id uuid;
  v_cant numeric;
  v_vistos uuid[] := '{}';
  v_quitar jsonb := '[]'::jsonb;
  v_extras jsonb := '[]'::jsonb;
  v_opc jsonb := '[]'::jsonb;
  v_tq text[] := '{}';
  v_te text[] := '{}';
  v_to text[] := '{}';
  v_precio numeric := 0;
  v_po numeric := 0;
  v_snap jsonb;
  v_exigir boolean := coalesce(p_exigir, true);
  v_claves text := nullif(current_setting('erp.mods_sin_exigir_claves', true), '');
begin
  select nombre into v_nombre from productos where id = p_producto;
  if p_mods is not null and jsonb_typeof(p_mods) not in ('object', 'null') then
    raise exception 'Modificadores inválidos en "%"', v_nombre;
  end if;
  begin
    v_q := mods_quitar_ids(p_mods);
    v_o := mods_opcion_ids(p_mods);
    if v_exigir and v_claves is not null then
      v_exigir := not ((p_producto::text || '#' || mods_clave(p_mods)) = any (string_to_array(v_claves, ';')));
    end if;
  exception when others then
    raise exception 'Modificadores inválidos en "%"', v_nombre;
  end;

  -- Quitar: ingredientes directos del plato marcados "Se puede quitar".
  if cardinality(v_q) > 0 then
    if exists (select 1 from unnest(v_q) u
                where not exists (select 1 from recetas_items ri where ri.producto_id = p_producto and ri.insumo_id = u and ri.se_puede_quitar)) then
      raise exception 'En "%" hay un ingrediente que no se puede quitar', v_nombre;
    end if;
    select jsonb_agg(jsonb_build_object('producto_id', i.id, 'nombre', i.nombre) order by ri.orden, i.nombre),
           array_agg('sin ' || lower(i.nombre) order by ri.orden, i.nombre)
      into v_quitar, v_tq
      from recetas_items ri join productos i on i.id = ri.insumo_id
     where ri.producto_id = p_producto and ri.insumo_id = any (v_q);
  end if;

  -- Extras: activados en el plato, activos, cantidad entera de 1 al máximo.
  if jsonb_typeof(p_mods->'extras') = 'array' then
    if jsonb_array_length(p_mods->'extras') > 30 then raise exception 'Demasiados extras en "%"', v_nombre; end if;
    for x in select * from jsonb_array_elements(p_mods->'extras') loop
      begin
        v_id := nullif(x->>'extra_id', '')::uuid;
        v_cant := coalesce(nullif(x->>'cantidad', '')::numeric, 1);
      exception when others then
        raise exception 'Hay un extra inválido en "%"', v_nombre;
      end;
      if v_id is null then raise exception 'Hay un extra inválido en "%"', v_nombre; end if;
      if v_cant = 0 then continue; end if;
      if v_id = any (v_vistos) then raise exception 'En "%" hay un extra repetido', v_nombre; end if;
      v_vistos := v_vistos || v_id;
      select ex.nombre, coalesce(pe.precio, ex.precio) as precio, pe.maximo, ex.activo into r
        from plato_extras pe join extras ex on ex.id = pe.extra_id
       where pe.producto_id = p_producto and pe.extra_id = v_id;
      if not found then raise exception 'Ese extra no es de "%"', v_nombre; end if;
      if not r.activo then raise exception 'El extra "%" ya no está disponible', r.nombre; end if;
      if v_cant <> trunc(v_cant) or v_cant < 1 or v_cant > r.maximo then
        raise exception '"%" en "%": de 1 a %', r.nombre, v_nombre, r.maximo;
      end if;
      v_extras := v_extras || jsonb_build_array(jsonb_build_object('extra_id', v_id, 'nombre', r.nombre, 'cantidad', v_cant, 'precio', r.precio));
      v_precio := v_precio + r.precio * v_cant;
    end loop;
    select coalesce(jsonb_agg(e order by e->>'nombre'), '[]'::jsonb),
           coalesce(array_agg('+ ' || lower(e->>'nombre') || case when (e->>'cantidad')::numeric > 1 then ' ×' || (e->>'cantidad') else '' end
                              order by e->>'nombre'), '{}')
      into v_extras, v_te
      from jsonb_array_elements(v_extras) e;
  end if;

  -- Opciones: de los grupos del plato, activas; por grupo, entre el mínimo y el máximo.
  if cardinality(v_o) > 0 and exists (
       select 1 from unnest(v_o) u
        where not exists (select 1 from plato_opciones o join plato_opcion_grupos g on g.id = o.grupo_id
                           where o.id = u and g.producto_id = p_producto and o.activo)) then
    raise exception 'Hay una opción que no es de "%"', v_nombre;
  end if;
  for r in
    select g.nombre, g.obligatorio, g.minimo, g.maximo,
           (select count(*) from plato_opciones o where o.grupo_id = g.id and o.id = any (v_o)) as n
      from plato_opcion_grupos g
     where g.producto_id = p_producto
       and exists (select 1 from plato_opciones o where o.grupo_id = g.id and o.activo)
     order by g.orden, g.nombre
  loop
    if r.n > r.maximo then
      raise exception 'En "%" de "%" se elige hasta %', r.nombre, v_nombre, r.maximo;
    end if;
    if v_exigir and r.obligatorio and r.n < greatest(r.minimo, 1) then
      if greatest(r.minimo, 1) > 1 then
        raise exception 'Elegí al menos % en "%" de "%"', r.minimo, r.nombre, v_nombre;
      end if;
      raise exception 'Elegí "%" para "%"', r.nombre, v_nombre;
    end if;
  end loop;
  if cardinality(v_o) > 0 then
    select jsonb_agg(jsonb_build_object('grupo_id', g.id, 'grupo', g.nombre, 'opcion_id', o.id, 'opcion', o.nombre, 'precio', o.precio)
                     order by g.orden, g.nombre, o.orden, o.nombre),
           coalesce(sum(o.precio), 0),
           array_agg(lower(o.nombre) order by g.orden, g.nombre, o.orden, o.nombre)
      into v_opc, v_po, v_to
      from plato_opciones o join plato_opcion_grupos g on g.id = o.grupo_id
     where g.producto_id = p_producto and o.id = any (v_o);
  end if;

  v_snap := case when jsonb_array_length(v_quitar) = 0 and jsonb_array_length(v_extras) = 0 and jsonb_array_length(v_opc) = 0 then null
                 else jsonb_build_object('quitar', v_quitar, 'extras', v_extras, 'opciones', v_opc) end;
  return jsonb_build_object(
    'mods', v_snap,
    'texto', nullif(array_to_string(v_tq || v_te || v_to, ' · '), ''),
    'precio', v_precio + v_po,
    'clave', mods_clave(v_snap));
end;
$fn$;

-- =============================================================================
-- 4. Cobro de la cuenta de mesa desde la caja (redefinida desde la 73)
-- =============================================================================
create or replace function :"schema".mesa_cuenta_cobrar_caja(
  p_cuenta_id uuid, p_version text,
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket', p_cliente_ocasional boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  m mesas;
  v_caja uuid;
  v_suc_caja uuid;
  v_previa uuid;
  v_venta jsonb;
  g record;
  v_en_carrito numeric;
  v_quien text;
  v_viejas text;
  v_claves text;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  -- La fila de la cuenta serializa a los cajeros: el segundo espera y ve que ya se cobró.
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta de mesa no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;

  -- Reintento del mismo POS: la venta ya está hecha y la cuenta cerrada con ella.
  if nullif(p_idempotency_key, '') is not null then
    select id into v_previa from ventas where empresa_id = s.s_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_previa is not null and c.venta_id = v_previa then
      return jsonb_build_object('venta_id', v_previa, 'numero_control', (select numero_control from ventas where id = v_previa),
                                'reusada', true, 'mesa', m.nombre);
    end if;
  end if;

  if c.estado = 'cerrada' then
    select coalesce(u.nombre, 'otro usuario') into v_quien from usuarios u where u.id = c.cerrada_por;
    raise exception 'La cuenta de "%" ya se cobró (%): soltala del carrito', m.nombre, coalesce(v_quien, 'otro usuario');
  end if;
  if c.estado <> 'abierta' then raise exception 'La cuenta de "%" ya no está abierta: soltala del carrito', m.nombre; end if;
  if c.en_caja_at is null then raise exception 'La cuenta de "%" ya no está en caja (la volvieron a abrir): soltala del carrito', m.nombre; end if;
  if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado = 'nuevo') then
    raise exception 'La mesa "%" tiene un pedido nuevo sin atender: aceptalo o rechazalo en Pedidos de mesas antes de cobrar', m.nombre;
  end if;
  if p_version is null or p_version <> mesa_cuenta_version(c.id) then
    raise exception 'La cuenta de "%" cambió desde que la cargaste: recargala antes de cobrar', m.nombre;
  end if;

  -- Caja: abierta y de la sucursal de la mesa.
  v_caja := caja_abierta_para(null, null, p_caja_id);
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> m.sucursal_id then raise exception 'La mesa "%" es de otra sucursal: cobrala en una caja de su sucursal', m.nombre; end if;

  -- El carrito trae, por producto Y combinación de modificadores (73), al menos lo que pidió la
  -- mesa (no se quitan ítems de la cuenta).
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'La venta debe tener al menos un ítem'; end if;
  for g in
    select i.producto_id, max(i.producto_nombre) as nombre, mods_clave(i.modificadores) as clave,
           max(i.modificadores_texto) as texto, sum(i.cantidad) as cantidad
      from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
     where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
     group by i.producto_id, mods_clave(i.modificadores)
  loop
    if g.producto_id is null then
      raise exception 'El producto "%" de la cuenta ya no existe en el catálogo: no se puede cobrar en caja', g.nombre;
    end if;
    select coalesce(sum((x->>'cantidad')::numeric), 0) into v_en_carrito
      from jsonb_array_elements(p_items) x
     where x->>'producto_id' = g.producto_id::text and mods_clave(x->'mods') = g.clave;
    if v_en_carrito < g.cantidad then
      raise exception 'No se pueden quitar productos de la cuenta de la mesa: "%"% pidió %, en el carrito hay %',
        g.nombre, coalesce(' (' || g.texto || ')', ''), trim_scale(g.cantidad), trim_scale(v_en_carrito);
    end if;
  end loop;

  -- 73: los platos pedidos antes de tener opciones obligatorias se cobran sin exigirlas.
  select string_agg(distinct i.producto_id::text, ',') into v_viejas
    from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
   where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado') and i.modificadores is null and i.producto_id is not null;
  -- 74: ni las combinaciones de la cuenta a las que les falta un grupo obligatorio nuevo
  -- (ej. "jugosa" pedida antes de que existiera "Acompañamiento").
  select string_agg(distinct i.producto_id::text || '#' || mods_clave(i.modificadores), ';') into v_claves
    from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
   where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado') and i.producto_id is not null;
  perform set_config('erp.mods_sin_exigir', coalesce(v_viejas, ''), true);
  perform set_config('erp.mods_sin_exigir_claves', coalesce(v_claves, ''), true);

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Cuenta de mesa: ' || m.nombre || coalesce(' · ' || m.zona, ''), 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);
  perform set_config('erp.mods_sin_exigir', '', true);
  perform set_config('erp.mods_sin_exigir_claves', '', true);

  update mesa_cuentas set estado = 'cerrada', cerrada_at = now(), cerrada_por = s.s_usuario,
         venta_id = (v_venta->>'venta_id')::uuid, total = coalesce((v_venta->>'total')::numeric, 0)
   where id = c.id;
  -- Lo que quedó sin entregar se da por entregado al cobrar (las comandas de cada estación también).
  update mesa_comandas k set estado = 'entregado', preparando_at = coalesce(k.preparando_at, now()),
         listo_at = coalesce(k.listo_at, now()), entregado_at = now(), updated_at = now()
    from mesa_pedidos p
   where p.id = k.pedido_id and p.cuenta_id = c.id and k.estado <> 'entregado';
  update mesa_pedidos set estado = 'entregado', entregado_at = now(), listo_at = coalesce(listo_at, now()), updated_at = now()
   where cuenta_id = c.id and estado in ('aceptado', 'en_preparacion', 'listo');
  return v_venta || jsonb_build_object('mesa', m.nombre);
end;
$fn$;

-- =============================================================================
-- 5. API de recetas (redefinidas desde la 73): ingredientes de las opciones y rango de costo
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
    'costo_rango', plato_costo_rango(p.id),  -- 74: { desde, hasta } | null
    'porciones', plato_porciones(p.id, v_dep),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'insumo_id', i.id, 'nombre', i.nombre, 'sku', i.sku, 'unidad_insumo', i.unidad_medida,
        'cantidad', ri.cantidad, 'unidad', ri.unidad, 'merma_pct', ri.merma_pct,
        'se_puede_quitar', ri.se_puede_quitar,  -- 73
        'es_preparacion', tiene_receta(i.id),
        'costo_unitario', case when tiene_receta(i.id) then receta_costo(i.id) else coalesce(i.costo_promedio, 0) end,
        'stock', coalesce(sd.cantidad, 0), 'controla_stock', i.controla_stock, 'activo', i.activo)
        order by ri.orden, i.nombre)
      from recetas_items ri join productos i on i.id = ri.insumo_id
      left join stock_depositos sd on sd.producto_id = i.id and sd.deposito_id = v_dep
      where ri.producto_id = p.id), '[]'::jsonb),
    'usado_en', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
      from recetas_items ri join productos u on u.id = ri.producto_id where ri.insumo_id = p.id), '[]'::jsonb),
    -- 73: extras activados y grupos de opciones del plato.
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
            -- 74: ingredientes de la opción, su costo y si alcanza.
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
           p.categoria_principal_id, tiene_receta(p.id) as con_receta
      from productos p
     where p.empresa_id = s.s_empresa and p.activo
       and (p.tipo_producto = 'menu' or (p.tipo_producto = 'materia_prima' and exists (select 1 from recetas_items z where z.producto_id = p.id)))
  ),
  calc as (
    select b.*, rc.rendimiento,
           (select count(*) from recetas_items ri where ri.producto_id = b.id) as ingredientes,
           case when b.con_receta then receta_costo(b.id) end as costo,
           case when b.con_receta and b.tipo_producto = 'menu' then plato_costo_rango(b.id) end as rango,  -- 74
           case when b.con_receta then plato_porciones(b.id, v_dep) end as porciones,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from necesidad_stock(b.id, 1) n join productos i on i.id = n.producto_id
              left join stock_depositos sd on sd.producto_id = n.producto_id and sd.deposito_id = v_dep
             where b.con_receta and coalesce(sd.cantidad, 0) < n.cantidad) as faltan,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from receta_insumos(b.id, 1) n join productos i on i.id = n.insumo_id
             where b.con_receta and not i.activo) as inactivos,
           -- 74: grupos obligatorios sin ninguna opción con stock.
           (select string_agg('ninguna opción de «' || g.nombre || '» con stock', ', ' order by g.orden, g.nombre)
              from plato_opcion_grupos g
             where b.con_receta and b.tipo_producto = 'menu' and g.producto_id = b.id and g.obligatorio
               and exists (select 1 from plato_opciones o join plato_opcion_items oi on oi.opcion_id = o.id where o.grupo_id = g.id and o.activo)
               and not exists (select 1 from plato_opciones o where o.grupo_id = g.id and o.activo
                                 and opcion_disponible(b.id, o.id, v_dep))) as faltan_opciones,
           -- 73: cuántos modificadores tiene (quitables + extras + grupos de opciones).
           (select count(*) from recetas_items ri where ri.producto_id = b.id and ri.se_puede_quitar)
             + (select count(*) from plato_extras pe where pe.producto_id = b.id)
             + (select count(*) from plato_opcion_grupos g where g.producto_id = b.id) as modificadores
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
      'costo_desde', (c.rango->>'desde')::numeric, 'costo_hasta', (c.rango->>'hasta')::numeric,  -- 74
      'faltan', coalesce(c.inactivos, c.faltan, c.faltan_opciones),
      'modificadores', c.modificadores,
      'estado', case when not c.con_receta then 'sin_receta'
                     when c.inactivos is not null or c.faltan is not null or c.faltan_opciones is not null then 'faltante'
                     else 'completa' end)
      order by (c.tipo_producto <> 'menu'), c.nombre), '[]'::jsonb))
    into r
    from calc c;
  return r;
end;
$fn$;

-- p = { producto_id, rendimiento, notas, items: [{ insumo_id, cantidad, unidad, merma_pct, se_puede_quitar }],
--       extras?: [{ extra_id, precio (null = el de la lista), maximo }],
--       grupos?: [{ id?, nombre, obligatorio, minimo, maximo,
--                   opciones: [{ id?, nombre, precio, activo, items?: [{ insumo_id, cantidad, unidad, merma_pct }] }] }] }
-- items vacío = quitar la receta. Sin "extras" / "grupos" en p: no se tocan (73).
-- 74: sin "items" en una opción: sus ingredientes no se tocan; con "items": se reemplazan.
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
  -- 73
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
  -- 74
  ij jsonb;
  v_iorden integer;
  v_ivistos uuid[];
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
    insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden, se_puede_quitar)
      values (s.s_empresa, prod.id, v_ins, v_cant, v_unidad, v_merma, v_orden,
              prod.tipo_producto = 'menu' and coalesce((it->>'se_puede_quitar')::boolean, false));
  end loop;

  -- Profundidad: la de esta receta y la de las que la usan (hasta 5 niveles).
  -- 74: también las opciones de platos que la usan (plato + opción = un nivel más).
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

  -- 73: extras del plato (solo Menú). Se reemplaza la lista entera.
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

  -- 73: grupos de opciones (solo Menú). Se conservan los ids que vienen; los que faltan se borran.
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

        -- 74: ingredientes de la opción (se reemplazan si vienen).
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
-- 6. Semilla (solo erp_demo): Rebozador, Acompañamiento de la Hamburguesa y Guarnición de la
--    Milanesa con sus ingredientes
-- =============================================================================
select (:'schema' = 'erp_demo') as es_demo \gset
\if :es_demo
do $seed$
declare
  e record;
  d record;
  x record;
  v_cat uuid;
  v_id uuid;
  v_plato uuid;
  v_g uuid;
  v_o uuid;
  v_ins uuid;
  v_virgenes uuid[];
begin
  for e in select id from empresas loop
    -- Rebozador (materia prima con stock en los depósitos principales).
    select id into v_id from productos where empresa_id = e.id and sku = 'MP-REBOZ';
    if v_id is null then
      select id into v_cat from categorias_productos where empresa_id = e.id and lower(btrim(nombre)) = 'insumos';
      insert into productos (empresa_id, nombre, sku, costo_promedio, precio_venta, unidad_medida, tipo_producto,
                             controla_stock, es_vendible, categoria_principal_id, tipo_iva, stock_minimo)
        values (e.id, 'Rebozador', 'MP-REBOZ', 14000, 0, 'kg', 'materia_prima', true, false, v_cat, '10%', 1)
        returning id into v_id;
      for d in select dp.id from depositos dp join sucursales su on su.id = dp.sucursal_id
                where dp.empresa_id = e.id and dp.activo and su.activa and dp.es_principal loop
        perform inv_mover(e.id, v_id, d.id, 5, 14000, 'inventario_inicial', null, null, null,
                          'Stock inicial de demo (receta 74)', null, 'Sistema');
      end loop;
    end if;

    -- Hamburguesa clásica: la papa (si estaba) sale de la base; grupo obligatorio "Acompañamiento".
    select id into v_plato from productos where empresa_id = e.id and sku = 'MENU-HAMB';
    if v_plato is not null and exists (select 1 from recetas where producto_id = v_plato) then
      delete from recetas_items ri using productos i
       where ri.producto_id = v_plato and i.id = ri.insumo_id and i.sku = 'MP-PAPA';
      update productos set descripcion = 'Carne, queso, lechuga y tomate, con acompañamiento a elección.'
       where id = v_plato and descripcion ilike '%y papas fritas%';
      select id into v_g from plato_opcion_grupos where producto_id = v_plato and lower(nombre) = 'acompañamiento';
      if v_g is null then
        insert into plato_opcion_grupos (empresa_id, producto_id, nombre, obligatorio, minimo, maximo, orden)
          values (e.id, v_plato, 'Acompañamiento', true, 1, 1,
                  (select coalesce(max(orden), 0) + 1 from plato_opcion_grupos where producto_id = v_plato))
          returning id into v_g;
      end if;
      for x in select * from (values (1, 'Papas fritas'), (2, 'Aros de cebolla')) t(orden, nombre) loop
        if not exists (select 1 from plato_opciones where grupo_id = v_g and lower(nombre) = lower(x.nombre)) then
          insert into plato_opciones (empresa_id, grupo_id, nombre, precio, orden) values (e.id, v_g, x.nombre, 0, x.orden);
        end if;
      end loop;
    end if;

    -- Milanesa: la guarnición (papa y leche) sale de la base y pasa a las opciones de "Guarnición".
    select id into v_plato from productos where empresa_id = e.id and sku = 'MENU-MILA';
    if v_plato is not null and exists (select 1 from recetas where producto_id = v_plato) then
      delete from recetas_items ri using productos i
       where ri.producto_id = v_plato and i.id = ri.insumo_id and i.sku in ('MP-PAPA', 'MP-LECHE');
      if not exists (select 1 from recetas_items ri join productos i on i.id = ri.insumo_id
                      where ri.producto_id = v_plato and i.sku = 'MP-PAPA') then
        update productos set nombre = 'Milanesa con guarnición',
               descripcion = 'Milanesa de carne con guarnición a elección: puré o papas fritas.'
         where id = v_plato and nombre = 'Milanesa con puré';
      end if;
    end if;

    -- Ingredientes de las opciones (solo si la opción todavía no tiene ninguno).
    select coalesce(array_agg(o.id), '{}') into v_virgenes
      from plato_opciones o
     where o.empresa_id = e.id and not exists (select 1 from plato_opcion_items oi where oi.opcion_id = o.id);
    for x in select * from (values
        ('MENU-HAMB', 'Acompañamiento', 'Papas fritas',    'MP-PAPA',    200::numeric, 'g',  15::numeric, 1),
        ('MENU-HAMB', 'Acompañamiento', 'Papas fritas',    'MP-ACEITE',  20,           'ml', 0,           2),
        ('MENU-HAMB', 'Acompañamiento', 'Aros de cebolla', 'MP-CEBOLLA', 150,          'g',  10,          1),
        ('MENU-HAMB', 'Acompañamiento', 'Aros de cebolla', 'MP-REBOZ',   50,           'g',  0,           2),
        ('MENU-HAMB', 'Acompañamiento', 'Aros de cebolla', 'MP-ACEITE',  25,           'ml', 0,           3),
        ('MENU-MILA', 'Guarnición',     'Puré',            'MP-PAPA',    200,          'g',  15,          1),
        ('MENU-MILA', 'Guarnición',     'Puré',            'MP-LECHE',   50,           'ml', 0,           2),
        ('MENU-MILA', 'Guarnición',     'Puré',            'MP-ACEITE',  10,           'ml', 0,           3),
        ('MENU-MILA', 'Guarnición',     'Papas fritas',    'MP-PAPA',    200,          'g',  15,          1),
        ('MENU-MILA', 'Guarnición',     'Papas fritas',    'MP-ACEITE',  20,           'ml', 0,           2)
      ) t(plato, grupo, opcion, insumo, cantidad, unidad, merma, orden)
    loop
      select o.id into v_o
        from plato_opciones o join plato_opcion_grupos g on g.id = o.grupo_id join productos pl on pl.id = g.producto_id
       where pl.empresa_id = e.id and pl.sku = x.plato and lower(g.nombre) = lower(x.grupo) and lower(o.nombre) = lower(x.opcion);
      select id into v_ins from productos where empresa_id = e.id and sku = x.insumo;
      if v_o is null or v_ins is null then continue; end if;
      -- Una opción que ya tenía ingredientes (de una corrida anterior o cargados a mano) no se toca.
      if not (v_o = any (v_virgenes)) then continue; end if;
      insert into plato_opcion_items (empresa_id, opcion_id, insumo_id, cantidad, unidad, merma_pct, orden)
        values (e.id, v_o, v_ins, x.cantidad, x.unidad, x.merma, x.orden)
        on conflict (opcion_id, insumo_id) do nothing;
    end loop;

    -- Costo de la ficha = el de la receta base (sin opciones).
    update productos set costo_promedio = round(receta_costo(id))
     where empresa_id = e.id and sku in ('MENU-HAMB', 'MENU-MILA') and tiene_receta(id);
  end loop;
end;
$seed$;
\endif

-- =============================================================================
-- 7. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".opcion_insumos(uuid, numeric) from public, anon, authenticated;
revoke all on function :"schema".opcion_costo(uuid) from public, anon, authenticated;
revoke all on function :"schema".opcion_porciones(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".opcion_disponible(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".plato_costo_rango(uuid) from public, anon, authenticated;
revoke all on function :"schema".plato_insumos(uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function :"schema".plato_mods_catalogo(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".plato_mods_resolver(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function
  :"schema".opcion_insumos(uuid, numeric),
  :"schema".opcion_costo(uuid),
  :"schema".opcion_porciones(uuid, uuid, uuid, jsonb),
  :"schema".opcion_disponible(uuid, uuid, uuid, jsonb),
  :"schema".plato_costo_rango(uuid),
  :"schema".plato_insumos(uuid, numeric, jsonb),
  :"schema".plato_mods_catalogo(uuid, uuid, jsonb),
  :"schema".plato_mods_resolver(uuid, jsonb, boolean)
  to service_role;

commit;
