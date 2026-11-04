-- =============================================================================
-- RUBRO INMOBILIARIA (pedido del dueño, 4-nov-2026) — fase 1: el rubro y las propiedades.
--
--   · Rubro y funciones: función nueva `inmobiliaria` (empresa_funciones.inmobiliaria). Rubro
--     "Inmobiliaria" = inmobiliaria prendida y lo gastronómico, Pedidos y Sorteos apagados. Prenderla
--     da la pantalla Propiedades a Supervisor, Vendedor y Cajero (rubro_dar_inmobiliaria).
--   · Cada propiedad ES un producto (así se vende, se presupuesta y se cobra en cuotas con lo que ya
--     existe), sin stock (cada una es única), con IVA 5 % por defecto (inmuebles), más su ficha en
--     `propiedades`: ciudad y barrio, dirección, m² de terreno y construidos, tipo, gestión (venta,
--     alquiler o las dos), precio de alquiler, cuenta catastral, finca, manzana y lote, estado de la
--     documentación, estado comercial, y si es propia o de un dueño (cliente) con su comisión.
--     Solo alquiler = no se vende en la caja (es_vendible falso): se cobra por contrato (fase 2).
--   · Tipos de propiedad: lista por empresa que el cliente edita (arranca con los de siempre).
--   · Las tablas son solo por funciones (RLS forzada). Editar exige `editar_productos`, como el resto
--     del inventario (el disparador de productos lo vuelve a exigir al cambiar precios).
--
-- IDEMPOTENTE. Va después de 122 (las 123-129 son de Sorteos y no dependen de esta).
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Función "Inmobiliaria" en Rubro y funciones
-- =============================================================================
alter table :"schema".empresa_funciones add column if not exists inmobiliaria boolean not null default false;

do $do$
declare
  v_def text;
begin
  -- funcion_activa: 'inmobiliaria' lee su columna (sin fila = apagada).
  v_def := pg_get_functiondef('funcion_activa(uuid,text)'::regprocedure);
  if position('-- 130: inmobiliaria' in v_def) = 0 then
    if position($a$when p_funcion = 'pedidos' then$a$ in v_def) = 0 then raise exception 'Receta 130: funcion_activa no tiene el patrón esperado'; end if;
    execute replace(v_def, $a$when p_funcion = 'pedidos' then$a$,
      $b$when p_funcion = 'inmobiliaria' then coalesce((select f.inmobiliaria from empresa_funciones f where f.empresa_id = p_empresa), false) -- 130: inmobiliaria
    when p_funcion = 'pedidos' then$b$);
  end if;

  -- funciones_empresa: devuelve 'inmobiliaria' y el rubro "inmobiliaria".
  v_def := pg_get_functiondef('funciones_empresa()'::regprocedure);
  if position('-- 130: inmobiliaria' in v_def) = 0 then
    if position($a$v_rubro := case when coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'sorteos' -- 123: sorteos
                  when not v_mesas and not v_cocina and not v_recetas then 'comercio'$a$ in v_def) = 0
       or position($a$'sorteos', coalesce(f.sorteos, false),$a$ in v_def) = 0 then
      raise exception 'Receta 130: funciones_empresa no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, $a$v_rubro := case when coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'sorteos' -- 123: sorteos
                  when not v_mesas and not v_cocina and not v_recetas then 'comercio'$a$,
      $b$v_rubro := case when coalesce(f.inmobiliaria, false) and not coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'inmobiliaria' -- 130: inmobiliaria
                  when coalesce(f.sorteos, false) and not coalesce(f.inmobiliaria, false) and not v_mesas and not v_cocina and not v_recetas then 'sorteos' -- 123: sorteos
                  when coalesce(f.sorteos, false) or coalesce(f.inmobiliaria, false) then 'personalizado'
                  when not v_mesas and not v_cocina and not v_recetas then 'comercio'$b$);
    v_def := replace(v_def, $a$'sorteos', coalesce(f.sorteos, false),$a$, $b$'sorteos', coalesce(f.sorteos, false),
    'inmobiliaria', coalesce(f.inmobiliaria, false),$b$);
    execute v_def;
  end if;

  -- guardar_funciones_empresa: preset "inmobiliaria", interruptor `inmobiliaria` y perfiles al prenderla.
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('-- 130: inmobiliaria' in v_def) = 0 then
    if position($a$  v_sorteos boolean; -- 123: sorteos$a$ in v_def) = 0
       or position($a$  v_sorteos := f.sorteos;$a$ in v_def) = 0
       or position($a$v_pedidos := true; v_sorteos := false;$a$ in v_def) = 0
       or position($a$v_pedidos := false; v_sorteos := false;$a$ in v_def) = 0
       or position($a$v_pedidos := false; v_sorteos := true;$a$ in v_def) = 0
       or position($a$      else raise exception 'Rubro inválido (Comercio, Gastronomía o Sorteos)';$a$ in v_def) = 0
       or position($a$array['mesas', 'cocina', 'recetas', 'pedidos', 'sorteos', 'confirmar_recetas']$a$ in v_def) = 0
       or position($a$  if p ? 'sorteos' then v_sorteos := (p->>'sorteos')::boolean; end if;$a$ in v_def) = 0
       or position($a$sorteos = v_sorteos, updated_at = now()$a$ in v_def) = 0
       or position(E'\n  update empresa_funciones' in v_def) = 0 then
      raise exception 'Receta 130: guardar_funciones_empresa no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, $a$  v_sorteos boolean; -- 123: sorteos$a$, $b$  v_sorteos boolean; -- 123: sorteos
  v_inmobiliaria boolean; -- 130: inmobiliaria$b$);
    v_def := replace(v_def, $a$  v_sorteos := f.sorteos;$a$, $b$  v_sorteos := f.sorteos;
  v_inmobiliaria := f.inmobiliaria;$b$);
    -- Los rubros de antes apagan Inmobiliaria; el nuevo prende solo Inmobiliaria.
    v_def := replace(v_def, $a$v_pedidos := true; v_sorteos := false;$a$, $b$v_pedidos := true; v_sorteos := false; v_inmobiliaria := false;$b$);
    v_def := replace(v_def, $a$v_pedidos := false; v_sorteos := false;$a$, $b$v_pedidos := false; v_sorteos := false; v_inmobiliaria := false;$b$);
    v_def := replace(v_def, $a$v_pedidos := false; v_sorteos := true;$a$, $b$v_pedidos := false; v_sorteos := true; v_inmobiliaria := false;
      when 'inmobiliaria' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := false; v_sorteos := false; v_inmobiliaria := true;$b$);
    v_def := replace(v_def, $a$      else raise exception 'Rubro inválido (Comercio, Gastronomía o Sorteos)';$a$,
      $b$      else raise exception 'Rubro inválido (Comercio, Gastronomía, Sorteos o Inmobiliaria)';$b$);
    v_def := replace(v_def, $a$array['mesas', 'cocina', 'recetas', 'pedidos', 'sorteos', 'confirmar_recetas']$a$,
      $b$array['mesas', 'cocina', 'recetas', 'pedidos', 'sorteos', 'inmobiliaria', 'confirmar_recetas']$b$);
    v_def := replace(v_def, $a$  if p ? 'sorteos' then v_sorteos := (p->>'sorteos')::boolean; end if;$a$,
      $b$  if p ? 'sorteos' then v_sorteos := (p->>'sorteos')::boolean; end if;
  if p ? 'inmobiliaria' then v_inmobiliaria := (p->>'inmobiliaria')::boolean; end if;$b$);
    v_def := replace(v_def, E'\n  update empresa_funciones',
      E'\n  -- 130: inmobiliaria: perfiles que atienden propiedades al prenderla'
      || E'\n  if v_inmobiliaria and not f.inmobiliaria then perform rubro_dar_inmobiliaria(s.p_empresa); end if;'
      || E'\n\n  update empresa_funciones');
    v_def := replace(v_def, $a$sorteos = v_sorteos, updated_at = now()$a$, $b$sorteos = v_sorteos, inmobiliaria = v_inmobiliaria, updated_at = now()$b$);
    execute v_def;
  end if;
end;
$do$;

-- =============================================================================
-- 2. Tablas
-- =============================================================================
create table if not exists :"schema".propiedad_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists propiedad_tipos_nombre_uq on :"schema".propiedad_tipos (empresa_id, lower(nombre));

create table if not exists :"schema".propiedades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  producto_id uuid not null unique references :"schema".productos(id) on delete cascade,
  codigo text not null,
  tipo_id uuid references :"schema".propiedad_tipos(id) on delete set null,
  gestion text not null default 'venta' check (gestion in ('venta', 'alquiler', 'venta_alquiler')),
  estado text not null default 'disponible' check (estado in ('disponible', 'reservada', 'vendida', 'alquilada', 'retirada')),
  ciudad text,
  barrio text,
  direccion text,
  superficie_terreno numeric(14,2) check (superficie_terreno is null or superficie_terreno >= 0),
  superficie_construida numeric(14,2) check (superficie_construida is null or superficie_construida >= 0),
  cuenta_catastral text,
  finca text,
  manzana text,
  lote text,
  documentacion text not null default 'al_dia' check (documentacion in ('al_dia', 'en_tramite', 'con_observaciones', 'sin_titulo')),
  documentacion_nota text,
  precio_alquiler numeric(16,0) check (precio_alquiler is null or precio_alquiler >= 0),
  propia boolean not null default true,
  propietario_id uuid references :"schema".clientes(id) on delete restrict,
  comision_venta_pct numeric(5,2) check (comision_venta_pct is null or comision_venta_pct between 0 and 100),
  comision_alquiler_pct numeric(5,2) check (comision_alquiler_pct is null or comision_alquiler_pct between 0 and 100),
  notas text,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint propiedades_dueno check (propia or propietario_id is not null)
);
create unique index if not exists propiedades_codigo_uq on :"schema".propiedades (empresa_id, codigo);
create index if not exists propiedades_estado_idx on :"schema".propiedades (empresa_id, estado);
create index if not exists propiedades_propietario_idx on :"schema".propiedades (propietario_id) where propietario_id is not null;

do $do$
declare
  t text;
begin
  foreach t in array array['propiedad_tipos', 'propiedades'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- =============================================================================
-- 3. Pantallas
-- =============================================================================
create or replace function :"schema".rubro_dar_inmobiliaria(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, '/inmobiliaria'
    from perfiles pf
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
end;
$fn$;

-- =============================================================================
-- 4. Ayudantes
-- =============================================================================
create or replace function :"schema".inmo_sesion(out s_empresa uuid, out s_usuario uuid, out s_rol text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  if not funcion_activa(s.s_empresa, 'inmobiliaria') then
    raise exception 'Inmobiliaria no está activa en tu empresa' using errcode = '42501';
  end if;
  s_empresa := s.s_empresa; s_usuario := s.s_usuario; s_rol := s.s_rol;
end;
$fn$;

-- Tipos de siempre, la primera vez que una empresa los pide.
create or replace function :"schema".propiedad_tipos_base(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if exists (select 1 from propiedad_tipos where empresa_id = p_empresa) then return; end if;
  insert into propiedad_tipos (empresa_id, nombre, orden)
  select p_empresa, x.nombre, x.orden
    from (values ('Casa', 1), ('Departamento', 2), ('Dúplex', 3), ('Terreno / lote', 4), ('Local comercial', 5),
                 ('Oficina', 6), ('Depósito / galpón', 7), ('Quinta', 8), ('Campo / estancia', 9), ('Edificio', 10)) x(nombre, orden)
  on conflict do nothing;
end;
$fn$;

create or replace function :"schema".propiedad_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'id', pr.id, 'producto_id', pr.producto_id, 'codigo', pr.codigo, 'titulo', p.nombre, 'descripcion', p.descripcion,
    'imagen_url', p.imagen_url, 'precio_venta', p.precio_venta, 'tipo_iva', p.tipo_iva,
    'tipo_id', pr.tipo_id, 'tipo', t.nombre, 'gestion', pr.gestion, 'estado', pr.estado,
    'ciudad', pr.ciudad, 'barrio', pr.barrio, 'direccion', pr.direccion,
    'superficie_terreno', pr.superficie_terreno, 'superficie_construida', pr.superficie_construida,
    'cuenta_catastral', pr.cuenta_catastral, 'finca', pr.finca, 'manzana', pr.manzana, 'lote', pr.lote,
    'documentacion', pr.documentacion, 'documentacion_nota', pr.documentacion_nota,
    'precio_alquiler', pr.precio_alquiler, 'propia', pr.propia,
    'propietario_id', pr.propietario_id, 'propietario', c.nombre, 'propietario_documento', c.documento,
    'comision_venta_pct', pr.comision_venta_pct, 'comision_alquiler_pct', pr.comision_alquiler_pct,
    'notas', pr.notas, 'created_at', pr.created_at, 'updated_at', pr.updated_at)
    from propiedades pr
    join productos p on p.id = pr.producto_id
    left join propiedad_tipos t on t.id = pr.tipo_id
    left join clientes c on c.id = pr.propietario_id
   where pr.id = p_id
$fn$;

-- =============================================================================
-- 5. Con sesión
-- =============================================================================
create or replace function :"schema".propiedad_tipos_lista()
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  perform propiedad_tipos_base(s.s_empresa);
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'activo', t.activo,
                                                       'usos', (select count(*) from propiedades x where x.tipo_id = t.id))
                                    order by t.orden, t.nombre)
                     from propiedad_tipos t where t.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

-- p: [{id?, nombre, activo}] en el orden en que se muestran. Un tipo en uso no se borra: se desactiva.
create or replace function :"schema".propiedad_tipos_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  x jsonb;
  v_orden smallint := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('editar_productos');
  if jsonb_typeof(p) <> 'array' then raise exception 'Faltan los tipos de propiedad'; end if;
  for x in select * from jsonb_array_elements(p) loop
    if length(btrim(coalesce(x->>'nombre', ''))) < 2 then raise exception 'Cada tipo necesita un nombre'; end if;
    v_orden := v_orden + 1;
    v_id := nullif(x->>'id', '')::uuid;
    if v_id is null then
      insert into propiedad_tipos (empresa_id, nombre, orden, activo)
        values (s.s_empresa, btrim(x->>'nombre'), v_orden, coalesce((x->>'activo')::boolean, true))
        on conflict (empresa_id, lower(nombre)) do update set orden = excluded.orden, activo = excluded.activo
        returning id into v_id;
    else
      update propiedad_tipos set nombre = btrim(x->>'nombre'), orden = v_orden, activo = coalesce((x->>'activo')::boolean, true)
       where id = v_id and empresa_id = s.s_empresa;
      if not found then raise exception 'No existe ese tipo de propiedad'; end if;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  -- Los que no vinieron: se borran si no se usan, si no se desactivan.
  delete from propiedad_tipos t where t.empresa_id = s.s_empresa and not (t.id = any (v_ids))
     and not exists (select 1 from propiedades x where x.tipo_id = t.id);
  update propiedad_tipos set activo = false where empresa_id = s.s_empresa and not (id = any (v_ids));
  return propiedad_tipos_lista();
end;
$fn$;

-- p: q, tipo_id, gestion, estado, ciudad, limite, desde
create or replace function :"schema".propiedades_lista(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_q text := nullif(norm(btrim(coalesce(p->>'q', ''))), '');
  v_lim integer := least(greatest(coalesce((p->>'limite')::integer, 60), 1), 200);
  v_desde integer := greatest(coalesce((p->>'desde')::integer, 0), 0);
begin
  select * into s from inmo_sesion();
  return (
    with base as (
      select pr.*, pd.nombre, pd.precio_venta, pd.imagen_url, t.nombre as tipo, c.nombre as propietario
        from propiedades pr
        join productos pd on pd.id = pr.producto_id
        left join propiedad_tipos t on t.id = pr.tipo_id
        left join clientes c on c.id = pr.propietario_id
       where pr.empresa_id = s.s_empresa
         and (nullif(p->>'tipo_id', '') is null or pr.tipo_id = (p->>'tipo_id')::uuid)
         and (nullif(p->>'gestion', '') is null or pr.gestion = p->>'gestion'
              or (p->>'gestion' in ('venta', 'alquiler') and pr.gestion = 'venta_alquiler'))
         and (nullif(p->>'ciudad', '') is null or norm(pr.ciudad) = norm(p->>'ciudad'))
         and (v_q is null or (select bool_and(norm(concat_ws(' ', pd.nombre, pr.codigo, pr.direccion, pr.ciudad, pr.barrio,
                                                                  pr.cuenta_catastral, pr.finca, pr.manzana, pr.lote, c.nombre, t.nombre)) like '%' || w || '%')
                                from unnest(string_to_array(v_q, ' ')) w where w <> ''))),
    filtrada as (
      select * from base where nullif(p->>'estado', '') is null or estado = p->>'estado')
    select jsonb_build_object(
      'total', (select count(*) from filtrada),
      'por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb) from (select estado, count(*) n from base group by estado) e),
      'ciudades', (select coalesce(jsonb_agg(distinct pr.ciudad), '[]'::jsonb) from propiedades pr where pr.empresa_id = s.s_empresa and pr.ciudad is not null),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', f.id, 'codigo', f.codigo, 'titulo', f.nombre, 'tipo', f.tipo, 'gestion', f.gestion, 'estado', f.estado,
          'ciudad', f.ciudad, 'barrio', f.barrio, 'direccion', f.direccion,
          'superficie_terreno', f.superficie_terreno, 'superficie_construida', f.superficie_construida,
          'precio_venta', f.precio_venta, 'precio_alquiler', f.precio_alquiler, 'documentacion', f.documentacion,
          'propia', f.propia, 'propietario', f.propietario, 'imagen_url', f.imagen_url, 'lote', f.lote, 'manzana', f.manzana)
          order by (f.estado = 'disponible') desc, f.updated_at desc)
        from (select * from filtrada order by (estado = 'disponible') desc, updated_at desc offset v_desde limit v_lim) f), '[]'::jsonb)));
end;
$fn$;

create or replace function :"schema".propiedad_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  if not exists (select 1 from propiedades where id = p_id and empresa_id = s.s_empresa) then raise exception 'No existe esa propiedad'; end if;
  return propiedad_json(p_id);
end;
$fn$;

-- p: id?, titulo, descripcion, imagen_url, imagen_path, tipo_id, gestion, ciudad, barrio, direccion,
--    superficie_terreno, superficie_construida, cuenta_catastral, finca, manzana, lote, documentacion,
--    documentacion_nota, precio_venta, precio_alquiler, tipo_iva, propia, propietario_id,
--    comision_venta_pct, comision_alquiler_pct, notas
create or replace function :"schema".propiedad_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v propiedades;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_gestion text := coalesce(nullif(p->>'gestion', ''), 'venta');
  v_venta numeric := coalesce((p->>'precio_venta')::numeric, 0);
  v_alq numeric := nullif((p->>'precio_alquiler')::numeric, 0);
  v_propia boolean := coalesce((p->>'propia')::boolean, true);
  v_dueno uuid := nullif(p->>'propietario_id', '')::uuid;
  v_iva text := coalesce(nullif(p->>'tipo_iva', ''), '5%');
  v_prod uuid;
  v_codigo text;
  v_n integer;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('editar_productos');
  if length(btrim(coalesce(p->>'titulo', ''))) < 3 then raise exception 'Poné un título a la propiedad (ej. Casa de 3 dormitorios en Luque)'; end if;
  if v_gestion not in ('venta', 'alquiler', 'venta_alquiler') then raise exception 'Elegí si es para venta, alquiler o las dos'; end if;
  if v_gestion in ('venta', 'venta_alquiler') and v_venta <= 0 then raise exception 'Poné el precio de venta'; end if;
  if v_gestion in ('alquiler', 'venta_alquiler') and coalesce(v_alq, 0) <= 0 then raise exception 'Poné el alquiler mensual'; end if;
  if v_iva not in ('EXENTA', '5%', '10%') then raise exception 'IVA inválido'; end if;
  if coalesce(p->>'documentacion', 'al_dia') not in ('al_dia', 'en_tramite', 'con_observaciones', 'sin_titulo') then
    raise exception 'Estado de documentación inválido';
  end if;
  if not v_propia then
    if v_dueno is null then raise exception 'Elegí el dueño de la propiedad (o marcala como propia)'; end if;
    if not exists (select 1 from clientes where id = v_dueno and empresa_id = s.s_empresa and deleted_at is null) then
      raise exception 'No existe ese cliente';
    end if;
  else
    v_dueno := null;
  end if;
  if nullif(p->>'tipo_id', '') is not null
     and not exists (select 1 from propiedad_tipos where id = (p->>'tipo_id')::uuid and empresa_id = s.s_empresa) then
    raise exception 'No existe ese tipo de propiedad';
  end if;

  if v_id is null then
    -- Código correlativo INM-0001 (también es el SKU del producto).
    select coalesce(max(substring(codigo from '^INM-(\d+)$')::integer), 0) + 1 into v_n
      from propiedades where empresa_id = s.s_empresa;
    loop
      v_codigo := 'INM-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from productos where empresa_id = s.s_empresa and upper(sku) = v_codigo);
      v_n := v_n + 1;
    end loop;
    insert into productos (empresa_id, nombre, sku, precio_venta, controla_stock, es_vendible, unidad_medida, tipo_producto, tipo_iva)
      values (s.s_empresa, btrim(p->>'titulo'), v_codigo, v_venta, false, v_gestion <> 'alquiler', 'Unidad', 'reventa', v_iva)
      returning id into v_prod;
    insert into propiedades (empresa_id, producto_id, codigo, propia, propietario_id, created_by)
      values (s.s_empresa, v_prod, v_codigo, v_propia, v_dueno, s.s_usuario)
      returning id into v_id;
  end if;

  select * into v from propiedades where id = v_id and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe esa propiedad'; end if;

  update productos set
    nombre = btrim(p->>'titulo'),
    descripcion = nullif(btrim(coalesce(p->>'descripcion', '')), ''),
    imagen_url = case when p ? 'imagen_url' then nullif(btrim(coalesce(p->>'imagen_url', '')), '') else imagen_url end,
    imagen_path = case when p ? 'imagen_path' then nullif(btrim(coalesce(p->>'imagen_path', '')), '') else imagen_path end,
    precio_venta = v_venta,
    es_vendible = v_gestion <> 'alquiler' and v.estado not in ('vendida', 'retirada'),
    tipo_iva = v_iva,
    updated_at = now()
  where id = v.producto_id;

  update propiedades set
    tipo_id = nullif(p->>'tipo_id', '')::uuid,
    gestion = v_gestion,
    ciudad = nullif(btrim(coalesce(p->>'ciudad', '')), ''),
    barrio = nullif(btrim(coalesce(p->>'barrio', '')), ''),
    direccion = nullif(btrim(coalesce(p->>'direccion', '')), ''),
    superficie_terreno = nullif(p->>'superficie_terreno', '')::numeric,
    superficie_construida = nullif(p->>'superficie_construida', '')::numeric,
    cuenta_catastral = nullif(btrim(coalesce(p->>'cuenta_catastral', '')), ''),
    finca = nullif(btrim(coalesce(p->>'finca', '')), ''),
    manzana = nullif(btrim(coalesce(p->>'manzana', '')), ''),
    lote = nullif(btrim(coalesce(p->>'lote', '')), ''),
    documentacion = coalesce(nullif(p->>'documentacion', ''), 'al_dia'),
    documentacion_nota = nullif(btrim(coalesce(p->>'documentacion_nota', '')), ''),
    precio_alquiler = case when v_gestion = 'venta' then null else v_alq end,
    propia = v_propia,
    propietario_id = v_dueno,
    comision_venta_pct = case when v_propia then null else nullif(p->>'comision_venta_pct', '')::numeric end,
    comision_alquiler_pct = case when v_propia then null else nullif(p->>'comision_alquiler_pct', '')::numeric end,
    notas = nullif(btrim(coalesce(p->>'notas', '')), ''),
    updated_at = now()
  where id = v_id;

  return propiedad_json(v_id);
end;
$fn$;

-- Estado comercial a mano (reservar, retirar, volver a disponible). Vendida y alquilada también las
-- pone la venta y el contrato (fase 2); acá se permiten para cargar lo que ya pasó.
create or replace function :"schema".propiedad_estado(p_id uuid, p_estado text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v propiedades;
begin
  select * into s from inmo_sesion();
  perform exigir_permiso('editar_productos');
  if p_estado not in ('disponible', 'reservada', 'vendida', 'alquilada', 'retirada') then raise exception 'Estado inválido'; end if;
  select * into v from propiedades where id = p_id and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe esa propiedad'; end if;
  update propiedades set estado = p_estado, updated_at = now() where id = p_id;
  -- Vendida o retirada no se vuelve a vender en la caja.
  update productos set es_vendible = v.gestion <> 'alquiler' and p_estado not in ('vendida', 'retirada'), updated_at = now()
   where id = v.producto_id;
  return propiedad_json(p_id);
end;
$fn$;

-- =============================================================================
-- 6. Permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  -- Internas.
  foreach f in array array['rubro_dar_inmobiliaria(uuid)', 'propiedad_tipos_base(uuid)', 'propiedad_json(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Con sesión (cada una exige la función Inmobiliaria prendida; guardar exige editar_productos).
  foreach f in array array['inmo_sesion()', 'propiedad_tipos_lista()', 'propiedad_tipos_guardar(jsonb)', 'propiedades_lista(jsonb)',
                           'propiedad_detalle(uuid)', 'propiedad_guardar(jsonb)', 'propiedad_estado(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

-- Las empresas que ya tengan Inmobiliaria prendida (re-aplicación): pantallas.
do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where inmobiliaria loop
    perform rubro_dar_inmobiliaria(r.empresa_id);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
