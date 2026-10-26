-- =============================================================================
-- MODIFICADORES DE LOS PLATOS (pedido del dueño, 26-oct-2026).
--
-- Tres tipos de modificador para los productos Menú:
--   1. QUITAR un ingrediente (gratis): recetas_items.se_puede_quitar. "Sin lechuga". Lo quitado
--      NO se descuenta del stock (si es una preparación, tampoco sus materias primas).
--   2. EXTRAS con precio: lista común (extras: nombre, ingrediente = materia prima o preparación,
--      cantidad + unidad, precio, activo) + activación por plato (plato_extras: precio propio
--      opcional y máximo por extra, default 3). Suman al precio y descuentan su stock.
--      MERMA DE LOS EXTRAS: NO se aplica. La cantidad del extra es lo que se descuenta tal cual
--      (bruto): "Extra carne = 150 g" descuenta 150 g. Si se quiere contar la merma, se carga la
--      cantidad bruta (ej. 167 g). Así el extra es el mismo en todos los platos que lo activan.
--      Si el ingrediente es una preparación, se explota en sus materias primas (con SU receta).
--   3. OPCIONES a elegir: grupos por plato (plato_opcion_grupos: obligatorio, mínimo, máximo) con
--      opciones (plato_opciones: precio extra opcional, 0 por defecto). PENDIENTE: una opción que
--      agregue o reemplace un ingrediente (por ahora las opciones solo cambian el precio).
--
-- Línea vendida / pedida: snapshot jsonb `modificadores`
--   { quitar: [{producto_id, nombre}], extras: [{extra_id, nombre, cantidad, precio}],
--     opciones: [{grupo_id, grupo, opcion_id, opcion, precio}] }
--   + `modificadores_texto` ("sin cebolla · + extra queso ×2 · a punto") + `precio_mods` (por unidad)
--   en mesa_pedido_items y ventas_items.
--
-- Entrada (caja / menú QR): cada ítem puede traer `mods`: { quitar: [producto_id], extras:
--   [{extra_id, cantidad}], opciones: [opcion_id] } (también se acepta el snapshot de arriba).
--   El SERVIDOR valida (que sean del plato, cantidades ≤ máximo, opciones obligatorias) y pone
--   los precios: plato_mods_resolver. Precio de la línea = precio base (con su descuento) +
--   extras + opciones. El descuento del producto NO se aplica a los modificadores.
--
-- Stock y costo: receta − quitados + extras (plato_insumos). necesidad_mods / stock_faltante /
--   mesa_reservas_json cuentan los extras; crear_venta descuenta y guarda en
--   ventas_items_insumos (anular_venta devuelve exactamente eso, sin cambios). CMV = costo real.
--
-- Mesas: el pedido guarda los modificadores por línea; misma combinación = misma línea. Al cobrar
--   desde la caja, el carrito tiene que traer cada producto + combinación (mesa_cuenta_cobrar_caja).
--   Las líneas viejas (sin modificadores) de cuentas abiertas se cobran igual aunque el plato
--   tenga ahora una opción obligatoria (GUC local erp.mods_sin_exigir).
--
-- Redefine desde su última versión vigente: crear_venta (72), stock_faltante (72),
-- mesa_reservas_json (72), mesa_menu_publico (72), mesa_pedido_publico_crear (72),
-- mesa_pedido_accion (72), productos_pos (72), receta_detalle / recetas_listar / receta_guardar
-- (72), mesa_pedido_json (70), mesas_tablero (70), mesa_cuenta_cobrar_caja (70),
-- mesas_por_cobrar (69), mesa_pedidos_publico_estado (69). Sin cambios de firma.
--
-- Semilla SOLO en erp_demo: extras comunes, Panceta (materia prima), cebolla en la Hamburguesa y
-- los modificadores de Hamburguesa, Lomito, Pizza y Milanesa.
--
-- IDEMPOTENTE. Va después de 72.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tablas y columnas
-- =============================================================================
alter table :"schema".recetas_items add column if not exists se_puede_quitar boolean not null default false;

create table if not exists :"schema".extras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  insumo_id uuid not null references :"schema".productos(id) on delete restrict,
  cantidad numeric not null,
  unidad text not null,
  precio numeric not null default 0,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_extras_nombre check (length(btrim(nombre)) between 1 and 60),
  constraint chk_extras_cantidad check (cantidad > 0 and cantidad <= 100000),
  constraint chk_extras_unidad check (unidad in ('Unidad', 'kg', 'g', 'l', 'ml')),
  constraint chk_extras_precio check (precio >= 0 and precio <= 100000000)
);
create unique index if not exists uq_extras_nombre on :"schema".extras (empresa_id, lower(btrim(nombre)));
create index if not exists extras_insumo_idx on :"schema".extras (insumo_id);

create table if not exists :"schema".plato_extras (
  producto_id uuid not null references :"schema".productos(id) on delete cascade,
  extra_id uuid not null references :"schema".extras(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  precio numeric,
  maximo integer not null default 3,
  orden integer not null default 0,
  primary key (producto_id, extra_id),
  constraint chk_plato_extras_precio check (precio is null or (precio >= 0 and precio <= 100000000)),
  constraint chk_plato_extras_maximo check (maximo between 1 and 20)
);
create index if not exists plato_extras_extra_idx on :"schema".plato_extras (extra_id);

create table if not exists :"schema".plato_opcion_grupos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null references :"schema".productos(id) on delete cascade,
  nombre text not null,
  obligatorio boolean not null default false,
  minimo integer not null default 0,
  maximo integer not null default 1,
  orden integer not null default 0,
  constraint chk_pog_nombre check (length(btrim(nombre)) between 1 and 60),
  constraint chk_pog_rango check (minimo >= 0 and maximo >= 1 and maximo <= 20 and minimo <= maximo)
);
create index if not exists plato_opcion_grupos_prod_idx on :"schema".plato_opcion_grupos (producto_id, orden);

create table if not exists :"schema".plato_opciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  grupo_id uuid not null references :"schema".plato_opcion_grupos(id) on delete cascade,
  nombre text not null,
  precio numeric not null default 0,
  activo boolean not null default true,
  orden integer not null default 0,
  constraint chk_po_nombre check (length(btrim(nombre)) between 1 and 60),
  constraint chk_po_precio check (precio >= 0 and precio <= 100000000)
);
create index if not exists plato_opciones_grupo_idx on :"schema".plato_opciones (grupo_id, orden);

-- Snapshot de modificadores en las líneas.
alter table :"schema".mesa_pedido_items add column if not exists modificadores jsonb;
alter table :"schema".mesa_pedido_items add column if not exists modificadores_texto text;
alter table :"schema".mesa_pedido_items add column if not exists precio_mods numeric not null default 0;
alter table :"schema".ventas_items add column if not exists modificadores jsonb;
alter table :"schema".ventas_items add column if not exists modificadores_texto text;
alter table :"schema".ventas_items add column if not exists precio_mods numeric not null default 0;

alter table :"schema".extras enable row level security;
alter table :"schema".extras force row level security;
alter table :"schema".plato_extras enable row level security;
alter table :"schema".plato_extras force row level security;
alter table :"schema".plato_opcion_grupos enable row level security;
alter table :"schema".plato_opcion_grupos force row level security;
alter table :"schema".plato_opciones enable row level security;
alter table :"schema".plato_opciones force row level security;

drop policy if exists extras_propios on :"schema".extras;
create policy extras_propios on :"schema".extras for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists plato_extras_propios on :"schema".plato_extras;
create policy plato_extras_propios on :"schema".plato_extras for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists plato_opcion_grupos_propios on :"schema".plato_opcion_grupos;
create policy plato_opcion_grupos_propios on :"schema".plato_opcion_grupos for select to authenticated using (empresa_id = :"schema".empresa_actual());
drop policy if exists plato_opciones_propias on :"schema".plato_opciones;
create policy plato_opciones_propias on :"schema".plato_opciones for select to authenticated using (empresa_id = :"schema".empresa_actual());

revoke all on :"schema".extras, :"schema".plato_extras, :"schema".plato_opcion_grupos, :"schema".plato_opciones from anon, authenticated;
grant select on :"schema".extras, :"schema".plato_extras, :"schema".plato_opcion_grupos, :"schema".plato_opciones to authenticated;
grant all on :"schema".extras, :"schema".plato_extras, :"schema".plato_opcion_grupos, :"schema".plato_opciones to service_role;

-- =============================================================================
-- 2. Helpers de modificadores (internos)
-- =============================================================================

-- Ingredientes a quitar: ["uuid", …] o [{producto_id}, …].
create or replace function :"schema".mods_quitar_ids(p jsonb)
returns uuid[] language sql immutable set search_path = :"schema", public as $$
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) from (
    select nullif(coalesce(q->>'producto_id', case when jsonb_typeof(q) = 'string' then q #>> '{}' end), '')::uuid as id
      from jsonb_array_elements(case when jsonb_typeof(p->'quitar') = 'array' then p->'quitar' else '[]'::jsonb end) q
  ) x where x.id is not null
$$;

-- Opciones elegidas: ["uuid", …] o [{opcion_id}, …].
create or replace function :"schema".mods_opcion_ids(p jsonb)
returns uuid[] language sql immutable set search_path = :"schema", public as $$
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) from (
    select nullif(coalesce(q->>'opcion_id', case when jsonb_typeof(q) = 'string' then q #>> '{}' end), '')::uuid as id
      from jsonb_array_elements(case when jsonb_typeof(p->'opciones') = 'array' then p->'opciones' else '[]'::jsonb end) q
  ) x where x.id is not null
$$;

-- Extras: [{extra_id, cantidad}] (cantidad por plato, default 1).
create or replace function :"schema".mods_extras_lista(p jsonb)
returns table (extra_id uuid, cantidad numeric) language sql immutable set search_path = :"schema", public as $$
  select (x->>'extra_id')::uuid, coalesce(nullif(x->>'cantidad', '')::numeric, 1)
    from jsonb_array_elements(case when jsonb_typeof(p->'extras') = 'array' then p->'extras' else '[]'::jsonb end) x
   where jsonb_typeof(x) = 'object' and nullif(x->>'extra_id', '') is not null
$$;

-- Clave canónica de una combinación ('' = sin modificadores). Sirve para agrupar líneas.
create or replace function :"schema".mods_clave(p jsonb)
returns text language sql immutable set search_path = :"schema", public as $$
  select case when t.q = '' and t.e = '' and t.o = '' then '' else 'q:' || t.q || '|e:' || t.e || '|o:' || t.o end
    from (select
      coalesce((select string_agg(i::text, ',' order by i::text) from unnest(mods_quitar_ids(p)) i), '') as q,
      coalesce((select string_agg(x.extra_id::text || '*' || trim_scale(x.cantidad)::text, ',' order by x.extra_id::text)
                  from mods_extras_lista(p) x where x.cantidad > 0), '') as e,
      coalesce((select string_agg(i::text, ',' order by i::text) from unnest(mods_opcion_ids(p)) i), '') as o) t
$$;

-- Receta explotada SIN los ingredientes directos quitados (igual que receta_insumos de la 72).
create or replace function :"schema".receta_insumos_sin(p_producto uuid, p_cantidad numeric, p_quitar uuid[])
returns table (insumo_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
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

-- Materias primas de p_cantidad unidades de un extra (sin merma; una preparación se explota).
create or replace function :"schema".extra_insumos(p_extra uuid, p_cantidad numeric)
returns table (insumo_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
  with e as (
    select x.insumo_id as ins, p_cantidad * unidad_convertir(x.cantidad, x.unidad, i.unidad_medida) as cant
      from extras x join productos i on i.id = x.insumo_id
     where x.id = p_extra
  )
  select r.insumo_id, r.cantidad from e cross join lateral receta_insumos(e.ins, e.cant) r where tiene_receta(e.ins)
  union all
  select e.ins, round(e.cant, 4) from e where not tiene_receta(e.ins) and round(e.cant, 4) > 0
$$;

-- Materias primas de p_cantidad platos con sus modificadores: receta − quitados + extras.
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
    ) t
   group by t.insumo_id
  having round(sum(t.cantidad), 4) > 0
$$;

-- necesidad_stock (72) con modificadores: lo que consume del stock (solo lo que controla stock).
create or replace function :"schema".necesidad_mods(p_producto uuid, p_cantidad numeric, p_mods jsonb)
returns table (producto_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select r.insumo_id, r.cantidad
    from plato_insumos(p_producto, p_cantidad, p_mods) r join productos i on i.id = r.insumo_id
   where i.controla_stock and tiene_receta(p_producto)
  union all
  select p.id, p_cantidad from productos p
   where p.id = p_producto and p.controla_stock and not tiene_receta(p.id)
$$;

-- Unidades de un extra que alcanzan para UN plato (stock libre − lo reservado − el plato base).
-- 999 = el extra no consume nada con control de stock.
create or replace function :"schema".extra_disponible(p_producto uuid, p_extra uuid, p_deposito uuid, p_reserva jsonb default '{}'::jsonb)
returns integer language sql stable security definer set search_path = :"schema", public as $$
  select greatest(0, coalesce(floor(min(
           (coalesce(sd.cantidad, 0) - coalesce((coalesce(p_reserva, '{}'::jsonb) ->> n.insumo_id::text)::numeric, 0) - coalesce(b.cantidad, 0))
           / n.cantidad)), 999))::integer
    from extra_insumos(p_extra, 1) n
    join productos i on i.id = n.insumo_id and i.controla_stock
    left join stock_depositos sd on sd.producto_id = n.insumo_id and sd.deposito_id = p_deposito
    left join necesidad_stock(p_producto, 1) b on b.producto_id = n.insumo_id
   where n.cantidad > 0
$$;

-- ¿El plato tiene algún modificador configurado?
create or replace function :"schema".plato_tiene_mods(p_producto uuid)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select exists (select 1 from recetas_items where producto_id = p_producto and se_puede_quitar)
      or exists (select 1 from plato_extras pe join extras x on x.id = pe.extra_id and x.activo where pe.producto_id = p_producto)
      or exists (select 1 from plato_opcion_grupos g join plato_opciones o on o.grupo_id = g.id and o.activo where g.producto_id = p_producto)
$$;

-- Catálogo de modificadores de un plato (menú QR y caja). null = no tiene.
--   { quitar: [{producto_id, nombre}], extras: [{extra_id, nombre, precio, maximo, disponible}],
--     grupos: [{id, nombre, obligatorio, minimo, maximo, opciones: [{id, nombre, precio}]}] }
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
           'opciones', (select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'precio', o.precio) order by o.orden, o.nombre)
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
begin
  select nombre into v_nombre from productos where id = p_producto;
  if p_mods is not null and jsonb_typeof(p_mods) not in ('object', 'null') then
    raise exception 'Modificadores inválidos en "%"', v_nombre;
  end if;
  begin
    v_q := mods_quitar_ids(p_mods);
    v_o := mods_opcion_ids(p_mods);
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
    if p_exigir and r.obligatorio and r.n < greatest(r.minimo, 1) then
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
-- 3. Disponibilidad con modificadores (redefinidas desde la 72)
-- =============================================================================
create or replace function :"schema".mesa_reservas_json(p_sucursal uuid, p_excluir_pedido uuid default null)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(jsonb_object_agg(x.producto_id::text, x.cant), '{}'::jsonb)
    from (
      select n.producto_id, sum(n.cantidad) as cant
        from mesa_pedido_items i
        join mesa_pedidos p on p.id = i.pedido_id
        join mesa_cuentas c on c.id = p.cuenta_id
        join mesas m on m.id = p.mesa_id
        cross join lateral necesidad_mods(i.producto_id, i.cantidad, i.modificadores) n  -- 73
       where c.estado = 'abierta' and p.estado not in ('nuevo', 'rechazado')
         and m.sucursal_id = p_sucursal and p.id is distinct from p_excluir_pedido
         and i.producto_id is not null
       group by n.producto_id
    ) x
$$;

-- p_items: [{producto_id, cantidad, mods?}] (73: mods = entrada o snapshot de modificadores).
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
        cross join lateral necesidad_mods(pp.id, (e->>'cantidad')::numeric, e->'mods') n  -- 73
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
-- 4. Lista común de extras (Inventario › Recetas › Extras)
-- =============================================================================
create or replace function :"schema".extras_listar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_dep uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  if not (tiene_permiso('ver_costos') or tiene_permiso('editar_productos')) then perform exigir_permiso('ver_costos'); end if;
  v_dep := deposito_por_defecto(s.s_empresa, s.s_sucursal);
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'nombre', x.nombre, 'insumo_id', i.id, 'insumo_nombre', i.nombre, 'insumo_sku', i.sku,
      'unidad_insumo', i.unidad_medida, 'es_preparacion', tiene_receta(i.id), 'cantidad', x.cantidad, 'unidad', x.unidad,
      'precio', x.precio, 'activo', x.activo, 'insumo_activo', i.activo,
      'costo', coalesce((select round(sum(n.cantidad * coalesce(pi.costo_promedio, 0)), 2)
                           from extra_insumos(x.id, 1) n join productos pi on pi.id = n.insumo_id), 0),
      'alcanza', (select floor(min(coalesce(sd.cantidad, 0) / n.cantidad))
                    from extra_insumos(x.id, 1) n join productos pi on pi.id = n.insumo_id and pi.controla_stock
                    left join stock_depositos sd on sd.producto_id = n.insumo_id and sd.deposito_id = v_dep
                   where n.cantidad > 0),
      'platos', (select count(*) from plato_extras pe where pe.extra_id = x.id))
      order by x.orden, x.nombre)
    from extras x join productos i on i.id = x.insumo_id
   where x.empresa_id = s.s_empresa), '[]'::jsonb));
end;
$fn$;

-- p = { id?, nombre, insumo_id, cantidad, unidad, precio, activo }
create or replace function :"schema".extra_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ins productos;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text := btrim(coalesce(p->>'nombre', ''));
  v_cant numeric := nullif(p->>'cantidad', '')::numeric;
  v_unidad text;
  v_precio numeric := coalesce(nullif(p->>'precio', '')::numeric, 0);
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('editar_productos');
  if length(v_nombre) < 1 or length(v_nombre) > 60 then raise exception 'Escribí el nombre del extra (hasta 60 letras)'; end if;
  select * into ins from productos where id = nullif(p->>'insumo_id', '')::uuid and empresa_id = s.s_empresa;
  if not found then raise exception 'Elegí el ingrediente del extra'; end if;
  if ins.tipo_producto <> 'materia_prima' then
    raise exception '"%" no es materia prima: un extra lleva una materia prima o una preparación', ins.nombre;
  end if;
  if v_cant is null or v_cant <= 0 or v_cant > 100000 then raise exception 'Cargá la cantidad del extra'; end if;
  v_unidad := coalesce(unidad_normal(nullif(p->>'unidad', '')), ins.unidad_medida);
  if unidad_dim(v_unidad) is distinct from unidad_dim(ins.unidad_medida) then
    raise exception '"%" se mide en %: no se puede cargar en %', ins.nombre, ins.unidad_medida, v_unidad;
  end if;
  if v_precio < 0 or v_precio > 100000000 then raise exception 'El precio del extra no es válido'; end if;
  if exists (select 1 from extras where empresa_id = s.s_empresa and lower(btrim(nombre)) = lower(v_nombre) and id is distinct from v_id) then
    raise exception 'Ya hay un extra "%"', v_nombre;
  end if;
  if v_id is null then
    insert into extras (empresa_id, nombre, insumo_id, cantidad, unidad, precio, activo, orden)
      values (s.s_empresa, v_nombre, ins.id, v_cant, v_unidad, round(v_precio), v_activo,
              (select coalesce(max(orden), 0) + 1 from extras where empresa_id = s.s_empresa))
      returning id into v_id;
  else
    update extras set nombre = v_nombre, insumo_id = ins.id, cantidad = v_cant, unidad = v_unidad, precio = round(v_precio),
           activo = v_activo, updated_at = now()
     where id = v_id and empresa_id = s.s_empresa;
    if not found then raise exception 'Extra no encontrado'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$fn$;

create or replace function :"schema".extra_eliminar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  n integer;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('editar_productos');
  select count(*) into n from plato_extras where extra_id = p_id;
  delete from extras where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Extra no encontrado'; end if;
  return jsonb_build_object('id', p_id, 'platos', n);
end;
$fn$;

-- =============================================================================
-- 5. API de recetas (redefinidas desde la 72): quitar, extras y opciones del plato
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
        'opciones', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'precio', o.precio, 'activo', o.activo)
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
           case when b.con_receta then plato_porciones(b.id, v_dep) end as porciones,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from necesidad_stock(b.id, 1) n join productos i on i.id = n.producto_id
              left join stock_depositos sd on sd.producto_id = n.producto_id and sd.deposito_id = v_dep
             where b.con_receta and coalesce(sd.cantidad, 0) < n.cantidad) as faltan,
           (select string_agg(i.nombre, ', ' order by i.nombre)
              from receta_insumos(b.id, 1) n join productos i on i.id = n.insumo_id
             where b.con_receta and not i.activo) as inactivos,
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
      'faltan', coalesce(c.inactivos, c.faltan),
      'modificadores', c.modificadores,
      'estado', case when not c.con_receta then 'sin_receta'
                     when c.inactivos is not null or c.faltan is not null then 'faltante'
                     else 'completa' end)
      order by (c.tipo_producto <> 'menu'), c.nombre), '[]'::jsonb))
    into r
    from calc c;
  return r;
end;
$fn$;

-- p = { producto_id, rendimiento, notas, items: [{ insumo_id, cantidad, unidad, merma_pct, se_puede_quitar }],
--       extras?: [{ extra_id, precio (null = el de la lista), maximo }],
--       grupos?: [{ id?, nombre, obligatorio, minimo, maximo, opciones: [{ id?, nombre, precio, activo }] }] }
-- items vacío = quitar la receta. Sin "extras" / "grupos" en p: no se tocan (73).
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
  select max(receta_profundidad(a.pid)) into v_prof from (
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
-- 6. Caja: catálogo con los modificadores de cada plato (redefinida desde la 72)
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
  -- 73: `mods` = sus modificadores (quitar / extras con lo que alcanza / opciones), null si no tiene.
  select coalesce(json_agg(r), '[]'::json) into v_prod from (
    select p.id, p.nombre, p.sku, p.codigo_barras, p.precio_venta, p.precio_mayorista, p.precio_distribuidor,
           p.descuento_pct,
           case when p.tipo_producto = 'menu' then coalesce(pp.porciones, 0) else coalesce(sd.cantidad, 0) end as stock_actual,
           case when p.tipo_producto = 'menu' then coalesce(pp.porciones, 0) else p.stock_actual end as stock_total,
           p.unidad_medida, p.tipo_iva,
           case when p.tipo_producto = 'menu' then pp.porciones is not null else p.controla_stock end as controla_stock,
           p.imagen_url, p.tipo_producto,
           (p.tipo_producto = 'menu' and not tiene_receta(p.id)) as sin_receta,
           case when p.tipo_producto = 'menu' then plato_mods_catalogo(p.id, v_dep) end as mods
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
-- 7. crear_venta (redefinida desde la 72): modificadores por línea
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
  -- 73: modificadores.
  v_mods jsonb;
  v_snap jsonb;
  v_pmods numeric;
  v_sin_exigir text[] := string_to_array(nullif(current_setting('erp.mods_sin_exigir', true), ''), ',');
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

    -- 73: modificadores (los valida y les pone precio el servidor). Las líneas viejas de una
    -- cuenta de mesa (sin modificadores) no exigen las opciones obligatorias.
    v_mods := plato_mods_resolver(prod.id, it->'mods',
                not (coalesce(jsonb_typeof(it->'mods'), 'null') = 'null' and prod.id::text = any (coalesce(v_sin_exigir, '{}'))));
    v_snap := v_mods->'mods';
    if jsonb_typeof(v_snap) = 'null' then v_snap := null; end if;
    v_pmods := coalesce((v_mods->>'precio')::numeric, 0);
    if v_snap is not null and not v_receta then
      raise exception '"%" no lleva modificadores', prod.nombre;
    end if;

    v_costo_rec := null;
    if v_receta then
      v_msg := stock_faltante(v_dep, jsonb_build_array(jsonb_build_object('producto_id', prod.id, 'cantidad', v_cant, 'mods', v_snap)));
      if v_msg is not null then raise exception '%', v_msg; end if;
      select coalesce(sum(r.cantidad * coalesce(i.costo_promedio, 0)), 0) into v_costo_rec
        from plato_insumos(prod.id, v_cant, v_snap) r join productos i on i.id = r.insumo_id;
    end if;

    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then coalesce(round(v_costo_rec / v_cant), prod.costo_promedio)
                  else prod.precio_venta end;
    -- 73: precio_unitario manual = el del plato SIN modificadores (los modificadores se suman siempre).
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
    -- 73: + extras y opciones (sin el descuento del producto; el descuento global sí).
    v_precio := v_precio + round(v_pmods * v_factor);

    v_total_linea := round(v_cant * v_precio);
    v_iva_tipo := coalesce(nullif(it->>'tipo_iva', ''), prod.tipo_iva);
    v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
    v_iva := case when v_tasa = 0 then 0 else round(v_total_linea * v_tasa / (100 + v_tasa)) end;
    v_sub := v_total_linea - v_iva;

    insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
                             precio_venta_original, precio_venta, tipo_precio, tipo_iva,
                             subtotal, monto_iva, total_linea, costo_unitario,
                             modificadores, modificadores_texto, precio_mods)
      values (v_empresa, v_venta, prod.id, prod.nombre, prod.sku, v_cant,
              v_precio_lista, v_precio, coalesce(it->>'tipo_precio', 'minorista'), v_iva_tipo,
              v_sub, v_iva, v_total_linea,
              case when v_receta then round(v_costo_rec / v_cant, 4) else prod.costo_promedio end,
              v_snap, v_mods->>'texto', v_pmods)
      returning id into v_item;

    if v_receta then
      -- 72: descuenta las materias primas explotadas (con merma) del depósito de la caja.
      -- 73: sin lo quitado y con los extras.
      for ins in
        select r.insumo_id, r.cantidad, coalesce(i.costo_promedio, 0) as costo, i.controla_stock, i.controla_lotes
          from plato_insumos(prod.id, v_cant, v_snap) r join productos i on i.id = r.insumo_id
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
      -- El costo del plato en la ficha sigue al de su receta (73: el de la receta sola).
      if v_snap is null then
        update productos set costo_promedio = round(v_costo_rec / v_cant)
         where id = prod.id and costo_promedio is distinct from round(v_costo_rec / v_cant);
      end if;
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
-- 8. Menú QR (redefinidas desde la 72): modificadores del plato y del pedido
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
        'categoria', coalesce(cp.nombre, 'Otros'),
        -- 73: quitar / extras (con lo que alcanza) / opciones. null = se agrega directo.
        'mods', case when p.tipo_producto = 'menu' then plato_mods_catalogo(p.id, v_dep, v_res) end)
        order by coalesce(cp.nombre, 'zzz'), p.nombre)
      from productos p left join categorias_productos cp on cp.id = p.categoria_principal_id
      where p.empresa_id = m.empresa_id and p.en_menu_qr and p.activo and coalesce(p.es_vendible, true)
        and p.tipo_producto <> 'materia_prima'
        and coalesce(p.precio_venta, 0) > 0
        and not (coalesce(p.controla_stock, false) and coalesce(p.stock_actual, 0) <= 0)
        and (not (p.tipo_producto = 'menu' or tiene_receta(p.id)) or coalesce(plato_porciones(p.id, v_dep, v_res), 1) >= 1)), '[]'::jsonb));
end;
$function$;

-- p_items: [{producto_id, cantidad, nota?, mods?}]. El mismo plato puede venir en varias líneas
-- si cambia la combinación de modificadores.
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
  v_claves text[] := '{}';
  v_clave text;
  v_pid uuid;
  v_dep uuid;
  v_res jsonb;
  v_mods jsonb;
  v_snap jsonb;
  v_stock jsonb := '[]'::jsonb;
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
    begin
      v_cant := (it->>'cantidad')::numeric;
    exception when others then
      raise exception 'Cantidad inválida';
    end;
    if v_cant is null or v_cant <> trunc(v_cant) or v_cant < 1 or v_cant > 50 then
      raise exception 'La cantidad de cada producto va de 1 a 50';
    end if;
    select p.id, p.nombre, p.precio_venta, p.descuento_pct, p.tipo_producto, tiene_receta(p.id) as con_receta into prod
      from productos p
     where p.id = v_pid and p.empresa_id = m.empresa_id and p.en_menu_qr and p.activo and coalesce(p.es_vendible, true)
       and p.tipo_producto <> 'materia_prima'
       and coalesce(p.precio_venta, 0) > 0
       and not (coalesce(p.controla_stock, false) and coalesce(p.stock_actual, 0) <= 0)
       and (not (p.tipo_producto = 'menu' or tiene_receta(p.id)) or coalesce(plato_porciones(p.id, v_dep, v_res), v_cant) >= v_cant);
    if not found then raise exception 'Un producto del pedido ya no está disponible: actualizá el menú'; end if;
    -- 73: modificadores validados y con precio del servidor.
    v_mods := plato_mods_resolver(prod.id, it->'mods', true);
    v_snap := v_mods->'mods';
    if jsonb_typeof(v_snap) = 'null' then v_snap := null; end if;
    v_clave := prod.id::text || '#' || coalesce(v_mods->>'clave', '');
    if v_clave = any (v_claves) then raise exception 'Hay un producto repetido en el pedido'; end if;
    v_claves := v_claves || v_clave;
    v_precio := mesa_precio(prod.precio_venta, prod.descuento_pct) + coalesce((v_mods->>'precio')::numeric, 0);
    v_item_nota := left(nullif(btrim(coalesce(it->>'nota', '')), ''), 200);
    insert into mesa_pedido_items (empresa_id, pedido_id, producto_id, producto_nombre, cantidad, precio_unitario, total, nota,
                                   modificadores, modificadores_texto, precio_mods)
      values (m.empresa_id, v_ped.id, prod.id, prod.nombre, v_cant, v_precio, round(v_cant * v_precio), v_item_nota,
              v_snap, v_mods->>'texto', coalesce((v_mods->>'precio')::numeric, 0));
    v_total := v_total + round(v_cant * v_precio);
    if prod.con_receta then
      v_stock := v_stock || jsonb_build_array(jsonb_build_object('producto_id', prod.id, 'cantidad', v_cant, 'mods', v_snap));
    end if;
  end loop;

  -- 73: todo el pedido junto (mismo ingrediente en varios platos, extras) tiene que alcanzar.
  if jsonb_array_length(v_stock) > 0 and stock_faltante(v_dep, v_stock, v_res) is not null then
    raise exception 'No alcanza el stock para todo tu pedido: probá con menos unidades o sin algún extra';
  end if;

  update mesa_pedidos set total = v_total where id = v_ped.id;
  return jsonb_build_object('seguimiento', v_ped.seguimiento, 'numero', v_ped.numero, 'estado', 'nuevo', 'total', v_total);
end;
$function$;

-- Estado de los pedidos en el celular del cliente (69 + el resumen de modificadores).
CREATE OR REPLACE FUNCTION :"schema".mesa_pedidos_publico_estado(p_token text, p_seguimientos text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO :"schema", 'public'
AS $function$
declare
  v_mesa uuid;
  v_segs text[];
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return '[]'::jsonb; end if;
  select id into v_mesa from mesas where token = p_token;
  if v_mesa is null then return '[]'::jsonb; end if;
  select coalesce(array_agg(x), '{}') into v_segs
    from (select distinct x from unnest(coalesce(p_seguimientos, '{}')) x where x ~ '^[0-9a-f]{32}$' limit 20) t;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'seguimiento', p.seguimiento, 'numero', p.numero, 'estado', p.estado, 'motivo_rechazo', p.motivo_rechazo,
      'total', p.total, 'creado_at', p.creado_at, 'cuenta_cerrada', c.estado <> 'abierta',
      'cuenta_en_caja', c.estado = 'abierta' and c.en_caja_at is not null,
      'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', i.producto_nombre, 'cantidad', i.cantidad, 'total', i.total,
                                                             'modificadores_texto', i.modificadores_texto)
                          order by i.producto_nombre, i.id) from mesa_pedido_items i where i.pedido_id = p.id), '[]'::jsonb))
      order by p.creado_at desc)
    from mesa_pedidos p join mesa_cuentas c on c.id = p.cuenta_id
    where p.mesa_id = v_mesa and p.seguimiento = any (v_segs) and p.creado_at > now() - interval '12 hours'), '[]'::jsonb);
end;
$function$;

-- =============================================================================
-- 9. Pedidos de mesas, tablero y cobro (redefinidas desde 70 / 72 / 69)
-- =============================================================================
create or replace function :"schema".mesa_pedido_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'estado', p.estado, 'cuenta_id', p.cuenta_id,
    'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
    'sucursal', jsonb_build_object('id', s.id, 'nombre', s.nombre),
    'nombre_cliente', p.nombre_cliente, 'nota', p.nota, 'total', p.total,
    'creado_at', p.creado_at, 'aceptado_at', p.aceptado_at, 'aceptado_por_nombre', p.aceptado_por_nombre,
    'rechazado_at', p.rechazado_at, 'motivo_rechazo', p.motivo_rechazo,
    'preparando_at', p.preparando_at, 'listo_at', p.listo_at, 'entregado_at', p.entregado_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'nombre', i.producto_nombre, 'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
        'total', i.total, 'nota', i.nota, 'estacion_id', i.estacion_id,
        'modificadores', i.modificadores, 'modificadores_texto', i.modificadores_texto) order by i.producto_nombre, i.id)  -- 73
      from mesa_pedido_items i where i.pedido_id = p.id), '[]'::jsonb),
    'comandas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'estacion_id', k.estacion_id, 'estacion_nombre', coalesce(e.nombre, k.estacion_nombre),
        'color', e.color, 'icono', e.icono, 'estado', k.estado, 'creado_at', k.creado_at,
        'preparando_at', k.preparando_at, 'listo_at', k.listo_at, 'entregado_at', k.entregado_at,
        'impresa_at', k.impresa_at)
        order by (k.estacion_id is null), e.orden, coalesce(e.nombre, k.estacion_nombre))
      from mesa_comandas k left join estaciones_cocina e on e.id = k.estacion_id
      where k.pedido_id = p.id), '[]'::jsonb))
  from mesa_pedidos p
  join mesas m on m.id = p.mesa_id
  join sucursales s on s.id = m.sucursal_id
  where p.id = p_id
$$;

create or replace function :"schema".mesas_tablero()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from mesa_sesion();
  if not (tiene_permiso('pedidos_mesas') or tiene_permiso('cocina')) then
    raise exception 'Tu perfil no tiene permiso para: atender pedidos de mesas' using errcode = '42501', hint = 'permiso:pedidos_mesas';
  end if;
  return jsonb_build_object(
    'ahora', now(),
    'pedidos', coalesce((select jsonb_agg(mesa_pedido_json(p.id) order by p.creado_at, p.numero)
      from mesa_pedidos p join mesas m on m.id = p.mesa_id
      where p.empresa_id = s.s_empresa
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)
        and (p.estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')
             or coalesce(p.entregado_at, p.rechazado_at, p.updated_at) > now() - interval '1 hour')), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'abierta_at', c.abierta_at,
        'estado', case when c.en_caja_at is not null then 'en_caja' else 'abierta' end,
        'en_caja_at', c.en_caja_at, 'en_caja_por_nombre', c.en_caja_por_nombre,
        'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
        'sucursal', jsonb_build_object('id', su.id, 'nombre', su.nombre),
        'total', coalesce((select sum(p.total) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), 0),
        'pedidos', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')),
        'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
        'items', coalesce((select jsonb_agg(x order by x->>'nombre', x->>'modificadores_texto' nulls first) from (
            select jsonb_build_object('nombre', i.producto_nombre, 'cantidad', sum(i.cantidad), 'precio_unitario', i.precio_unitario,
                                      'total', sum(i.total), 'modificadores_texto', i.modificadores_texto) as x  -- 73
              from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
             where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
             group by i.producto_nombre, i.precio_unitario, i.modificadores_texto) t), '[]'::jsonb))
        order by m.orden, m.nombre)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id join sucursales su on su.id = m.sucursal_id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta'
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)), '[]'::jsonb),
    'estaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nombre', e.nombre, 'color', e.color, 'icono', e.icono, 'orden', e.orden, 'activa', e.activa)
        order by e.orden, e.nombre)
      from estaciones_cocina e where e.empresa_id = s.s_empresa), '[]'::jsonb),
    'mi_estacion_id', (select u.estacion_cocina_id from usuarios u where u.id = s.s_usuario),
    'puede_atender', tiene_permiso('pedidos_mesas'),
    'puede_cocina', tiene_permiso('cocina'));
end;
$fn$;

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
    -- 73: con los modificadores de cada línea (sin lo quitado, con los extras).
    perform pg_advisory_xact_lock(hashtext('mesas_stock_' || v_suc::text));
    v_msg := stock_faltante(
      deposito_por_defecto(s.s_empresa, v_suc),
      (select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad, 'mods', i.modificadores)), '[]'::jsonb)
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

-- Caja › Nueva venta: mesas por cobrar (69 + modificadores: una línea por producto y combinación).
create or replace function :"schema".mesas_por_cobrar(p_caja_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja uuid;
  v_suc uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  begin
    v_caja := caja_abierta_para(null, null, p_caja_id);
  exception when others then
    v_caja := null;
  end;
  if v_caja is null then return jsonb_build_object('ahora', now(), 'cuentas', '[]'::jsonb); end if;
  select sucursal_id into v_suc from cajas where id = v_caja;
  return jsonb_build_object(
    'ahora', now(),
    'caja_id', v_caja,
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'abierta_at', c.abierta_at, 'en_caja_at', c.en_caja_at, 'en_caja_por_nombre', c.en_caja_por_nombre,
        'version', mesa_cuenta_version(c.id),
        'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
        'total', coalesce((select sum(p.total) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), 0),
        'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
        'items', coalesce((select jsonb_agg(x order by x->>'nombre', x->>'modificadores_texto' nulls first) from (
            select jsonb_build_object('producto_id', i.producto_id, 'nombre', i.producto_nombre, 'cantidad', sum(i.cantidad),
                                      'precio_unitario', i.precio_unitario, 'total', sum(i.total),
                                      -- 73: modificadores de la línea; precio_base = sin modificadores
                                      'modificadores', i.modificadores, 'modificadores_texto', i.modificadores_texto,
                                      'precio_mods', i.precio_mods, 'precio_base', i.precio_unitario - i.precio_mods,
                                      -- true = el precio base del pedido es el de hoy (lista con el descuento del producto)
                                      'precio_de_hoy', bool_and(pr.id is not null and mesa_precio(pr.precio_venta, pr.descuento_pct) = i.precio_unitario - i.precio_mods)) as x
              from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
              left join productos pr on pr.id = i.producto_id
             where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
             group by i.producto_id, i.producto_nombre, i.precio_unitario, i.modificadores, i.modificadores_texto, i.precio_mods) t), '[]'::jsonb))
        order by c.en_caja_at)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta' and c.en_caja_at is not null
        and m.sucursal_id = v_suc), '[]'::jsonb));
end;
$fn$;

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
  perform set_config('erp.mods_sin_exigir', coalesce(v_viejas, ''), true);

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Cuenta de mesa: ' || m.nombre || coalesce(' · ' || m.zona, ''), 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);
  perform set_config('erp.mods_sin_exigir', '', true);

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
-- 10. Semilla (solo erp_demo): extras, Panceta y modificadores de los platos
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
  v_ins uuid;
  v_g uuid;
begin
  for e in select id from empresas loop
    -- Panceta (materia prima con stock en los depósitos principales).
    select id into v_id from productos where empresa_id = e.id and sku = 'MP-PANCETA';
    if v_id is null then
      select id into v_cat from categorias_productos where empresa_id = e.id and lower(btrim(nombre)) = 'insumos';
      insert into productos (empresa_id, nombre, sku, costo_promedio, precio_venta, unidad_medida, tipo_producto,
                             controla_stock, es_vendible, categoria_principal_id, tipo_iva, stock_minimo)
        values (e.id, 'Panceta', 'MP-PANCETA', 60000, 0, 'kg', 'materia_prima', true, false, v_cat, '10%', 0.6)
        returning id into v_id;
      for d in select dp.id from depositos dp join sucursales su on su.id = dp.sucursal_id
                where dp.empresa_id = e.id and dp.activo and su.activa and dp.es_principal loop
        perform inv_mover(e.id, v_id, d.id, 3, 60000, 'inventario_inicial', null, null, null,
                          'Stock inicial de demo (receta 73)', null, 'Sistema');
      end loop;
    end if;

    -- La Hamburguesa lleva cebolla (para poder pedirla "sin cebolla").
    select id into v_plato from productos where empresa_id = e.id and sku = 'MENU-HAMB';
    select id into v_ins from productos where empresa_id = e.id and sku = 'MP-CEBOLLA';
    if v_plato is not null and v_ins is not null and exists (select 1 from recetas where producto_id = v_plato) then
      insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden)
        values (e.id, v_plato, v_ins, 20, 'g', 15, (select count(*) + 1 from recetas_items z where z.producto_id = v_plato))
        on conflict (producto_id, insumo_id) do nothing;
      update productos set costo_promedio = round(receta_costo(id)) where id = v_plato;
    end if;

    -- Lista común de extras: nombre, ingrediente, cantidad, unidad, precio.
    for x in select * from (values
        (1, 'Extra queso',      'MP-QUESO',   1::numeric, 'Unidad', 5000),
        (2, 'Extra carne',      'MP-CARMOL',  150,  'g', 12000),
        (3, 'Huevo frito',      'MP-HUEVO',   1,    'Unidad', 3000),
        (4, 'Panceta',          'MP-PANCETA', 40,   'g', 6000),
        (5, 'Extra muzzarella', 'MP-MUZZA',   100,  'g', 8000)
      ) t(orden, nombre, insumo, cantidad, unidad, precio)
    loop
      select id into v_ins from productos where empresa_id = e.id and sku = x.insumo;
      if v_ins is null then continue; end if;
      if exists (select 1 from extras where empresa_id = e.id and lower(btrim(nombre)) = lower(x.nombre)) then continue; end if;
      insert into extras (empresa_id, nombre, insumo_id, cantidad, unidad, precio, orden)
        values (e.id, x.nombre, v_ins, x.cantidad, x.unidad, x.precio, x.orden);
    end loop;

    -- Ingredientes que se pueden quitar.
    update recetas_items ri set se_puede_quitar = true
      from productos pl, productos i
     where pl.id = ri.producto_id and i.id = ri.insumo_id and pl.empresa_id = e.id and not ri.se_puede_quitar
       and ((pl.sku = 'MENU-HAMB' and i.sku in ('MP-LECHUGA', 'MP-TOMATE', 'MP-CEBOLLA', 'MP-SALSA'))
         or (pl.sku = 'MENU-LOMI' and i.sku in ('MP-LECHUGA', 'MP-TOMATE', 'MP-SALSA')));

    -- Extras activados por plato (precio de la lista, hasta 3).
    for x in select * from (values
        ('MENU-HAMB', 'Extra queso', 1), ('MENU-HAMB', 'Extra carne', 2), ('MENU-HAMB', 'Huevo frito', 3), ('MENU-HAMB', 'Panceta', 4),
        ('MENU-LOMI', 'Extra queso', 1), ('MENU-LOMI', 'Huevo frito', 2),
        ('MENU-PIZZ', 'Extra muzzarella', 1)
      ) t(plato, extra, orden)
    loop
      select id into v_plato from productos where empresa_id = e.id and sku = x.plato;
      select id into v_id from extras where empresa_id = e.id and lower(btrim(nombre)) = lower(x.extra);
      if v_plato is null or v_id is null then continue; end if;
      insert into plato_extras (producto_id, extra_id, empresa_id, maximo, orden)
        values (v_plato, v_id, e.id, 3, x.orden)
        on conflict (producto_id, extra_id) do nothing;
    end loop;

    -- Grupos de opciones (solo si el plato todavía no tiene uno con ese nombre).
    for x in select * from (values
        ('MENU-HAMB', 'Punto de la carne', 1, array['Jugosa', 'A punto', 'Bien cocida']),
        ('MENU-PIZZ', 'Masa', 1, array['Tradicional', 'Fina']),
        ('MENU-MILA', 'Guarnición', 1, array['Puré', 'Papas fritas'])
      ) t(plato, grupo, orden, opciones)
    loop
      select id into v_plato from productos where empresa_id = e.id and sku = x.plato;
      if v_plato is null then continue; end if;
      if exists (select 1 from plato_opcion_grupos where producto_id = v_plato and lower(nombre) = lower(x.grupo)) then continue; end if;
      insert into plato_opcion_grupos (empresa_id, producto_id, nombre, obligatorio, minimo, maximo, orden)
        values (e.id, v_plato, x.grupo, true, 1, 1, x.orden)
        returning id into v_g;
      insert into plato_opciones (empresa_id, grupo_id, nombre, precio, orden)
        select e.id, v_g, o.nombre, 0, o.n from unnest(x.opciones) with ordinality o(nombre, n);
    end loop;
  end loop;
end;
$seed$;
\endif

-- =============================================================================
-- 11. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".mods_quitar_ids(jsonb) from public, anon, authenticated;
revoke all on function :"schema".mods_opcion_ids(jsonb) from public, anon, authenticated;
revoke all on function :"schema".mods_extras_lista(jsonb) from public, anon, authenticated;
revoke all on function :"schema".mods_clave(jsonb) from public, anon, authenticated;
revoke all on function :"schema".receta_insumos_sin(uuid, numeric, uuid[]) from public, anon, authenticated;
revoke all on function :"schema".extra_insumos(uuid, numeric) from public, anon, authenticated;
revoke all on function :"schema".plato_insumos(uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function :"schema".necesidad_mods(uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function :"schema".extra_disponible(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".plato_tiene_mods(uuid) from public, anon, authenticated;
revoke all on function :"schema".plato_mods_catalogo(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".plato_mods_resolver(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function :"schema".extras_listar() from public, anon;
revoke all on function :"schema".extra_guardar(jsonb) from public, anon;
revoke all on function :"schema".extra_eliminar(uuid) from public, anon;

grant execute on function
  :"schema".mods_quitar_ids(jsonb),
  :"schema".mods_opcion_ids(jsonb),
  :"schema".mods_extras_lista(jsonb),
  :"schema".mods_clave(jsonb),
  :"schema".receta_insumos_sin(uuid, numeric, uuid[]),
  :"schema".extra_insumos(uuid, numeric),
  :"schema".plato_insumos(uuid, numeric, jsonb),
  :"schema".necesidad_mods(uuid, numeric, jsonb),
  :"schema".extra_disponible(uuid, uuid, uuid, jsonb),
  :"schema".plato_tiene_mods(uuid),
  :"schema".plato_mods_catalogo(uuid, uuid, jsonb),
  :"schema".plato_mods_resolver(uuid, jsonb, boolean)
  to service_role;
grant execute on function
  :"schema".extras_listar(),
  :"schema".extra_guardar(jsonb),
  :"schema".extra_eliminar(uuid)
  to authenticated, service_role;

commit;
