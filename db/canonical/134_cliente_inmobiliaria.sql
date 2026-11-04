-- =============================================================================
-- FICHA DEL CLIENTE EN INMOBILIARIA (fase 2 — 4-nov-2026).
--
--   · Lo que busca cada cliente (cliente_busquedas): venta o alquiler, tipo, ciudad, precio máximo y
--     m² mínimos de terreno. Cada búsqueda muestra las propiedades DISPONIBLES que le sirven.
--   · cliente_inmobiliaria(cliente): sus propiedades como dueño, las que compró, sus contratos (como
--     inquilino o dueño) y sus búsquedas con coincidencias.
--   · propiedad_interesados(propiedad): los clientes con una búsqueda que esta propiedad cumple (en la
--     ficha de la propiedad: a quién avisarle).
--   · Solo por funciones (RLS forzada); cargar búsquedas: cualquiera con Inmobiliaria prendida.
--
-- IDEMPOTENTE. Va después de 133.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

create table if not exists :"schema".cliente_busquedas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  gestion text not null default 'venta' check (gestion in ('venta', 'alquiler')),
  tipo_id uuid references :"schema".propiedad_tipos(id) on delete set null,
  ciudad text,
  precio_max numeric(16,0) check (precio_max is null or precio_max > 0),
  superficie_min numeric(14,2) check (superficie_min is null or superficie_min > 0),
  notas text,
  activa boolean not null default true,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cliente_busquedas_cliente_idx on :"schema".cliente_busquedas (cliente_id);
alter table :"schema".cliente_busquedas enable row level security;
alter table :"schema".cliente_busquedas force row level security;
revoke all on :"schema".cliente_busquedas from public, anon, authenticated;
grant all on :"schema".cliente_busquedas to service_role;

-- ¿La propiedad le sirve a la búsqueda? (disponible, gestión, tipo, ciudad, precio y m²)
create or replace function :"schema".busqueda_coincide(b cliente_busquedas, pr propiedades, p_precio_venta numeric)
returns boolean language sql immutable as $$
  select pr.estado in ('disponible', 'reservada')
     and (pr.gestion = 'venta_alquiler' or pr.gestion = b.gestion)
     and (b.tipo_id is null or pr.tipo_id = b.tipo_id)
     and (b.ciudad is null or lower(coalesce(pr.ciudad, '')) = lower(b.ciudad))
     and (b.precio_max is null or (case when b.gestion = 'venta' then p_precio_venta else pr.precio_alquiler end) <= b.precio_max)
     and (b.superficie_min is null or coalesce(pr.superficie_terreno, 0) >= b.superficie_min)
$$;

create or replace function :"schema".busqueda_json(b cliente_busquedas)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', b.id, 'gestion', b.gestion, 'tipo_id', b.tipo_id, 'tipo', (select nombre from propiedad_tipos where id = b.tipo_id),
    'ciudad', b.ciudad, 'precio_max', b.precio_max, 'superficie_min', b.superficie_min, 'notas', b.notas, 'activa', b.activa,
    'created_at', b.created_at,
    'coincidencias', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'codigo', pr.codigo, 'titulo', pd.nombre, 'ciudad', pr.ciudad,
                                                                'precio_venta', pd.precio_venta, 'precio_alquiler', pr.precio_alquiler,
                                                                'gestion', pr.gestion, 'imagen_url', pd.imagen_url) order by pr.updated_at desc)
                                 from propiedades pr join productos pd on pd.id = pr.producto_id
                                where pr.empresa_id = b.empresa_id and busqueda_coincide(b, pr, pd.precio_venta)), '[]'::jsonb))
$$;

create or replace function :"schema".cliente_inmobiliaria(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = s.s_empresa) then raise exception 'No existe ese cliente'; end if;
  return jsonb_build_object(
    'como_dueno', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'codigo', pr.codigo, 'titulo', pd.nombre, 'estado', pr.estado,
                                                               'gestion', pr.gestion, 'precio_venta', pd.precio_venta, 'precio_alquiler', pr.precio_alquiler,
                                                               'comision_venta_pct', pr.comision_venta_pct, 'comision_alquiler_pct', pr.comision_alquiler_pct)
                                            order by pr.codigo)
                              from propiedades pr join productos pd on pd.id = pr.producto_id
                             where pr.empresa_id = s.s_empresa and pr.propietario_id = p_cliente), '[]'::jsonb),
    'compradas', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'codigo', pr.codigo, 'titulo', pd.nombre, 'venta', v.numero_control,
                                                              'fecha', v.fecha, 'total', v.total, 'cuotas', v.cuotas, 'entrega', v.entrega,
                                                              'saldo', (select coalesce(sum(c.saldo), 0) from cuentas_por_cobrar c where c.venta_id = v.id and c.estado in ('pendiente', 'parcial'))))
                             from propiedades pr join productos pd on pd.id = pr.producto_id join ventas v on v.id = pr.venta_id
                            where pr.empresa_id = s.s_empresa and v.cliente_id = p_cliente and v.estado <> 'anulada'), '[]'::jsonb),
    'contratos', alquileres_lista(jsonb_build_object('inquilino_id', p_cliente)),
    'busquedas', coalesce((select jsonb_agg(busqueda_json(b) order by b.activa desc, b.created_at desc)
                             from cliente_busquedas b where b.cliente_id = p_cliente and b.empresa_id = s.s_empresa), '[]'::jsonb));
end;
$fn$;

-- p: id?, cliente_id, gestion, tipo_id, ciudad, precio_max, superficie_min, notas, activa
create or replace function :"schema".cliente_busqueda_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  b cliente_busquedas;
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  select * into s from inmo_sesion();
  if not exists (select 1 from clientes where id = nullif(p->>'cliente_id', '')::uuid and empresa_id = s.s_empresa and deleted_at is null) then
    raise exception 'No existe ese cliente';
  end if;
  if coalesce(p->>'gestion', 'venta') not in ('venta', 'alquiler') then raise exception 'Elegí si busca comprar o alquilar'; end if;
  if nullif(p->>'tipo_id', '') is not null and not exists (select 1 from propiedad_tipos where id = (p->>'tipo_id')::uuid and empresa_id = s.s_empresa) then
    raise exception 'No existe ese tipo de propiedad';
  end if;
  if v_id is null then
    insert into cliente_busquedas (empresa_id, cliente_id, created_by) values (s.s_empresa, (p->>'cliente_id')::uuid, s.s_usuario) returning id into v_id;
  elsif not exists (select 1 from cliente_busquedas where id = v_id and empresa_id = s.s_empresa) then
    raise exception 'No existe esa búsqueda';
  end if;
  update cliente_busquedas set
    gestion = coalesce(nullif(p->>'gestion', ''), 'venta'),
    tipo_id = nullif(p->>'tipo_id', '')::uuid,
    ciudad = nullif(btrim(coalesce(p->>'ciudad', '')), ''),
    precio_max = nullif(nullif(p->>'precio_max', '')::numeric, 0),
    superficie_min = nullif(nullif(p->>'superficie_min', '')::numeric, 0),
    notas = nullif(btrim(coalesce(p->>'notas', '')), ''),
    activa = coalesce((p->>'activa')::boolean, true)
  where id = v_id
  returning * into b;
  return busqueda_json(b);
end;
$fn$;

create or replace function :"schema".cliente_busqueda_borrar(p_id uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  delete from cliente_busquedas where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'No existe esa búsqueda'; end if;
end;
$fn$;

-- A quién le sirve esta propiedad (búsquedas activas que cumple).
create or replace function :"schema".propiedad_interesados(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  return coalesce((select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'cliente', c.nombre, 'telefono', c.telefono, 'email', c.email,
                                                       'gestion', b.gestion, 'precio_max', b.precio_max, 'notas', b.notas) order by b.created_at desc)
                     from cliente_busquedas b
                     join clientes c on c.id = b.cliente_id and c.deleted_at is null
                     join propiedades pr on pr.id = p_id and pr.empresa_id = s.s_empresa
                     join productos pd on pd.id = pr.producto_id
                    where b.empresa_id = s.s_empresa and b.activa and busqueda_coincide(b, pr, pd.precio_venta)
                      and b.cliente_id is distinct from pr.propietario_id), '[]'::jsonb);
end;
$fn$;

do $do$
declare
  f text;
begin
  foreach f in array array['busqueda_coincide(cliente_busquedas,propiedades,numeric)', 'busqueda_json(cliente_busquedas)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['cliente_inmobiliaria(uuid)', 'cliente_busqueda_guardar(jsonb)', 'cliente_busqueda_borrar(uuid)', 'propiedad_interesados(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
