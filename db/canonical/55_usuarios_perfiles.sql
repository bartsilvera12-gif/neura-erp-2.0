-- =============================================================================
-- USUARIOS Y PERFILES (Configuración › Usuarios). Perfiles = roles configurables con
-- pantallas y permisos; los permisos se cumplen en la API (withTenant) Y en la base.
--
--   perfiles              empresa, nombre, sistema (Administrador / Supervisor / Cajero /
--                         Vendedor, sembrados), nivel_base (el rol de siempre: ADMIN /
--                         SUPERVISOR / CAJERO / VENDEDOR), alcance_sucursal (propia | todas)
--                         y tope_descuento_pct (null = sin tope).
--   perfil_pantallas      pantallas del menú que ve el perfil (href del registro de módulos).
--   perfil_permisos       acciones sensibles (catálogo: permisos_catalogo()).
--   usuarios.perfil_id    el perfil del usuario. usuarios.rol queda SINCRONIZADO con el
--                         nivel_base del perfil (trigger): todo lo que hoy chequea rol sigue igual.
--   usuarios_historial    quién cambió qué (usuarios y perfiles).
--
-- Reglas en la base:
--   · tiene_permiso(p)     ¿el perfil de la sesión tiene p? (Administrador: todo). Se usa en
--                          las funciones críticas (anular venta, cerrar/abrir caja, retiros,
--                          crear_venta: descuentos / precio manual / crédito con el tope del
--                          perfil, aprobar transferencias, aprobar pérdidas, reportes) y en
--                          triggers guardianes (anular compra / gasto / cobro / pago, traslados,
--                          ajustes, precios de productos) que valen aunque se llame directo.
--   · alcance_todas()      ADMIN o perfil con alcance "todas": ve y opera todas las sucursales.
--   · Escritura de usuarios / empresas: SOLO por funciones SECURITY DEFINER (admin_*). Se le
--     quita INSERT/UPDATE/DELETE a authenticated (podía ponerse ADMIN o borrar la empresa).
--   · No se desactiva ni se cambia de perfil al último Administrador; nadie se desactiva solo.
-- IDEMPOTENTE. SECURITY DEFINER + search_path fijo.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
create table if not exists :"schema".perfiles (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references :"schema".empresas(id) on delete cascade,
  nombre             text not null,
  descripcion        text,
  codigo             text check (codigo in ('ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR')),
  sistema            boolean not null default false,
  nivel_base         text not null default 'VENDEDOR' check (nivel_base in ('ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR')),
  alcance_sucursal   text not null default 'propia' check (alcance_sucursal in ('propia', 'todas')),
  tope_descuento_pct numeric(5, 2) check (tope_descuento_pct is null or (tope_descuento_pct >= 0 and tope_descuento_pct <= 100)),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists perfiles_nombre_uk on :"schema".perfiles (empresa_id, lower(nombre));
create unique index if not exists perfiles_codigo_uk on :"schema".perfiles (empresa_id, codigo) where codigo is not null;

create table if not exists :"schema".perfil_pantallas (
  perfil_id  uuid not null references :"schema".perfiles(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  pantalla   text not null,
  primary key (perfil_id, pantalla)
);

create table if not exists :"schema".perfil_permisos (
  perfil_id  uuid not null references :"schema".perfiles(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  permiso    text not null,
  primary key (perfil_id, permiso)
);

alter table :"schema".usuarios add column if not exists perfil_id   uuid references :"schema".perfiles(id);
alter table :"schema".usuarios add column if not exists nombres     text;
alter table :"schema".usuarios add column if not exists apellidos   text;
alter table :"schema".usuarios add column if not exists ci          text;
alter table :"schema".usuarios add column if not exists telefono    text;
-- origen: 'invitado' (la cuenta se creó desde esta pantalla), 'vinculado' (el email ya tenía
-- cuenta en el servidor de auth compartido: solo se lo sumó a la empresa) o 'existente'.
alter table :"schema".usuarios add column if not exists origen      text not null default 'existente';
alter table :"schema".usuarios add column if not exists invitado_at timestamptz;
alter table :"schema".usuarios add column if not exists updated_at  timestamptz;
create index if not exists usuarios_perfil_idx on :"schema".usuarios (perfil_id);

create table if not exists :"schema".usuarios_historial (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references :"schema".empresas(id) on delete cascade,
  objeto        text not null check (objeto in ('usuario', 'perfil')),
  usuario_id    uuid references :"schema".usuarios(id) on delete set null,
  perfil_id     uuid references :"schema".perfiles(id) on delete set null,
  objeto_nombre text,
  accion        text not null,
  detalle       jsonb not null default '{}'::jsonb,
  actor_id      uuid references :"schema".usuarios(id) on delete set null,
  actor_nombre  text,
  created_at    timestamptz not null default now()
);
create index if not exists usuarios_historial_emp_idx on :"schema".usuarios_historial (empresa_id, created_at desc);
create index if not exists usuarios_historial_usr_idx on :"schema".usuarios_historial (usuario_id, created_at desc);
create index if not exists usuarios_historial_per_idx on :"schema".usuarios_historial (perfil_id, created_at desc);

-- =============================================================================
-- 2. Catálogo de permisos (el mismo que src/modules/usuarios/permisos.ts)
-- =============================================================================
create or replace function :"schema".permisos_catalogo()
returns table (codigo text, nombre text, grupo text)
language sql immutable set search_path = :"schema", public as $$
  values
    ('ver_costos',                 'Ver costos y márgenes',                         'Ventas y caja'),
    ('anular_ventas',              'Anular ventas',                                 'Ventas y caja'),
    ('anular_ventas_cerradas',     'Anular ventas de turnos cerrados',              'Ventas y caja'),
    ('descuentos_precio',          'Dar descuentos y cambiar precios en caja',      'Ventas y caja'),
    ('vender_credito',             'Vender a crédito',                              'Ventas y caja'),
    ('abrir_cerrar_caja',          'Abrir y cerrar caja',                           'Ventas y caja'),
    ('movimientos_caja',           'Retiros e ingresos de efectivo',                'Ventas y caja'),
    ('ver_cajas_otras_sucursales', 'Ver cajas de otras sucursales',                 'Ventas y caja'),
    ('registrar_cobros',           'Registrar cobros',                              'Cobranzas'),
    ('registrar_transferencias',   'Cargar transferencias para conciliar',          'Cobranzas'),
    ('aprobar_transferencias',     'Aprobar y rechazar transferencias',             'Cobranzas'),
    ('anular_cobros',              'Anular cobros',                                 'Cobranzas'),
    ('registrar_compras',          'Registrar compras',                             'Compras y gastos'),
    ('anular_compras',             'Anular compras',                                'Compras y gastos'),
    ('registrar_gastos',           'Registrar gastos',                              'Compras y gastos'),
    ('anular_gastos',              'Anular gastos',                                 'Compras y gastos'),
    ('pagar_proveedores',          'Pagar a proveedores',                           'Compras y gastos'),
    ('editar_productos',           'Crear y editar productos y precios',            'Inventario'),
    ('ajustes_inventario',         'Ajustes de inventario',                         'Inventario'),
    ('registrar_perdidas',         'Cargar pérdidas',                               'Inventario'),
    ('aprobar_perdidas',           'Aprobar ajustes y pérdidas',                    'Inventario'),
    ('crear_traslados',            'Crear y anular traslados',                      'Inventario'),
    ('recibir_traslados',          'Recibir traslados',                             'Inventario'),
    ('ver_cierres_caja',           'Ver cierres de caja',                           'Reportes'),
    ('ver_reportes_financieros',   'Ver reportes financieros',                      'Reportes'),
    ('exportar',                   'Exportar a Excel y PDF',                        'Reportes'),
    ('administrar_usuarios',       'Administrar usuarios y perfiles',               'Administración'),
    ('configuracion',              'Configuración del sistema',                     'Administración')
$$;

create or replace function :"schema".permiso_nombre(p text)
returns text language sql immutable set search_path = :"schema", public as $$
  select coalesce((select c.nombre from permisos_catalogo() c where c.codigo = p), p)
$$;

-- =============================================================================
-- 3. Sesión con perfil y helpers de permiso
-- =============================================================================

-- Usuario de la sesión con su perfil EFECTIVO (el suyo; si no tiene, el de sistema de su rol).
create or replace function :"schema".perfil_sesion(
  out p_usuario uuid, out p_empresa uuid, out p_rol text, out p_perfil uuid, out p_codigo text,
  out p_alcance text, out p_tope numeric, out p_sucursal uuid, out p_nombre text)
language sql stable security definer set search_path = :"schema", public as $$
  select u.id, u.empresa_id, upper(u.rol), pf.id, pf.codigo, pf.alcance_sucursal, pf.tope_descuento_pct, u.sucursal_id, u.nombre
    from usuarios u
    left join perfiles pf on pf.id = coalesce(u.perfil_id,
         (select x.id from perfiles x where x.empresa_id = u.empresa_id and x.codigo = upper(u.rol)))
   where u.auth_user_id = auth.uid() and u.activo
   limit 1
$$;

-- ¿El perfil de la sesión tiene el permiso? Administrador: todos. Sin sesión: no.
create or replace function :"schema".tiene_permiso(p_permiso text)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((
    select s.p_codigo = 'ADMIN'
        or exists (select 1 from perfil_permisos pp where pp.perfil_id = s.p_perfil and pp.permiso = p_permiso)
      from perfil_sesion() s
     where s.p_usuario is not null), false)
$$;

-- ¿Ve y opera todas las sucursales? (nivel ADMIN o perfil con alcance "todas")
create or replace function :"schema".alcance_todas()
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((select s.p_rol = 'ADMIN' or s.p_alcance = 'todas' from perfil_sesion() s where s.p_usuario is not null), false)
$$;

-- Corta con un mensaje claro si el perfil no tiene el permiso.
create or replace function :"schema".exigir_permiso(p_permiso text)
returns void language plpgsql stable security definer set search_path = :"schema", public as $fn$
begin
  if not tiene_permiso(p_permiso) then
    raise exception 'Tu perfil no tiene permiso para: %', lower(permiso_nombre(p_permiso))
      using errcode = '42501', hint = 'permiso:' || p_permiso;
  end if;
end;
$fn$;

-- Trigger guardián genérico. tg_argv[0] = permisos aceptados ('a|b' = cualquiera de ellos);
-- tg_argv[1] = columna: en UPDATE solo se exige cuando pasa de null a un valor (anulado_at…).
-- Sin usuario en la sesión (service role, cron, migraciones) no se exige nada.
create or replace function :"schema".tg_exige_permiso()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_perms text[] := string_to_array(tg_argv[0], '|');
  v_col text := nullif(coalesce(tg_argv[1], ''), '');
  p text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    if v_col is null then return new; end if;
    if (to_jsonb(old) ->> v_col) is not null or (to_jsonb(new) ->> v_col) is null then return new; end if;
  end if;
  foreach p in array v_perms loop
    if tiene_permiso(p) then return new; end if;
  end loop;
  perform exigir_permiso(v_perms[1]);
  return new;
end;
$fn$;

-- Ajustes y pérdidas: cargar (según el tipo), aplicar / rechazar (aprobar) y anular.
create or replace function :"schema".tg_ajustes_exige_permiso()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    perform exigir_permiso(case when new.tipo = 'perdida' then 'registrar_perdidas' else 'ajustes_inventario' end);
    if new.estado = 'aplicado' then perform exigir_permiso('aprobar_perdidas'); end if;
  elsif new.estado is distinct from old.estado then
    if new.estado in ('aplicado', 'rechazado') then perform exigir_permiso('aprobar_perdidas');
    elsif new.estado = 'anulado' then perform exigir_permiso('ajustes_inventario');
    end if;
  end if;
  return new;
end;
$fn$;

-- Productos: alta y cambios de precio / descuento de lista.
create or replace function :"schema".tg_productos_exige_permiso()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.precio_venta is not distinct from old.precio_venta
     and new.precio_mayorista is not distinct from old.precio_mayorista
     and new.precio_distribuidor is not distinct from old.precio_distribuidor
     and new.descuento_pct is not distinct from old.descuento_pct then
    return new;
  end if;
  perform exigir_permiso('editar_productos');
  return new;
end;
$fn$;

-- Ventas (aunque se escriba la tabla directo) y transferencias de Conciliación.
create or replace function :"schema".tg_ventas_exige_permiso()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if auth.uid() is null then return new; end if;
  if new.estado = 'anulada' and old.estado is distinct from 'anulada' then perform exigir_permiso('anular_ventas'); end if;
  return new;
end;
$fn$;

create or replace function :"schema".tg_cobros_pendientes_exige_permiso()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if auth.uid() is null then return new; end if;
  if new.estado is distinct from old.estado and new.estado in ('aprobado', 'rechazado', 'anulado') then
    perform exigir_permiso('aprobar_transferencias');
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_compras_permiso_alta on :"schema".compras;
create trigger trg_compras_permiso_alta before insert on :"schema".compras
  for each row execute function :"schema".tg_exige_permiso('registrar_compras', '');
drop trigger if exists trg_compras_permiso_anular on :"schema".compras;
create trigger trg_compras_permiso_anular before update of anulada_at on :"schema".compras
  for each row execute function :"schema".tg_exige_permiso('anular_compras', 'anulada_at');

drop trigger if exists trg_gastos_permiso_alta on :"schema".gastos;
create trigger trg_gastos_permiso_alta before insert on :"schema".gastos
  for each row execute function :"schema".tg_exige_permiso('registrar_gastos', '');
drop trigger if exists trg_gastos_permiso_anular on :"schema".gastos;
create trigger trg_gastos_permiso_anular before update of anulado_at on :"schema".gastos
  for each row execute function :"schema".tg_exige_permiso('anular_gastos', 'anulado_at');

drop trigger if exists trg_pagos_prov_permiso_alta on :"schema".pagos_proveedores;
create trigger trg_pagos_prov_permiso_alta before insert on :"schema".pagos_proveedores
  for each row execute function :"schema".tg_exige_permiso('pagar_proveedores', '');
drop trigger if exists trg_pagos_prov_permiso_anular on :"schema".pagos_proveedores;
create trigger trg_pagos_prov_permiso_anular before update of anulado_at on :"schema".pagos_proveedores
  for each row execute function :"schema".tg_exige_permiso('pagar_proveedores', 'anulado_at');

-- Un cobro nace en caja (registrar_cobros) o al aprobar una transferencia (aprobar_transferencias).
drop trigger if exists trg_cobros_permiso_alta on :"schema".cobros_clientes;
create trigger trg_cobros_permiso_alta before insert on :"schema".cobros_clientes
  for each row execute function :"schema".tg_exige_permiso('registrar_cobros|aprobar_transferencias', '');
drop trigger if exists trg_cobros_permiso_anular on :"schema".cobros_clientes;
create trigger trg_cobros_permiso_anular before update of anulado_at on :"schema".cobros_clientes
  for each row execute function :"schema".tg_exige_permiso('anular_cobros|aprobar_transferencias', 'anulado_at');

drop trigger if exists trg_traslados_permiso_alta on :"schema".traslados;
create trigger trg_traslados_permiso_alta before insert on :"schema".traslados
  for each row execute function :"schema".tg_exige_permiso('crear_traslados', '');
drop trigger if exists trg_traslados_permiso_recibir on :"schema".traslados;
create trigger trg_traslados_permiso_recibir before update of recibido_at on :"schema".traslados
  for each row execute function :"schema".tg_exige_permiso('recibir_traslados', 'recibido_at');
drop trigger if exists trg_traslados_permiso_anular on :"schema".traslados;
create trigger trg_traslados_permiso_anular before update of anulado_at on :"schema".traslados
  for each row execute function :"schema".tg_exige_permiso('crear_traslados', 'anulado_at');

drop trigger if exists trg_ajustes_permiso on :"schema".ajustes_inventario;
create trigger trg_ajustes_permiso before insert or update of estado on :"schema".ajustes_inventario
  for each row execute function :"schema".tg_ajustes_exige_permiso();

drop trigger if exists trg_productos_permiso on :"schema".productos;
create trigger trg_productos_permiso
  before insert or update of precio_venta, precio_mayorista, precio_distribuidor, descuento_pct on :"schema".productos
  for each row execute function :"schema".tg_productos_exige_permiso();

drop trigger if exists trg_ventas_permiso_anular on :"schema".ventas;
create trigger trg_ventas_permiso_anular before update of estado on :"schema".ventas
  for each row execute function :"schema".tg_ventas_exige_permiso();

drop trigger if exists trg_cobros_pendientes_permiso on :"schema".cobros_pendientes;
create trigger trg_cobros_pendientes_permiso before update of estado on :"schema".cobros_pendientes
  for each row execute function :"schema".tg_cobros_pendientes_exige_permiso();

-- =============================================================================
-- 4. Perfiles de sistema (sembrados por empresa) y sincronización usuarios.rol
-- =============================================================================
create or replace function :"schema".perfiles_sistema_asegurar(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  v_id uuid;
  v_nombre text;
  -- Pantallas que hoy ven todos los roles (los módulos sin `roles` + Caja + Presupuestos).
  v_comun text[] := array[
    '/clientes', '/crm', '/presupuestos', '/clientes/gestion', '/clientes/suscripciones', '/clientes/agenda', '/proyectos',
    '/caja/nueva', '/caja/turnos', '/caja', '/caja/credito', '/cobranzas', '/cobranzas/conciliacion', '/pagos',
    '/conversaciones', '/conversaciones/finalizadas', '/conversaciones/historial',
    '/soporte', '/soporte/tickets', '/soporte/mis-tickets'];
  v_inventario text[] := array['/inventario', '/inventario/movimientos', '/inventario/traslados', '/inventario/ajustes',
    '/inventario/vencimientos', '/inventario/categorias'];
  -- Lo que hoy puede hacer cada rol, de hecho (rutas `roles: [...]` + funciones de la base).
  v_caja text[] := array['anular_ventas', 'descuentos_precio', 'vender_credito', 'abrir_cerrar_caja', 'movimientos_caja',
    'registrar_perdidas', 'recibir_traslados', 'exportar'];
begin
  for r in select * from (values
      ('ADMIN',      'Administrador', 'Acceso total: todas las pantallas y permisos. Administra usuarios y la configuración.', 'todas'),
      ('SUPERVISOR', 'Supervisor',    'Caja de su sucursal, anula ventas de turnos cerrados y ve los cierres de caja.',          'propia'),
      ('CAJERO',     'Cajero',        'Vende y cobra en la caja de su sucursal; carga pérdidas y recibe traslados.',             'propia'),
      ('VENDEDOR',   'Vendedor',      'Vende, cotiza y atiende clientes en su sucursal.',                                        'propia')
    ) x(codigo, nombre, descripcion, alcance) loop
    if exists (select 1 from perfiles where empresa_id = p_empresa and codigo = r.codigo) then continue; end if;
    v_nombre := r.nombre;
    if exists (select 1 from perfiles where empresa_id = p_empresa and lower(nombre) = lower(v_nombre)) then
      v_nombre := v_nombre || ' (sistema)';
    end if;
    insert into perfiles (empresa_id, nombre, descripcion, codigo, sistema, nivel_base, alcance_sucursal)
      values (p_empresa, v_nombre, r.descripcion, r.codigo, true, r.codigo, r.alcance)
      returning id into v_id;
    -- Administrador: todo de forma implícita (sin filas): ve las pantallas y permisos nuevos.
    if r.codigo = 'ADMIN' then continue; end if;
    insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
      select v_id, p_empresa, x from unnest(case r.codigo
        when 'SUPERVISOR' then v_comun || array['/reportes']
        else v_comun || v_inventario end) x
      on conflict do nothing;
    insert into perfil_permisos (perfil_id, empresa_id, permiso)
      select v_id, p_empresa, x from unnest(case r.codigo
        when 'SUPERVISOR' then v_caja || array['anular_ventas_cerradas', 'registrar_transferencias', 'ver_cierres_caja']
        when 'CAJERO'     then v_caja || array['registrar_cobros', 'registrar_transferencias']
        else                   v_caja || array['registrar_cobros'] end) x
      on conflict do nothing;
  end loop;
end;
$fn$;

create or replace function :"schema".tg_empresas_perfiles()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform perfiles_sistema_asegurar(new.id);
  return null;
end;
$fn$;
drop trigger if exists trg_empresas_perfiles on :"schema".empresas;
create trigger trg_empresas_perfiles after insert on :"schema".empresas
  for each row execute function :"schema".tg_empresas_perfiles();

-- usuarios: el perfil manda. Sin perfil → el de sistema de su rol. Si alguien cambia el rol
-- directo (provisión, scripts), pasa al perfil de sistema de ese rol. rol = nivel_base del perfil.
create or replace function :"schema".tg_usuarios_perfil()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_nivel text;
  v_emp uuid;
  v_rol text := upper(coalesce(new.rol, ''));
begin
  if v_rol not in ('ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR') then v_rol := 'VENDEDOR'; end if;
  if tg_op = 'UPDATE' and new.perfil_id is not distinct from old.perfil_id and new.rol is distinct from old.rol
     and new.perfil_id is not null
     and v_rol is distinct from (select nivel_base from perfiles where id = new.perfil_id) then
    new.perfil_id := null;
  end if;
  if new.perfil_id is null then
    select id into new.perfil_id from perfiles where empresa_id = new.empresa_id and codigo = v_rol;
  end if;
  if new.perfil_id is not null then
    select nivel_base, empresa_id into v_nivel, v_emp from perfiles where id = new.perfil_id;
    if v_emp is distinct from new.empresa_id then raise exception 'El perfil no es de esta empresa'; end if;
    new.rol := v_nivel;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_usuarios_perfil on :"schema".usuarios;
create trigger trg_usuarios_perfil before insert or update of perfil_id, rol, empresa_id on :"schema".usuarios
  for each row execute function :"schema".tg_usuarios_perfil();

create or replace function :"schema".tg_perfiles_nivel()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.nivel_base is distinct from old.nivel_base then
    update usuarios set rol = new.nivel_base where perfil_id = new.id;
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_perfiles_nivel on :"schema".perfiles;
create trigger trg_perfiles_nivel after update of nivel_base on :"schema".perfiles
  for each row execute function :"schema".tg_perfiles_nivel();

-- =============================================================================
-- 5. Lectura de la sesión para el servidor (service role): perfil, pantallas y permisos
-- =============================================================================
create or replace function :"schema".sesion_perfil(p_auth uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'usuario_id', u.id, 'empresa_id', u.empresa_id, 'rol', upper(u.rol), 'activo', u.activo, 'nombre', u.nombre,
    'sucursal_id', u.sucursal_id,
    'perfil_id', pf.id, 'perfil_nombre', pf.nombre, 'perfil_codigo', pf.codigo,
    'alcance_sucursal', coalesce(pf.alcance_sucursal, case when upper(u.rol) = 'ADMIN' then 'todas' else 'propia' end),
    'tope_descuento_pct', pf.tope_descuento_pct,
    'todo', coalesce(pf.codigo = 'ADMIN', false),
    'pantallas', coalesce((select jsonb_agg(pp.pantalla order by pp.pantalla) from perfil_pantallas pp where pp.perfil_id = pf.id), '[]'::jsonb),
    'permisos', case when pf.codigo = 'ADMIN' then (select jsonb_agg(c.codigo) from permisos_catalogo() c)
                     else coalesce((select jsonb_agg(pp.permiso order by pp.permiso) from perfil_permisos pp where pp.perfil_id = pf.id), '[]'::jsonb) end)
    from usuarios u
    left join perfiles pf on pf.id = coalesce(u.perfil_id,
         (select x.id from perfiles x where x.empresa_id = u.empresa_id and x.codigo = upper(u.rol)))
   where u.auth_user_id = p_auth
   limit 1
$$;

-- ¿Existe ya una cuenta con este email en el servidor de auth (compartido por la flota)?
-- Solo service role. Devuelve también si ya es usuario de una empresa de ESTE schema.
create or replace function :"schema".auth_buscar_email(p_email text)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((
    select jsonb_build_object(
      'auth_user_id', au.id, 'email', au.email, 'confirmado', au.email_confirmed_at is not null,
      'ultimo_ingreso', au.last_sign_in_at,
      'usuario', (select jsonb_build_object('id', u.id, 'empresa_id', u.empresa_id, 'activo', u.activo)
                    from usuarios u where u.auth_user_id = au.id))
      from auth.users au
     where lower(au.email) = lower(btrim(p_email))
     order by au.created_at
     limit 1), '{}'::jsonb)
$$;

-- Datos de auth de un usuario de la empresa (para reenviar invitación / restablecer).
create or replace function :"schema".auth_usuario_info(p_usuario uuid, p_empresa uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((
    select jsonb_build_object(
      'usuario_id', u.id, 'auth_user_id', u.auth_user_id, 'nombre', u.nombre, 'origen', u.origen, 'activo', u.activo,
      'email', coalesce(au.email, u.email), 'existe', au.id is not null,
      'confirmado', au.email_confirmed_at is not null, 'ultimo_ingreso', au.last_sign_in_at)
      from usuarios u left join auth.users au on au.id = u.auth_user_id
     where u.id = p_usuario and u.empresa_id = p_empresa), '{}'::jsonb)
$$;

-- =============================================================================
-- 6. Administración (pantalla Configuración › Usuarios). Nivel ADMIN + administrar_usuarios.
-- =============================================================================
create or replace function :"schema".usr_admin_sesion(out s_empresa uuid, out s_usuario uuid, out s_nombre text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(array['ADMIN']);
  perform exigir_permiso('administrar_usuarios');
  s_empresa := s.s_empresa;
  s_usuario := s.s_usuario;
  s_nombre := s.s_nombre;
end;
$fn$;

create or replace function :"schema".usr_historial(
  p_empresa uuid, p_objeto text, p_usuario uuid, p_perfil uuid, p_nombre text, p_accion text, p_detalle jsonb,
  p_actor uuid, p_actor_nombre text)
returns void language sql security definer set search_path = :"schema", public as $$
  insert into usuarios_historial (empresa_id, objeto, usuario_id, perfil_id, objeto_nombre, accion, detalle, actor_id, actor_nombre)
  values (p_empresa, p_objeto, p_usuario, p_perfil, p_nombre, p_accion, coalesce(p_detalle, '{}'::jsonb), p_actor, p_actor_nombre)
$$;

-- Usuarios con perfil, sucursal, estado e ingreso + lo que necesita la pantalla.
create or replace function :"schema".admin_listar_usuarios()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from usr_admin_sesion();
  return jsonb_build_object(
    'mi_usuario_id', s.s_usuario,
    'usuarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre, 'nombres', coalesce(u.nombres, u.nombre), 'apellidos', u.apellidos,
        'ci', u.ci, 'telefono', u.telefono, 'email', coalesce(u.email, au.email),
        'rol', upper(u.rol), 'perfil_id', u.perfil_id, 'perfil_nombre', pf.nombre, 'perfil_codigo', pf.codigo,
        'sucursal_id', u.sucursal_id, 'sucursal_nombre', su.nombre, 'activo', u.activo,
        'es_tecnico', u.es_tecnico, 'es_qa', u.es_qa, 'usa_soporte', u.usa_soporte,
        'origen', u.origen, 'creado_at', u.creado_at, 'invitado_at', u.invitado_at, 'updated_at', u.updated_at,
        'ultimo_ingreso', au.last_sign_in_at, 'email_confirmado', au.email_confirmed_at is not null,
        'pendiente', au.id is not null and au.last_sign_in_at is null,
        'sin_cuenta', au.id is null,
        'es_yo', u.id = s.s_usuario
      ) order by u.activo desc, lower(u.nombre))
        from usuarios u
        left join perfiles pf on pf.id = u.perfil_id
        left join sucursales su on su.id = u.sucursal_id
        left join auth.users au on au.id = u.auth_user_id
       where u.empresa_id = s.s_empresa), '[]'::jsonb),
    'perfiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', pf.id, 'nombre', pf.nombre, 'codigo', pf.codigo, 'sistema', pf.sistema,
                                          'nivel_base', pf.nivel_base, 'alcance_sucursal', pf.alcance_sucursal)
                       order by pf.sistema desc, case pf.codigo when 'ADMIN' then 1 when 'SUPERVISOR' then 2 when 'CAJERO' then 3 when 'VENDEDOR' then 4 else 5 end, lower(pf.nombre))
        from perfiles pf where pf.empresa_id = s.s_empresa), '[]'::jsonb),
    'sucursales', coalesce((
      select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre, 'activa', su.activa, 'es_principal', su.es_principal)
                       order by su.es_principal desc, su.nombre)
        from sucursales su where su.empresa_id = s.s_empresa), '[]'::jsonb)
  );
end;
$fn$;

-- Perfiles con sus pantallas, permisos y cuántos usuarios los usan.
create or replace function :"schema".admin_listar_perfiles()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from usr_admin_sesion();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pf.id, 'nombre', pf.nombre, 'descripcion', pf.descripcion, 'codigo', pf.codigo, 'sistema', pf.sistema,
      'nivel_base', pf.nivel_base, 'alcance_sucursal', pf.alcance_sucursal, 'tope_descuento_pct', pf.tope_descuento_pct,
      'todo', pf.codigo = 'ADMIN',
      'pantallas', coalesce((select jsonb_agg(pp.pantalla order by pp.pantalla) from perfil_pantallas pp where pp.perfil_id = pf.id), '[]'::jsonb),
      'permisos', coalesce((select jsonb_agg(pp.permiso order by pp.permiso) from perfil_permisos pp where pp.perfil_id = pf.id), '[]'::jsonb),
      'usuarios', (select count(*) from usuarios u where u.perfil_id = pf.id and u.activo),
      'usuarios_inactivos', (select count(*) from usuarios u where u.perfil_id = pf.id and not u.activo),
      'updated_at', pf.updated_at
    ) order by pf.sistema desc, case pf.codigo when 'ADMIN' then 1 when 'SUPERVISOR' then 2 when 'CAJERO' then 3 when 'VENDEDOR' then 4 else 5 end, lower(pf.nombre))
      from perfiles pf where pf.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

-- Último administrador: usuarios activos con el perfil Administrador (sin contar p_excepto).
create or replace function :"schema".usr_admins_activos(p_empresa uuid, p_excepto uuid default null)
returns integer language sql stable security definer set search_path = :"schema", public as $$
  select count(*)::integer from usuarios u join perfiles pf on pf.id = u.perfil_id
   where u.empresa_id = p_empresa and u.activo and pf.codigo = 'ADMIN' and u.id is distinct from p_excepto
$$;

-- Alta de un usuario de la empresa. La cuenta de auth ya existe (la creó la invitación del
-- servidor, o es un email que ya tenía cuenta y se VINCULA): se valida que el id de auth
-- corresponda a ese email. Nunca toca la contraseña.
--   p: { auth_user_id, email, nombres, apellidos?, ci?, telefono?, perfil_id, sucursal_id?,
--        es_tecnico?, es_qa?, usa_soporte?, origen: 'invitado'|'vinculado' }
create or replace function :"schema".admin_crear_usuario(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_auth uuid := nullif(p->>'auth_user_id', '')::uuid;
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_nombres text := nullif(btrim(coalesce(p->>'nombres', '')), '');
  v_apellidos text := nullif(btrim(coalesce(p->>'apellidos', '')), '');
  v_perfil uuid := nullif(p->>'perfil_id', '')::uuid;
  v_suc uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_origen text := coalesce(nullif(p->>'origen', ''), 'invitado');
  v_existente record;
  v_pf record;
  v_id uuid;
  v_nombre text;
begin
  select * into s from usr_admin_sesion();
  if v_auth is null or v_email = '' then raise exception 'Falta la cuenta del usuario'; end if;
  if v_origen not in ('invitado', 'vinculado') then raise exception 'Origen inválido'; end if;
  if not exists (select 1 from auth.users au where au.id = v_auth and lower(au.email) = v_email) then
    raise exception 'La cuenta no corresponde a ese email';
  end if;
  if v_nombres is null then raise exception 'Escribí el nombre'; end if;
  select u.id, u.empresa_id into v_existente from usuarios u where u.auth_user_id = v_auth;
  if found then
    if v_existente.empresa_id = s.s_empresa then raise exception 'Ese email ya es usuario de esta empresa'; end if;
    raise exception 'Ese email ya es usuario de otra empresa de este sistema';
  end if;
  select * into v_pf from perfiles where id = v_perfil and empresa_id = s.s_empresa;
  if not found then raise exception 'Elegí el perfil'; end if;
  if v_suc is not null and not exists (select 1 from sucursales where id = v_suc and empresa_id = s.s_empresa and activa) then
    raise exception 'Sucursal no encontrada o inactiva';
  end if;
  v_nombre := btrim(v_nombres || coalesce(' ' || v_apellidos, ''));

  insert into usuarios (auth_user_id, empresa_id, nombre, nombres, apellidos, ci, telefono, email, perfil_id, rol, sucursal_id,
                        es_tecnico, es_qa, usa_soporte, origen, invitado_at, activo, updated_at)
    values (v_auth, s.s_empresa, left(v_nombre, 160), left(v_nombres, 80), left(v_apellidos, 80),
            nullif(left(btrim(coalesce(p->>'ci', '')), 20), ''), nullif(left(btrim(coalesce(p->>'telefono', '')), 40), ''),
            v_email, v_pf.id, v_pf.nivel_base, v_suc,
            coalesce((p->>'es_tecnico')::boolean, false), coalesce((p->>'es_qa')::boolean, false), coalesce((p->>'usa_soporte')::boolean, false),
            v_origen, case when v_origen = 'invitado' then now() end, true, now())
    returning id into v_id;

  perform usr_historial(s.s_empresa, 'usuario', v_id, v_pf.id, v_nombre,
    case when v_origen = 'vinculado' then 'vinculado' else 'creado' end,
    jsonb_build_object('email', v_email, 'perfil', v_pf.nombre,
                       'sucursal', (select nombre from sucursales where id = v_suc)),
    s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- Edición: datos, perfil, sucursal, activo y tildes de Soporte (solo las claves que vienen).
--   No se desactiva ni se cambia de perfil al último Administrador; nadie se desactiva ni se
--   cambia el perfil a sí mismo. Todo cambio queda en usuarios_historial.
create or replace function :"schema".admin_actualizar_usuario(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  u usuarios;
  v_pf_old record;
  v_pf_new record;
  v_cambios jsonb := '{}'::jsonb;
  v_nombres text;
  v_apellidos text;
  v_ci text;
  v_tel text;
  v_perfil uuid;
  v_suc uuid;
  v_activo boolean;
  v_nombre text;
begin
  select * into s from usr_admin_sesion();
  -- Serializa los cambios de usuarios de la empresa (dos admins no se bajan entre sí a la vez).
  perform pg_advisory_xact_lock(hashtextextended('usuarios_admin:' || s.s_empresa::text, 0));
  select * into u from usuarios where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  select * into v_pf_old from perfiles where id = u.perfil_id;

  v_nombres := case when p ? 'nombres' then nullif(btrim(coalesce(p->>'nombres', '')), '') else coalesce(u.nombres, u.nombre) end;
  if v_nombres is null then raise exception 'Escribí el nombre'; end if;
  v_apellidos := case when p ? 'apellidos' then nullif(btrim(coalesce(p->>'apellidos', '')), '') else u.apellidos end;
  v_ci := case when p ? 'ci' then nullif(left(btrim(coalesce(p->>'ci', '')), 20), '') else u.ci end;
  v_tel := case when p ? 'telefono' then nullif(left(btrim(coalesce(p->>'telefono', '')), 40), '') else u.telefono end;
  v_perfil := case when p ? 'perfil_id' then nullif(p->>'perfil_id', '')::uuid else u.perfil_id end;
  v_suc := case when p ? 'sucursal_id' then nullif(p->>'sucursal_id', '')::uuid else u.sucursal_id end;
  v_activo := case when p ? 'activo' then coalesce((p->>'activo')::boolean, u.activo) else u.activo end;

  select * into v_pf_new from perfiles where id = v_perfil and empresa_id = s.s_empresa;
  if not found then raise exception 'Elegí el perfil'; end if;
  if v_suc is distinct from u.sucursal_id and v_suc is not null
     and not exists (select 1 from sucursales where id = v_suc and empresa_id = s.s_empresa and activa) then
    raise exception 'Sucursal no encontrada o inactiva';
  end if;

  if u.id = s.s_usuario then
    if not v_activo then raise exception 'No podés desactivar tu propio usuario'; end if;
    if v_perfil is distinct from u.perfil_id then raise exception 'No podés cambiar tu propio perfil: pedíselo a otro administrador'; end if;
  end if;
  if u.activo and v_pf_old.codigo = 'ADMIN' and (not v_activo or v_pf_new.codigo is distinct from 'ADMIN')
     and usr_admins_activos(s.s_empresa, u.id) = 0 then
    raise exception 'Es el último administrador: no se puede desactivar ni cambiar de perfil (primero hacé administrador a otro usuario)';
  end if;

  v_nombre := btrim(v_nombres || coalesce(' ' || v_apellidos, ''));
  if v_nombre is distinct from u.nombre then v_cambios := v_cambios || jsonb_build_object('nombre', jsonb_build_array(u.nombre, v_nombre)); end if;
  if v_ci is distinct from u.ci then v_cambios := v_cambios || jsonb_build_object('ci', jsonb_build_array(u.ci, v_ci)); end if;
  if v_tel is distinct from u.telefono then v_cambios := v_cambios || jsonb_build_object('telefono', jsonb_build_array(u.telefono, v_tel)); end if;
  if v_perfil is distinct from u.perfil_id then
    v_cambios := v_cambios || jsonb_build_object('perfil', jsonb_build_array(v_pf_old.nombre, v_pf_new.nombre));
  end if;
  if v_suc is distinct from u.sucursal_id then
    v_cambios := v_cambios || jsonb_build_object('sucursal', jsonb_build_array(
      (select nombre from sucursales where id = u.sucursal_id), (select nombre from sucursales where id = v_suc)));
  end if;
  if v_activo is distinct from u.activo then v_cambios := v_cambios || jsonb_build_object('activo', jsonb_build_array(u.activo, v_activo)); end if;
  if p ? 'es_tecnico' and (p->>'es_tecnico')::boolean is distinct from u.es_tecnico then
    v_cambios := v_cambios || jsonb_build_object('es_tecnico', jsonb_build_array(u.es_tecnico, (p->>'es_tecnico')::boolean));
  end if;
  if p ? 'es_qa' and (p->>'es_qa')::boolean is distinct from u.es_qa then
    v_cambios := v_cambios || jsonb_build_object('es_qa', jsonb_build_array(u.es_qa, (p->>'es_qa')::boolean));
  end if;
  if p ? 'usa_soporte' and (p->>'usa_soporte')::boolean is distinct from u.usa_soporte then
    v_cambios := v_cambios || jsonb_build_object('usa_soporte', jsonb_build_array(u.usa_soporte, (p->>'usa_soporte')::boolean));
  end if;
  if v_cambios = '{}'::jsonb then return jsonb_build_object('id', u.id, 'cambios', 0); end if;

  update usuarios
     set nombre = left(v_nombre, 160), nombres = left(v_nombres, 80), apellidos = left(v_apellidos, 80), ci = v_ci, telefono = v_tel,
         perfil_id = v_perfil, sucursal_id = v_suc, activo = v_activo,
         es_tecnico = coalesce((p->>'es_tecnico')::boolean, es_tecnico),
         es_qa = coalesce((p->>'es_qa')::boolean, es_qa),
         usa_soporte = coalesce((p->>'usa_soporte')::boolean, usa_soporte),
         updated_at = now()
   where id = u.id;

  perform usr_historial(s.s_empresa, 'usuario', u.id, v_perfil, v_nombre,
    case when v_activo is distinct from u.activo then case when v_activo then 'activado' else 'desactivado' end else 'editado' end,
    v_cambios, s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', u.id, 'cambios', (select count(*) from jsonb_object_keys(v_cambios)));
end;
$fn$;

-- Registro de una acción sobre la cuenta (invitación reenviada, link copiado…) — sin datos sensibles.
create or replace function :"schema".admin_registrar_accion_usuario(p_id uuid, p_accion text, p_detalle jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_nombre text;
begin
  select * into s from usr_admin_sesion();
  if p_accion not in ('invitacion_enviada', 'link_invitacion', 'link_restablecer', 'restablecer_enviado') then
    raise exception 'Acción inválida';
  end if;
  select nombre into v_nombre from usuarios where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Usuario no encontrado'; end if;
  perform usr_historial(s.s_empresa, 'usuario', p_id, null, v_nombre, p_accion, coalesce(p_detalle, '{}'::jsonb), s.s_usuario, s.s_nombre);
end;
$fn$;

-- Alta / edición de un perfil.
--   p: { id?, nombre, descripcion?, nivel_base, alcance_sucursal, tope_descuento_pct?, pantallas[], permisos[] }
--   Administrador: no se edita. Perfiles de sistema: se editan pantallas, permisos, alcance y
--   tope (el nombre y el nivel base quedan fijos).
create or replace function :"schema".admin_guardar_perfil(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old perfiles;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  v_desc text := nullif(left(btrim(coalesce(p->>'descripcion', '')), 300), '');
  v_nivel text := upper(coalesce(nullif(p->>'nivel_base', ''), 'VENDEDOR'));
  v_alcance text := coalesce(nullif(p->>'alcance_sucursal', ''), 'propia');
  v_tope numeric := nullif(p->>'tope_descuento_pct', '')::numeric;
  v_pant text[];
  v_perm text[];
  v_pant_old text[] := '{}';
  v_perm_old text[] := '{}';
  v_invalidos text[];
  v_cambios jsonb := '{}'::jsonb;
begin
  select * into s from usr_admin_sesion();
  perform pg_advisory_xact_lock(hashtextextended('usuarios_admin:' || s.s_empresa::text, 0));
  if v_nombre is null then raise exception 'Escribí el nombre del perfil'; end if;
  if length(v_nombre) > 60 then raise exception 'El nombre es muy largo (máximo 60)'; end if;
  if v_nivel not in ('ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR') then raise exception 'Nivel base inválido'; end if;
  if v_alcance not in ('propia', 'todas') then raise exception 'Alcance inválido'; end if;
  if v_tope is not null and (v_tope < 0 or v_tope > 100) then raise exception 'El tope de descuento va de 0 a 100 %%'; end if;
  if v_nivel = 'ADMIN' then v_alcance := 'todas'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_pant
    from jsonb_array_elements_text(coalesce(p->'pantallas', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x), '{}') into v_perm
    from jsonb_array_elements_text(coalesce(p->'permisos', '[]'::jsonb)) x;
  select array_agg(x) into v_invalidos from unnest(v_pant) x where x !~ '^/[a-z0-9/_-]{0,120}$';
  if v_invalidos is not null then raise exception 'Pantalla inválida: %', v_invalidos[1]; end if;
  select array_agg(x) into v_invalidos from unnest(v_perm) x where x not in (select codigo from permisos_catalogo());
  if v_invalidos is not null then raise exception 'Permiso inválido: %', v_invalidos[1]; end if;
  if not ('descuentos_precio' = any (v_perm)) then v_tope := null; end if;

  if v_id is not null then
    select * into v_old from perfiles where id = v_id and empresa_id = s.s_empresa for update;
    if not found then raise exception 'Perfil no encontrado'; end if;
    if v_old.codigo = 'ADMIN' then raise exception 'El perfil Administrador tiene todo y no se edita'; end if;
    if v_old.sistema then
      v_nombre := v_old.nombre;
      v_nivel := v_old.nivel_base;
    end if;
  end if;
  if exists (select 1 from perfiles where empresa_id = s.s_empresa and lower(nombre) = lower(v_nombre) and id is distinct from v_id) then
    raise exception 'Ya hay un perfil que se llama "%"', v_nombre;
  end if;

  if v_id is null then
    insert into perfiles (empresa_id, nombre, descripcion, sistema, nivel_base, alcance_sucursal, tope_descuento_pct)
      values (s.s_empresa, v_nombre, v_desc, false, v_nivel, v_alcance, v_tope)
      returning id into v_id;
    v_cambios := jsonb_build_object('nivel_base', v_nivel, 'alcance_sucursal', v_alcance, 'tope_descuento_pct', v_tope,
                                    'pantallas', to_jsonb(v_pant), 'permisos', to_jsonb(v_perm));
  else
    select coalesce(array_agg(pantalla), '{}') into v_pant_old from perfil_pantallas where perfil_id = v_id;
    select coalesce(array_agg(permiso), '{}') into v_perm_old from perfil_permisos where perfil_id = v_id;
    if v_nombre is distinct from v_old.nombre then v_cambios := v_cambios || jsonb_build_object('nombre', jsonb_build_array(v_old.nombre, v_nombre)); end if;
    if v_desc is distinct from v_old.descripcion then v_cambios := v_cambios || jsonb_build_object('descripcion', jsonb_build_array(v_old.descripcion, v_desc)); end if;
    if v_nivel is distinct from v_old.nivel_base then v_cambios := v_cambios || jsonb_build_object('nivel_base', jsonb_build_array(v_old.nivel_base, v_nivel)); end if;
    if v_alcance is distinct from v_old.alcance_sucursal then v_cambios := v_cambios || jsonb_build_object('alcance_sucursal', jsonb_build_array(v_old.alcance_sucursal, v_alcance)); end if;
    if v_tope is distinct from v_old.tope_descuento_pct then v_cambios := v_cambios || jsonb_build_object('tope_descuento_pct', jsonb_build_array(v_old.tope_descuento_pct, v_tope)); end if;
    if exists (select unnest(v_pant) except select unnest(v_pant_old)) or exists (select unnest(v_pant_old) except select unnest(v_pant)) then
      v_cambios := v_cambios || jsonb_build_object('pantallas', jsonb_build_object(
        'agregadas', to_jsonb(array(select unnest(v_pant) except select unnest(v_pant_old))),
        'quitadas', to_jsonb(array(select unnest(v_pant_old) except select unnest(v_pant)))));
    end if;
    if exists (select unnest(v_perm) except select unnest(v_perm_old)) or exists (select unnest(v_perm_old) except select unnest(v_perm)) then
      v_cambios := v_cambios || jsonb_build_object('permisos', jsonb_build_object(
        'agregados', to_jsonb(array(select unnest(v_perm) except select unnest(v_perm_old))),
        'quitados', to_jsonb(array(select unnest(v_perm_old) except select unnest(v_perm)))));
    end if;
    if v_cambios = '{}'::jsonb then return jsonb_build_object('id', v_id, 'cambios', 0); end if;
    update perfiles
       set nombre = v_nombre, descripcion = v_desc, nivel_base = v_nivel, alcance_sucursal = v_alcance,
           tope_descuento_pct = v_tope, updated_at = now()
     where id = v_id;
    delete from perfil_pantallas where perfil_id = v_id and not (pantalla = any (v_pant));
    delete from perfil_permisos where perfil_id = v_id and not (permiso = any (v_perm));
  end if;
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla) select v_id, s.s_empresa, x from unnest(v_pant) x on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso) select v_id, s.s_empresa, x from unnest(v_perm) x on conflict do nothing;

  perform usr_historial(s.s_empresa, 'perfil', null, v_id, v_nombre, case when v_old.id is null then 'creado' else 'editado' end,
                        v_cambios, s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', v_id, 'cambios', (select count(*) from jsonb_object_keys(v_cambios)));
end;
$fn$;

-- Eliminar un perfil propio que nadie usa (ni usuarios inactivos).
create or replace function :"schema".admin_eliminar_perfil(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v perfiles;
  v_n integer;
begin
  select * into s from usr_admin_sesion();
  select * into v from perfiles where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Perfil no encontrado'; end if;
  if v.sistema then raise exception 'Los perfiles de sistema no se eliminan'; end if;
  select count(*) into v_n from usuarios where perfil_id = p_id;
  if v_n > 0 then raise exception 'El perfil "%" lo usan % usuario(s): cambiales el perfil antes de eliminarlo', v.nombre, v_n; end if;
  delete from perfiles where id = p_id;
  perform usr_historial(s.s_empresa, 'perfil', null, null, v.nombre, 'eliminado', jsonb_build_object('nivel_base', v.nivel_base), s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', p_id);
end;
$fn$;

-- Historial (de un usuario, de un perfil o de todo).
create or replace function :"schema".admin_historial(p_usuario uuid default null, p_perfil uuid default null, p_limite integer default 100)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from usr_admin_sesion();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id, 'objeto', h.objeto, 'usuario_id', h.usuario_id, 'perfil_id', h.perfil_id, 'nombre', h.objeto_nombre,
      'accion', h.accion, 'detalle', h.detalle, 'actor_nombre', h.actor_nombre, 'created_at', h.created_at) order by h.created_at desc)
      from (select * from usuarios_historial h
             where h.empresa_id = s.s_empresa
               and (p_usuario is null or h.usuario_id = p_usuario)
               and (p_perfil is null or h.perfil_id = p_perfil)
             order by h.created_at desc
             limit greatest(1, least(coalesce(p_limite, 100), 500))) h), '[]'::jsonb);
end;
$fn$;

-- Tildes del equipo de Soporte (Soporte › Configuración › Equipo). Antes era un UPDATE
-- directo a usuarios desde la ruta; ahora pasa por acá (con historial).
create or replace function :"schema".usuario_flags_soporte(p_usuario uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  u usuarios;
  v_cambios jsonb := '{}'::jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  if not (tiene_permiso('configuracion') or tiene_permiso('administrar_usuarios')) then perform exigir_permiso('configuracion'); end if;
  select * into u from usuarios where id = p_usuario and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if p ? 'es_tecnico' and (p->>'es_tecnico')::boolean is distinct from u.es_tecnico then
    v_cambios := v_cambios || jsonb_build_object('es_tecnico', jsonb_build_array(u.es_tecnico, (p->>'es_tecnico')::boolean));
  end if;
  if p ? 'es_qa' and (p->>'es_qa')::boolean is distinct from u.es_qa then
    v_cambios := v_cambios || jsonb_build_object('es_qa', jsonb_build_array(u.es_qa, (p->>'es_qa')::boolean));
  end if;
  if p ? 'usa_soporte' and (p->>'usa_soporte')::boolean is distinct from u.usa_soporte then
    v_cambios := v_cambios || jsonb_build_object('usa_soporte', jsonb_build_array(u.usa_soporte, (p->>'usa_soporte')::boolean));
  end if;
  if v_cambios = '{}'::jsonb then return jsonb_build_object('id', u.id, 'cambios', 0); end if;
  update usuarios
     set es_tecnico = coalesce((p->>'es_tecnico')::boolean, es_tecnico),
         es_qa = coalesce((p->>'es_qa')::boolean, es_qa),
         usa_soporte = coalesce((p->>'usa_soporte')::boolean, usa_soporte),
         updated_at = now()
   where id = u.id;
  perform usr_historial(s.s_empresa, 'usuario', u.id, u.perfil_id, u.nombre, 'editado', v_cambios, s.s_usuario, s.s_nombre);
  return jsonb_build_object('id', u.id, 'cambios', 1);
end;
$fn$;

-- Sucursal de un usuario (Inventario › Depósitos). Misma firma que la receta 50, ahora con
-- el permiso de administrar usuarios y con historial.
create or replace function :"schema".asignar_sucursal_usuario(p_usuario uuid, p_sucursal uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  u usuarios;
begin
  select * into s from usr_admin_sesion();
  if p_sucursal is not null and not exists (select 1 from sucursales where id = p_sucursal and empresa_id = s.s_empresa and activa) then
    raise exception 'Sucursal no encontrada o inactiva';
  end if;
  select * into u from usuarios where id = p_usuario and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if u.sucursal_id is distinct from p_sucursal then
    update usuarios set sucursal_id = p_sucursal, updated_at = now() where id = p_usuario;
    perform usr_historial(s.s_empresa, 'usuario', u.id, u.perfil_id, u.nombre, 'editado',
      jsonb_build_object('sucursal', jsonb_build_array((select nombre from sucursales where id = u.sucursal_id),
                                                       (select nombre from sucursales where id = p_sucursal))),
      s.s_usuario, s.s_nombre);
  end if;
  return jsonb_build_object('id', p_usuario, 'sucursal_id', p_sucursal);
end;
$fn$;

-- =============================================================================
-- 7. Funciones críticas con permisos del perfil (misma firma que antes). Copiadas de las
--    recetas 43 / 50 / 51 / 54; los cambios están marcados con "-- 55:".
-- =============================================================================
-- Sesión de reportes: empresa, rol y la sucursal EFECTIVA del filtro.
create or replace function :"schema".rep_sesion(
  p_roles text[], p_sucursal uuid,
  out s_empresa uuid, out s_rol text, out s_sucursal uuid, out s_admin boolean, out s_principal uuid)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  -- 55: el acceso sale del perfil. Los reportes de ADMIN piden "ver reportes financieros";
  -- los de ADMIN+SUPERVISOR (cierres de caja) aceptan además "ver cierres de caja".
  -- s_admin = ve costos y márgenes; la sucursal libre depende del alcance del perfil.
  select * into s from inv_sesion(null);
  if p_roles is not null and not (tiene_permiso('ver_reportes_financieros')
                                  or ('SUPERVISOR' = any (p_roles) and tiene_permiso('ver_cierres_caja'))) then
    perform exigir_permiso(case when 'SUPERVISOR' = any (p_roles) then 'ver_cierres_caja' else 'ver_reportes_financieros' end);
  end if;
  s_empresa := s.s_empresa;
  s_rol := s.s_rol;
  s_admin := tiene_permiso('ver_costos');
  s_principal := sucursal_principal(s.s_empresa);
  if alcance_todas() then
    if p_sucursal is not null and not exists (select 1 from sucursales where id = p_sucursal and empresa_id = s.s_empresa) then
      raise exception 'Sucursal no encontrada';
    end if;
    s_sucursal := p_sucursal;
  else
    s_sucursal := coalesce(s.s_sucursal, s_principal);
  end if;
end;
$fn$;

create or replace function :"schema".listar_cajas()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_suc uuid;
  v_admin boolean;
  v_todas boolean;
  v_pred uuid;
  v_pred_error text;
  r jsonb;
begin
  select * into s from inv_sesion(null);
  v_admin := s.s_rol = 'ADMIN';
  -- 55: ver las cajas de todas las sucursales sale del perfil (alcance o permiso).
  v_todas := v_admin or alcance_todas() or tiene_permiso('ver_cajas_otras_sucursales');
  v_suc := coalesce(s.s_sucursal, sucursal_principal(s.s_empresa));
  begin
    v_pred := caja_abierta_para();
  exception when others then
    v_pred := null;
    v_pred_error := sqlerrm;
  end;

  with turnos as (
    select c.id, c.numero_caja, c.punto_venta_id, c.sucursal_id, c.deposito_id, c.abierta_por, c.fecha_apertura,
           c.monto_apertura, c.observacion_apertura, u.nombre as abierta_por_nombre,
           caja_efectivo_esperado(c.id) as efectivo_esperado,
           (select count(*) from ventas v where v.caja_id = c.id and v.estado <> 'anulada') as ventas_cantidad,
           (select coalesce(sum(v.total), 0) from ventas v where v.caja_id = c.id and v.estado <> 'anulada') as ventas_total
      from cajas c left join usuarios u on u.id = c.abierta_por
     where c.empresa_id = s.s_empresa and c.estado = 'abierta'
  ), visibles as (
    select su.* from sucursales su
     where su.empresa_id = s.s_empresa and (v_todas or su.id = v_suc)
  )
  select jsonb_build_object(
    'es_admin', v_admin,
    've_todas', v_todas,
    'mi_usuario_id', s.s_usuario,
    'mi_sucursal_id', v_suc,
    'predeterminada', v_pred,
    'predeterminada_error', v_pred_error,
    'sucursales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', su.id, 'nombre', su.nombre, 'es_principal', su.es_principal, 'activa', su.activa,
        'depositos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'es_principal', d.es_principal, 'activo', d.activo)
                                          order by d.es_principal desc, d.nombre)
                                 from depositos d where d.sucursal_id = su.id), '[]'::jsonb),
        'cajas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pv.id, 'nombre', pv.nombre, 'activo', pv.activo, 'deposito_id', pv.deposito_id, 'deposito_nombre', d.nombre,
            'turno', (select to_jsonb(t) - 'punto_venta_id' - 'sucursal_id' from turnos t where t.punto_venta_id = pv.id),
            'ultimo_cierre', (select jsonb_build_object('id', c.id, 'numero_caja', c.numero_caja, 'fecha_cierre', c.fecha_cierre,
                                                         'diferencia', c.diferencia, 'diferencia_otros', c.diferencia_otros,
                                                         'cerrada_por_nombre', uc.nombre)
                                from cajas c left join usuarios uc on uc.id = c.cerrada_por
                               where c.punto_venta_id = pv.id and c.estado = 'cerrada'
                               order by c.fecha_cierre desc nulls last limit 1)
          ) order by pv.activo desc, pv.nombre)
            from puntos_venta pv join depositos d on d.id = pv.deposito_id
           where pv.sucursal_id = su.id), '[]'::jsonb)
      ) order by su.es_principal desc, su.activa desc, su.nombre)
        from visibles su), '[]'::jsonb),
    'abiertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'numero_caja', t.numero_caja, 'punto_venta_id', t.punto_venta_id, 'punto_nombre', pv.nombre,
        'sucursal_id', t.sucursal_id, 'sucursal_nombre', su.nombre, 'deposito_id', t.deposito_id, 'deposito_nombre', d.nombre,
        'abierta_por_nombre', t.abierta_por_nombre, 'fecha_apertura', t.fecha_apertura, 'mia', t.abierta_por = s.s_usuario
      ) order by su.es_principal desc, su.nombre, pv.nombre)
        from turnos t join puntos_venta pv on pv.id = t.punto_venta_id join sucursales su on su.id = t.sucursal_id
        join depositos d on d.id = t.deposito_id
       where v_todas or t.sucursal_id = v_suc), '[]'::jsonb),
    'recientes', coalesce((
      select jsonb_agg(x order by x.fecha_cierre desc) from (
        select c.id, c.numero_caja, c.fecha_apertura, c.fecha_cierre, c.monto_apertura, c.diferencia, c.diferencia_otros,
               pv.nombre as punto_nombre, su.nombre as sucursal_nombre, uc.nombre as cerrada_por_nombre, ua.nombre as abierta_por_nombre,
               (select coalesce(sum(v.total), 0) from ventas v where v.caja_id = c.id and v.estado <> 'anulada') as total_vendido
          from cajas c join puntos_venta pv on pv.id = c.punto_venta_id join sucursales su on su.id = c.sucursal_id
          left join usuarios uc on uc.id = c.cerrada_por left join usuarios ua on ua.id = c.abierta_por
         where c.empresa_id = s.s_empresa and c.estado = 'cerrada' and (v_todas or c.sucursal_id = v_suc)
         order by c.fecha_cierre desc nulls last limit 15) x), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

create or replace function :"schema".abrir_caja(p_punto_venta uuid, p_monto numeric, p_observacion text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pv record;
  v_abierta record;
  v_num bigint;
  v_id uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  perform exigir_permiso('abrir_cerrar_caja');  -- 55
  if p_monto is null or p_monto < 0 then raise exception 'El monto inicial tiene que ser 0 o más'; end if;
  select pv0.*, su.nombre as sucursal_nombre, su.activa as sucursal_activa, d.activo as deposito_activo
    into pv
    from puntos_venta pv0 join sucursales su on su.id = pv0.sucursal_id join depositos d on d.id = pv0.deposito_id
   where pv0.id = p_punto_venta and pv0.empresa_id = s.s_empresa
   for update of pv0;
  if not found then raise exception 'Caja no encontrada'; end if;
  if not pv.activo or not pv.sucursal_activa then raise exception 'La caja "%" está inactiva', pv.nombre; end if;
  if not pv.deposito_activo then raise exception 'El depósito de salida de la caja está inactivo: cambialo en la configuración de cajas'; end if;
  if not alcance_todas() and pv.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then  -- 55
    raise exception 'Solo podés abrir las cajas de tu sucursal';
  end if;
  select c.numero_caja, u.nombre as quien, c.fecha_apertura into v_abierta
    from cajas c left join usuarios u on u.id = c.abierta_por
   where c.punto_venta_id = p_punto_venta and c.estado <> 'cerrada' limit 1;
  if found then
    raise exception '% · % ya está abierta (turno N° %, la abrió %)', pv.nombre, pv.sucursal_nombre, v_abierta.numero_caja, coalesce(v_abierta.quien, '—');
  end if;

  v_num := inv_numero(s.s_empresa, 'turno_caja', (select max(numero_caja) from cajas where empresa_id = s.s_empresa));
  insert into cajas (empresa_id, estado, numero_caja, abierta_por, fecha_apertura, monto_apertura, observacion_apertura,
                     punto_venta_id, sucursal_id, deposito_id)
    values (s.s_empresa, 'abierta', v_num, s.s_usuario, now(), round(p_monto), nullif(btrim(coalesce(p_observacion, '')), ''),
            pv.id, pv.sucursal_id, pv.deposito_id)
    returning id into v_id;
  return jsonb_build_object('caja_id', v_id, 'numero_caja', v_num);
end;
$fn$;

create or replace function :"schema".registrar_movimiento_caja(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja uuid;
  v_tipo text := lower(coalesce(p->>'tipo', ''));
  v_motivo text := lower(coalesce(nullif(btrim(p->>'motivo'), ''), 'otro'));
  v_detalle text := nullif(btrim(coalesce(p->>'detalle', '')), '');
  v_monto numeric := round(coalesce(nullif(p->>'monto', '')::numeric, 0));
  v_label text;
  v_disp numeric;
  v_num text;
  v_id uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  perform exigir_permiso('movimientos_caja');  -- 55
  if v_tipo not in ('retiro', 'ingreso') then raise exception 'Elegí si es un retiro o un ingreso de efectivo'; end if;
  if v_monto <= 0 then raise exception 'El monto tiene que ser mayor a cero'; end if;
  v_label := case
    when v_tipo = 'retiro' and v_motivo = 'deposito_banco' then 'Retiro para depósito en banco'
    when v_tipo = 'retiro' and v_motivo = 'retiro_dueno' then 'Retiro del dueño'
    when v_tipo = 'retiro' and v_motivo = 'caja_fuerte' then 'Retiro a caja fuerte'
    when v_tipo = 'ingreso' and v_motivo = 'cambio' then 'Ingreso de cambio / sencillo'
    when v_tipo = 'ingreso' and v_motivo = 'aporte' then 'Aporte de efectivo'
    when v_tipo = 'ingreso' and v_motivo = 'devolucion_retiro' then 'Devolución de un retiro'
    when v_motivo = 'otro' then null
    else 'x' end;
  if v_label = 'x' then raise exception 'Motivo inválido'; end if;
  if v_label is null then
    if v_detalle is null then raise exception 'Escribí el motivo del %', case when v_tipo = 'retiro' then 'retiro' else 'ingreso' end; end if;
    v_label := case when v_tipo = 'retiro' then 'Retiro' else 'Ingreso' end;
    v_motivo := 'otro';
  end if;

  v_caja := caja_abierta_para(null, null, nullif(p->>'caja_id', '')::uuid);
  if v_caja is null then raise exception 'No hay una caja abierta: abrila primero'; end if;
  perform 1 from cajas where id = v_caja for update;
  if v_tipo = 'retiro' then
    v_disp := caja_efectivo_esperado(v_caja);
    if v_monto > v_disp then
      raise exception 'En la caja debería haber Gs. % en efectivo: no se puede retirar más', replace(to_char(v_disp, 'FM999,999,999,990'), ',', '.');
    end if;
  end if;

  v_num := 'MC-' || lpad(inv_numero(s.s_empresa, 'mov_caja', (
             select max(substring(numero from '[0-9]+$')::bigint) from caja_movimientos where empresa_id = s.s_empresa and numero ~ '^MC-[0-9]+$'))::text, 6, '0');
  insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, metodo, categoria, usuario_id,
                                usuario_email, observacion, fecha, numero)
    values (s.s_empresa, v_caja, v_tipo, left(v_label || coalesce(': ' || v_detalle, ''), 200), v_monto, 'efectivo', 'efectivo',
            v_motivo, s.s_usuario, (select email from usuarios where id = s.s_usuario), v_detalle,
            (now() at time zone 'America/Asuncion')::date, v_num)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'caja_id', v_caja);
end;
$fn$;

create or replace function :"schema".anular_movimiento_caja(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  m record;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  perform exigir_permiso('movimientos_caja');  -- 55
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo'; end if;
  select x.*, c.estado as caja_estado, c.sucursal_id into m
    from caja_movimientos x join cajas c on c.id = x.caja_id
   where x.id = p_id and x.empresa_id = s.s_empresa for update of x;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  if m.anulado_at is not null then raise exception 'El movimiento ya está anulado'; end if;
  if m.venta_id is not null or m.cobro_id is not null or m.compra_id is not null or m.gasto_id is not null or m.pago_proveedor_id is not null then
    raise exception 'Ese movimiento es de un documento (venta, cobro, compra, gasto o pago): anulá el documento';
  end if;
  if m.caja_estado <> 'abierta' then raise exception 'La caja ya está cerrada: no se puede anular'; end if;
  if not alcance_todas() and m.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then  -- 55
    raise exception 'Ese movimiento es de una caja de otra sucursal';
  end if;
  if m.tipo = 'ingreso' and m.medio_pago = 'efectivo' and m.monto > caja_efectivo_esperado(m.caja_id) then
    raise exception 'Ese efectivo ya no está en la caja: no se puede anular el ingreso';
  end if;
  update caja_movimientos set anulado_at = now(), anulado_por = s.s_usuario, anulado_motivo = left(btrim(p_motivo), 200)
   where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$fn$;

create or replace function :"schema".cerrar_caja(
  p_caja_id uuid,
  p_monto_contado numeric,
  p_observacion text,
  p_arqueo_json jsonb
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja record;
  rt jsonb;
  m jsonb;
  v_esperado numeric;
  v_contado numeric := round(p_monto_contado);
  v_dif numeric;
  v_dif_otros numeric := 0;
  v_decl jsonb := '{}'::jsonb;
  v_valor numeric;
  v_motivo text := nullif(btrim(coalesce(p_arqueo_json->>'motivo_diferencia', '')), '');
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  perform exigir_permiso('abrir_cerrar_caja');  -- 55
  if p_monto_contado is null or p_monto_contado < 0 then raise exception 'Contá el efectivo antes de cerrar (monto 0 o más)'; end if;

  select * into v_caja from cajas where id = p_caja_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Caja no encontrada'; end if;
  if v_caja.estado = 'cerrada' then raise exception 'Esa caja ya está cerrada'; end if;
  if not alcance_todas() and v_caja.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then  -- 55
    raise exception 'Solo podés cerrar las cajas de tu sucursal';
  end if;

  rt := resumen_turno(p_caja_id);
  v_esperado := (rt->'efectivo'->>'esperado')::numeric;
  v_dif := v_contado - v_esperado;
  for m in select * from jsonb_array_elements(rt->'metodos') loop
    if m->>'metodo' = 'efectivo' then continue; end if;
    v_valor := coalesce(nullif(p_arqueo_json->'declarado'->>(m->>'metodo'), '')::numeric, (m->>'esperado')::numeric);
    if v_valor < 0 then raise exception 'El monto declarado de % no puede ser negativo', m->>'label'; end if;
    v_valor := round(v_valor);
    v_decl := v_decl || jsonb_build_object(m->>'metodo', v_valor);
    v_dif_otros := v_dif_otros + (v_valor - (m->>'esperado')::numeric);
  end loop;
  if (v_dif <> 0 or v_dif_otros <> 0) and v_motivo is null then
    raise exception 'Hay diferencias en el arqueo: escribí el motivo';
  end if;

  update cajas
     set estado = 'cerrada', fecha_cierre = now(), cerrada_por = s.s_usuario,
         monto_cierre_contado = v_contado, monto_esperado_efectivo = v_esperado,
         diferencia = v_dif, diferencia_otros = v_dif_otros, motivo_diferencia = v_motivo,
         observacion_cierre = nullif(btrim(coalesce(p_observacion, '')), ''),
         arqueo_cierre_json = jsonb_build_object('declarado', v_decl, 'billetes', p_arqueo_json->'billetes'),
         updated_at = now()
   where id = p_caja_id;
  -- Foto del turno tal como se cerró (el PDF y los reportes la pueden usar sin recalcular).
  update cajas set resumen_cierre = resumen_turno(p_caja_id) where id = p_caja_id;

  return jsonb_build_object(
    'caja_id', p_caja_id, 'numero_caja', v_caja.numero_caja,
    'contado', v_contado, 'esperado', v_esperado, 'diferencia', v_dif, 'diferencia_otros', v_dif_otros);
end;
$fn$;

create or replace function :"schema".crear_venta(
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text,
  p_descuento_pct numeric default 0, p_plazo_dias integer default null, p_deposito_id uuid default null,
  p_caja_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
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
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  v_empresa := s.s_empresa;
  v_usuario := s.s_usuario;

  if v_tipo not in ('CONTADO', 'CREDITO') then raise exception 'Condición de venta inválida'; end if;
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
  select coalesce(max(case when numero_control ~ '^VTA-[0-9]+$'
           then substring(numero_control from '[0-9]+$')::bigint end), 0) + 1
    into v_next from ventas where empresa_id = v_empresa;
  v_numero := 'VTA-' || lpad(v_next::text, 6, '0');

  insert into ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio,
                      subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago,
                      caja_id, created_by, usuario_nombre, fecha, observaciones, idempotency_key, deposito_id,
                      sucursal_id, punto_venta_id)
    values (v_empresa, p_cliente_id, v_numero, coalesce(p_moneda, 'GS'), 1,
            0, 0, 0, 'completada', v_tipo,
            case when v_tipo = 'CREDITO' then p_plazo_dias else null end,
            case when v_tipo = 'CREDITO' then 'credito' else null end,
            v_caja.id, auth.uid(), s.s_nombre, now(), p_observaciones, nullif(p_idempotency_key, ''), v_dep,
            v_caja.sucursal_id, v_caja.punto_venta_id)
    returning id into v_venta;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en un ítem'; end if;

    select * into prod from productos
      where id = (it->>'producto_id')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no existe en esta empresa', it->>'producto_id'; end if;

    v_precio_lista := case coalesce(it->>'tipo_precio', 'minorista')
                  when 'mayorista'   then coalesce(prod.precio_mayorista, prod.precio_venta)
                  when 'distribuidor' then coalesce(prod.precio_distribuidor, prod.precio_venta)
                  when 'costo'       then prod.costo_promedio
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
              v_sub, v_iva, v_total_linea, prod.costo_promedio)
      returning id into v_item;

    if prod.controla_stock then
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
                            'vuelto', v_vuelto_total, 'caja_id', v_caja.id);
end;
$function$;

create or replace function :"schema".anular_venta(p_venta_id uuid, p_motivo text default null, p_caja_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $function$
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
  -- 55: antes ADMIN/SUPERVISOR; ahora alcance "todas" o el permiso de turnos cerrados.
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
             order by vi.producto_id loop
    perform inv_mover(v_empresa, it.producto_id, v_dep, it.cantidad, coalesce(it.costo_unitario, 0), 'anulacion_venta',
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

create or replace function :"schema".aprobar_cobro_pendiente(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_usr record;
  cp cobros_pendientes;
  cx cuentas_por_cobrar;
  v_cobro jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if not tiene_permiso('aprobar_transferencias') then perform exigir_permiso('aprobar_transferencias'); end if;  -- 55
  select * into cp from cobros_pendientes where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if cp.estado <> 'pendiente' then raise exception 'Esta transferencia ya fue %', replace(cp.estado, 'ado', 'ada'); end if;
  select * into cx from cuentas_por_cobrar where id = cp.cxc_id and empresa_id = v_emp for update;
  if cx.estado not in ('pendiente', 'parcial') or cp.monto > cx.saldo then
    raise exception 'El monto (Gs. %) supera el saldo actual de % (Gs. %): rechazala y cargala de nuevo',
      gs_texto(cp.monto), cx.numero, gs_texto(cx.saldo);
  end if;

  v_cobro := registrar_cobro(jsonb_build_object(
    'cliente_id', cp.cliente_id,
    'pagos', jsonb_build_array(jsonb_build_object('metodo', 'transferencia', 'monto', cp.monto,
                                                  'referencia', left(cp.banco_origen || ' · Op ' || cp.numero_operacion, 120))),
    'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', cx.id, 'monto', cp.monto)),
    'observacion', left('Transferencia aprobada en Conciliación bancaria · ' || to_char(cp.fecha, 'DD/MM/YYYY') || ' · titular ' || cp.titular, 1000),
    'sin_caja', true));

  update cobros_pendientes
     set estado = 'aprobado', cobro_id = (v_cobro->>'id')::uuid, aprobado_by = v_usr.id, aprobado_por_nombre = v_usr.nombre,
         aprobado_at = now(), updated_at = now()
   where id = cp.id;
  -- El cliente pagó: sus promesas pendientes (todas anteriores a este cobro) se cumplen.
  update cobranza_promesas
     set estado = 'cumplida', cerrada_at = now(), cerrada_por_nombre = v_usr.nombre,
         cerrada_motivo = 'Cobro aprobado ' || (v_cobro->>'numero_recibo')
   where empresa_id = v_emp and cliente_id = cp.cliente_id and estado = 'pendiente' and created_at <= now();
  perform cobranza_limpiar_notificacion(cp.id);
  return jsonb_build_object('id', cp.id, 'cobro_id', v_cobro->>'id', 'numero_recibo', v_cobro->>'numero_recibo',
                            'saldo_restante', (select saldo from cuentas_por_cobrar where id = cx.id));
end;
$fn$;

-- Rechazar (ADMIN): sólo cambia el estado; la deuda no se tocó nunca.
create or replace function :"schema".rechazar_cobro_pendiente(p_id uuid, p_motivo text)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_usr record;
  cp cobros_pendientes;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if not tiene_permiso('aprobar_transferencias') then perform exigir_permiso('aprobar_transferencias'); end if;  -- 55
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo del rechazo'; end if;
  select * into cp from cobros_pendientes where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if cp.estado <> 'pendiente' then raise exception 'Esta transferencia ya fue %', replace(cp.estado, 'ado', 'ada'); end if;
  update cobros_pendientes
     set estado = 'rechazado', motivo_rechazo = left(btrim(p_motivo), 500), rechazado_by = v_usr.id,
         rechazado_por_nombre = v_usr.nombre, rechazado_at = now(), updated_at = now()
   where id = cp.id;
  perform cobranza_limpiar_notificacion(cp.id);
  return jsonb_build_object('id', cp.id, 'estado', 'rechazado');
end;
$fn$;

-- Anular (ADMIN) una transferencia APROBADA: se anula su cobro → la deuda vuelve.
create or replace function :"schema".anular_cobro_pendiente(p_id uuid, p_motivo text)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_usr record;
  cp cobros_pendientes;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre, u.rol into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
  if not tiene_permiso('aprobar_transferencias') then perform exigir_permiso('aprobar_transferencias'); end if;  -- 55
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into cp from cobros_pendientes where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if cp.estado <> 'aprobado' then raise exception 'Solo se anula una transferencia aprobada (esta está %)', replace(cp.estado, 'ado', 'ada'); end if;
  if cp.cobro_id is not null and exists (select 1 from cobros_clientes where id = cp.cobro_id and anulado_at is null) then
    perform anular_cobro(cp.cobro_id, left('Transferencia anulada en Conciliación: ' || btrim(p_motivo), 500));
  end if;
  update cobros_pendientes
     set estado = 'anulado', motivo_anulacion = left(btrim(p_motivo), 500), anulado_by = v_usr.id,
         anulado_por_nombre = v_usr.nombre, anulado_at = now(), updated_at = now()
   where id = cp.id;
  perform cobranza_limpiar_notificacion(cp.id);
  return jsonb_build_object('id', cp.id, 'estado', 'anulado');
end;
$fn$;

create or replace function :"schema".aprobar_ajuste(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion(null);
  perform exigir_permiso('aprobar_perdidas');  -- 55 (antes solo ADMIN)
  if not exists (select 1 from ajustes_inventario where id = p_id and empresa_id = s.s_empresa) then
    raise exception 'Documento no encontrado';
  end if;
  return inv_aplicar_ajuste(p_id, s.s_usuario, s.s_nombre, false);
end;
$fn$;

create or replace function :"schema".rechazar_ajuste(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  a record;
begin
  select * into s from inv_sesion(null);
  perform exigir_permiso('aprobar_perdidas');  -- 55 (antes solo ADMIN)
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí por qué se rechaza'; end if;
  select * into a from ajustes_inventario where id = p_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Documento no encontrado'; end if;
  if a.estado <> 'pendiente' then raise exception 'El documento % ya está %', a.numero, a.estado; end if;
  update ajustes_inventario set estado = 'rechazado', rechazado_por_nombre = s.s_nombre, rechazado_at = now(),
         rechazado_motivo = left(btrim(p_motivo), 500)
   where id = a.id;
  return jsonb_build_object('id', a.id, 'numero', a.numero, 'estado', 'rechazado');
end;
$fn$;

-- =============================================================================
-- 8. Migración: perfiles de sistema en cada empresa y cada usuario con el de su rol
-- =============================================================================
do $$
declare
  e record;
begin
  for e in select id from empresas loop
    perform perfiles_sistema_asegurar(e.id);
  end loop;
end $$;

update :"schema".usuarios set nombres = nombre where nombres is null;
-- El trigger asigna el perfil de sistema del rol (rol desconocido → Vendedor) y sincroniza rol.
update :"schema".usuarios set perfil_id = null where perfil_id is null;

-- =============================================================================
-- 9. Seguridad: nada de escrituras directas a usuarios / empresas / perfiles
-- =============================================================================
revoke insert, update, delete, truncate on :"schema".usuarios, :"schema".empresas from authenticated, anon;
grant select on :"schema".usuarios, :"schema".empresas to authenticated;

alter table :"schema".perfiles enable row level security;
alter table :"schema".perfiles force row level security;
alter table :"schema".perfil_pantallas enable row level security;
alter table :"schema".perfil_pantallas force row level security;
alter table :"schema".perfil_permisos enable row level security;
alter table :"schema".perfil_permisos force row level security;
alter table :"schema".usuarios_historial enable row level security;
alter table :"schema".usuarios_historial force row level security;

drop policy if exists perfiles_propios on :"schema".perfiles;
create policy perfiles_propios on :"schema".perfiles for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists perfil_pantallas_propias on :"schema".perfil_pantallas;
create policy perfil_pantallas_propias on :"schema".perfil_pantallas for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists perfil_permisos_propios on :"schema".perfil_permisos;
create policy perfil_permisos_propios on :"schema".perfil_permisos for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists usuarios_historial_admin on :"schema".usuarios_historial;
create policy usuarios_historial_admin on :"schema".usuarios_historial for select to authenticated
  using (empresa_id = :"schema".empresa_actual() and :"schema".tiene_permiso('administrar_usuarios'));

revoke all on :"schema".perfiles, :"schema".perfil_pantallas, :"schema".perfil_permisos, :"schema".usuarios_historial from authenticated, anon;
grant select on :"schema".perfiles, :"schema".perfil_pantallas, :"schema".perfil_permisos, :"schema".usuarios_historial to authenticated;
grant all on :"schema".perfiles, :"schema".perfil_pantallas, :"schema".perfil_permisos, :"schema".usuarios_historial to service_role;

-- Funciones internas / de trigger: nadie las llama directo.
revoke all on function :"schema".perfiles_sistema_asegurar(uuid) from public, anon, authenticated;
revoke all on function :"schema".tg_empresas_perfiles() from public, anon, authenticated;
revoke all on function :"schema".tg_usuarios_perfil() from public, anon, authenticated;
revoke all on function :"schema".tg_perfiles_nivel() from public, anon, authenticated;
revoke all on function :"schema".tg_exige_permiso() from public, anon, authenticated;
revoke all on function :"schema".tg_ajustes_exige_permiso() from public, anon, authenticated;
revoke all on function :"schema".tg_productos_exige_permiso() from public, anon, authenticated;
revoke all on function :"schema".tg_ventas_exige_permiso() from public, anon, authenticated;
revoke all on function :"schema".tg_cobros_pendientes_exige_permiso() from public, anon, authenticated;
revoke all on function :"schema".usr_historial(uuid, text, uuid, uuid, text, text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function :"schema".usr_admin_sesion() from public, anon, authenticated;
revoke all on function :"schema".usr_admins_activos(uuid, uuid) from public, anon, authenticated;

-- Solo el servidor (service role): leen auth.users de la flota.
revoke all on function :"schema".sesion_perfil(uuid) from public, anon, authenticated;
revoke all on function :"schema".auth_buscar_email(text) from public, anon, authenticated;
revoke all on function :"schema".auth_usuario_info(uuid, uuid) from public, anon, authenticated;
grant execute on function :"schema".sesion_perfil(uuid) to service_role;
grant execute on function :"schema".auth_buscar_email(text) to service_role;
grant execute on function :"schema".auth_usuario_info(uuid, uuid) to service_role;

-- Helpers de permiso: los usan funciones SECURITY INVOKER (Conciliación) con la sesión.
revoke all on function :"schema".permisos_catalogo() from public, anon;
revoke all on function :"schema".permiso_nombre(text) from public, anon;
revoke all on function :"schema".perfil_sesion() from public, anon;
revoke all on function :"schema".tiene_permiso(text) from public, anon;
revoke all on function :"schema".alcance_todas() from public, anon;
revoke all on function :"schema".exigir_permiso(text) from public, anon;
grant execute on function :"schema".permisos_catalogo() to authenticated, service_role;
grant execute on function :"schema".permiso_nombre(text) to authenticated, service_role;
grant execute on function :"schema".perfil_sesion() to authenticated, service_role;
grant execute on function :"schema".tiene_permiso(text) to authenticated, service_role;
grant execute on function :"schema".alcance_todas() to authenticated, service_role;
grant execute on function :"schema".exigir_permiso(text) to authenticated, service_role;

-- Pantalla de usuarios (validan nivel ADMIN + administrar_usuarios adentro).
revoke all on function :"schema".admin_listar_usuarios() from public, anon;
revoke all on function :"schema".admin_listar_perfiles() from public, anon;
revoke all on function :"schema".admin_crear_usuario(jsonb) from public, anon;
revoke all on function :"schema".admin_actualizar_usuario(uuid, jsonb) from public, anon;
revoke all on function :"schema".admin_registrar_accion_usuario(uuid, text, jsonb) from public, anon;
revoke all on function :"schema".admin_guardar_perfil(jsonb) from public, anon;
revoke all on function :"schema".admin_eliminar_perfil(uuid) from public, anon;
revoke all on function :"schema".admin_historial(uuid, uuid, integer) from public, anon;
revoke all on function :"schema".usuario_flags_soporte(uuid, jsonb) from public, anon;
revoke all on function :"schema".asignar_sucursal_usuario(uuid, uuid) from public, anon;
grant execute on function :"schema".admin_listar_usuarios() to authenticated, service_role;
grant execute on function :"schema".admin_listar_perfiles() to authenticated, service_role;
grant execute on function :"schema".admin_crear_usuario(jsonb) to authenticated, service_role;
grant execute on function :"schema".admin_actualizar_usuario(uuid, jsonb) to authenticated, service_role;
grant execute on function :"schema".admin_registrar_accion_usuario(uuid, text, jsonb) to authenticated, service_role;
grant execute on function :"schema".admin_guardar_perfil(jsonb) to authenticated, service_role;
grant execute on function :"schema".admin_eliminar_perfil(uuid) to authenticated, service_role;
grant execute on function :"schema".admin_historial(uuid, uuid, integer) to authenticated, service_role;
grant execute on function :"schema".usuario_flags_soporte(uuid, jsonb) to authenticated, service_role;
grant execute on function :"schema".asignar_sucursal_usuario(uuid, uuid) to authenticated, service_role;

commit;
