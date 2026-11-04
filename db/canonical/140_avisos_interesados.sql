-- =============================================================================
-- AVISOS A INTERESADOS EN INMOBILIARIA (pendiente de la 134, pedido del dueño 4-nov-2026).
--
--   Cuando una propiedad queda disponible (o reservada) y cumple la búsqueda activa de un cliente:
--   · propiedad_avisos: un aviso por propiedad × búsqueda (nunca se repite el mismo par), pendiente
--     hasta que alguien lo resuelve: enviado (por WhatsApp u otro medio) o descartado.
--   · Aviso INTERNO en la campanita (usuario_notificaciones, tipo inmo_interesados): a quien cargó
--     la búsqueda si sigue activo; si no, a los administradores. Uno por propiedad.
--   · El mensaje al CLIENTE no sale solo: el vendedor lo abre en WhatsApp con el texto armado y lo
--     envía (como los presupuestos); al hacerlo el aviso queda "enviado" y va al historial del cliente.
--   Se dispara al guardar la propiedad, al cambiar su estado (anular la venta, terminar el alquiler)
--   o al bajar el precio (disparador diferido: corre al confirmar, con el producto ya guardado).
--
-- IDEMPOTENTE. Va después de 137 (138 y 139 son de la sesión de Sorteos).
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

create table if not exists :"schema".propiedad_avisos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  propiedad_id uuid not null references :"schema".propiedades(id) on delete cascade,
  busqueda_id uuid not null references :"schema".cliente_busquedas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'descartado')),
  canal text check (canal is null or canal in ('whatsapp', 'otro')),
  created_at timestamptz not null default now(),
  resuelto_at timestamptz,
  resuelto_por uuid references :"schema".usuarios(id) on delete set null,
  unique (propiedad_id, busqueda_id)
);
create index if not exists propiedad_avisos_pendientes_idx on :"schema".propiedad_avisos (empresa_id, created_at desc) where estado = 'pendiente';
alter table :"schema".propiedad_avisos enable row level security;
alter table :"schema".propiedad_avisos force row level security;
revoke all on :"schema".propiedad_avisos from public, anon, authenticated;
grant all on :"schema".propiedad_avisos to service_role;

-- Interna (sin sesión: la llaman los disparadores). Crea los avisos nuevos y la notificación.
create or replace function :"schema".inmo_generar_avisos(p_propiedad uuid)
returns integer language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  pr propiedades;
  v_titulo text;
  v_nuevos integer;
begin
  select * into pr from propiedades where id = p_propiedad;
  if pr.id is null or pr.estado not in ('disponible', 'reservada') then return 0; end if;
  select nombre into v_titulo from productos where id = pr.producto_id;

  -- Una sola sentencia: crea los avisos nuevos y, por persona, una notificación (la que cargó la
  -- búsqueda si sigue activa; si no, los administradores).
  with nuevos as (
    insert into propiedad_avisos (empresa_id, propiedad_id, busqueda_id, cliente_id)
    select pr.empresa_id, pr.id, b.id, b.cliente_id
      from cliente_busquedas b
      join clientes c on c.id = b.cliente_id and c.deleted_at is null
      join productos pd on pd.id = pr.producto_id
     where b.empresa_id = pr.empresa_id and b.activa and busqueda_coincide(b, pr, pd.precio_venta)
       and b.cliente_id is distinct from pr.propietario_id
    on conflict (propiedad_id, busqueda_id) do nothing
    returning busqueda_id, cliente_id),
  con_autor as (select n.busqueda_id, n.cliente_id, b.created_by from nuevos n join cliente_busquedas b on b.id = n.busqueda_id),
  notif as (
  insert into usuario_notificaciones (empresa_id, usuario_id, tipo, bandeja, titulo, cuerpo, url)
  select pr.empresa_id, x.usuario_id, 'inmo_interesados', 'general',
         left(x.cant || case when x.cant = 1 then ' cliente busca algo como ' else ' clientes buscan algo como ' end || coalesce(pr.codigo, 'esta propiedad'), 200),
         left(coalesce(v_titulo, '') || ' · ' || x.nombres || ' · avisales por WhatsApp', 500),
         '/inmobiliaria?propiedad=' || pr.id
    from (select u.id as usuario_id, count(*) as cant, string_agg(distinct c.nombre, ', ') as nombres
            from con_autor n
            join clientes c on c.id = n.cliente_id
            join usuarios u on u.empresa_id = pr.empresa_id and u.activo
             and (u.id = n.created_by
                  or (u.rol = 'ADMIN' and not exists (select 1 from usuarios w where w.id = n.created_by and w.activo and w.empresa_id = pr.empresa_id)))
           group by u.id) x
  returning 1)
  select (select count(*) from nuevos) into v_nuevos;
  return v_nuevos;
end;
$fn$;
revoke all on function :"schema".inmo_generar_avisos(uuid) from public, anon, authenticated;
grant execute on function :"schema".inmo_generar_avisos(uuid) to service_role;

-- Disparadores diferidos: al confirmar la transacción el precio (productos) ya está guardado.
create or replace function :"schema".tg_propiedad_avisos()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_id uuid;
begin
  if tg_table_name = 'productos' then
    for v_id in select id from propiedades where producto_id = new.id loop perform inmo_generar_avisos(v_id); end loop;
  else
    perform inmo_generar_avisos(new.id);
  end if;
  return null;
end;
$fn$;
revoke all on function :"schema".tg_propiedad_avisos() from public, anon, authenticated;

drop trigger if exists trg_propiedad_avisos on :"schema".propiedades;
create constraint trigger trg_propiedad_avisos after insert or update on :"schema".propiedades
  deferrable initially deferred for each row execute function :"schema".tg_propiedad_avisos();

drop trigger if exists trg_producto_propiedad_avisos on :"schema".productos;
create constraint trigger trg_producto_propiedad_avisos after update of precio_venta on :"schema".productos
  deferrable initially deferred for each row
  when (new.precio_venta is distinct from old.precio_venta)
  execute function :"schema".tg_propiedad_avisos();

-- Una búsqueda guardada: las propiedades que ya le sirven se ven en la ficha del cliente (quien la
-- carga las está viendo), así que no se avisan: quedan como conocidas (descartadas de entrada) y no
-- salta después un aviso de algo que ya sabía. Solo en UPDATE: cliente_busqueda_guardar inserta la
-- búsqueda vacía y después le pone los filtros (en el insert coincidiría con todo).
create or replace function :"schema".tg_busqueda_avisos_conocidos()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if not new.activa then return null; end if;
  insert into propiedad_avisos (empresa_id, propiedad_id, busqueda_id, cliente_id, estado, resuelto_at, resuelto_por)
  select new.empresa_id, pr.id, new.id, new.cliente_id, 'descartado', now(), new.created_by
    from propiedades pr join productos pd on pd.id = pr.producto_id
   where pr.empresa_id = new.empresa_id and busqueda_coincide(new, pr, pd.precio_venta)
     and new.cliente_id is distinct from pr.propietario_id
  on conflict (propiedad_id, busqueda_id) do nothing;
  return null;
end;
$fn$;
revoke all on function :"schema".tg_busqueda_avisos_conocidos() from public, anon, authenticated;
drop trigger if exists trg_busqueda_avisos_conocidos on :"schema".cliente_busquedas;
create trigger trg_busqueda_avisos_conocidos after update on :"schema".cliente_busquedas
  for each row execute function :"schema".tg_busqueda_avisos_conocidos();

-- Fila de aviso para la pantalla (con lo necesario para armar el WhatsApp).
create or replace function :"schema".propiedad_aviso_json(a propiedad_avisos)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', a.id, 'estado', a.estado, 'canal', a.canal, 'created_at', a.created_at, 'resuelto_at', a.resuelto_at,
    'propiedad_id', pr.id, 'codigo', pr.codigo, 'titulo', pd.nombre, 'ciudad', pr.ciudad, 'barrio', pr.barrio,
    'gestion', b.gestion, 'precio_venta', pd.precio_venta, 'precio_alquiler', pr.precio_alquiler, 'imagen_url', pd.imagen_url,
    'cliente_id', c.id, 'cliente', c.nombre, 'telefono', c.telefono, 'email', c.email, 'notas', b.notas,
    'empresa', (select coalesce(nullif(btrim(e.nombre_fantasia), ''), e.nombre) from empresas e where e.id = a.empresa_id))
    from propiedades pr
    join productos pd on pd.id = pr.producto_id
    join clientes c on c.id = a.cliente_id
    join cliente_busquedas b on b.id = a.busqueda_id
   where pr.id = a.propiedad_id
$$;
revoke all on function :"schema".propiedad_aviso_json(propiedad_avisos) from public, anon, authenticated;
grant execute on function :"schema".propiedad_aviso_json(propiedad_avisos) to service_role;

-- Pendientes de la empresa (o de una propiedad, todos los estados).
create or replace function :"schema".propiedad_avisos_lista(p_propiedad uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inmo_sesion();
  return coalesce((select jsonb_agg(propiedad_aviso_json(a) order by a.created_at desc)
                     from propiedad_avisos a
                    where a.empresa_id = s.s_empresa
                      and (case when p_propiedad is null then a.estado = 'pendiente' else a.propiedad_id = p_propiedad end)
                      and (p_propiedad is not null or exists (select 1 from propiedades pr where pr.id = a.propiedad_id and pr.estado in ('disponible', 'reservada')))),
                  '[]'::jsonb);
end;
$fn$;

-- Resolver: enviado (whatsapp | otro) o descartado. Va al historial del cliente.
create or replace function :"schema".propiedad_aviso_resolver(p_id uuid, p_estado text, p_canal text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a propiedad_avisos;
begin
  select * into s from inmo_sesion();
  if p_estado not in ('enviado', 'descartado', 'pendiente') then raise exception 'Estado de aviso inválido'; end if;
  if p_estado = 'enviado' and coalesce(p_canal, '') not in ('whatsapp', 'otro') then raise exception 'Falta por dónde se avisó'; end if;
  update propiedad_avisos
     set estado = p_estado, canal = case when p_estado = 'enviado' then p_canal end,
         resuelto_at = case when p_estado = 'pendiente' then null else now() end,
         resuelto_por = case when p_estado = 'pendiente' then null else s.s_usuario end
   where id = p_id and empresa_id = s.s_empresa
  returning * into a;
  if a.id is null then raise exception 'No existe ese aviso'; end if;
  if p_estado = 'enviado' then
    perform registrar_historial_cliente(a.cliente_id, 'inmobiliaria',
      jsonb_build_object('evento', 'aviso_propiedad', 'propiedad_id', a.propiedad_id,
                         'codigo', (select codigo from propiedades where id = a.propiedad_id), 'canal', p_canal));
  end if;
  -- Sin pendientes de esa propiedad: la notificación ya no hace falta.
  if not exists (select 1 from propiedad_avisos where propiedad_id = a.propiedad_id and estado = 'pendiente') then
    delete from usuario_notificaciones where empresa_id = s.s_empresa and tipo = 'inmo_interesados' and url = '/inmobiliaria?propiedad=' || a.propiedad_id;
  end if;
  return propiedad_aviso_json(a);
end;
$fn$;

do $do$
declare
  f text;
begin
  foreach f in array array['propiedad_avisos_lista(uuid)', 'propiedad_aviso_resolver(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$do$;

-- Lo que ya coincide hoy cuenta como conocido (no se avisa de golpe todo lo viejo).
insert into :"schema".propiedad_avisos (empresa_id, propiedad_id, busqueda_id, cliente_id, estado, resuelto_at)
select b.empresa_id, pr.id, b.id, b.cliente_id, 'descartado', now()
  from :"schema".cliente_busquedas b
  join :"schema".propiedades pr on pr.empresa_id = b.empresa_id
  join :"schema".productos pd on pd.id = pr.producto_id
 where b.activa and :"schema".busqueda_coincide(b, pr, pd.precio_venta) and b.cliente_id is distinct from pr.propietario_id
on conflict (propiedad_id, busqueda_id) do nothing;

commit;

notify pgrst, 'reload schema';
