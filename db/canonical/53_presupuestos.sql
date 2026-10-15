-- =============================================================================
-- PRESUPUESTOS: cotizar → mandar (PDF / WhatsApp / link) → aceptar → convertir a venta.
--
-- Tablas
--   · presupuestos            cabecera (PRE-000001), cliente existente O prospecto
--                             (nombre/RUC/teléfono/email libres), validez, moneda,
--                             condición propuesta, vendedor, descuento global, totales
--                             con IVA incluido desglosado (10 / 5 / exenta), estado,
--                             token del link público, vistas.
--   · presupuestos_items      líneas: producto del catálogo o línea LIBRE (servicio sin
--                             producto, con su IVA), descuento % por línea.
--   · presupuestos_eventos    historial (creado, editado, revisión, enviado, visto, pdf,
--                             aceptado, rechazado, convertido…).
--   · presupuestos_config     validez por defecto (15 días), condiciones comerciales por
--                             defecto y si el cliente puede aceptar/rechazar desde el link.
--   · ventas.presupuesto_id   la venta sabe de qué presupuesto salió.
--
-- Estados guardados: borrador → enviado → aceptado | rechazado → convertido.
-- "vencido" NO se guarda: es borrador/enviado con valido_hasta < hoy (Asunción). Así no
-- hace falta un cron y nunca queda desfasado (presupuesto_estado_efectivo).
--
-- Versionado (lo más simple y claro): se edita EN EL LUGAR mientras está en borrador o
-- enviado. Editar un ENVIADO sube la revisión (PRE-000001 rev 2) y guarda en el historial
-- una foto completa de la versión anterior (evento "revision"). El link del cliente
-- siempre muestra la versión vigente. Aceptado / rechazado / convertido no se editan:
-- se duplican (nuevo número).
--
-- Seguridad
--   · RLS por empresa_actual(); a `authenticated` SOLO se le da SELECT. Toda escritura va
--     por funciones SECURITY DEFINER con search_path fijo que validan empresa Y rol adentro
--     (presupuesto_actor). Como corren como dueño (salta RLS), cada consulta filtra por
--     empresa a mano.
--   · Vista pública: presupuesto_publico(token) es SECURITY DEFINER ejecutable por `anon`
--     y devuelve SOLO los campos públicos (sin notas internas, ids, costos ni venta). El
--     token son 64 hex de dos gen_random_uuid() (≈244 bits, inadivinable) y el link vence
--     con la validez. Se eligió esto y no una ruta con service-role: el servidor de Next
--     llama con la clave anónima, así que aunque hubiera un bug en la ruta, no podría leer
--     nada más que lo que esta función decide mostrar.
-- IDEMPOTENTE. No toca las recetas 50 a 52.
-- =============================================================================
set search_path = :"schema", public, extensions;

-- ── Tablas ───────────────────────────────────────────────────────────────────
create table if not exists :"schema".presupuestos_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  validez_dias integer not null default 15,
  condiciones text,
  respuesta_online boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint chk_pres_cfg_validez check (validez_dias between 1 and 365)
);

create table if not exists :"schema".presupuestos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text not null,
  revision integer not null default 1,
  cliente_id uuid references :"schema".clientes(id) on delete set null,
  cliente_nombre text not null,
  cliente_ruc text,
  cliente_telefono text,
  cliente_email text,
  cliente_direccion text,
  fecha date not null default ((now() at time zone 'America/Asuncion')::date),
  validez_dias integer not null default 15,
  valido_hasta date not null,
  moneda text not null default 'GS',
  tipo_cambio numeric not null default 1,
  condicion text not null default 'contado',
  plazo_dias integer,
  vendedor_id uuid references :"schema".usuarios(id) on delete set null,
  vendedor_nombre text,
  descuento_pct numeric not null default 0,
  subtotal_bruto numeric not null default 0,     -- Σ cantidad × precio (sin descuentos)
  descuento_lineas numeric not null default 0,   -- lo que bajan los descuentos por línea
  descuento_global numeric not null default 0,   -- lo que baja el descuento global
  total numeric not null default 0,              -- a pagar, IVA incluido
  total_10 numeric not null default 0,
  iva_10 numeric not null default 0,
  total_5 numeric not null default 0,
  iva_5 numeric not null default 0,
  total_exenta numeric not null default 0,
  total_iva numeric not null default 0,
  condiciones text,                              -- observaciones / condiciones comerciales (las ve el cliente)
  notas_internas text,                           -- nunca salen del ERP
  estado text not null default 'borrador',
  enviado_at timestamptz,
  aceptado_at timestamptz,
  aceptado_por text,
  rechazado_at timestamptz,
  rechazado_por text,
  rechazo_motivo text,
  convertido_at timestamptz,
  venta_id uuid references :"schema".ventas(id) on delete set null,
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  vistas integer not null default 0,
  visto_at timestamptz,
  ultima_vista_at timestamptz,
  busqueda text,
  idempotency_key uuid,
  created_by uuid references :"schema".usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_pres_estado check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado', 'convertido')),
  constraint chk_pres_moneda check (moneda in ('GS', 'USD')),
  constraint chk_pres_cambio check (tipo_cambio > 0),
  constraint chk_pres_condicion check (condicion in ('contado', 'credito')),
  constraint chk_pres_plazo check (plazo_dias is null or plazo_dias between 1 and 3650),
  constraint chk_pres_desc check (descuento_pct >= 0 and descuento_pct < 100),
  constraint chk_pres_validez check (valido_hasta >= fecha),
  constraint chk_pres_revision check (revision >= 1),
  constraint chk_pres_token check (token ~ '^[0-9a-f]{64}$')
);
create unique index if not exists uq_presupuestos_numero on :"schema".presupuestos (empresa_id, numero);
create unique index if not exists uq_presupuestos_token on :"schema".presupuestos (token);
create unique index if not exists uq_presupuestos_idem on :"schema".presupuestos (empresa_id, idempotency_key) where idempotency_key is not null;
create index if not exists presupuestos_fecha_idx on :"schema".presupuestos (empresa_id, fecha desc, created_at desc);
create index if not exists presupuestos_cliente_idx on :"schema".presupuestos (empresa_id, cliente_id, fecha desc) where cliente_id is not null;
create index if not exists presupuestos_estado_idx on :"schema".presupuestos (empresa_id, estado, valido_hasta);
create index if not exists presupuestos_busqueda_trgm on :"schema".presupuestos using gin (busqueda extensions.gin_trgm_ops);

create table if not exists :"schema".presupuestos_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  presupuesto_id uuid not null references :"schema".presupuestos(id) on delete cascade,
  orden integer not null default 0,
  producto_id uuid references :"schema".productos(id) on delete set null,  -- null = línea libre
  sku text,
  descripcion text not null,
  detalle text,
  unidad text,
  cantidad numeric not null,
  precio_unitario numeric not null,     -- en la moneda del presupuesto, IVA incluido, sin descuento
  precio_lista numeric,                 -- el de lista del producto al cotizar (en la moneda)
  descuento_pct numeric not null default 0,
  tipo_iva text not null default '10%',
  total numeric not null default 0,         -- con el descuento de la línea
  total_final numeric not null default 0,   -- además con el descuento global (lo que paga)
  constraint chk_pres_item_cant check (cantidad > 0),
  constraint chk_pres_item_precio check (precio_unitario > 0),
  constraint chk_pres_item_desc check (descuento_pct >= 0 and descuento_pct < 100),
  constraint chk_pres_item_iva check (tipo_iva in ('10%', '5%', 'EXENTA'))
);
create index if not exists presupuestos_items_pres_idx on :"schema".presupuestos_items (presupuesto_id, orden);

create table if not exists :"schema".presupuestos_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  presupuesto_id uuid not null references :"schema".presupuestos(id) on delete cascade,
  tipo text not null,
  canal text,
  revision integer,
  detalle jsonb,
  usuario_id uuid references :"schema".usuarios(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
-- clock_timestamp: varios eventos de la misma transacción quedan en orden.
alter table :"schema".presupuestos_eventos alter column created_at set default clock_timestamp();
create index if not exists presupuestos_eventos_pres_idx on :"schema".presupuestos_eventos (presupuesto_id, created_at desc);

-- La venta sabe de qué presupuesto salió.
alter table :"schema".ventas add column if not exists presupuesto_id uuid references :"schema".presupuestos(id) on delete set null;
create index if not exists ventas_presupuesto_idx on :"schema".ventas (presupuesto_id) where presupuesto_id is not null;

-- ── RLS: solo lectura para la sesión del usuario ────────────────────────────
alter table :"schema".presupuestos enable row level security;
alter table :"schema".presupuestos force row level security;
alter table :"schema".presupuestos_items enable row level security;
alter table :"schema".presupuestos_items force row level security;
alter table :"schema".presupuestos_eventos enable row level security;
alter table :"schema".presupuestos_eventos force row level security;
alter table :"schema".presupuestos_config enable row level security;
alter table :"schema".presupuestos_config force row level security;

drop policy if exists presupuestos_propios on :"schema".presupuestos;
create policy presupuestos_propios on :"schema".presupuestos for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists presupuestos_items_propios on :"schema".presupuestos_items;
create policy presupuestos_items_propios on :"schema".presupuestos_items for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists presupuestos_eventos_propios on :"schema".presupuestos_eventos;
create policy presupuestos_eventos_propios on :"schema".presupuestos_eventos for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists presupuestos_config_propia on :"schema".presupuestos_config;
create policy presupuestos_config_propia on :"schema".presupuestos_config for select to authenticated
  using (empresa_id = :"schema".empresa_actual());

-- Los default privileges del core dan insert/update/delete a authenticated: acá NO.
revoke all on :"schema".presupuestos, :"schema".presupuestos_items, :"schema".presupuestos_eventos, :"schema".presupuestos_config
  from anon, authenticated;
grant select on :"schema".presupuestos, :"schema".presupuestos_items, :"schema".presupuestos_eventos, :"schema".presupuestos_config
  to authenticated;
grant all on :"schema".presupuestos, :"schema".presupuestos_items, :"schema".presupuestos_eventos, :"schema".presupuestos_config
  to service_role;

-- =============================================================================
-- Helpers internos (no se le dan a nadie: solo los usan las funciones de abajo)
-- =============================================================================

-- Usuario de la sesión, activo, con uno de los roles pedidos. Si no, error claro.
create or replace function :"schema".presupuesto_actor(p_roles text[])
returns :"schema".usuarios
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  u usuarios;
begin
  select * into u from usuarios where auth_user_id = auth.uid() and activo limit 1;
  if not found then raise exception 'No hay usuario en la sesión'; end if;
  if not (u.rol = any (p_roles)) then raise exception 'No tenés permiso para hacer esto con presupuestos'; end if;
  return u;
end;
$fn$;

-- borrador/enviado con la validez pasada = vencido (calculado, nunca guardado).
create or replace function :"schema".presupuesto_estado_efectivo(p_estado text, p_valido_hasta date)
returns text language sql stable as $fn$
  select case when p_estado in ('borrador', 'enviado') and p_valido_hasta < (now() at time zone 'America/Asuncion')::date
              then 'vencido' else p_estado end
$fn$;

create or replace function :"schema".presupuesto_evento(p_id uuid, p_tipo text, p_canal text, p_detalle jsonb, p_usuario :"schema".usuarios)
returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into presupuestos_eventos (empresa_id, presupuesto_id, tipo, canal, revision, detalle, usuario_id, usuario_nombre)
  select p.empresa_id, p.id, p_tipo, p_canal, p.revision, p_detalle, p_usuario.id, p_usuario.nombre
    from presupuestos p where p.id = p_id;
end;
$fn$;

-- Aviso (campanita) al vendedor del presupuesto, si tiene.
create or replace function :"schema".presupuesto_notificar(p_id uuid, p_tipo text, p_titulo text, p_cuerpo text)
returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into usuario_notificaciones (empresa_id, usuario_id, tipo, bandeja, titulo, cuerpo, url)
  select p.empresa_id, coalesce(p.vendedor_id, p.created_by), p_tipo, 'general', left(p_titulo, 200), left(p_cuerpo, 500),
         '/presupuestos/' || p.id
    from presupuestos p
   where p.id = p_id and coalesce(p.vendedor_id, p.created_by) is not null;
exception when undefined_table then
  null; -- sin módulo de notificaciones: no pasa nada
end;
$fn$;

-- Recalcula líneas y totales. Misma cuenta que la caja (crear_venta): el precio unitario
-- se redondea con los descuentos aplicados y la línea es cantidad × ese precio. En Gs. se
-- redondea a enteros; en US$ a centavos. El IVA va incluido (10% = /11, 5% = /21) y se
-- liquida sobre el total de cada tasa, como en una factura.
create or replace function :"schema".presupuesto_recalcular(p_id uuid)
returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_dec integer;
  v_f numeric;
begin
  select case when moneda = 'USD' then 2 else 0 end, 1 - descuento_pct / 100.0 into v_dec, v_f
    from presupuestos where id = p_id;
  if v_dec is null then return; end if;

  update presupuestos_items
     set total = round(cantidad * round(precio_unitario * (1 - descuento_pct / 100.0), v_dec), v_dec),
         total_final = round(cantidad * round(precio_unitario * (1 - descuento_pct / 100.0) * v_f, v_dec), v_dec)
   where presupuesto_id = p_id;

  update presupuestos p
     set subtotal_bruto = s.bruto,
         descuento_lineas = s.bruto - s.neto,
         descuento_global = s.neto - s.final,
         total = s.final,
         total_10 = s.t10, iva_10 = round(s.t10 / 11, v_dec),
         total_5 = s.t5, iva_5 = round(s.t5 / 21, v_dec),
         total_exenta = s.tex,
         total_iva = round(s.t10 / 11, v_dec) + round(s.t5 / 21, v_dec),
         busqueda = concat_ws(' ', norm(p.numero), compacto(p.numero), norm(p.cliente_nombre), compacto(p.cliente_ruc),
                              compacto(p.cliente_telefono), norm(p.cliente_email), norm(p.vendedor_nombre), s.txt),
         updated_at = now()
    from (select coalesce(sum(round(i.cantidad * i.precio_unitario, v_dec)), 0) as bruto,
                 coalesce(sum(i.total), 0) as neto,
                 coalesce(sum(i.total_final), 0) as final,
                 coalesce(sum(i.total_final) filter (where i.tipo_iva = '10%'), 0) as t10,
                 coalesce(sum(i.total_final) filter (where i.tipo_iva = '5%'), 0) as t5,
                 coalesce(sum(i.total_final) filter (where i.tipo_iva = 'EXENTA'), 0) as tex,
                 string_agg(norm(i.descripcion) || ' ' || norm(i.sku) || ' ' || compacto(i.sku), ' ') as txt
            from presupuestos_items i where i.presupuesto_id = p_id) s
   where p.id = p_id;
end;
$fn$;

-- El documento (lo que ve el cliente en el PDF y en el link). SOLO campos públicos.
create or replace function :"schema".presupuesto_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = :"schema", public as $fn$
  select jsonb_build_object(
    'numero', p.numero, 'revision', p.revision, 'fecha', p.fecha, 'valido_hasta', p.valido_hasta,
    'validez_dias', p.validez_dias, 'estado', presupuesto_estado_efectivo(p.estado, p.valido_hasta),
    'moneda', p.moneda, 'tipo_cambio', p.tipo_cambio, 'condicion', p.condicion, 'plazo_dias', p.plazo_dias,
    'vendedor_nombre', p.vendedor_nombre,
    'cliente', jsonb_build_object('nombre', p.cliente_nombre, 'ruc', p.cliente_ruc, 'telefono', p.cliente_telefono,
                                  'email', p.cliente_email, 'direccion', p.cliente_direccion),
    'condiciones', p.condiciones, 'descuento_pct', p.descuento_pct,
    'subtotal_bruto', p.subtotal_bruto, 'descuento_lineas', p.descuento_lineas, 'descuento_global', p.descuento_global,
    'total', p.total, 'total_10', p.total_10, 'iva_10', p.iva_10, 'total_5', p.total_5, 'iva_5', p.iva_5,
    'total_exenta', p.total_exenta, 'total_iva', p.total_iva,
    'aceptado_at', p.aceptado_at, 'rechazado_at', p.rechazado_at, 'rechazo_motivo', p.rechazo_motivo,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'descripcion', i.descripcion, 'detalle', i.detalle, 'sku', i.sku, 'unidad', i.unidad,
                         'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario, 'descuento_pct', i.descuento_pct,
                         'tipo_iva', i.tipo_iva, 'total', i.total) order by i.orden)
                         from presupuestos_items i where i.presupuesto_id = p.id), '[]'::jsonb))
    from presupuestos p where p.id = p_id
$fn$;

revoke all on function :"schema".presupuesto_actor(text[]) from public;
revoke all on function :"schema".presupuesto_evento(uuid, text, text, jsonb, :"schema".usuarios) from public;
revoke all on function :"schema".presupuesto_notificar(uuid, text, text, text) from public;
revoke all on function :"schema".presupuesto_recalcular(uuid) from public;
revoke all on function :"schema".presupuesto_json(uuid) from public;
grant execute on function :"schema".presupuesto_estado_efectivo(text, date) to authenticated, service_role;

-- =============================================================================
-- guardar_presupuesto(p jsonb)  — crea o edita
--   { id? (editar), idempotency_key? (crear), cliente_id? | cliente_nombre + cliente_ruc?
--     + cliente_telefono? + cliente_email? + cliente_direccion?, fecha?, validez_dias? |
--     valido_hasta?, moneda, tipo_cambio?, condicion, plazo_dias?, vendedor_id?,
--     descuento_pct?, condiciones?, notas_internas?,
--     items: [{ producto_id? | (descripcion + tipo_iva), descripcion?, detalle?, unidad?,
--               cantidad, precio_unitario, descuento_pct? }] }
-- Editar: solo borrador o enviado; un enviado sube de revisión (foto de la anterior en el
-- historial). → { id, numero, revision, total, repetido? }
-- =============================================================================
create or replace function :"schema".guardar_presupuesto(p jsonb)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  v_emp uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_cfg presupuestos_config;
  v_actual presupuestos;
  v_cli record;
  v_cli_id uuid;
  v_vend record;
  v_numero text;
  v_revision integer := 1;
  v_fecha date;
  v_hasta date;
  v_validez integer;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric;
  v_dec integer;
  v_cond text := coalesce(nullif(p->>'condicion', ''), 'contado');
  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_desc numeric := coalesce(nullif(p->>'descuento_pct', '')::numeric, 0);
  v_nombre text;
  v_ruc text;
  v_tel text;
  v_email text;
  v_dir text;
  v_foto jsonb;
  it jsonb;
  prod record;
  v_orden integer := 0;
  v_cant numeric;
  v_precio numeric;
  v_dl numeric;
  v_iva text;
  v_descr text;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  v_emp := v_u.empresa_id;

  -- Idempotencia al crear: un doble clic devuelve el mismo presupuesto.
  if v_id is null and v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('presupuesto:' || v_emp::text || ':' || v_idem::text, 0));
    select id, numero, revision, total into v_rep from presupuestos where empresa_id = v_emp and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero', v_rep.numero, 'revision', v_rep.revision, 'total', v_rep.total, 'repetido', true);
    end if;
  end if;

  if v_id is not null then
    select * into v_actual from presupuestos where id = v_id and empresa_id = v_emp for update;
    if not found then raise exception 'Presupuesto no encontrado'; end if;
    if v_actual.estado not in ('borrador', 'enviado') then
      raise exception 'Un presupuesto % no se edita. Duplicalo para hacer uno nuevo.',
        case v_actual.estado when 'aceptado' then 'aceptado' when 'rechazado' then 'rechazado' else 'convertido en venta' end;
    end if;
  end if;

  select * into v_cfg from presupuestos_config where empresa_id = v_emp;

  -- Cliente existente (se copian sus datos) o prospecto / cliente ocasional (datos libres).
  if nullif(p->>'cliente_id', '') is not null then
    select c.id, coalesce(nullif(btrim(c.razon_social), ''), c.nombre) as nombre,
           coalesce(nullif(btrim(c.ruc), ''), nullif(btrim(c.documento), '')) as ruc,
           nullif(btrim(c.telefono), '') as telefono, nullif(btrim(c.email), '') as email,
           nullif(concat_ws(', ', nullif(btrim(c.direccion), ''), nullif(btrim(c.ciudad), '')), '') as direccion
      into v_cli from clientes c
     where c.id = (p->>'cliente_id')::uuid and c.empresa_id = v_emp and c.deleted_at is null;
    if not found then raise exception 'Cliente no encontrado'; end if;
    v_cli_id := v_cli.id;
    v_nombre := v_cli.nombre;
    v_ruc := coalesce(nullif(btrim(p->>'cliente_ruc'), ''), v_cli.ruc);
    v_tel := coalesce(nullif(btrim(p->>'cliente_telefono'), ''), v_cli.telefono);
    v_email := coalesce(nullif(btrim(p->>'cliente_email'), ''), v_cli.email);
    v_dir := coalesce(nullif(btrim(p->>'cliente_direccion'), ''), v_cli.direccion);
  else
    v_nombre := nullif(btrim(p->>'cliente_nombre'), '');
    if v_nombre is null then raise exception 'Elegí el cliente o escribí el nombre del prospecto'; end if;
    v_ruc := nullif(btrim(p->>'cliente_ruc'), '');
    v_tel := nullif(btrim(p->>'cliente_telefono'), '');
    v_email := nullif(btrim(p->>'cliente_email'), '');
    v_dir := nullif(btrim(p->>'cliente_direccion'), '');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'El email del cliente no es válido'; end if;

  -- Vendedor: un usuario activo de la empresa (por defecto, quien lo carga).
  select id, nombre into v_vend from usuarios
   where id = coalesce(nullif(p->>'vendedor_id', '')::uuid, v_u.id) and empresa_id = v_emp and activo;
  if not found then raise exception 'Vendedor no encontrado'; end if;

  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  v_cambio := case when v_moneda = 'USD' then nullif(p->>'tipo_cambio', '')::numeric else 1 end;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  v_dec := case when v_moneda = 'USD' then 2 else 0 end;

  if v_cond not in ('contado', 'credito') then raise exception 'Condición inválida'; end if;
  if v_cond = 'credito' then
    if v_plazo is null or v_plazo < 1 or v_plazo > 3650 then raise exception 'Poné el plazo del crédito (en días)'; end if;
  else
    v_plazo := null;
  end if;
  if v_desc < 0 or v_desc >= 100 then raise exception 'El descuento global tiene que estar entre 0 y 99,99 %%'; end if;

  -- Fecha y validez (días o fecha de vencimiento).
  v_fecha := coalesce(nullif(p->>'fecha', '')::date, v_actual.fecha, v_hoy);
  if v_fecha > v_hoy then raise exception 'La fecha del presupuesto no puede ser futura'; end if;
  if nullif(p->>'valido_hasta', '') is not null then
    v_hasta := (p->>'valido_hasta')::date;
  else
    v_validez := coalesce(nullif(p->>'validez_dias', '')::integer, v_cfg.validez_dias, 15);
    if v_validez < 1 or v_validez > 365 then raise exception 'La validez tiene que estar entre 1 y 365 días'; end if;
    v_hasta := v_fecha + v_validez;
  end if;
  if v_hasta < v_fecha then raise exception 'El vencimiento no puede ser antes de la fecha del presupuesto'; end if;
  if v_hasta > v_fecha + 365 then raise exception 'La validez no puede pasar de un año'; end if;

  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'El presupuesto no tiene líneas';
  end if;
  if jsonb_array_length(p->'items') > 300 then raise exception 'Máximo 300 líneas por presupuesto'; end if;

  if v_id is null then
    v_numero := 'PRE-' || lpad(reservar_secuencia('presupuesto', coalesce((
                  select max(substring(numero from '[0-9]+$')::bigint) from presupuestos where empresa_id = v_emp), 0))::text, 6, '0');
    insert into presupuestos (empresa_id, numero, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_email,
                              cliente_direccion, fecha, validez_dias, valido_hasta, moneda, tipo_cambio, condicion, plazo_dias,
                              vendedor_id, vendedor_nombre, descuento_pct, condiciones, notas_internas, idempotency_key, created_by)
      values (v_emp, v_numero, v_cli_id, v_nombre, v_ruc, v_tel, v_email, v_dir, v_fecha, v_hasta - v_fecha, v_hasta,
              v_moneda, v_cambio, v_cond, v_plazo, v_vend.id, v_vend.nombre, v_desc,
              left(nullif(btrim(coalesce(p->>'condiciones', v_cfg.condiciones)), ''), 4000),
              left(nullif(btrim(p->>'notas_internas'), ''), 4000), v_idem, v_u.id)
      returning id into v_id;
  else
    v_numero := v_actual.numero;
    v_revision := v_actual.revision;
    -- Editar uno ya mandado: nueva revisión, con la foto de la anterior en el historial.
    if v_actual.estado = 'enviado' then
      v_foto := presupuesto_json(v_id);
      v_revision := v_actual.revision + 1;
    end if;
    update presupuestos
       set revision = v_revision, cliente_id = v_cli_id, cliente_nombre = v_nombre, cliente_ruc = v_ruc,
           cliente_telefono = v_tel, cliente_email = v_email, cliente_direccion = v_dir, fecha = v_fecha,
           validez_dias = v_hasta - v_fecha, valido_hasta = v_hasta, moneda = v_moneda, tipo_cambio = v_cambio,
           condicion = v_cond, plazo_dias = v_plazo, vendedor_id = v_vend.id, vendedor_nombre = v_vend.nombre,
           descuento_pct = v_desc, condiciones = left(nullif(btrim(p->>'condiciones'), ''), 4000),
           notas_internas = left(nullif(btrim(p->>'notas_internas'), ''), 4000), updated_at = now()
     where id = v_id;
    delete from presupuestos_items where presupuesto_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    v_cant := nullif(it->>'cantidad', '')::numeric;
    v_precio := round(nullif(it->>'precio_unitario', '')::numeric, v_dec);
    v_dl := coalesce(nullif(it->>'descuento_pct', '')::numeric, 0);
    v_descr := left(nullif(btrim(it->>'descripcion'), ''), 300);
    if v_cant is null or v_cant <= 0 then raise exception 'Línea %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_precio is null or v_precio <= 0 then raise exception 'Línea %: falta el precio', v_orden; end if;
    if v_dl < 0 or v_dl >= 100 then raise exception 'Línea %: el descuento tiene que estar entre 0 y 99,99 %%', v_orden; end if;

    if nullif(it->>'producto_id', '') is not null then
      select id, nombre, sku, unidad_medida, tipo_iva, precio_venta, activo into prod
        from productos where id = (it->>'producto_id')::uuid and empresa_id = v_emp;
      if not found then raise exception 'Línea %: producto no encontrado', v_orden; end if;
      if not prod.activo then raise exception 'Línea %: el producto "%" está inactivo', v_orden, prod.nombre; end if;
      insert into presupuestos_items (empresa_id, presupuesto_id, orden, producto_id, sku, descripcion, detalle, unidad,
                                      cantidad, precio_unitario, precio_lista, descuento_pct, tipo_iva)
        values (v_emp, v_id, v_orden, prod.id, prod.sku, coalesce(v_descr, prod.nombre),
                left(nullif(btrim(it->>'detalle'), ''), 1000), prod.unidad_medida, v_cant, v_precio,
                round(prod.precio_venta / v_cambio, v_dec), v_dl, prod.tipo_iva);
    else
      -- Línea libre (servicio / ítem sin producto): descripción e IVA obligatorios.
      v_iva := nullif(it->>'tipo_iva', '');
      if v_descr is null then raise exception 'Línea %: escribí la descripción', v_orden; end if;
      if v_iva is null or v_iva not in ('10%', '5%', 'EXENTA') then raise exception 'Línea %: elegí el IVA', v_orden; end if;
      insert into presupuestos_items (empresa_id, presupuesto_id, orden, producto_id, sku, descripcion, detalle, unidad,
                                      cantidad, precio_unitario, precio_lista, descuento_pct, tipo_iva)
        values (v_emp, v_id, v_orden, null, null, v_descr, left(nullif(btrim(it->>'detalle'), ''), 1000),
                left(nullif(btrim(it->>'unidad'), ''), 30), v_cant, v_precio, null, v_dl, v_iva);
    end if;
  end loop;

  perform presupuesto_recalcular(v_id);

  if v_actual.id is null then
    perform presupuesto_evento(v_id, 'creado', null, null, v_u);
  elsif v_foto is not null then
    perform presupuesto_evento(v_id, 'revision', null,
      jsonb_build_object('revision_anterior', v_actual.revision, 'total_anterior', v_actual.total, 'anterior', v_foto), v_u);
  else
    perform presupuesto_evento(v_id, 'editado', null, null, v_u);
  end if;

  return (select jsonb_build_object('id', id, 'numero', numero, 'revision', revision, 'total', total)
            from presupuestos where id = v_id);
end;
$fn$;

-- =============================================================================
-- Acciones
-- =============================================================================

-- Se mandó (WhatsApp / link / email / a mano). Borrador → enviado. Uno vencido no se
-- manda: primero se le pone una validez nueva.
create or replace function :"schema".presupuesto_registrar_envio(p_id uuid, p_canal text)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  r presupuestos;
  v_ef text;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  if p_canal is null or p_canal not in ('whatsapp', 'link', 'email', 'manual') then raise exception 'Canal inválido'; end if;
  select * into r from presupuestos where id = p_id and empresa_id = v_u.empresa_id for update;
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  v_ef := presupuesto_estado_efectivo(r.estado, r.valido_hasta);
  if v_ef = 'vencido' then
    raise exception 'Venció el %: editalo y poné una validez nueva antes de mandarlo', to_char(r.valido_hasta, 'DD/MM/YYYY');
  end if;
  if v_ef in ('rechazado', 'convertido') then
    raise exception 'El presupuesto está %: no se manda', case v_ef when 'rechazado' then 'rechazado' else 'convertido en venta' end;
  end if;
  if r.estado = 'borrador' then
    update presupuestos set estado = 'enviado', enviado_at = now(), updated_at = now() where id = r.id;
  end if;
  perform presupuesto_evento(r.id, case when r.estado = 'borrador' then 'enviado' else 'reenviado' end, p_canal, null, v_u);
  return jsonb_build_object('id', r.id, 'estado', case when r.estado = 'borrador' then 'enviado' else r.estado end, 'token', r.token);
end;
$fn$;

-- Cambios de estado hechos desde el ERP: aceptado (el cliente dijo que sí por teléfono),
-- rechazado (con motivo) y reabrir (deshacer un aceptado/rechazado marcado por error).
create or replace function :"schema".presupuesto_cambiar_estado(p_id uuid, p_accion text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  r presupuestos;
  v_ef text;
  v_nuevo text;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  select * into r from presupuestos where id = p_id and empresa_id = v_u.empresa_id for update;
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  v_ef := presupuesto_estado_efectivo(r.estado, r.valido_hasta);

  if p_accion = 'aceptar' then
    if r.estado not in ('borrador', 'enviado') then raise exception 'Solo se acepta un presupuesto abierto'; end if;
    update presupuestos set estado = 'aceptado', aceptado_at = now(), aceptado_por = v_u.nombre,
           enviado_at = coalesce(enviado_at, now()), updated_at = now() where id = r.id;
    v_nuevo := 'aceptado';
    perform presupuesto_evento(r.id, 'aceptado', 'interno', case when v_ef = 'vencido' then jsonb_build_object('estaba_vencido', true) end, v_u);
  elsif p_accion = 'rechazar' then
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo del rechazo'; end if;
    if r.estado not in ('borrador', 'enviado', 'aceptado') then raise exception 'Este presupuesto ya no se puede rechazar'; end if;
    update presupuestos set estado = 'rechazado', rechazado_at = now(), rechazado_por = v_u.nombre,
           rechazo_motivo = left(btrim(p_motivo), 500), updated_at = now() where id = r.id;
    v_nuevo := 'rechazado';
    perform presupuesto_evento(r.id, 'rechazado', 'interno', jsonb_build_object('motivo', left(btrim(p_motivo), 500)), v_u);
  elsif p_accion = 'reabrir' then
    if r.estado not in ('aceptado', 'rechazado') then raise exception 'Solo se reabre un presupuesto aceptado o rechazado'; end if;
    v_nuevo := case when r.enviado_at is null then 'borrador' else 'enviado' end;
    update presupuestos set estado = v_nuevo, aceptado_at = null, aceptado_por = null, rechazado_at = null,
           rechazado_por = null, rechazo_motivo = null, updated_at = now() where id = r.id;
    perform presupuesto_evento(r.id, 'reabierto', 'interno', jsonb_build_object('estaba', r.estado), v_u);
  else
    raise exception 'Acción inválida';
  end if;
  return jsonb_build_object('id', r.id, 'estado', presupuesto_estado_efectivo(v_nuevo, r.valido_hasta));
end;
$fn$;

-- Copia como borrador nuevo (fecha de hoy, validez por defecto, vendedor = quien duplica).
create or replace function :"schema".presupuesto_duplicar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  r presupuestos;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_dias integer;
  v_id uuid;
  v_numero text;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  select * into r from presupuestos where id = p_id and empresa_id = v_u.empresa_id;
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  select coalesce((select validez_dias from presupuestos_config where empresa_id = v_u.empresa_id), 15) into v_dias;
  v_numero := 'PRE-' || lpad(reservar_secuencia('presupuesto', coalesce((
                select max(substring(numero from '[0-9]+$')::bigint) from presupuestos where empresa_id = v_u.empresa_id), 0))::text, 6, '0');
  insert into presupuestos (empresa_id, numero, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_email,
                            cliente_direccion, fecha, validez_dias, valido_hasta, moneda, tipo_cambio, condicion, plazo_dias,
                            vendedor_id, vendedor_nombre, descuento_pct, condiciones, notas_internas, created_by)
    values (r.empresa_id, v_numero, r.cliente_id, r.cliente_nombre, r.cliente_ruc, r.cliente_telefono, r.cliente_email,
            r.cliente_direccion, v_hoy, v_dias, v_hoy + v_dias, r.moneda, r.tipo_cambio, r.condicion, r.plazo_dias,
            v_u.id, v_u.nombre, r.descuento_pct, r.condiciones, r.notas_internas, v_u.id)
    returning id into v_id;
  insert into presupuestos_items (empresa_id, presupuesto_id, orden, producto_id, sku, descripcion, detalle, unidad,
                                  cantidad, precio_unitario, precio_lista, descuento_pct, tipo_iva)
    select empresa_id, v_id, orden, producto_id, sku, descripcion, detalle, unidad, cantidad, precio_unitario,
           precio_lista, descuento_pct, tipo_iva
      from presupuestos_items where presupuesto_id = r.id order by orden;
  perform presupuesto_recalcular(v_id);
  perform presupuesto_evento(v_id, 'creado', null, jsonb_build_object('duplicado_de', r.numero), v_u);
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$fn$;

-- Una línea libre pasa a ser un producto del catálogo (para poder venderla por caja).
-- No cambia lo que vio el cliente (descripción, precio, IVA): solo la liga al producto.
create or replace function :"schema".presupuesto_vincular_producto(p_item_id uuid, p_producto_id uuid)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  it presupuestos_items;
  r presupuestos;
  prod record;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  select * into it from presupuestos_items where id = p_item_id and empresa_id = v_u.empresa_id;
  if not found then raise exception 'Línea no encontrada'; end if;
  select * into r from presupuestos where id = it.presupuesto_id and empresa_id = v_u.empresa_id for update;
  if r.estado in ('rechazado', 'convertido') then raise exception 'El presupuesto ya está cerrado'; end if;
  if it.producto_id is not null then raise exception 'Esa línea ya es un producto del catálogo'; end if;
  select id, nombre, sku, unidad_medida, precio_venta, activo into prod
    from productos where id = p_producto_id and empresa_id = v_u.empresa_id;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not prod.activo then raise exception 'El producto "%" está inactivo', prod.nombre; end if;
  update presupuestos_items set producto_id = prod.id, sku = prod.sku, unidad = coalesce(unidad, prod.unidad_medida),
         precio_lista = round(prod.precio_venta / r.tipo_cambio, case when r.moneda = 'USD' then 2 else 0 end)
   where id = it.id;
  perform presupuesto_recalcular(r.id);
  perform presupuesto_evento(r.id, 'producto_vinculado', 'interno',
    jsonb_build_object('linea', it.descripcion, 'producto', prod.nombre, 'sku', prod.sku), v_u);
  return jsonb_build_object('id', it.id, 'producto_id', prod.id);
end;
$fn$;

-- Antes de cobrar en la caja: ¿se puede convertir? (error claro si no).
create or replace function :"schema".presupuesto_puede_convertir(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  r presupuestos;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  select * into r from presupuestos where id = p_id and empresa_id = v_u.empresa_id;
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  if r.estado = 'convertido' then
    raise exception 'El presupuesto % ya se convirtió en la venta %', r.numero,
      coalesce((select numero_control from ventas where id = r.venta_id), '(anulada)');
  end if;
  if r.estado = 'rechazado' then raise exception 'El presupuesto % está rechazado: reabrilo si el cliente cambió de idea', r.numero; end if;
  return jsonb_build_object('id', r.id, 'numero', r.numero);
end;
$fn$;

-- La venta ya se registró: el presupuesto queda convertido y la venta lo referencia.
-- Idempotente (reintento con la misma venta = ok).
create or replace function :"schema".presupuesto_marcar_convertido(p_id uuid, p_venta_id uuid)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  r presupuestos;
  v record;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  select * into r from presupuestos where id = p_id and empresa_id = v_u.empresa_id for update;
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  select id, numero_control, total, estado, presupuesto_id into v from ventas where id = p_venta_id and empresa_id = v_u.empresa_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if r.estado = 'convertido' then
    if r.venta_id = v.id then return jsonb_build_object('id', r.id, 'venta_id', v.id, 'numero_control', v.numero_control, 'repetido', true); end if;
    raise exception 'El presupuesto % ya se convirtió en otra venta', r.numero;
  end if;
  if r.estado = 'rechazado' then raise exception 'El presupuesto % está rechazado', r.numero; end if;
  if v.estado = 'anulada' then raise exception 'La venta % está anulada', v.numero_control; end if;
  if v.presupuesto_id is not null and v.presupuesto_id <> r.id then raise exception 'La venta % ya viene de otro presupuesto', v.numero_control; end if;

  update ventas set presupuesto_id = r.id where id = v.id;
  update presupuestos set estado = 'convertido', convertido_at = now(), venta_id = v.id,
         aceptado_at = coalesce(aceptado_at, now()), aceptado_por = coalesce(aceptado_por, v_u.nombre),
         enviado_at = coalesce(enviado_at, now()), updated_at = now()
   where id = r.id;
  perform presupuesto_evento(r.id, 'convertido', 'caja',
    jsonb_build_object('venta_id', v.id, 'numero_control', v.numero_control, 'total', v.total), v_u);
  return jsonb_build_object('id', r.id, 'venta_id', v.id, 'numero_control', v.numero_control);
end;
$fn$;

-- Si se anula la venta, el presupuesto vuelve a "aceptado" (se puede volver a convertir).
create or replace function :"schema".tg_ventas_anular_presupuesto()
returns trigger
language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.presupuesto_id is not null and new.estado = 'anulada' and old.estado is distinct from 'anulada' then
    update presupuestos set estado = 'aceptado', venta_id = null, convertido_at = null, updated_at = now()
     where id = new.presupuesto_id and empresa_id = new.empresa_id and estado = 'convertido' and venta_id = new.id;
    if found then
      insert into presupuestos_eventos (empresa_id, presupuesto_id, tipo, canal, revision, detalle, usuario_id, usuario_nombre)
      select p.empresa_id, p.id, 'venta_anulada', 'caja', p.revision,
             jsonb_build_object('venta_id', new.id, 'numero_control', new.numero_control), u.id, u.nombre
        from presupuestos p left join usuarios u on u.auth_user_id = auth.uid() and u.empresa_id = p.empresa_id
       where p.id = new.presupuesto_id;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists ventas_anular_presupuesto on :"schema".ventas;
create trigger ventas_anular_presupuesto after update of estado on :"schema".ventas
  for each row execute function :"schema".tg_ventas_anular_presupuesto();
revoke all on function :"schema".tg_ventas_anular_presupuesto() from public;

-- Documento para el PDF interno (+ deja constancia de la descarga en el historial, una
-- vez cada 10 minutos por usuario para no llenarlo).
create or replace function :"schema".presupuesto_documento(p_id uuid, p_registrar_pdf boolean default false)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  v_doc jsonb;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  if not exists (select 1 from presupuestos where id = p_id and empresa_id = v_u.empresa_id) then
    raise exception 'Presupuesto no encontrado';
  end if;
  v_doc := presupuesto_json(p_id);
  if p_registrar_pdf and not exists (
       select 1 from presupuestos_eventos
        where presupuesto_id = p_id and tipo = 'pdf' and usuario_id = v_u.id and created_at > now() - interval '10 minutes') then
    perform presupuesto_evento(p_id, 'pdf', 'interno', null, v_u);
  end if;
  return v_doc;
end;
$fn$;

-- Ajustes del módulo (solo administrador).
create or replace function :"schema".guardar_presupuestos_config(p jsonb)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u usuarios;
  v_dias integer := coalesce(nullif(p->>'validez_dias', '')::integer, 15);
begin
  v_u := presupuesto_actor(array['ADMIN']);
  if v_dias < 1 or v_dias > 365 then raise exception 'La validez tiene que estar entre 1 y 365 días'; end if;
  insert into presupuestos_config (empresa_id, validez_dias, condiciones, respuesta_online, updated_at)
    values (v_u.empresa_id, v_dias, left(nullif(btrim(p->>'condiciones'), ''), 4000),
            coalesce(nullif(p->>'respuesta_online', '')::boolean, true), now())
  on conflict (empresa_id) do update
    set validez_dias = excluded.validez_dias, condiciones = excluded.condiciones,
        respuesta_online = excluded.respuesta_online, updated_at = now();
  return (select to_jsonb(c) - 'empresa_id' from presupuestos_config c where c.empresa_id = v_u.empresa_id);
end;
$fn$;

-- =============================================================================
-- Lista paginada (SECURITY INVOKER: la RLS filtra) + cifras del encabezado.
--   estado: '' (todos) | 'abiertos' (borrador/enviado/aceptado vigentes) | borrador |
--           enviado | aceptado | rechazado | vencido | convertido
-- =============================================================================
create or replace function :"schema".listar_presupuestos(
  p_q text default null, p_estado text default null, p_cliente uuid default null, p_vendedor uuid default null,
  p_desde date default null, p_hasta date default null, p_pagina integer default 1, p_por_pagina integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion'))::date;
  v_pats text[];
  v_lim integer := least(greatest(coalesce(p_por_pagina, 25), 5), 100);
  v_off integer := (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_por_pagina, 25), 5), 100);
  v_out jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select coalesce(array_agg('%' || t || '%'), '{}') into v_pats from unnest(tokens_busqueda(p_q)) t;

  with base as (
    select p.*, presupuesto_estado_efectivo(p.estado, p.valido_hasta) as estado_ef
      from presupuestos p
     where p.empresa_id = v_emp
       and (p_cliente is null or p.cliente_id = p_cliente)
       and (p_vendedor is null or p.vendedor_id = p_vendedor)
       and (p_desde is null or p.fecha >= p_desde)
       and (p_hasta is null or p.fecha <= p_hasta)
       and (cardinality(v_pats) = 0 or p.busqueda like all (v_pats))
  ), filtrada as (
    select * from base
     where coalesce(p_estado, '') = ''
        or (p_estado = 'abiertos' and estado_ef in ('borrador', 'enviado', 'aceptado'))
        or estado_ef = p_estado
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'conteos', (select jsonb_build_object(
        'todos', count(*),
        'abiertos', count(*) filter (where estado_ef in ('borrador', 'enviado', 'aceptado')),
        'borrador', count(*) filter (where estado_ef = 'borrador'),
        'enviado', count(*) filter (where estado_ef = 'enviado'),
        'aceptado', count(*) filter (where estado_ef = 'aceptado'),
        'vencido', count(*) filter (where estado_ef = 'vencido'),
        'rechazado', count(*) filter (where estado_ef = 'rechazado'),
        'convertido', count(*) filter (where estado_ef = 'convertido')) from base),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'numero', f.numero, 'revision', f.revision, 'fecha', f.fecha, 'valido_hasta', f.valido_hasta,
        'cliente_id', f.cliente_id, 'cliente_nombre', f.cliente_nombre, 'cliente_ruc', f.cliente_ruc,
        'vendedor_id', f.vendedor_id, 'vendedor_nombre', f.vendedor_nombre, 'moneda', f.moneda, 'tipo_cambio', f.tipo_cambio,
        'total', f.total, 'estado', f.estado_ef, 'vistas', f.vistas, 'enviado_at', f.enviado_at,
        'venta_id', f.venta_id, 'venta_numero', v.numero_control,
        'dias_para_vencer', case when f.estado_ef in ('borrador', 'enviado') then f.valido_hasta - v_hoy end)
        order by f.fecha desc, f.created_at desc)
      from (select * from filtrada order by fecha desc, created_at desc limit v_lim offset v_off) f
      left join ventas v on v.id = f.venta_id), '[]'::jsonb)
  ) into v_out;

  -- Cifras del encabezado (de toda la empresa, sin filtros).
  return v_out || jsonb_build_object('kpis', (
    select jsonb_build_object(
      'abiertos', count(*) filter (where e in ('borrador', 'enviado', 'aceptado')),
      'en_negociacion', coalesce(round(sum(total * tipo_cambio) filter (where e in ('enviado', 'aceptado'))), 0),
      'mes_emitidos', count(*) filter (where fecha >= v_mes and estado <> 'borrador'),
      'mes_convertidos', count(*) filter (where fecha >= v_mes and estado = 'convertido'))
      from (select presupuesto_estado_efectivo(estado, valido_hasta) as e, total, tipo_cambio, fecha, estado
              from presupuestos where empresa_id = v_emp) k));
end;
$fn$;

-- =============================================================================
-- Link público /p/<token> (anon). SOLO por token; borradores no se ven; el link vence
-- con la validez (después muestra solo "venció").
-- =============================================================================
create or replace function :"schema".presupuesto_publico(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  r presupuestos;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_online boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into r from presupuestos where token = p_token;
  if not found or r.estado = 'borrador' then return null; end if;
  if v_hoy > r.valido_hasta then
    return jsonb_build_object('expirado', true, 'numero', r.numero, 'valido_hasta', r.valido_hasta, 'vendedor_nombre', r.vendedor_nombre);
  end if;
  select coalesce((select respuesta_online from presupuestos_config where empresa_id = r.empresa_id), true) into v_online;
  return presupuesto_json(r.id) || jsonb_build_object(
    'expirado', false,
    'permite_responder', v_online and r.estado = 'enviado');
end;
$fn$;

-- El cliente abrió el link (lo llama la página desde el navegador, así los robots que
-- arman la vista previa de WhatsApp no cuentan). Historial: una vez cada 30 min.
create or replace function :"schema".presupuesto_publico_visto(p_token text)
returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r presupuestos;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return; end if;
  select * into r from presupuestos where token = p_token for update;
  if not found or r.estado = 'borrador' or (now() at time zone 'America/Asuncion')::date > r.valido_hasta then return; end if;
  update presupuestos set vistas = vistas + 1, visto_at = coalesce(visto_at, now()), ultima_vista_at = now() where id = r.id;
  if not exists (select 1 from presupuestos_eventos where presupuesto_id = r.id and tipo = 'visto' and created_at > now() - interval '30 minutes') then
    insert into presupuestos_eventos (empresa_id, presupuesto_id, tipo, canal, revision)
      values (r.empresa_id, r.id, 'visto', 'link', r.revision);
  end if;
  if r.visto_at is null then
    perform presupuesto_notificar(r.id, 'presupuesto_visto', 'El cliente abrió el presupuesto ' || r.numero, r.cliente_nombre);
  end if;
end;
$fn$;

-- El cliente acepta o rechaza desde el link (si la empresa lo permite y está vigente).
create or replace function :"schema".presupuesto_publico_responder(p_token text, p_accion text, p_nombre text default null, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r presupuestos;
  v_online boolean;
  v_nombre text := left(nullif(btrim(coalesce(p_nombre, '')), ''), 120);
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 500);
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Presupuesto no encontrado'; end if;
  select * into r from presupuestos where token = p_token for update;
  if not found or r.estado = 'borrador' then raise exception 'Presupuesto no encontrado'; end if;
  select coalesce((select respuesta_online from presupuestos_config where empresa_id = r.empresa_id), true) into v_online;
  if not v_online then raise exception 'Este presupuesto se responde directamente con el vendedor'; end if;
  if presupuesto_estado_efectivo(r.estado, r.valido_hasta) = 'vencido' then raise exception 'Este presupuesto ya venció'; end if;
  if r.estado <> 'enviado' then raise exception 'Este presupuesto ya fue respondido'; end if;

  if p_accion = 'aceptar' then
    update presupuestos set estado = 'aceptado', aceptado_at = now(),
           aceptado_por = coalesce(v_nombre, r.cliente_nombre) || ' (desde el link)', updated_at = now()
     where id = r.id;
    insert into presupuestos_eventos (empresa_id, presupuesto_id, tipo, canal, revision, detalle)
      values (r.empresa_id, r.id, 'aceptado', 'link', r.revision, jsonb_build_object('nombre', v_nombre));
    perform presupuesto_notificar(r.id, 'presupuesto_aceptado', '¡' || r.numero || ' aceptado por el cliente!',
      r.cliente_nombre || coalesce(' · ' || v_nombre, ''));
    return jsonb_build_object('estado', 'aceptado');
  elsif p_accion = 'rechazar' then
    if v_motivo is null then raise exception 'Contanos el motivo, así te podemos ofrecer algo mejor'; end if;
    update presupuestos set estado = 'rechazado', rechazado_at = now(),
           rechazado_por = coalesce(v_nombre, r.cliente_nombre) || ' (desde el link)', rechazo_motivo = v_motivo, updated_at = now()
     where id = r.id;
    insert into presupuestos_eventos (empresa_id, presupuesto_id, tipo, canal, revision, detalle)
      values (r.empresa_id, r.id, 'rechazado', 'link', r.revision, jsonb_build_object('nombre', v_nombre, 'motivo', v_motivo));
    perform presupuesto_notificar(r.id, 'presupuesto_rechazado', r.numero || ' rechazado por el cliente', v_motivo);
    return jsonb_build_object('estado', 'rechazado');
  end if;
  raise exception 'Acción inválida';
end;
$fn$;

-- ── Permisos de ejecución ────────────────────────────────────────────────────
revoke all on function :"schema".guardar_presupuesto(jsonb) from public;
revoke all on function :"schema".presupuesto_registrar_envio(uuid, text) from public;
revoke all on function :"schema".presupuesto_cambiar_estado(uuid, text, text) from public;
revoke all on function :"schema".presupuesto_duplicar(uuid) from public;
revoke all on function :"schema".presupuesto_vincular_producto(uuid, uuid) from public;
revoke all on function :"schema".presupuesto_puede_convertir(uuid) from public;
revoke all on function :"schema".presupuesto_marcar_convertido(uuid, uuid) from public;
revoke all on function :"schema".presupuesto_documento(uuid, boolean) from public;
revoke all on function :"schema".guardar_presupuestos_config(jsonb) from public;
revoke all on function :"schema".listar_presupuestos(text, text, uuid, uuid, date, date, integer, integer) from public;
revoke all on function :"schema".presupuesto_publico(text) from public;
revoke all on function :"schema".presupuesto_publico_visto(text) from public;
revoke all on function :"schema".presupuesto_publico_responder(text, text, text, text) from public;

grant execute on function
  :"schema".guardar_presupuesto(jsonb),
  :"schema".presupuesto_registrar_envio(uuid, text),
  :"schema".presupuesto_cambiar_estado(uuid, text, text),
  :"schema".presupuesto_duplicar(uuid),
  :"schema".presupuesto_vincular_producto(uuid, uuid),
  :"schema".presupuesto_puede_convertir(uuid),
  :"schema".presupuesto_marcar_convertido(uuid, uuid),
  :"schema".presupuesto_documento(uuid, boolean),
  :"schema".guardar_presupuestos_config(jsonb),
  :"schema".listar_presupuestos(text, text, uuid, uuid, date, date, integer, integer)
  to authenticated, service_role;
grant execute on function
  :"schema".presupuesto_publico(text),
  :"schema".presupuesto_publico_visto(text),
  :"schema".presupuesto_publico_responder(text, text, text, text)
  to anon, authenticated, service_role;
