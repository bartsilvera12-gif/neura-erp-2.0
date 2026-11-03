-- =============================================================================
-- RUBRO SORTEOS (pedido del dueño, 3-nov-2026). Modelado sobre cómo vende Grupo BIRM (sin traer ningún
-- dato): combos con descuento, venta por WhatsApp con comprobante, venta manual, vendedores con link y
-- punto de venta, cupones impresos para la urna, y además lo que allá no existe: premios, ganadores,
-- sorteo digital verificable y página pública de compra.
--
--   · Rubro y funciones: función nueva `sorteos` (empresa_funciones.sorteos). Rubro "Sorteos" = sorteos
--     prendida y lo gastronómico apagado. Prenderla da las pantallas y permisos a Supervisor, Cajero y
--     Vendedor (rubro_dar_sorteos).
--   · Números: una fila por número, generada al ACTIVAR el sorteo (hasta 1.000.000). La columna `orden`
--     es el orden en que se entregan (al azar o correlativo). Vender toma los primeros libres con
--     `for update skip locked`: dos ventas a la vez NO se esperan entre sí y nunca comparten número.
--     Reservar (pago pendiente) → vendido (confirmado). Rechazar, anular o vencer LIBERA los números.
--   · Una sola función de venta (sorteo_orden_registrar) para todos los canales: manual, vendedor,
--     web y WhatsApp (bot por service_role). El monto sale del precio o del combo, nunca a mano.
--   · Sorteo verificable: al activar se guarda una semilla secreta y se publica su huella (sha256). Al
--     cerrar se publica la huella de la lista de números vendidos. Cada ganador digital sale de
--     sha256(semilla:lista:posición:intento) sobre esa lista; al terminar se revela la semilla y
--     cualquiera puede recalcularlo. También se pueden cargar ganadores de urna o de lotería externa.
--   · Todas las tablas son solo por funciones (RLS forzada, sin acceso directo). Las públicas
--     (sorteo_publico_*, sorteo_vendedor_*) validan slug / token / PIN y tienen límite de intentos.
--   · Buckets propios: erp-sorteos (privado: comprobantes) y erp-sorteos-publico (imágenes del sorteo
--     y de los premios).
--
-- IDEMPOTENTE. Va después de 122.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Función "Sorteos" en Rubro y funciones
-- =============================================================================
alter table :"schema".empresa_funciones add column if not exists sorteos boolean not null default false;

do $do$
declare
  v_def text;
begin
  -- funcion_activa: 'sorteos' lee su columna (sin fila = apagada).
  v_def := pg_get_functiondef('funcion_activa(uuid,text)'::regprocedure);
  if position('-- 123: sorteos' in v_def) = 0 then
    if position($a$when p_funcion = 'pedidos' then$a$ in v_def) = 0 then raise exception 'Receta 123: funcion_activa no tiene el patrón esperado'; end if;
    execute replace(v_def, $a$when p_funcion = 'pedidos' then$a$,
      $b$when p_funcion = 'sorteos' then coalesce((select f.sorteos from empresa_funciones f where f.empresa_id = p_empresa), false) -- 123: sorteos
    when p_funcion = 'pedidos' then$b$);
  end if;

  -- funciones_empresa: devuelve 'sorteos' y el rubro "sorteos".
  v_def := pg_get_functiondef('funciones_empresa()'::regprocedure);
  if position('-- 123: sorteos' in v_def) = 0 then
    if position($a$v_rubro := case when not v_mesas and not v_cocina and not v_recetas then 'comercio'$a$ in v_def) = 0
       or position($a$'pedidos', v_pedidos,$a$ in v_def) = 0 then
      raise exception 'Receta 123: funciones_empresa no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, $a$v_rubro := case when not v_mesas and not v_cocina and not v_recetas then 'comercio'$a$,
      $b$v_rubro := case when coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'sorteos' -- 123: sorteos
                  when not v_mesas and not v_cocina and not v_recetas then 'comercio'$b$);
    v_def := replace(v_def, $a$'pedidos', v_pedidos,$a$, $b$'pedidos', v_pedidos,
    'sorteos', coalesce(f.sorteos, false),$b$);
    execute v_def;
  end if;

  -- guardar_funciones_empresa: preset "sorteos", interruptor `sorteos` y perfiles al prenderla.
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('-- 123: sorteos' in v_def) = 0 then
    if position($a$  v_pedidos boolean;$a$ in v_def) = 0
       or position($a$  v_pedidos := f.pedidos;$a$ in v_def) = 0
       or position($a$      else raise exception 'Rubro inválido (Comercio o Gastronomía)';$a$ in v_def) = 0
       or position($a$when 'comercio' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := true;$a$ in v_def) = 0
       or position($a$when 'gastronomia' then v_mesas := true; v_cocina := true; v_recetas := true; v_pedidos := false;$a$ in v_def) = 0
       or position($a$array['mesas', 'cocina', 'recetas', 'pedidos', 'confirmar_recetas']$a$ in v_def) = 0
       or position($a$  if p ? 'pedidos' then v_pedidos := (p->>'pedidos')::boolean; end if;$a$ in v_def) = 0
       or position($a$pedidos = v_pedidos, updated_at = now()$a$ in v_def) = 0
       or position(E'\n  update empresa_funciones' in v_def) = 0 then
      raise exception 'Receta 123: guardar_funciones_empresa no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, $a$  v_pedidos boolean;$a$, $b$  v_pedidos boolean;
  v_sorteos boolean; -- 123: sorteos$b$);
    v_def := replace(v_def, $a$  v_pedidos := f.pedidos;$a$, $b$  v_pedidos := f.pedidos;
  v_sorteos := f.sorteos;$b$);
    v_def := replace(v_def, $a$when 'comercio' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := true;$a$,
      $b$when 'comercio' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := true; v_sorteos := false;$b$);
    v_def := replace(v_def, $a$when 'gastronomia' then v_mesas := true; v_cocina := true; v_recetas := true; v_pedidos := false;$a$,
      $b$when 'gastronomia' then v_mesas := true; v_cocina := true; v_recetas := true; v_pedidos := false; v_sorteos := false;
      when 'sorteos' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := false; v_sorteos := true;$b$);
    v_def := replace(v_def, $a$      else raise exception 'Rubro inválido (Comercio o Gastronomía)';$a$,
      $b$      else raise exception 'Rubro inválido (Comercio, Gastronomía o Sorteos)';$b$);
    v_def := replace(v_def, $a$array['mesas', 'cocina', 'recetas', 'pedidos', 'confirmar_recetas']$a$,
      $b$array['mesas', 'cocina', 'recetas', 'pedidos', 'sorteos', 'confirmar_recetas']$b$);
    v_def := replace(v_def, $a$  if p ? 'pedidos' then v_pedidos := (p->>'pedidos')::boolean; end if;$a$,
      $b$  if p ? 'pedidos' then v_pedidos := (p->>'pedidos')::boolean; end if;
  if p ? 'sorteos' then v_sorteos := (p->>'sorteos')::boolean; end if;$b$);
    v_def := replace(v_def, E'\n  update empresa_funciones',
      E'\n  -- 123: sorteos: perfiles que venden al prenderla'
      || E'\n  if v_sorteos and not f.sorteos then perform rubro_dar_sorteos(s.p_empresa); end if;'
      || E'\n\n  update empresa_funciones');
    v_def := replace(v_def, $a$pedidos = v_pedidos, updated_at = now()$a$, $b$pedidos = v_pedidos, sorteos = v_sorteos, updated_at = now()$b$);
    execute v_def;
  end if;
end;
$do$;

-- =============================================================================
-- 2. Tablas
-- =============================================================================
create table if not exists :"schema".sorteos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  slug text not null,
  descripcion text,
  imagen_url text,
  precio numeric(14,0) not null,
  numero_desde integer not null default 1,
  numero_hasta integer not null,
  digitos smallint not null default 1,
  modo_numeros text not null default 'aleatorio',
  permite_elegir boolean not null default false,   -- la web deja elegir números
  max_por_compra integer,                          -- null = sin tope
  fecha_sorteo timestamptz,
  estado text not null default 'borrador',
  datos_pago jsonb not null default '[]'::jsonb,   -- [{banco, titular, cuenta, documento, alias}]
  reserva_minutos integer not null default 30,     -- web: cuánto se guardan los números sin pagar
  confirmacion_auto boolean not null default false,-- el bot puede confirmar si el comprobante es válido
  mensaje_ticket text,                             -- texto que acompaña el ticket
  numeros_generados boolean not null default false,
  semilla text,                                    -- secreta hasta revelarla
  semilla_hash text,                               -- pública desde que se activa
  semilla_revelada boolean not null default false,
  lista_hash text,                                 -- huella de los vendidos al cerrar
  lista_cantidad integer,
  activado_at timestamptz,
  cerrado_at timestamptz,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sorteos_slug_uk unique (slug),
  constraint chk_sorteos_estado check (estado in ('borrador', 'activo', 'pausado', 'cerrado', 'sorteado', 'anulado')),
  constraint chk_sorteos_modo check (modo_numeros in ('aleatorio', 'correlativo')),
  constraint chk_sorteos_precio check (precio > 0),
  constraint chk_sorteos_rango check (numero_desde >= 0 and numero_hasta >= numero_desde and numero_hasta - numero_desde < 1000000),
  constraint chk_sorteos_max check (max_por_compra is null or max_por_compra > 0),
  constraint chk_sorteos_reserva check (reserva_minutos between 5 and 1440),
  constraint chk_sorteos_slug check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists sorteos_empresa_idx on :"schema".sorteos (empresa_id, created_at desc);

create table if not exists :"schema".sorteo_combos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sorteo_id uuid not null references :"schema".sorteos(id) on delete cascade,
  cantidad integer not null,
  precio numeric(14,0) not null,
  etiqueta text,
  orden smallint not null default 0,
  activo boolean not null default true,
  constraint sorteo_combos_uk unique (sorteo_id, cantidad),
  constraint chk_sorteo_combos check (cantidad > 0 and precio > 0)
);

create table if not exists :"schema".sorteo_vendedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero integer not null,
  nombre text not null,
  telefono text,
  codigo text not null,                            -- referido: /r/<codigo>
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  pin_hash text,
  acceso_hash text,                                -- sha256 del link del punto de venta
  cupo integer,                                    -- boletas por sorteo (null = sin tope)
  comision_pct numeric(5,2) not null default 0,
  activo boolean not null default true,
  intentos_fallidos smallint not null default 0,
  bloqueado_hasta timestamptz,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sorteo_vendedores_numero_uk unique (empresa_id, numero),
  constraint sorteo_vendedores_codigo_uk unique (empresa_id, codigo),
  constraint chk_sorteo_vendedores_codigo check (codigo ~ '^[A-Z0-9]{3,20}$'),
  constraint chk_sorteo_vendedores_cupo check (cupo is null or cupo > 0),
  constraint chk_sorteo_vendedores_comision check (comision_pct between 0 and 100)
);
create unique index if not exists sorteo_vendedores_acceso_uk on :"schema".sorteo_vendedores (acceso_hash) where acceso_hash is not null;

create table if not exists :"schema".sorteo_vendedor_clicks (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  vendedor_id uuid not null references :"schema".sorteo_vendedores(id) on delete cascade,
  sorteo_id uuid references :"schema".sorteos(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists sorteo_vendedor_clicks_idx on :"schema".sorteo_vendedor_clicks (vendedor_id, sorteo_id, created_at);

create table if not exists :"schema".sorteo_rendiciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  vendedor_id uuid not null references :"schema".sorteo_vendedores(id) on delete restrict,
  cantidad_ordenes integer not null,
  boletas integer not null,
  monto numeric(14,0) not null,
  comision numeric(14,0) not null,
  entregado numeric(14,0) not null,                -- monto - comisión: lo que entrega el vendedor
  nota text,
  recibido_por uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sorteo_rendiciones_vendedor_idx on :"schema".sorteo_rendiciones (vendedor_id, created_at desc);

create table if not exists :"schema".sorteo_ordenes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sorteo_id uuid not null references :"schema".sorteos(id) on delete restrict,
  numero bigint generated always as identity,
  token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  comprador_nombre text not null,
  comprador_documento text,
  comprador_telefono text,
  comprador_ciudad text,
  cantidad integer not null,
  monto numeric(14,0) not null,
  precio_lista numeric(14,0) not null,             -- cantidad × precio (para ver el descuento del combo)
  combo_id uuid references :"schema".sorteo_combos(id) on delete set null,
  canal text not null,
  metodo_pago text not null default 'transferencia',
  estado text not null,
  vence_at timestamptz,                            -- pendiente_pago: hasta cuándo se guardan los números
  vendedor_id uuid references :"schema".sorteo_vendedores(id) on delete set null,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  conversacion_id uuid,
  anuncio_id text,                                 -- anuncio de Meta (Click-to-WhatsApp)
  anuncio_titulo text,
  referencia_pago text,                            -- nº de operación del comprobante
  comprobante_path text,
  comprobante jsonb,                               -- lectura automática del comprobante
  validacion text,                                 -- manual / auto
  revisado_por uuid references :"schema".usuarios(id) on delete set null,
  revisado_at timestamptz,
  motivo text,                                     -- rechazo / anulación
  rendicion_id uuid references :"schema".sorteo_rendiciones(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sorteo_ordenes_numero_uk unique (numero),
  constraint sorteo_ordenes_token_uk unique (token),
  constraint chk_sorteo_ordenes_estado check (estado in ('pendiente_pago', 'en_revision', 'confirmada', 'rechazada', 'anulada', 'vencida')),
  constraint chk_sorteo_ordenes_canal check (canal in ('manual', 'vendedor', 'web', 'whatsapp')),
  constraint chk_sorteo_ordenes_metodo check (metodo_pago in ('transferencia', 'efectivo', 'tarjeta', 'otro')),
  constraint chk_sorteo_ordenes_cantidad check (cantidad > 0),
  constraint chk_sorteo_ordenes_validacion check (validacion is null or validacion in ('manual', 'auto'))
);
create index if not exists sorteo_ordenes_sorteo_idx on :"schema".sorteo_ordenes (sorteo_id, created_at desc);
create index if not exists sorteo_ordenes_estado_idx on :"schema".sorteo_ordenes (sorteo_id, estado);
create index if not exists sorteo_ordenes_vence_idx on :"schema".sorteo_ordenes (sorteo_id, vence_at) where estado = 'pendiente_pago';
create index if not exists sorteo_ordenes_vendedor_idx on :"schema".sorteo_ordenes (vendedor_id, sorteo_id) where vendedor_id is not null;
create index if not exists sorteo_ordenes_documento_idx on :"schema".sorteo_ordenes (empresa_id, comprador_documento);
create index if not exists sorteo_ordenes_telefono_idx on :"schema".sorteo_ordenes (empresa_id, comprador_telefono);
create unique index if not exists sorteo_ordenes_idem_uk on :"schema".sorteo_ordenes (empresa_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists sorteo_ordenes_referencia_uk on :"schema".sorteo_ordenes (sorteo_id, referencia_pago)
  where referencia_pago is not null and estado in ('pendiente_pago', 'en_revision', 'confirmada');

create table if not exists :"schema".sorteo_numeros (
  sorteo_id uuid not null references :"schema".sorteos(id) on delete cascade,
  numero integer not null,
  orden integer not null,
  estado text not null default 'libre',
  orden_id uuid references :"schema".sorteo_ordenes(id) on delete set null,
  impreso_at timestamptz,
  primary key (sorteo_id, numero),
  constraint chk_sorteo_numeros_estado check (estado in ('libre', 'reservado', 'vendido'))
);
create index if not exists sorteo_numeros_libres_idx on :"schema".sorteo_numeros (sorteo_id, orden) where estado = 'libre';
create index if not exists sorteo_numeros_orden_idx on :"schema".sorteo_numeros (orden_id) where orden_id is not null;

create table if not exists :"schema".sorteo_premios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  sorteo_id uuid not null references :"schema".sorteos(id) on delete cascade,
  posicion smallint not null,
  nombre text not null,
  descripcion text,
  imagen_url text,
  numero_ganador integer,
  orden_id uuid references :"schema".sorteo_ordenes(id) on delete set null,
  metodo text,                                     -- digital / urna / externo
  intento smallint,                                -- digital: cuántos números ya ganadores se saltearon
  nota text,
  sorteado_por uuid references :"schema".usuarios(id) on delete set null,
  sorteado_at timestamptz,
  constraint sorteo_premios_pos_uk unique (sorteo_id, posicion),
  constraint chk_sorteo_premios_metodo check (metodo is null or metodo in ('digital', 'urna', 'externo'))
);
create unique index if not exists sorteo_premios_ganador_uk on :"schema".sorteo_premios (sorteo_id, numero_ganador) where numero_ganador is not null;

create table if not exists :"schema".sorteo_publico_intentos (
  id bigint generated always as identity primary key,
  clave text not null,
  created_at timestamptz not null default now()
);
create index if not exists sorteo_publico_intentos_idx on :"schema".sorteo_publico_intentos (clave, created_at);

-- Clientes: origen SORTEO y búsqueda por teléfono.
alter table :"schema".clientes drop constraint if exists clientes_origen_check;
alter table :"schema".clientes add constraint clientes_origen_check check (origen = any (array['MANUAL', 'VENTA', 'CRM', 'SORTEO']));
create index if not exists clientes_telefono_digitos_idx on :"schema".clientes (empresa_id, regexp_replace(coalesce(telefono, ''), '\D', '', 'g'))
  where deleted_at is null;

-- Solo por funciones.
do $do$
declare
  t text;
begin
  foreach t in array array['sorteos', 'sorteo_combos', 'sorteo_vendedores', 'sorteo_vendedor_clicks', 'sorteo_rendiciones',
                           'sorteo_ordenes', 'sorteo_numeros', 'sorteo_premios', 'sorteo_publico_intentos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end;
$do$;

-- Buckets propios (receta 122: todo lo del 2.0 con prefijo erp-).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('erp-sorteos',         'erp-sorteos',         false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('erp-sorteos-publico', 'erp-sorteos-publico', true,  5242880,  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- =============================================================================
-- 3. Permisos y pantallas
-- =============================================================================
do $do$
declare
  v_def text := pg_get_functiondef('permisos_catalogo()'::regprocedure);
  v_ultimo text := $a$('administrar_rrhh',           'Administrar RR HH y salarios',                  'Administración')$a$;
begin
  if position('sorteos_vender' in v_def) = 0 then
    if position(v_ultimo in v_def) = 0 then raise exception 'Receta 123: permisos_catalogo no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ultimo, v_ultimo || $b$,
    ('sorteos_vender',             'Vender boletas de sorteos',                     'Sorteos'),
    ('sorteos_revisar',            'Revisar pagos de sorteos',                      'Sorteos'),
    ('sorteos_administrar',        'Administrar sorteos, premios y vendedores',     'Sorteos')$b$);
  end if;
end;
$do$;

-- Al prender Sorteos: Supervisor, Cajero y Vendedor venden; Supervisor además revisa pagos.
create or replace function :"schema".rubro_dar_sorteos(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into perfil_pantallas (perfil_id, empresa_id, pantalla)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(case when pf.nivel_base = 'SUPERVISOR'
                                  then array['/sorteos', '/sorteos/vender', '/sorteos/ventas', '/sorteos/revision']
                                  else array['/sorteos', '/sorteos/vender', '/sorteos/ventas'] end) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
  insert into perfil_permisos (perfil_id, empresa_id, permiso)
  select pf.id, pf.empresa_id, x
    from perfiles pf, unnest(case when pf.nivel_base = 'SUPERVISOR'
                                  then array['sorteos_vender', 'sorteos_revisar'] else array['sorteos_vender'] end) x
   where pf.empresa_id = p_empresa and pf.nivel_base in ('SUPERVISOR', 'CAJERO', 'VENDEDOR') and coalesce(pf.codigo, '') <> 'ADMIN'
  on conflict do nothing;
end;
$fn$;

-- =============================================================================
-- 4. Ayudantes
-- =============================================================================
create or replace function :"schema".sorteo_sesion(p_permiso text,
  out s_empresa uuid, out s_usuario uuid, out s_nombre text, out s_rol text)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from inv_sesion();
  perform exigir_permiso(p_permiso);
  if not funcion_activa(s.s_empresa, 'sorteos') then
    raise exception 'Los sorteos no están activos en tu empresa' using errcode = '42501';
  end if;
  s_empresa := s.s_empresa; s_usuario := s.s_usuario; s_nombre := s.s_nombre; s_rol := s.s_rol;
end;
$fn$;

create or replace function :"schema".sorteo_digitos(p text) returns text
language sql immutable as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

-- Nombre para mostrar en público: "Juan Pérez" → "Juan P."
create or replace function :"schema".sorteo_nombre_publico(p text) returns text
language sql immutable as $$
  select case when coalesce(btrim(p), '') = '' then 'Participante'
              else split_part(btrim(p), ' ', 1)
                   || coalesce(' ' || nullif(left(split_part(btrim(p), ' ', 2), 1), '') || '.', '') end
$$;

create or replace function :"schema".sorteo_formato(p_sorteo sorteos, p_numero integer) returns text
language sql immutable as $$ select lpad(p_numero::text, p_sorteo.digitos, '0') $$;

-- Precio de una cantidad: el combo exacto si existe, si no cantidad × precio.
create or replace function :"schema".sorteo_precio(p_sorteo uuid, p_cantidad integer,
  out monto numeric, out precio_lista numeric, out combo_id uuid)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_precio numeric;
begin
  select s.precio into v_precio from sorteos s where s.id = p_sorteo;
  precio_lista := v_precio * p_cantidad;
  select c.precio, c.id into monto, combo_id from sorteo_combos c
   where c.sorteo_id = p_sorteo and c.cantidad = p_cantidad and c.activo;
  monto := coalesce(monto, precio_lista);
end;
$fn$;

-- Límite de intentos de las funciones públicas (por clave: ip/teléfono/token).
create or replace function :"schema".sorteo_limite(p_clave text, p_max integer, p_ventana interval)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if (select count(*) from sorteo_publico_intentos where clave = p_clave and created_at > now() - p_ventana) >= p_max then
    raise exception 'Demasiados intentos. Probá de nuevo en unos minutos';
  end if;
  insert into sorteo_publico_intentos (clave) values (p_clave);
  delete from sorteo_publico_intentos where created_at < now() - interval '1 day' and random() < 0.01;
end;
$fn$;

-- Vence los pagos web sin comprobante y libera sus números (se llama al vender y al leer).
create or replace function :"schema".sorteo_liberar_vencidas(p_sorteo uuid)
returns integer language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_ids uuid[];
begin
  with v as (
    select id from sorteo_ordenes
     where sorteo_id = p_sorteo and estado = 'pendiente_pago' and vence_at < now()
     for update skip locked),
  u as (
    update sorteo_ordenes o set estado = 'vencida', updated_at = now()
      from v where o.id = v.id
    returning o.id)
  select coalesce(array_agg(id), '{}') into v_ids from u;
  if cardinality(v_ids) > 0 then
    update sorteo_numeros set estado = 'libre', orden_id = null where orden_id = any (v_ids) and estado = 'reservado';
  end if;
  return cardinality(v_ids);
end;
$fn$;

-- Cliente del comprador: por documento, si no por teléfono; si no existe se crea (origen SORTEO).
create or replace function :"schema".sorteo_cliente(p_empresa uuid, p_nombre text, p_documento text, p_telefono text)
returns uuid language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_id uuid;
  v_doc text := nullif(regexp_replace(lower(coalesce(p_documento, '')), '[^a-z0-9]+', '', 'g'), '');
  v_tel text := nullif(sorteo_digitos(p_telefono), '');
begin
  if v_doc is not null then
    select id into v_id from clientes
     where empresa_id = p_empresa and deleted_at is null and documento is not null and btrim(documento) <> ''
       and regexp_replace(lower(documento), '[^a-z0-9]+', '', 'g') = v_doc limit 1;
  end if;
  if v_id is null and v_tel is not null then
    select id into v_id from clientes
     where empresa_id = p_empresa and deleted_at is null
       and regexp_replace(coalesce(telefono, ''), '\D', '', 'g') = v_tel limit 1;
  end if;
  if v_id is null then
    begin
      insert into clientes (empresa_id, nombre, documento, telefono, origen, tipo_cliente)
        values (p_empresa, btrim(p_nombre), nullif(btrim(coalesce(p_documento, '')), ''), v_tel, 'SORTEO', 'persona')
        returning id into v_id;
    exception when unique_violation then
      select id into v_id from clientes
       where empresa_id = p_empresa and deleted_at is null and documento is not null and btrim(documento) <> ''
         and regexp_replace(lower(documento), '[^a-z0-9]+', '', 'g') = v_doc limit 1;
    end;
  end if;
  return v_id;
end;
$fn$;

-- Genera los números del sorteo (una vez). Aleatorio: el orden de entrega se mezcla.
create or replace function :"schema".sorteo_generar_numeros(p_sorteo uuid)
returns integer language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
  v_n integer;
begin
  select * into s from sorteos where id = p_sorteo for update;
  if s.numeros_generados then return 0; end if;
  if s.modo_numeros = 'aleatorio' then
    insert into sorteo_numeros (sorteo_id, numero, orden)
    select p_sorteo, n, row_number() over (order by random())::integer
      from generate_series(s.numero_desde, s.numero_hasta) n;
  else
    insert into sorteo_numeros (sorteo_id, numero, orden)
    select p_sorteo, n, n - s.numero_desde + 1 from generate_series(s.numero_desde, s.numero_hasta) n;
  end if;
  get diagnostics v_n = row_count;
  update sorteos set numeros_generados = true, updated_at = now() where id = p_sorteo;
  return v_n;
end;
$fn$;

-- Lo que se devuelve de una orden (mismo formato para todos los canales).
create or replace function :"schema".sorteo_orden_json(p_orden uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'token', o.token, 'sorteo_id', o.sorteo_id, 'sorteo', s.nombre,
    'estado', o.estado, 'canal', o.canal, 'metodo_pago', o.metodo_pago,
    'cantidad', o.cantidad, 'monto', o.monto, 'precio_lista', o.precio_lista,
    'comprador_nombre', o.comprador_nombre, 'comprador_documento', o.comprador_documento,
    'comprador_telefono', o.comprador_telefono, 'comprador_ciudad', o.comprador_ciudad,
    'vendedor_id', o.vendedor_id, 'vendedor', (select v.nombre from sorteo_vendedores v where v.id = o.vendedor_id),
    'anuncio_id', o.anuncio_id, 'referencia_pago', o.referencia_pago, 'comprobante_path', o.comprobante_path,
    'validacion', o.validacion, 'motivo', o.motivo, 'vence_at', o.vence_at,
    'created_at', o.created_at, 'revisado_at', o.revisado_at,
    'numeros', coalesce((select jsonb_agg(sorteo_formato(s, n.numero) order by n.numero)
                           from sorteo_numeros n where n.orden_id = o.id), '[]'::jsonb))
    from sorteo_ordenes o join sorteos s on s.id = o.sorteo_id
   where o.id = p_orden
$fn$;

-- =============================================================================
-- 5. LA venta (todos los canales)
-- =============================================================================
-- p: sorteo_id, cantidad | numeros[], comprador {nombre, documento, telefono, ciudad}, canal, metodo_pago,
--    estado (confirmada | en_revision | pendiente_pago), vendedor_id, usuario_id, conversacion_id,
--    anuncio_id, anuncio_titulo, referencia_pago, comprobante_path, comprobante, validacion, idempotency_key
create or replace function :"schema".sorteo_orden_registrar(p_empresa uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
  v_id uuid;
  v_estado text := coalesce(p->>'estado', 'en_revision');
  v_canal text := p->>'canal';
  v_cant integer;
  v_pedidos integer[];
  v_tomados integer[];
  v_precio record;
  v_nombre text := btrim(coalesce(p->'comprador'->>'nombre', ''));
  v_doc text := nullif(btrim(coalesce(p->'comprador'->>'documento', '')), '');
  v_tel text := nullif(sorteo_digitos(p->'comprador'->>'telefono'), '');
  v_vend sorteo_vendedores;
  v_ya integer;
begin
  if v_estado not in ('confirmada', 'en_revision', 'pendiente_pago') then raise exception 'Estado inicial inválido'; end if;
  if v_canal is null or v_canal not in ('manual', 'vendedor', 'web', 'whatsapp') then raise exception 'Canal inválido'; end if;
  if length(v_nombre) < 2 then raise exception 'Falta el nombre del comprador'; end if;
  if v_tel is null and v_doc is null then raise exception 'Falta el teléfono o la cédula del comprador'; end if;

  select * into s from sorteos where id = (p->>'sorteo_id')::uuid and empresa_id = p_empresa for share;
  if s.id is null then raise exception 'No existe ese sorteo'; end if;
  if s.estado <> 'activo' then raise exception 'El sorteo "%" no está a la venta (%)', s.nombre, s.estado; end if;

  -- Reintento del mismo pedido (doble clic, webhook repetido): devuelve la orden que ya existe.
  if nullif(p->>'idempotency_key', '') is not null then
    select id into v_id from sorteo_ordenes where empresa_id = p_empresa and idempotency_key = p->>'idempotency_key';
    if v_id is not null then return sorteo_orden_json(v_id) || jsonb_build_object('repetida', true); end if;
  end if;

  perform sorteo_liberar_vencidas(s.id);

  if jsonb_typeof(p->'numeros') = 'array' and jsonb_array_length(p->'numeros') > 0 then
    select array_agg(distinct x::integer) into v_pedidos from jsonb_array_elements_text(p->'numeros') x;
    v_cant := cardinality(v_pedidos);
  else
    v_cant := (p->>'cantidad')::integer;
  end if;
  if v_cant is null or v_cant < 1 then raise exception 'Indicá cuántas boletas'; end if;
  if s.max_por_compra is not null and v_cant > s.max_por_compra then
    raise exception 'El máximo por compra es % boleta%', s.max_por_compra, case when s.max_por_compra = 1 then '' else 's' end;
  end if;
  if v_pedidos is not null and v_canal = 'web' and not s.permite_elegir then raise exception 'Este sorteo no permite elegir números'; end if;

  -- Vendedor: activo y dentro de su cupo para este sorteo.
  if p->>'vendedor_id' is not null then
    select * into v_vend from sorteo_vendedores where id = (p->>'vendedor_id')::uuid and empresa_id = p_empresa for update;
    if v_vend.id is null or not v_vend.activo then raise exception 'Ese vendedor no está activo'; end if;
    if v_vend.cupo is not null then
      select coalesce(sum(cantidad), 0) into v_ya from sorteo_ordenes
       where vendedor_id = v_vend.id and sorteo_id = s.id and estado in ('pendiente_pago', 'en_revision', 'confirmada');
      if v_ya + v_cant > v_vend.cupo then
        raise exception 'Superás tu cupo: te quedan % boleta% en este sorteo', greatest(v_vend.cupo - v_ya, 0),
          case when v_vend.cupo - v_ya = 1 then '' else 's' end;
      end if;
    end if;
  end if;

  if p->>'referencia_pago' is not null and exists (
       select 1 from sorteo_ordenes where sorteo_id = s.id and referencia_pago = p->>'referencia_pago'
          and estado in ('pendiente_pago', 'en_revision', 'confirmada')) then
    raise exception 'Ese comprobante ya se usó en otra compra' using errcode = '23505';
  end if;

  select * into v_precio from sorteo_precio(s.id, v_cant);

  insert into sorteo_ordenes (empresa_id, sorteo_id, cliente_id, comprador_nombre, comprador_documento, comprador_telefono,
                              comprador_ciudad, cantidad, monto, precio_lista, combo_id, canal, metodo_pago, estado, vence_at,
                              vendedor_id, usuario_id, conversacion_id, anuncio_id, anuncio_titulo, referencia_pago,
                              comprobante_path, comprobante, validacion, revisado_por, revisado_at, idempotency_key)
  values (p_empresa, s.id, sorteo_cliente(p_empresa, v_nombre, v_doc, v_tel), v_nombre, v_doc, v_tel,
          nullif(btrim(coalesce(p->'comprador'->>'ciudad', '')), ''), v_cant, v_precio.monto, v_precio.precio_lista, v_precio.combo_id,
          v_canal, coalesce(p->>'metodo_pago', 'transferencia'), v_estado,
          case when v_estado = 'pendiente_pago' then now() + make_interval(mins => s.reserva_minutos) end,
          v_vend.id, (p->>'usuario_id')::uuid, (p->>'conversacion_id')::uuid, nullif(p->>'anuncio_id', ''), nullif(p->>'anuncio_titulo', ''),
          nullif(p->>'referencia_pago', ''), nullif(p->>'comprobante_path', ''), p->'comprobante',
          case when v_estado = 'confirmada' then coalesce(p->>'validacion', 'manual') end,
          case when v_estado = 'confirmada' then (p->>'usuario_id')::uuid end,
          case when v_estado = 'confirmada' then now() end,
          nullif(p->>'idempotency_key', ''))
  returning id into v_id;

  -- Números: los elegidos (si siguen libres) o los primeros libres sin esperar a otras ventas.
  if v_pedidos is not null then
    with t as (
      update sorteo_numeros set estado = case when v_estado = 'confirmada' then 'vendido' else 'reservado' end, orden_id = v_id
       where sorteo_id = s.id and numero = any (v_pedidos) and estado = 'libre'
      returning numero)
    select array_agg(numero) into v_tomados from t;
    if coalesce(cardinality(v_tomados), 0) <> v_cant then
      raise exception 'Alguno de los números elegidos ya no está disponible. Elegí otros';
    end if;
  else
    with c as (
      select numero from sorteo_numeros
       where sorteo_id = s.id and estado = 'libre' order by orden limit v_cant
       for update skip locked),
    t as (
      update sorteo_numeros n set estado = case when v_estado = 'confirmada' then 'vendido' else 'reservado' end, orden_id = v_id
        from c where n.sorteo_id = s.id and n.numero = c.numero
      returning n.numero)
    select array_agg(numero) into v_tomados from t;
    if coalesce(cardinality(v_tomados), 0) <> v_cant then
      raise exception 'No quedan % boleta% disponibles en este sorteo', v_cant, case when v_cant = 1 then '' else 's' end;
    end if;
  end if;

  return sorteo_orden_json(v_id);
end;
$fn$;

-- =============================================================================
-- 6. Sorteos (administración)
-- =============================================================================
create or replace function :"schema".sorteo_stats(p_sorteo uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'total', (select numero_hasta - numero_desde + 1 from sorteos where id = p_sorteo),
    'vendidos', (select count(*) from sorteo_numeros where sorteo_id = p_sorteo and estado = 'vendido'),
    'reservados', (select count(*) from sorteo_numeros where sorteo_id = p_sorteo and estado = 'reservado'),
    'monto', (select coalesce(sum(monto), 0) from sorteo_ordenes where sorteo_id = p_sorteo and estado = 'confirmada'),
    'ordenes', (select count(*) from sorteo_ordenes where sorteo_id = p_sorteo and estado = 'confirmada'),
    'por_revisar', (select count(*) from sorteo_ordenes where sorteo_id = p_sorteo and estado = 'en_revision'),
    'hoy_boletas', (select coalesce(sum(cantidad), 0) from sorteo_ordenes where sorteo_id = p_sorteo and estado = 'confirmada'
                     and created_at >= date_trunc('day', now() at time zone 'America/Asuncion') at time zone 'America/Asuncion'),
    'hoy_monto', (select coalesce(sum(monto), 0) from sorteo_ordenes where sorteo_id = p_sorteo and estado = 'confirmada'
                     and created_at >= date_trunc('day', now() at time zone 'America/Asuncion') at time zone 'America/Asuncion'))
$fn$;

create or replace function :"schema".sorteo_json(p_sorteo uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $fn$
  select to_jsonb(s) - 'semilla' - 'empresa_id'
         || jsonb_build_object(
              'combos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'cantidad', c.cantidad, 'precio', c.precio,
                                                                     'etiqueta', c.etiqueta, 'activo', c.activo) order by c.orden, c.cantidad)
                                    from sorteo_combos c where c.sorteo_id = s.id), '[]'::jsonb),
              'premios', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'posicion', pr.posicion, 'nombre', pr.nombre,
                                                                      'descripcion', pr.descripcion, 'imagen_url', pr.imagen_url,
                                                                      'numero_ganador', case when pr.numero_ganador is not null then sorteo_formato(s, pr.numero_ganador) end,
                                                                      'ganador', o.comprador_nombre, 'ganador_telefono', o.comprador_telefono,
                                                                      'ganador_documento', o.comprador_documento, 'orden_numero', o.numero,
                                                                      'metodo', pr.metodo, 'nota', pr.nota, 'sorteado_at', pr.sorteado_at) order by pr.posicion)
                                     from sorteo_premios pr left join sorteo_ordenes o on o.id = pr.orden_id
                                    where pr.sorteo_id = s.id), '[]'::jsonb),
              'stats', sorteo_stats(s.id))
    from sorteos s where s.id = p_sorteo
$fn$;

create or replace function :"schema".sorteos_lista()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'nombre', x.nombre, 'slug', x.slug, 'estado', x.estado, 'precio', x.precio, 'imagen_url', x.imagen_url,
      'fecha_sorteo', x.fecha_sorteo, 'numero_desde', x.numero_desde, 'numero_hasta', x.numero_hasta,
      'stats', sorteo_stats(x.id)) order by (x.estado = 'activo') desc, x.created_at desc)
    from sorteos x where x.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

create or replace function :"schema".sorteo_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  if not exists (select 1 from sorteos where id = p_id and empresa_id = s.s_empresa) then raise exception 'No existe ese sorteo'; end if;
  return sorteo_json(p_id);
end;
$fn$;

-- p: id?, nombre, descripcion, imagen_url, precio, numero_desde, numero_hasta, modo_numeros, permite_elegir,
--    max_por_compra, fecha_sorteo, datos_pago[], reserva_minutos, confirmacion_auto, mensaje_ticket, combos[{cantidad, precio, etiqueta}]
create or replace function :"schema".sorteo_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v sorteos;
  v_id uuid := (p->>'id')::uuid;
  v_slug text;
  v_base text;
  v_i integer := 1;
  c jsonb;
  v_orden smallint := 0;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  if length(btrim(coalesce(p->>'nombre', ''))) < 3 then raise exception 'Poné un nombre al sorteo'; end if;
  if coalesce((p->>'precio')::numeric, 0) <= 0 then raise exception 'El precio por boleta tiene que ser mayor a 0'; end if;
  if jsonb_typeof(coalesce(p->'datos_pago', '[]'::jsonb)) <> 'array' then raise exception 'Los datos de pago tienen que ser una lista'; end if;

  if v_id is null then
    v_base := trim(both '-' from regexp_replace(norm(p->>'nombre'), '[^a-z0-9]+', '-', 'g'));
    if v_base = '' then v_base := 'sorteo'; end if;
    v_slug := left(v_base, 50);
    while exists (select 1 from sorteos where slug = v_slug) loop
      v_i := v_i + 1; v_slug := left(v_base, 46) || '-' || v_i;
    end loop;
    insert into sorteos (empresa_id, nombre, slug, precio, numero_desde, numero_hasta, created_by)
      values (s.s_empresa, btrim(p->>'nombre'), v_slug, (p->>'precio')::numeric,
              coalesce((p->>'numero_desde')::integer, 1), coalesce((p->>'numero_hasta')::integer, 10000), s.s_usuario)
      returning id into v_id;
  end if;

  select * into v from sorteos where id = v_id and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe ese sorteo'; end if;
  if v.estado in ('sorteado', 'anulado') then raise exception 'El sorteo ya está %: no se puede editar', v.estado; end if;

  -- El rango y el modo de los números solo se cambian antes de generarlos (al activar).
  if v.numeros_generados and (
       (p ? 'numero_desde' and (p->>'numero_desde')::integer <> v.numero_desde)
    or (p ? 'numero_hasta' and (p->>'numero_hasta')::integer <> v.numero_hasta)
    or (p ? 'modo_numeros' and p->>'modo_numeros' <> v.modo_numeros)) then
    raise exception 'Los números ya se generaron: el rango y el modo no se pueden cambiar';
  end if;

  update sorteos set
    nombre = btrim(p->>'nombre'),
    descripcion = nullif(btrim(coalesce(p->>'descripcion', '')), ''),
    imagen_url = nullif(btrim(coalesce(p->>'imagen_url', '')), ''),
    precio = (p->>'precio')::numeric,
    numero_desde = coalesce((p->>'numero_desde')::integer, numero_desde),
    numero_hasta = coalesce((p->>'numero_hasta')::integer, numero_hasta),
    digitos = length(coalesce((p->>'numero_hasta')::integer, numero_hasta)::text),
    modo_numeros = coalesce(p->>'modo_numeros', modo_numeros),
    permite_elegir = coalesce((p->>'permite_elegir')::boolean, permite_elegir),
    max_por_compra = case when p ? 'max_por_compra' then nullif((p->>'max_por_compra')::integer, 0) else max_por_compra end,
    fecha_sorteo = case when p ? 'fecha_sorteo' then (p->>'fecha_sorteo')::timestamptz else fecha_sorteo end,
    datos_pago = coalesce(p->'datos_pago', datos_pago),
    reserva_minutos = coalesce((p->>'reserva_minutos')::integer, reserva_minutos),
    confirmacion_auto = coalesce((p->>'confirmacion_auto')::boolean, confirmacion_auto),
    mensaje_ticket = case when p ? 'mensaje_ticket' then nullif(btrim(coalesce(p->>'mensaje_ticket', '')), '') else mensaje_ticket end,
    updated_at = now()
  where id = v_id;

  if jsonb_typeof(p->'combos') = 'array' then
    delete from sorteo_combos where sorteo_id = v_id;
    for c in select * from jsonb_array_elements(p->'combos') loop
      if coalesce((c->>'cantidad')::integer, 0) < 2 or coalesce((c->>'precio')::numeric, 0) <= 0 then
        raise exception 'Cada combo necesita cantidad (2 o más) y precio';
      end if;
      v_orden := v_orden + 1;
      insert into sorteo_combos (empresa_id, sorteo_id, cantidad, precio, etiqueta, orden, activo)
        values (s.s_empresa, v_id, (c->>'cantidad')::integer, (c->>'precio')::numeric, nullif(btrim(coalesce(c->>'etiqueta', '')), ''),
                v_orden, coalesce((c->>'activo')::boolean, true))
      on conflict (sorteo_id, cantidad) do update set precio = excluded.precio, etiqueta = excluded.etiqueta, orden = excluded.orden;
    end loop;
  end if;

  return sorteo_json(v_id);
end;
$fn$;

-- Ciclo: borrador → activo ⇄ pausado → cerrado → (premios) → sorteado. Anular: sin ventas confirmadas.
create or replace function :"schema".sorteo_estado(p_id uuid, p_estado text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v sorteos;
  v_lista text;
  v_n integer;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  select * into v from sorteos where id = p_id and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe ese sorteo'; end if;
  if v.estado = p_estado then return sorteo_json(p_id); end if;

  if p_estado = 'activo' then
    if v.estado not in ('borrador', 'pausado') then raise exception 'Un sorteo % no se puede volver a abrir', v.estado; end if;
    if v.estado = 'borrador' and jsonb_array_length(v.datos_pago) = 0 then
      raise exception 'Cargá al menos una cuenta para cobrar antes de activar';
    end if;
    perform sorteo_generar_numeros(p_id);
    -- La semilla del sorteo digital se fija ANTES de vender: nadie puede elegirla viendo quién compró.
    update sorteos set estado = 'activo', activado_at = coalesce(activado_at, now()),
           semilla = coalesce(semilla, encode(extensions.gen_random_bytes(32), 'hex')),
           updated_at = now()
     where id = p_id;
    update sorteos set semilla_hash = encode(extensions.digest(semilla, 'sha256'), 'hex') where id = p_id and semilla_hash is null;
  elsif p_estado = 'pausado' then
    if v.estado <> 'activo' then raise exception 'Solo se pausa un sorteo activo'; end if;
    update sorteos set estado = 'pausado', updated_at = now() where id = p_id;
  elsif p_estado = 'cerrado' then
    if v.estado not in ('activo', 'pausado') then raise exception 'Solo se cierra un sorteo activo o pausado'; end if;
    select count(*) into v_n from sorteo_ordenes where sorteo_id = p_id and estado in ('pendiente_pago', 'en_revision');
    if v_n > 0 then
      raise exception 'Hay % compra% sin confirmar: revisalas (confirmar o rechazar) antes de cerrar', v_n, case when v_n = 1 then '' else 's' end;
    end if;
    -- Huella de la lista de números vendidos: lo que entra al sorteo digital, publicado.
    select string_agg(numero::text, ',' order by numero), count(*) into v_lista, v_n
      from sorteo_numeros where sorteo_id = p_id and estado = 'vendido';
    update sorteos set estado = 'cerrado', cerrado_at = now(), lista_cantidad = v_n,
           lista_hash = encode(extensions.digest(coalesce(v_lista, ''), 'sha256'), 'hex'), updated_at = now()
     where id = p_id;
  elsif p_estado = 'anulado' then
    if v.estado in ('sorteado', 'anulado') then raise exception 'Un sorteo % no se puede anular', v.estado; end if;
    if exists (select 1 from sorteo_ordenes where sorteo_id = p_id and estado in ('confirmada', 'en_revision', 'pendiente_pago')) then
      raise exception 'El sorteo tiene compras: anulalas primero (y devolvé el dinero)';
    end if;
    update sorteos set estado = 'anulado', updated_at = now() where id = p_id;
  else
    raise exception 'Estado inválido';
  end if;
  return sorteo_json(p_id);
end;
$fn$;

-- =============================================================================
-- 7. Ventas internas, revisión y anulación
-- =============================================================================
-- Venta manual (mostrador / staff): confirmada al guardar.
create or replace function :"schema".sorteo_vender(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_metodo text := coalesce(p->>'metodo_pago', 'efectivo');
begin
  select * into s from sorteo_sesion('sorteos_vender');
  if v_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then raise exception 'Método de pago inválido'; end if;
  return sorteo_orden_registrar(s.s_empresa, jsonb_build_object(
    'sorteo_id', p->>'sorteo_id', 'cantidad', p->'cantidad', 'numeros', p->'numeros', 'comprador', p->'comprador',
    'canal', 'manual', 'metodo_pago', v_metodo, 'estado', 'confirmada', 'validacion', 'manual',
    'usuario_id', s.s_usuario, 'vendedor_id', p->>'vendedor_id', 'referencia_pago', nullif(p->>'referencia_pago', ''),
    'idempotency_key', p->>'idempotency_key'));
end;
$fn$;

create or replace function :"schema".sorteo_ordenes_lista(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_lim integer := least(greatest(coalesce((p->>'limite')::integer, 50), 1), 200);
  v_off integer := greatest(coalesce((p->>'desde')::integer, 0), 0);
  v_total bigint;
  v_filas jsonb;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  with f as (
    select o.* from sorteo_ordenes o
     where o.empresa_id = s.s_empresa
       and (p->>'sorteo_id' is null or o.sorteo_id = (p->>'sorteo_id')::uuid)
       and (p->>'estado' is null or o.estado = p->>'estado')
       and (p->>'canal' is null or o.canal = p->>'canal')
       and (p->>'vendedor_id' is null or o.vendedor_id = (p->>'vendedor_id')::uuid)
       and (v_q is null
            or o.numero::text = v_q
            or o.comprador_documento ilike '%' || v_q || '%'
            or o.comprador_telefono like '%' || sorteo_digitos(v_q) || '%' and sorteo_digitos(v_q) <> ''
            or norm(o.comprador_nombre) like '%' || norm(v_q) || '%'
            or exists (select 1 from sorteo_numeros n where n.orden_id = o.id and n.numero::text = ltrim(v_q, '0'))))
  select (select count(*) from f),
         coalesce((select jsonb_agg(sorteo_orden_json(x.id) order by x.created_at desc)
                     from (select id, created_at from f order by created_at desc limit v_lim offset v_off) x), '[]'::jsonb)
    into v_total, v_filas;
  return jsonb_build_object('total', v_total, 'filas', v_filas);
end;
$fn$;

create or replace function :"schema".sorteo_orden(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  if not exists (select 1 from sorteo_ordenes where id = p_id and empresa_id = s.s_empresa) then raise exception 'No existe esa compra'; end if;
  return sorteo_orden_json(p_id) || jsonb_build_object('comprobante',
    (select comprobante from sorteo_ordenes where id = p_id));
end;
$fn$;

-- Confirmar (manual o, por service_role, automático) un pago en revisión o pendiente.
create or replace function :"schema".sorteo_orden_confirmar_interna(p_empresa uuid, p_id uuid, p_usuario uuid, p_validacion text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  o sorteo_ordenes;
begin
  select * into o from sorteo_ordenes where id = p_id and empresa_id = p_empresa for update;
  if o.id is null then raise exception 'No existe esa compra'; end if;
  if o.estado = 'confirmada' then return sorteo_orden_json(p_id); end if;
  if o.estado not in ('en_revision', 'pendiente_pago') then raise exception 'Una compra % no se puede confirmar', o.estado; end if;
  if (select estado from sorteos where id = o.sorteo_id) not in ('activo', 'pausado') then
    raise exception 'El sorteo ya no está a la venta';
  end if;
  -- Una reserva web vencida pudo perder sus números: se exige que sigan siendo suyos.
  if (select count(*) from sorteo_numeros where orden_id = p_id) <> o.cantidad then
    raise exception 'Esta compra perdió sus números (venció la reserva). Registrala de nuevo';
  end if;
  update sorteo_numeros set estado = 'vendido' where orden_id = p_id;
  update sorteo_ordenes set estado = 'confirmada', vence_at = null, validacion = p_validacion,
         revisado_por = p_usuario, revisado_at = now(), updated_at = now()
   where id = p_id;
  return sorteo_orden_json(p_id);
end;
$fn$;

create or replace function :"schema".sorteo_orden_confirmar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_revisar');
  return sorteo_orden_confirmar_interna(s.s_empresa, p_id, s.s_usuario, 'manual');
end;
$fn$;

-- Rechazar (pago que no llegó) o anular (venta confirmada que se devuelve): liberan los números.
create or replace function :"schema".sorteo_orden_baja(p_empresa uuid, p_id uuid, p_usuario uuid, p_estado text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  o sorteo_ordenes;
  v_sorteo text;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo'; end if;
  select * into o from sorteo_ordenes where id = p_id and empresa_id = p_empresa for update;
  if o.id is null then raise exception 'No existe esa compra'; end if;
  select estado into v_sorteo from sorteos where id = o.sorteo_id;
  if v_sorteo = 'sorteado' then raise exception 'El sorteo ya se realizó: sus compras no se pueden tocar'; end if;
  if exists (select 1 from sorteo_premios pr where pr.orden_id = p_id) then raise exception 'Esta compra tiene un número ganador'; end if;
  if p_estado = 'rechazada' and o.estado not in ('en_revision', 'pendiente_pago') then
    raise exception 'Solo se rechaza un pago pendiente o en revisión';
  end if;
  if p_estado = 'anulada' and o.estado not in ('en_revision', 'pendiente_pago', 'confirmada') then
    raise exception 'Una compra % no se puede anular', o.estado;
  end if;
  if o.rendicion_id is not null then raise exception 'Esta venta ya está en una rendición del vendedor'; end if;
  update sorteo_numeros set estado = 'libre', orden_id = null, impreso_at = null where orden_id = p_id;
  update sorteo_ordenes set estado = p_estado, motivo = btrim(p_motivo), revisado_por = p_usuario, revisado_at = now(), updated_at = now()
   where id = p_id;
  return sorteo_orden_json(p_id);
end;
$fn$;

create or replace function :"schema".sorteo_orden_rechazar(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_revisar');
  return sorteo_orden_baja(s.s_empresa, p_id, s.s_usuario, 'rechazada', p_motivo);
end;
$fn$;

create or replace function :"schema".sorteo_orden_anular(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  return sorteo_orden_baja(s.s_empresa, p_id, s.s_usuario, 'anulada', p_motivo);
end;
$fn$;

-- Cupones para la urna: uno por número vendido (filtros por rango de números y "solo sin imprimir").
create or replace function :"schema".sorteo_cupones(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v sorteos;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  select * into v from sorteos where id = (p->>'sorteo_id')::uuid and empresa_id = s.s_empresa;
  if v.id is null then raise exception 'No existe ese sorteo'; end if;
  return jsonb_build_object('sorteo', v.nombre, 'cupones', coalesce((
    select jsonb_agg(jsonb_build_object('numero', sorteo_formato(v, n.numero), 'orden', o.numero, 'nombre', o.comprador_nombre,
                                        'documento', o.comprador_documento, 'telefono', o.comprador_telefono,
                                        'ciudad', o.comprador_ciudad, 'fecha', coalesce(o.revisado_at, o.created_at),
                                        'impreso', n.impreso_at is not null) order by n.numero)
      from (select * from sorteo_numeros n
             where n.sorteo_id = v.id and n.estado = 'vendido'
               and (p->>'desde' is null or n.numero >= (p->>'desde')::integer)
               and (p->>'hasta' is null or n.numero <= (p->>'hasta')::integer)
               and (not coalesce((p->>'solo_pendientes')::boolean, false) or n.impreso_at is null)
             order by n.numero limit 5000) n
      join sorteo_ordenes o on o.id = n.orden_id), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".sorteo_cupones_impresos(p_sorteo uuid, p_numeros integer[])
returns integer language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_n integer;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  if not exists (select 1 from sorteos where id = p_sorteo and empresa_id = s.s_empresa) then raise exception 'No existe ese sorteo'; end if;
  update sorteo_numeros set impreso_at = now()
   where sorteo_id = p_sorteo and numero = any (p_numeros) and estado = 'vendido' and impreso_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- =============================================================================
-- 8. Premios y ganadores
-- =============================================================================
create or replace function :"schema".sorteo_premios_guardar(p_sorteo uuid, p_premios jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v sorteos;
  x jsonb;
  v_pos smallint := 0;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  select * into v from sorteos where id = p_sorteo and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe ese sorteo'; end if;
  if jsonb_typeof(p_premios) <> 'array' or jsonb_array_length(p_premios) = 0 then raise exception 'Cargá al menos un premio'; end if;
  if exists (select 1 from sorteo_premios where sorteo_id = p_sorteo and numero_ganador is not null) then
    raise exception 'Ya hay ganadores: los premios no se pueden cambiar';
  end if;
  delete from sorteo_premios where sorteo_id = p_sorteo;
  for x in select * from jsonb_array_elements(p_premios) loop
    if length(btrim(coalesce(x->>'nombre', ''))) < 2 then raise exception 'Cada premio necesita un nombre'; end if;
    v_pos := v_pos + 1;
    insert into sorteo_premios (empresa_id, sorteo_id, posicion, nombre, descripcion, imagen_url)
      values (s.s_empresa, p_sorteo, v_pos, btrim(x->>'nombre'), nullif(btrim(coalesce(x->>'descripcion', '')), ''),
              nullif(btrim(coalesce(x->>'imagen_url', '')), ''));
  end loop;
  return sorteo_json(p_sorteo);
end;
$fn$;

-- Posición del ganador digital en la lista de vendidos (la misma cuenta que publica la página de verificación).
create or replace function :"schema".sorteo_indice(p_semilla text, p_lista_hash text, p_posicion integer, p_intento integer, p_n integer)
returns integer language sql immutable as $$
  select ((('x' || substr(encode(extensions.digest(p_semilla || ':' || p_lista_hash || ':' || p_posicion || ':' || p_intento, 'sha256'), 'hex'), 1, 15))::bit(60)::bigint
           % p_n) + 1)::integer
$$;

create or replace function :"schema".sorteo_cerrar_si_completo(p_sorteo uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if not exists (select 1 from sorteo_premios where sorteo_id = p_sorteo and numero_ganador is null) then
    update sorteos set estado = 'sorteado', semilla_revelada = true, updated_at = now() where id = p_sorteo;
  end if;
end;
$fn$;

-- Sorteo digital de UN premio (de mayor a menor posición o en el orden que se elija). Determinístico:
-- con la semilla revelada y la lista de vendidos cualquiera llega al mismo número.
create or replace function :"schema".sorteo_sortear(p_premio uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pr sorteo_premios;
  v sorteos;
  v_lista integer[];
  v_intento integer := 0;
  v_num integer;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  select * into pr from sorteo_premios where id = p_premio and empresa_id = s.s_empresa for update;
  if pr.id is null then raise exception 'No existe ese premio'; end if;
  select * into v from sorteos where id = pr.sorteo_id for update;
  if v.estado <> 'cerrado' then raise exception 'Primero cerrá la venta del sorteo'; end if;
  if pr.numero_ganador is not null then raise exception 'Ese premio ya tiene ganador'; end if;
  select array_agg(numero order by numero) into v_lista from sorteo_numeros where sorteo_id = v.id and estado = 'vendido';
  if coalesce(cardinality(v_lista), 0) = 0 then raise exception 'El sorteo no tiene números vendidos'; end if;
  if cardinality(v_lista) <= (select count(*) from sorteo_premios where sorteo_id = v.id and numero_ganador is not null) then
    raise exception 'No quedan números sin premio';
  end if;
  loop
    v_num := v_lista[sorteo_indice(v.semilla, v.lista_hash, pr.posicion, v_intento, cardinality(v_lista))];
    exit when not exists (select 1 from sorteo_premios where sorteo_id = v.id and numero_ganador = v_num);
    v_intento := v_intento + 1;
  end loop;
  update sorteo_premios set numero_ganador = v_num, intento = v_intento, metodo = 'digital',
         orden_id = (select orden_id from sorteo_numeros where sorteo_id = v.id and numero = v_num),
         sorteado_por = s.s_usuario, sorteado_at = now()
   where id = p_premio;
  perform sorteo_cerrar_si_completo(v.id);
  return sorteo_json(v.id);
end;
$fn$;

-- Ganador sacado de la urna o de una lotería externa: tiene que ser un número vendido.
create or replace function :"schema".sorteo_ganador_manual(p_premio uuid, p_numero integer, p_metodo text, p_nota text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  pr sorteo_premios;
  v sorteos;
  v_orden uuid;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  if p_metodo not in ('urna', 'externo') then raise exception 'Método inválido (urna o externo)'; end if;
  select * into pr from sorteo_premios where id = p_premio and empresa_id = s.s_empresa for update;
  if pr.id is null then raise exception 'No existe ese premio'; end if;
  select * into v from sorteos where id = pr.sorteo_id for update;
  if v.estado <> 'cerrado' then raise exception 'Primero cerrá la venta del sorteo'; end if;
  if pr.numero_ganador is not null then raise exception 'Ese premio ya tiene ganador'; end if;
  select orden_id into v_orden from sorteo_numeros where sorteo_id = v.id and numero = p_numero and estado = 'vendido';
  if v_orden is null then raise exception 'El número % no está vendido en este sorteo', sorteo_formato(v, p_numero); end if;
  if exists (select 1 from sorteo_premios where sorteo_id = v.id and numero_ganador = p_numero) then
    raise exception 'El número % ya ganó otro premio', sorteo_formato(v, p_numero);
  end if;
  update sorteo_premios set numero_ganador = p_numero, orden_id = v_orden, metodo = p_metodo,
         nota = nullif(btrim(coalesce(p_nota, '')), ''), sorteado_por = s.s_usuario, sorteado_at = now()
   where id = p_premio;
  perform sorteo_cerrar_si_completo(v.id);
  return sorteo_json(v.id);
end;
$fn$;

-- =============================================================================
-- 9. Vendedores y rendiciones
-- =============================================================================
create or replace function :"schema".sorteo_vendedor_json(p_id uuid, p_sorteo uuid default null)
returns jsonb language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'nombre', v.nombre, 'telefono', v.telefono, 'codigo', v.codigo,
    'usuario_id', v.usuario_id, 'cupo', v.cupo, 'comision_pct', v.comision_pct, 'activo', v.activo,
    'tiene_pin', v.pin_hash is not null, 'tiene_link', v.acceso_hash is not null,
    'clicks', (select count(*) from sorteo_vendedor_clicks c where c.vendedor_id = v.id and (p_sorteo is null or c.sorteo_id = p_sorteo)),
    'boletas', (select coalesce(sum(o.cantidad), 0) from sorteo_ordenes o
                 where o.vendedor_id = v.id and o.estado = 'confirmada' and (p_sorteo is null or o.sorteo_id = p_sorteo)),
    'monto', (select coalesce(sum(o.monto), 0) from sorteo_ordenes o
               where o.vendedor_id = v.id and o.estado = 'confirmada' and (p_sorteo is null or o.sorteo_id = p_sorteo)),
    'por_rendir', (select coalesce(sum(o.monto), 0) from sorteo_ordenes o
                    where o.vendedor_id = v.id and o.estado = 'confirmada' and o.metodo_pago = 'efectivo' and o.rendicion_id is null))
    from sorteo_vendedores v where v.id = p_id
$fn$;

create or replace function :"schema".sorteo_vendedores_lista(p_sorteo uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from sorteo_sesion('sorteos_vender');
  return coalesce((select jsonb_agg(sorteo_vendedor_json(v.id, p_sorteo) order by v.activo desc, v.numero)
                     from sorteo_vendedores v where v.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

-- p: id?, nombre, telefono, codigo?, usuario_id?, cupo?, comision_pct, activo, pin? (4 a 8 dígitos)
-- Devuelve el vendedor y, si se generó, el PIN (se muestra una sola vez).
create or replace function :"schema".sorteo_vendedor_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := (p->>'id')::uuid;
  v_codigo text := upper(regexp_replace(coalesce(p->>'codigo', ''), '[^A-Za-z0-9]', '', 'g'));
  v_pin text := nullif(p->>'pin', '');
  v_nuevo_pin text;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  if length(btrim(coalesce(p->>'nombre', ''))) < 2 then raise exception 'Poné el nombre del vendedor'; end if;
  if v_pin is not null and v_pin !~ '^\d{4,8}$' then raise exception 'El PIN tiene que tener de 4 a 8 números'; end if;
  if v_codigo = '' then
    v_codigo := left(upper(regexp_replace(norm(p->>'nombre'), '[^a-z0-9]', '', 'g')), 8);
    if length(v_codigo) < 3 then v_codigo := 'VEN'; end if;
    while exists (select 1 from sorteo_vendedores where empresa_id = s.s_empresa and codigo = v_codigo and id is distinct from v_id) loop
      v_codigo := left(v_codigo, 8) || (floor(random() * 900) + 100)::integer;
    end loop;
  end if;
  if exists (select 1 from sorteo_vendedores where empresa_id = s.s_empresa and codigo = v_codigo and id is distinct from v_id) then
    raise exception 'El código % ya lo usa otro vendedor', v_codigo;
  end if;

  if v_id is null then
    v_nuevo_pin := coalesce(v_pin, lpad((floor(random() * 10000))::integer::text, 4, '0'));
    insert into sorteo_vendedores (empresa_id, numero, nombre, telefono, codigo, usuario_id, cupo, comision_pct, pin_hash, created_by)
      values (s.s_empresa, coalesce((select max(numero) from sorteo_vendedores where empresa_id = s.s_empresa), 0) + 1,
              btrim(p->>'nombre'), nullif(sorteo_digitos(p->>'telefono'), ''), v_codigo, (p->>'usuario_id')::uuid,
              nullif((p->>'cupo')::integer, 0), coalesce((p->>'comision_pct')::numeric, 0),
              extensions.crypt(v_nuevo_pin, extensions.gen_salt('bf', 8)), s.s_usuario)
      returning id into v_id;
  else
    update sorteo_vendedores set
      nombre = btrim(p->>'nombre'), telefono = nullif(sorteo_digitos(p->>'telefono'), ''), codigo = v_codigo,
      usuario_id = (p->>'usuario_id')::uuid, cupo = nullif((p->>'cupo')::integer, 0),
      comision_pct = coalesce((p->>'comision_pct')::numeric, comision_pct),
      activo = coalesce((p->>'activo')::boolean, activo),
      pin_hash = case when v_pin is not null then extensions.crypt(v_pin, extensions.gen_salt('bf', 8)) else pin_hash end,
      intentos_fallidos = case when v_pin is not null then 0 else intentos_fallidos end,
      bloqueado_hasta = case when v_pin is not null then null else bloqueado_hasta end,
      updated_at = now()
    where id = v_id and empresa_id = s.s_empresa;
    if not found then raise exception 'No existe ese vendedor'; end if;
  end if;
  return sorteo_vendedor_json(v_id) || jsonb_build_object('pin', v_nuevo_pin);
end;
$fn$;

-- Link del punto de venta: se genera (y se muestra) una sola vez; uno nuevo invalida el anterior.
create or replace function :"schema".sorteo_vendedor_link(p_id uuid, p_revocar boolean default false)
returns text language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_token text;
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  if not p_revocar then v_token := encode(extensions.gen_random_bytes(24), 'hex'); end if;
  update sorteo_vendedores set acceso_hash = case when v_token is null then null else encode(extensions.digest(v_token, 'sha256'), 'hex') end,
         updated_at = now()
   where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'No existe ese vendedor'; end if;
  return v_token;
end;
$fn$;

-- Rendición: el vendedor entrega el efectivo de sus ventas confirmadas, menos su comisión.
create or replace function :"schema".sorteo_rendir(p_vendedor uuid, p_nota text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v sorteo_vendedores;
  v_id uuid;
  r record;
begin
  select * into s from sorteo_sesion('sorteos_revisar');
  select * into v from sorteo_vendedores where id = p_vendedor and empresa_id = s.s_empresa for update;
  if v.id is null then raise exception 'No existe ese vendedor'; end if;
  select count(*) as n, coalesce(sum(cantidad), 0) as boletas, coalesce(sum(monto), 0) as monto into r
    from sorteo_ordenes where vendedor_id = v.id and estado = 'confirmada' and metodo_pago = 'efectivo' and rendicion_id is null;
  if r.n = 0 then raise exception 'El vendedor no tiene efectivo por rendir'; end if;
  insert into sorteo_rendiciones (empresa_id, vendedor_id, cantidad_ordenes, boletas, monto, comision, entregado, nota, recibido_por)
    values (s.s_empresa, v.id, r.n, r.boletas, r.monto, round(r.monto * v.comision_pct / 100), r.monto - round(r.monto * v.comision_pct / 100),
            nullif(btrim(coalesce(p_nota, '')), ''), s.s_usuario)
    returning id into v_id;
  update sorteo_ordenes set rendicion_id = v_id, updated_at = now()
   where vendedor_id = v.id and estado = 'confirmada' and metodo_pago = 'efectivo' and rendicion_id is null;
  return jsonb_build_object('id', v_id, 'ordenes', r.n, 'boletas', r.boletas, 'monto', r.monto,
                            'comision', round(r.monto * v.comision_pct / 100), 'entregado', r.monto - round(r.monto * v.comision_pct / 100));
end;
$fn$;

-- =============================================================================
-- 10. Punto de venta del vendedor (público: link + PIN)
-- =============================================================================
create or replace function :"schema".sorteo_vendedor_acceso(p_token text, p_pin text)
returns sorteo_vendedores language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v sorteo_vendedores;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Link inválido' using errcode = '42501'; end if;
  select * into v from sorteo_vendedores where acceso_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if v.id is null or not v.activo then raise exception 'Este link ya no es válido. Pedí uno nuevo' using errcode = '42501'; end if;
  if not funcion_activa(v.empresa_id, 'sorteos') then raise exception 'Los sorteos no están activos' using errcode = '42501'; end if;
  if v.bloqueado_hasta is not null and v.bloqueado_hasta > now() then
    raise exception 'Demasiados PIN incorrectos. Probá de nuevo en unos minutos' using errcode = '42501';
  end if;
  if v.pin_hash is null or extensions.crypt(coalesce(p_pin, ''), v.pin_hash) <> v.pin_hash then
    update sorteo_vendedores set intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = case when intentos_fallidos + 1 >= 5 then now() + interval '15 minutes' end
     where id = v.id;
    -- Se confirma el contador aunque la llamada falle: el error sale como resultado, no como excepción.
    return null;
  end if;
  if v.intentos_fallidos > 0 then update sorteo_vendedores set intentos_fallidos = 0, bloqueado_hasta = null where id = v.id; end if;
  return v;
end;
$fn$;

create or replace function :"schema".sorteo_vendedor_entrar(p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v sorteo_vendedores;
begin
  v := sorteo_vendedor_acceso(p_token, p_pin);
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'PIN incorrecto'); end if;
  return jsonb_build_object('ok', true, 'vendedor', sorteo_vendedor_json(v.id) - 'usuario_id',
    'sorteos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio, 'imagen_url', s.imagen_url,
                                                            'max_por_compra', s.max_por_compra,
                                                            'combos', (sorteo_json(s.id))->'combos',
                                                            'mis_boletas', (select coalesce(sum(o.cantidad), 0) from sorteo_ordenes o
                                                                             where o.vendedor_id = v.id and o.sorteo_id = s.id
                                                                               and o.estado in ('pendiente_pago', 'en_revision', 'confirmada')))
                                           order by s.created_at desc)
                           from sorteos s where s.empresa_id = v.empresa_id and s.estado = 'activo'), '[]'::jsonb),
    'ultimas', coalesce((select jsonb_agg(sorteo_orden_json(o.id) - 'token' order by o.created_at desc)
                           from (select id, created_at from sorteo_ordenes where vendedor_id = v.id order by created_at desc limit 20) o), '[]'::jsonb));
end;
$fn$;

-- p: sorteo_id, cantidad, comprador {nombre, documento, telefono, ciudad}, metodo_pago (efectivo | transferencia)
create or replace function :"schema".sorteo_vendedor_vender(p_token text, p_pin text, p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v sorteo_vendedores;
  v_metodo text := coalesce(p->>'metodo_pago', 'efectivo');
begin
  v := sorteo_vendedor_acceso(p_token, p_pin);
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'PIN incorrecto'); end if;
  if v_metodo not in ('efectivo', 'transferencia') then raise exception 'Método de pago inválido'; end if;
  return jsonb_build_object('ok', true, 'orden', sorteo_orden_registrar(v.empresa_id, jsonb_build_object(
    'sorteo_id', p->>'sorteo_id', 'cantidad', p->'cantidad', 'comprador', p->'comprador', 'canal', 'vendedor',
    'metodo_pago', v_metodo, 'vendedor_id', v.id, 'usuario_id', v.usuario_id,
    -- Efectivo: lo cobró él (rinde después). Transferencia: queda para revisar el comprobante.
    'estado', case when v_metodo = 'efectivo' then 'confirmada' else 'en_revision' end,
    'validacion', case when v_metodo = 'efectivo' then 'manual' end,
    'referencia_pago', nullif(p->>'referencia_pago', ''), 'idempotency_key', p->>'idempotency_key')));
end;
$fn$;

-- Click en el link de referido /r/<codigo>: cuenta y devuelve a qué sorteo/whatsapp ir.
create or replace function :"schema".sorteo_referido(p_codigo text, p_slug text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v sorteo_vendedores;
  s sorteos;
begin
  if p_codigo is null or upper(p_codigo) !~ '^[A-Z0-9]{3,20}$' then return null; end if;
  select * into s from sorteos where slug = p_slug and estado = 'activo';
  select * into v from sorteo_vendedores
   where codigo = upper(p_codigo) and activo and (s.id is null or empresa_id = s.empresa_id)
   order by (empresa_id = s.empresa_id) desc nulls last limit 1;
  if v.id is null or not funcion_activa(v.empresa_id, 'sorteos') then return null; end if;
  perform sorteo_limite('ref:' || v.id, 600, interval '1 minute');
  insert into sorteo_vendedor_clicks (empresa_id, vendedor_id, sorteo_id) values (v.empresa_id, v.id, s.id);
  return jsonb_build_object('codigo', v.codigo, 'vendedor', v.nombre, 'slug', s.slug);
end;
$fn$;

-- =============================================================================
-- 11. Página pública
-- =============================================================================
create or replace function :"schema".sorteo_publico_sorteo(p_slug text) returns sorteos
language sql stable security definer set search_path = :"schema", public as $$
  select s.* from sorteos s
   where s.slug = p_slug and s.estado in ('activo', 'pausado', 'cerrado', 'sorteado') and funcion_activa(s.empresa_id, 'sorteos')
$$;

create or replace function :"schema".sorteo_publico(p_slug text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
begin
  s := sorteo_publico_sorteo(p_slug);
  if s.id is null then return null; end if;
  if s.estado = 'activo' then perform sorteo_liberar_vencidas(s.id); end if;
  return jsonb_build_object(
    'slug', s.slug, 'nombre', s.nombre, 'descripcion', s.descripcion, 'imagen_url', s.imagen_url, 'estado', s.estado,
    'precio', s.precio, 'fecha_sorteo', s.fecha_sorteo, 'max_por_compra', s.max_por_compra, 'permite_elegir', s.permite_elegir,
    'numero_desde', s.numero_desde, 'numero_hasta', s.numero_hasta, 'digitos', s.digitos, 'reserva_minutos', s.reserva_minutos,
    'empresa', (select nombre from empresas where id = s.empresa_id),
    'combos', coalesce((select jsonb_agg(jsonb_build_object('cantidad', c.cantidad, 'precio', c.precio, 'etiqueta', c.etiqueta)
                                         order by c.orden, c.cantidad)
                          from sorteo_combos c where c.sorteo_id = s.id and c.activo), '[]'::jsonb),
    'disponibles', (select count(*) from sorteo_numeros where sorteo_id = s.id and estado = 'libre'),
    'vendidos', (select count(*) from sorteo_numeros where sorteo_id = s.id and estado = 'vendido'),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('posicion', pr.posicion, 'nombre', pr.nombre, 'descripcion', pr.descripcion,
                                                             'imagen_url', pr.imagen_url,
                                                             'numero_ganador', case when pr.numero_ganador is not null then sorteo_formato(s, pr.numero_ganador) end,
                                                             'ganador', sorteo_nombre_publico(o.comprador_nombre), 'ciudad', o.comprador_ciudad,
                                                             'metodo', pr.metodo) order by pr.posicion)
                           from sorteo_premios pr left join sorteo_ordenes o on o.id = pr.orden_id where pr.sorteo_id = s.id), '[]'::jsonb),
    'verificacion', jsonb_build_object('semilla_hash', s.semilla_hash, 'lista_hash', s.lista_hash, 'lista_cantidad', s.lista_cantidad,
                                       'semilla', case when s.semilla_revelada then s.semilla end));
end;
$fn$;

-- Números libres para elegir (paginado), solo si el sorteo lo permite.
create or replace function :"schema".sorteo_publico_libres(p_slug text, p_desde integer, p_cantidad integer)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
begin
  s := sorteo_publico_sorteo(p_slug);
  if s.id is null or s.estado <> 'activo' or not s.permite_elegir then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(sorteo_formato(s, numero) order by numero) from (
    select numero from sorteo_numeros where sorteo_id = s.id and estado = 'libre' and numero >= coalesce(p_desde, s.numero_desde)
     order by numero limit least(greatest(coalesce(p_cantidad, 100), 1), 300)) x), '[]'::jsonb);
end;
$fn$;

-- Compra web: reserva los números `reserva_minutos` hasta que suba el comprobante.
-- p: cantidad | numeros[], comprador {nombre, documento, telefono, ciudad}, vendedor (código referido), idempotency_key
create or replace function :"schema".sorteo_publico_comprar(p_slug text, p jsonb, p_ip text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
  v_tel text := sorteo_digitos(p->'comprador'->>'telefono');
  v_vend uuid;
  v_orden jsonb;
begin
  s := sorteo_publico_sorteo(p_slug);
  if s.id is null then raise exception 'No existe ese sorteo'; end if;
  if length(v_tel) < 8 then raise exception 'Poné un número de celular válido'; end if;
  if length(btrim(coalesce(p->'comprador'->>'documento', ''))) < 5 then raise exception 'Poné tu número de cédula'; end if;
  perform sorteo_limite('web:ip:' || coalesce(p_ip, '?'), 10, interval '10 minutes');
  perform sorteo_limite('web:tel:' || v_tel, 5, interval '10 minutes');
  if (select count(*) from sorteo_ordenes where sorteo_id = s.id and comprador_telefono = v_tel and estado = 'pendiente_pago') >= 2 then
    raise exception 'Ya tenés compras esperando el comprobante: terminá esas primero';
  end if;
  if nullif(p->>'vendedor', '') is not null then
    select id into v_vend from sorteo_vendedores where empresa_id = s.empresa_id and codigo = upper(p->>'vendedor') and activo;
  end if;
  v_orden := sorteo_orden_registrar(s.empresa_id, jsonb_build_object(
    'sorteo_id', s.id, 'cantidad', p->'cantidad', 'numeros', p->'numeros', 'comprador', p->'comprador', 'canal', 'web',
    'metodo_pago', 'transferencia', 'estado', 'pendiente_pago', 'vendedor_id', v_vend, 'idempotency_key', p->>'idempotency_key'));
  return jsonb_build_object('token', v_orden->>'token', 'orden', v_orden - 'token' - 'comprador_documento',
                            'datos_pago', s.datos_pago);
end;
$fn$;

-- Estado de una compra por su link privado (ticket, pago pendiente, etc.).
create or replace function :"schema".sorteo_publico_orden(p_token text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  o sorteo_ordenes;
  s sorteos;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into o from sorteo_ordenes where token = p_token;
  if o.id is null then return null; end if;
  select * into s from sorteos where id = o.sorteo_id;
  if not funcion_activa(s.empresa_id, 'sorteos') then return null; end if;
  if o.estado = 'pendiente_pago' and o.vence_at < now() then
    perform sorteo_liberar_vencidas(o.sorteo_id);
    select * into o from sorteo_ordenes where id = o.id;
  end if;
  return sorteo_orden_json(o.id) - 'token' - 'comprador_documento' - 'vendedor_id' - 'anuncio_id' - 'comprobante_path'
         || jsonb_build_object('slug', s.slug, 'imagen_url', s.imagen_url, 'fecha_sorteo', s.fecha_sorteo,
                               'empresa', (select nombre from empresas where id = s.empresa_id),
                               'mensaje_ticket', s.mensaje_ticket,
                               'datos_pago', case when o.estado = 'pendiente_pago' then s.datos_pago end,
                               'comprobante_subido', o.comprobante_path is not null);
end;
$fn$;

-- El comprador subió el comprobante (el servidor lo guardó en erp-sorteos): pasa a revisión.
create or replace function :"schema".sorteo_publico_comprobante(p_token text, p_path text, p_referencia text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  o sorteo_ordenes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Link inválido'; end if;
  perform sorteo_limite('comp:' || p_token, 10, interval '10 minutes');
  select * into o from sorteo_ordenes where token = p_token for update;
  if o.id is null then raise exception 'Link inválido'; end if;
  if p_path is null or p_path !~ ('^' || current_schema() || '/' || o.empresa_id || '/' || o.id || '/[a-z0-9-]+\.(jpg|png|webp|pdf)$') then
    raise exception 'Archivo inválido';
  end if;
  if o.estado = 'pendiente_pago' and o.vence_at < now() then
    raise exception 'Se venció el tiempo para pagar y tus números se liberaron. Hacé la compra de nuevo';
  end if;
  if o.estado not in ('pendiente_pago', 'en_revision') then raise exception 'Esta compra ya está %', o.estado; end if;
  if nullif(btrim(coalesce(p_referencia, '')), '') is not null and exists (
       select 1 from sorteo_ordenes where sorteo_id = o.sorteo_id and referencia_pago = btrim(p_referencia) and id <> o.id
          and estado in ('pendiente_pago', 'en_revision', 'confirmada')) then
    raise exception 'Ese comprobante ya se usó en otra compra';
  end if;
  update sorteo_ordenes set comprobante_path = p_path, estado = 'en_revision', vence_at = null,
         referencia_pago = coalesce(nullif(btrim(coalesce(p_referencia, '')), ''), referencia_pago), updated_at = now()
   where id = o.id;
  return sorteo_publico_orden(p_token);
end;
$fn$;

-- "Verificá tu número": si está vendido muestra solo el nombre corto y la ciudad.
create or replace function :"schema".sorteo_publico_numero(p_slug text, p_numero integer, p_ip text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
  n sorteo_numeros;
  o sorteo_ordenes;
begin
  s := sorteo_publico_sorteo(p_slug);
  if s.id is null then return null; end if;
  perform sorteo_limite('num:' || coalesce(p_ip, '?'), 60, interval '1 minute');
  select * into n from sorteo_numeros where sorteo_id = s.id and numero = p_numero;
  if n.numero is null then return jsonb_build_object('existe', false); end if;
  select * into o from sorteo_ordenes where id = n.orden_id;
  return jsonb_build_object('existe', true, 'numero', sorteo_formato(s, n.numero),
    'estado', case when n.estado = 'vendido' then 'vendido' when n.estado = 'reservado' then 'reservado' else 'libre' end,
    'participante', case when n.estado = 'vendido' then sorteo_nombre_publico(o.comprador_nombre) end,
    'ciudad', case when n.estado = 'vendido' then o.comprador_ciudad end,
    'premio', (select pr.nombre from sorteo_premios pr where pr.sorteo_id = s.id and pr.numero_ganador = n.numero));
end;
$fn$;

-- Lista de números que entraron al sorteo digital (para recalcular el ganador). Solo con la venta cerrada.
create or replace function :"schema".sorteo_publico_lista(p_slug text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s sorteos;
begin
  s := sorteo_publico_sorteo(p_slug);
  if s.id is null or s.estado not in ('cerrado', 'sorteado') then return null; end if;
  return jsonb_build_object('lista_hash', s.lista_hash, 'numeros',
    (select coalesce(jsonb_agg(numero order by numero), '[]'::jsonb) from sorteo_numeros where sorteo_id = s.id and estado = 'vendido'));
end;
$fn$;

-- =============================================================================
-- 12. Permisos de ejecución
-- =============================================================================
do $do$
declare
  f text;
begin
  -- Ayudantes internos: nadie de afuera.
  foreach f in array array[
    'rubro_dar_sorteos(uuid)', 'sorteo_digitos(text)', 'sorteo_nombre_publico(text)', 'sorteo_formato(sorteos,integer)',
    'sorteo_precio(uuid,integer)', 'sorteo_limite(text,integer,interval)', 'sorteo_liberar_vencidas(uuid)',
    'sorteo_cliente(uuid,text,text,text)', 'sorteo_generar_numeros(uuid)', 'sorteo_orden_json(uuid)',
    'sorteo_stats(uuid)', 'sorteo_json(uuid)', 'sorteo_orden_baja(uuid,uuid,uuid,text,text)',
    'sorteo_indice(text,text,integer,integer,integer)', 'sorteo_cerrar_si_completo(uuid)',
    'sorteo_vendedor_json(uuid,uuid)', 'sorteo_vendedor_acceso(text,text)', 'sorteo_publico_sorteo(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Solo el servidor (bot de WhatsApp, confirmación automática).
  foreach f in array array['sorteo_orden_registrar(uuid,jsonb)', 'sorteo_orden_confirmar_interna(uuid,uuid,uuid,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Con sesión (cada una exige su permiso y la función Sorteos prendida).
  foreach f in array array[
    'sorteo_sesion(text)', 'sorteos_lista()', 'sorteo_detalle(uuid)', 'sorteo_guardar(jsonb)', 'sorteo_estado(uuid,text)',
    'sorteo_vender(jsonb)', 'sorteo_ordenes_lista(jsonb)', 'sorteo_orden(uuid)', 'sorteo_orden_confirmar(uuid)',
    'sorteo_orden_rechazar(uuid,text)', 'sorteo_orden_anular(uuid,text)', 'sorteo_cupones(jsonb)',
    'sorteo_cupones_impresos(uuid,integer[])', 'sorteo_premios_guardar(uuid,jsonb)', 'sorteo_sortear(uuid)',
    'sorteo_ganador_manual(uuid,integer,text,text)', 'sorteo_vendedores_lista(uuid)', 'sorteo_vendedor_guardar(jsonb)',
    'sorteo_vendedor_link(uuid,boolean)', 'sorteo_rendir(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Públicas a propósito (verify-rls las conoce): página del sorteo, compra web, referidos y punto de venta.
  foreach f in array array[
    'sorteo_publico(text)', 'sorteo_publico_libres(text,integer,integer)', 'sorteo_publico_comprar(text,jsonb,text)',
    'sorteo_publico_orden(text)', 'sorteo_publico_comprobante(text,text,text)', 'sorteo_publico_numero(text,integer,text)',
    'sorteo_publico_lista(text)', 'sorteo_referido(text,text)', 'sorteo_vendedor_entrar(text,text)',
    'sorteo_vendedor_vender(text,text,jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$do$;

-- Las empresas que ya tengan Sorteos prendida (re-aplicación): pantallas y permisos.
do $do$
declare
  r record;
begin
  for r in select empresa_id from empresa_funciones where sorteos loop
    perform rubro_dar_sorteos(r.empresa_id);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
