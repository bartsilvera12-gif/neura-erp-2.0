-- =============================================================================
-- Proveedores (Fase 1 de Compras, portado de Ferretería República y simplificado).
--   · proveedores               maestro: razón social, nombre comercial, RUC (único por
--                               empresa, con o sin puntos/guion), contacto, condición y
--                               plazo de pago, moneda, observaciones, activo
--   · proveedor_categorias      rubros del proveedor (ej. "Bebidas", "Limpieza")
--   · proveedor_categoria_rel   un proveedor puede tener varios rubros
--   · productos.proveedor_principal_id → proveedores (a quién se le compra normalmente)
--   · movimientos_inventario.proveedor_id → la compra queda ligada al proveedor real
--     (el texto `proveedor` se mantiene como foto del nombre, como producto_nombre)
-- RLS por empresa_actual(). IDEMPOTENTE.
-- =============================================================================
select set_config('app.schema_prov', :'schema', false);

create table if not exists :"schema".proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,                 -- razón social
  nombre_comercial text,
  ruc text,
  telefono text,
  email text,
  direccion text,
  ciudad text,
  contacto text,                        -- persona de contacto / vendedor
  contacto_telefono text,
  condicion_pago text not null default 'contado',
  plazo_pago_dias integer,
  moneda text not null default 'GS',
  observaciones text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_proveedor_condicion check (condicion_pago in ('contado', 'credito')),
  constraint chk_proveedor_moneda check (moneda in ('GS', 'USD')),
  constraint chk_proveedor_plazo check (plazo_pago_dias is null or plazo_pago_dias between 0 and 3650)
);
create index if not exists proveedores_empresa_idx on :"schema".proveedores(empresa_id);
-- Un RUC por empresa (se compara sin puntos, guiones ni espacios).
create unique index if not exists uq_proveedores_empresa_ruc
  on :"schema".proveedores(empresa_id, regexp_replace(lower(ruc), '[^a-z0-9]+', '', 'g'))
  where ruc is not null and btrim(ruc) <> '';

create table if not exists :"schema".proveedor_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_proveedor_categorias_nombre
  on :"schema".proveedor_categorias(empresa_id, lower(btrim(nombre)));

create table if not exists :"schema".proveedor_categoria_rel (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  proveedor_id uuid not null references :"schema".proveedores(id) on delete cascade,
  categoria_id uuid not null references :"schema".proveedor_categorias(id) on delete cascade,
  primary key (proveedor_id, categoria_id)
);
create index if not exists proveedor_categoria_rel_empresa_idx on :"schema".proveedor_categoria_rel(empresa_id);

-- Producto → proveedor principal (la columna ya existía, sin FK).
alter table :"schema".productos add column if not exists proveedor_principal_id uuid;
do $do$
declare s text := current_setting('app.schema_prov', true);
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_proveedor_principal_fk'
                    and conrelid = format('%I.productos', s)::regclass) then
    execute format('update %I.productos set proveedor_principal_id = null
                     where proveedor_principal_id is not null
                       and proveedor_principal_id not in (select id from %I.proveedores)', s, s);
    execute format('alter table %I.productos add constraint productos_proveedor_principal_fk
                     foreign key (proveedor_principal_id) references %I.proveedores(id) on delete set null', s, s);
  end if;
end
$do$;

-- Compra → proveedor real.
alter table :"schema".movimientos_inventario add column if not exists proveedor_id uuid;
do $do$
declare s text := current_setting('app.schema_prov', true);
begin
  if not exists (select 1 from pg_constraint where conname = 'movinv_proveedor_fk'
                    and conrelid = format('%I.movimientos_inventario', s)::regclass) then
    execute format('alter table %I.movimientos_inventario add constraint movinv_proveedor_fk
                     foreign key (proveedor_id) references %I.proveedores(id) on delete set null', s, s);
  end if;
end
$do$;
create index if not exists movinv_proveedor_idx on :"schema".movimientos_inventario(proveedor_id) where proveedor_id is not null;

-- --- RLS ---
alter table :"schema".proveedores enable row level security;
alter table :"schema".proveedores force row level security;
alter table :"schema".proveedor_categorias enable row level security;
alter table :"schema".proveedor_categorias force row level security;
alter table :"schema".proveedor_categoria_rel enable row level security;
alter table :"schema".proveedor_categoria_rel force row level security;

drop policy if exists proveedores_propios on :"schema".proveedores;
create policy proveedores_propios on :"schema".proveedores to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists prov_categorias_propias on :"schema".proveedor_categorias;
create policy prov_categorias_propias on :"schema".proveedor_categorias to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
drop policy if exists prov_cat_rel_propias on :"schema".proveedor_categoria_rel;
create policy prov_cat_rel_propias on :"schema".proveedor_categoria_rel to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());

grant select, insert, update, delete on
  :"schema".proveedores, :"schema".proveedor_categorias, :"schema".proveedor_categoria_rel
  to authenticated, service_role;

-- Cuántas compras tiene cada proveedor (para la lista y para no borrar uno con historial).
create or replace function :"schema".compras_por_proveedor()
returns table (proveedor_id uuid, compras bigint, ultima timestamptz)
language sql stable security invoker set search_path = :"schema", public as $$
  select m.proveedor_id, count(*), max(m.fecha)
    from movimientos_inventario m
   where m.empresa_id = empresa_actual() and m.proveedor_id is not null
   group by m.proveedor_id
$$;
grant execute on function :"schema".compras_por_proveedor() to authenticated, service_role;

-- La compra manual (Nuevo movimiento) recibe el proveedor real.
drop function if exists :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text, text, text);
create or replace function :"schema".registrar_movimiento_stock(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_costo_unitario numeric,
  p_origen text,
  p_referencia text,
  p_proveedor text default null,
  p_numero_factura text default null,
  p_proveedor_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = :"schema", public
as $fn$
declare
  v_empresa uuid := empresa_actual();
  prod record;
  v_delta numeric;
  v_nuevo numeric;
  v_costo numeric := coalesce(p_costo_unitario, 0);
  v_cpp numeric;
  v_usuario uuid;
  v_usuario_nombre text;
  v_ref text;
  v_prov_nombre text := p_proveedor;
begin
  if v_empresa is null then raise exception 'No hay empresa en la sesión'; end if;
  if p_tipo not in ('ENTRADA', 'SALIDA', 'AJUSTE') then raise exception 'Tipo de movimiento inválido'; end if;
  if p_origen not in ('compra', 'ajuste_manual') then raise exception 'Origen inválido'; end if;
  if p_cantidad is null or p_cantidad < 0 or (p_tipo <> 'AJUSTE' and p_cantidad = 0) then
    raise exception 'Cantidad inválida';
  end if;

  -- Proveedor real: se guarda el id y, como foto, su nombre.
  if p_proveedor_id is not null then
    select coalesce(nullif(btrim(nombre_comercial), ''), nombre) into v_prov_nombre
      from proveedores where id = p_proveedor_id and empresa_id = v_empresa;
    if not found then raise exception 'Proveedor no encontrado'; end if;
  end if;

  select * into prod from productos where id = p_producto_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not prod.controla_stock then raise exception '"%" no controla stock', prod.nombre; end if;

  v_delta := case p_tipo when 'ENTRADA' then p_cantidad when 'SALIDA' then -p_cantidad
                         else p_cantidad - prod.stock_actual end;
  if v_delta = 0 then raise exception 'El stock contado es igual al actual: no hay nada que ajustar'; end if;
  v_nuevo := prod.stock_actual + v_delta;
  if v_nuevo < 0 then
    raise exception 'Stock insuficiente de "%": hay %, no se pueden sacar %', prod.nombre, prod.stock_actual, abs(v_delta);
  end if;

  -- CPP: solo una entrada de compra con costo cambia el costo promedio.
  v_cpp := prod.costo_promedio;
  if v_delta > 0 and p_origen = 'compra' and v_costo > 0 then
    v_cpp := round(((greatest(prod.stock_actual, 0) * coalesce(prod.costo_promedio, 0)) + (v_delta * v_costo))
                   / (greatest(prod.stock_actual, 0) + v_delta), 2);
  end if;

  update productos set stock_actual = v_nuevo, costo_promedio = v_cpp, updated_at = now() where id = prod.id;

  v_ref := coalesce(nullif(btrim(p_referencia), ''),
                    case when p_tipo = 'AJUSTE' then 'Ajuste por conteo físico' when p_origen = 'compra' and p_tipo = 'ENTRADA' then 'Compra' else 'Movimiento manual' end);
  if p_tipo = 'AJUSTE' then
    v_ref := v_ref || ' (contado ' || to_char(p_cantidad, 'FM999999990.###') ||
             ', había ' || to_char(prod.stock_actual, 'FM999999990.###') || ')';
  end if;

  select u.id, u.nombre into v_usuario, v_usuario_nombre
    from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_empresa limit 1;
  insert into movimientos_inventario (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
                                      costo_unitario, origen, referencia, created_by, usuario_nombre,
                                      proveedor, numero_factura, proveedor_id)
    values (v_empresa, prod.id, prod.nombre, prod.sku,
            case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end, abs(v_delta),
            case when v_costo > 0 then v_costo else coalesce(prod.costo_promedio, 0) end,
            p_origen, left(v_ref, 200), v_usuario, v_usuario_nombre,
            -- proveedor y factura solo tienen sentido en una compra
            case when p_origen = 'compra' and v_delta > 0 then nullif(left(btrim(v_prov_nombre), 120), '') end,
            case when p_origen = 'compra' and v_delta > 0 then nullif(left(btrim(p_numero_factura), 60), '') end,
            case when p_origen = 'compra' and v_delta > 0 then p_proveedor_id end);

  return jsonb_build_object('stock_anterior', prod.stock_actual, 'stock_nuevo', v_nuevo,
                            'tipo', case when v_delta > 0 then 'ENTRADA' else 'SALIDA' end,
                            'cantidad', abs(v_delta), 'costo_promedio', v_cpp);
end;
$fn$;
grant execute on function :"schema".registrar_movimiento_stock(uuid, text, numeric, numeric, text, text, text, text, uuid) to authenticated, service_role;
