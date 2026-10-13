-- =============================================================================
-- PAGOS (cobro de facturas) y GASTOS Y SERVICIOS — portados del sistema actual, genéricos.
--
-- Pagos ("Registrar pagos de facturas pendientes de cobro"):
--   · pagos_facturas_pendientes(...)  facturas (ventas con cuenta a cobrar) con saldo, con
--     categoría del cliente ("tipo de servicio" del actual), plan de la suscripción y
--     vendedor; filtros por vencimiento, categoría y plan; totales de la vista en la misma
--     consulta. "Cobrar" registra una transferencia → Conciliación (registrar_transferencia).
--   · pagos_cobrados(...)             lo cobrado aplicado a cada factura (recibos no anulados;
--     las transferencias aprobadas ya son recibos), con método, referencia y usuario.
--
-- Gastos y Servicios (documentos que no afectan inventario: alquiler, honorarios, etc.):
--   · gasto_categorias  catálogo por empresa (reemplaza a la "cuenta contable" del actual:
--                       el 2.0 no tiene contabilidad; se conserva lo fiscal).
--   · gastos + gasto_items  cabecera fiscal (proveedor, comprobante, timbrado, fecha,
--                       condición contado/crédito, vencimiento) y líneas con IVA INCLUIDO
--                       (10 % / 5 % / exenta). Estados: borrador → confirmado → anulado.
--                       Número GS-000001 al confirmar. Idempotencia por idempotency_key.
--                       Comprobante adjunto (bucket privado "compras", lo sube la API).
--   · Al CONFIRMAR: a crédito nace su cuenta a pagar (se paga en Compras › Pagos a
--     proveedores con registrar_pago_proveedor); al contado en EFECTIVO sale de la caja
--     abierta (caja_movimientos egreso 'gasto'); otros medios solo quedan registrados.
--   · Al ANULAR (motivo obligatorio): se anula la cuenta a pagar (bloqueado si ya tiene
--     pagos) y el egreso de caja (bloqueado si la caja ya se cerró).
--   · cuentas_por_pagar admite gasto_id (compra_id pasa a opcional): listar_cuentas_pagar y
--     estado_cuenta_proveedor se redefinen acá para incluir los gastos (ver 42).
-- Sin "históricos": en el actual son los gastos viejos de la migración de Neura.
-- SECURITY INVOKER + empresa_actual(). Hoy = America/Asuncion. IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

-- ── Categorías de gasto ─────────────────────────────────────────────────────
create table if not exists :"schema".gasto_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_gasto_categorias_nombre on :"schema".gasto_categorias (empresa_id, lower(nombre));

-- ── Gastos y servicios ──────────────────────────────────────────────────────
create table if not exists :"schema".gastos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  numero text,                                   -- GS-000001 (al confirmar)
  estado text not null default 'borrador' check (estado in ('borrador', 'confirmado', 'anulado')),
  proveedor_id uuid references :"schema".proveedores(id),
  proveedor_nombre text,
  proveedor_ruc text,
  descripcion text,
  tipo_comprobante text,
  numero_comprobante text,
  timbrado text,
  fecha_comprobante date,
  tipo_pago text check (tipo_pago is null or tipo_pago in ('contado', 'credito')),
  plazo_dias integer check (plazo_dias is null or plazo_dias between 0 and 3650),
  fecha_vencimiento date,
  medio_pago text check (medio_pago is null or medio_pago in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  referencia_pago text,
  total_10 numeric not null default 0,           -- importes con IVA incluido por tasa
  iva_10 numeric not null default 0,
  total_5 numeric not null default 0,
  iva_5 numeric not null default 0,
  exenta numeric not null default 0,
  subtotal numeric not null default 0,           -- total − IVA
  monto_iva numeric not null default 0,
  total numeric not null default 0,
  observacion text,
  caja_id uuid references :"schema".cajas(id),
  idempotency_key uuid,
  comprobante_path text,
  comprobante_nombre text,
  comprobante_mime text,
  comprobante_size bigint,
  busqueda text,
  created_by uuid,
  usuario_nombre text,
  confirmado_at timestamptz,
  confirmado_por text,
  anulado_at timestamptz,
  anulado_por text,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_gastos_numero on :"schema".gastos (empresa_id, numero) where numero is not null;
create unique index if not exists uq_gastos_idem on :"schema".gastos (empresa_id, idempotency_key) where idempotency_key is not null;
-- El mismo comprobante del mismo proveedor no se confirma dos veces.
create unique index if not exists uq_gastos_comprobante on :"schema".gastos
  (empresa_id, proveedor_id, lower(tipo_comprobante), regexp_replace(numero_comprobante, '[^0-9A-Za-z]', '', 'g'), coalesce(timbrado, ''))
  where estado = 'confirmado';
create index if not exists gastos_lista_idx on :"schema".gastos (empresa_id, coalesce(fecha_comprobante, (created_at at time zone 'America/Asuncion')::date) desc, created_at desc);
create index if not exists gastos_estado_idx on :"schema".gastos (empresa_id, estado);
create index if not exists gastos_proveedor_idx on :"schema".gastos (proveedor_id);

create table if not exists :"schema".gasto_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  gasto_id uuid not null references :"schema".gastos(id) on delete cascade,
  orden integer not null default 0,
  categoria_id uuid references :"schema".gasto_categorias(id) on delete set null,
  categoria_nombre text,                         -- foto del nombre
  descripcion text not null,
  monto numeric not null default 0 check (monto >= 0),   -- IVA incluido
  iva_tipo text not null default '10%' check (iva_tipo in ('10%', '5%', 'exenta')),
  monto_iva numeric not null default 0
);
create index if not exists gasto_items_gasto_idx on :"schema".gasto_items (gasto_id, orden);

-- Egreso de caja de un gasto al contado en efectivo.
alter table :"schema".caja_movimientos add column if not exists gasto_id uuid references :"schema".gastos(id) on delete set null;
create index if not exists caja_mov_gasto_idx on :"schema".caja_movimientos (gasto_id) where gasto_id is not null;

-- Cuenta a pagar de un gasto a crédito (la de una compra sigue igual).
alter table :"schema".cuentas_por_pagar alter column compra_id drop not null;
alter table :"schema".cuentas_por_pagar add column if not exists gasto_id uuid references :"schema".gastos(id) on delete cascade;
create unique index if not exists uq_cxp_gasto on :"schema".cuentas_por_pagar (gasto_id) where gasto_id is not null;
alter table :"schema".cuentas_por_pagar drop constraint if exists chk_cxp_origen;
alter table :"schema".cuentas_por_pagar add constraint chk_cxp_origen check (compra_id is not null or gasto_id is not null);

-- Pagos › Cobrados: recibos por fecha.
create index if not exists cobros_empresa_fecha_idx on :"schema".cobros_clientes (empresa_id, fecha desc) where anulado_at is null;

do $$
declare t text;
begin
  foreach t in array array['gasto_categorias', 'gastos', 'gasto_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('create policy %I on %I to authenticated using (empresa_id = empresa_actual()) with check (empresa_id = empresa_actual())', t || '_propias', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;

-- Catálogo inicial de categorías (cada empresa lo edita desde el formulario).
insert into :"schema".gasto_categorias (empresa_id, nombre, orden)
select e.id, c.nombre, c.orden
  from :"schema".empresas e
 cross join (values
   ('Alquiler', 1), ('Servicios básicos (luz, agua)', 2), ('Internet y telefonía', 3), ('Honorarios profesionales', 4),
   ('Mantenimiento y reparaciones', 5), ('Publicidad y marketing', 6), ('Combustible y movilidad', 7),
   ('Impuestos, tasas y patentes', 8), ('Seguros', 9), ('Papelería y útiles', 10), ('Limpieza', 11),
   ('Gastos bancarios', 12), ('Otros gastos', 99)
 ) as c(nombre, orden)
on conflict (empresa_id, lower(nombre)) do nothing;

-- =============================================================================
-- GASTOS — funciones
-- =============================================================================

-- Timbrado exigido salvo en comprobantes que no lo llevan (igual que el actual).
create or replace function :"schema".gasto_requiere_timbrado(p_tipo text)
returns boolean language sql immutable as $$
  select lower(btrim(coalesce(p_tipo, ''))) not in ('', 'recibo', 'otro')
$$;

-- Escribe cabecera + líneas + totales de un gasto en borrador (uso interno).
-- p = { proveedor_id?, descripcion?, tipo_comprobante?, numero_comprobante?, timbrado?, fecha_comprobante?,
--       tipo_pago?, plazo_dias?, fecha_vencimiento?, medio_pago?, referencia_pago?, observacion?,
--       items: [{ categoria_id?, descripcion, monto, iva_tipo }] }
create or replace function :"schema".gasto_escribir(p_id uuid, p jsonb)
returns void language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_prov_id uuid;
  v_prov_nombre text;
  v_prov_ruc text;
  it jsonb;
  v_orden integer := 0;
  v_monto numeric;
  v_iva text;
  v_cat_id uuid;
  v_cat_nombre text;
  v_desc text;
  v_tipo_pago text := nullif(btrim(coalesce(p->>'tipo_pago', '')), '');
  v_medio text := nullif(btrim(coalesce(p->>'medio_pago', '')), '');
begin
  -- Solo se escribe sobre un borrador de esta empresa (la función es pública: que no sirva para editar un confirmado).
  perform 1 from gastos where id = p_id and empresa_id = v_emp and estado = 'borrador';
  if not found then raise exception 'Solo se editan los borradores'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' then raise exception 'Faltan las líneas del gasto'; end if;
  if jsonb_array_length(p->'items') > 100 then raise exception 'Máximo 100 líneas por documento'; end if;
  if v_tipo_pago is not null and v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición inválida'; end if;
  if v_medio is not null and v_medio not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then raise exception 'Medio de pago inválido'; end if;

  if nullif(p->>'proveedor_id', '') is not null then
    select id, coalesce(nullif(btrim(nombre_comercial), ''), nombre), ruc into v_prov_id, v_prov_nombre, v_prov_ruc
      from proveedores where id = (p->>'proveedor_id')::uuid and empresa_id = v_emp;
    if not found then raise exception 'Proveedor no encontrado'; end if;
  end if;

  delete from gasto_items where gasto_id = p_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_desc := btrim(coalesce(it->>'descripcion', ''));
    v_monto := round(coalesce(nullif(it->>'monto', '')::numeric, 0));
    v_iva := coalesce(nullif(it->>'iva_tipo', ''), '10%');
    if v_iva = '10' then v_iva := '10%'; elsif v_iva = '5' then v_iva := '5%'; elsif lower(v_iva) in ('exenta', 'exento') then v_iva := 'exenta'; end if;
    if v_iva not in ('10%', '5%', 'exenta') then raise exception 'Tipo de IVA inválido en una línea (10 %%, 5 %% o exenta)'; end if;
    if v_monto < 0 then raise exception 'El monto de una línea no puede ser negativo'; end if;
    v_cat_id := null;
    v_cat_nombre := null;
    if nullif(it->>'categoria_id', '') is not null then
      select id, nombre into v_cat_id, v_cat_nombre from gasto_categorias where id = (it->>'categoria_id')::uuid and empresa_id = v_emp;
      if not found then raise exception 'Una categoría de gasto no existe'; end if;
    end if;
    -- Una línea totalmente vacía no se guarda.
    if v_desc = '' and v_monto = 0 and v_cat_id is null then continue; end if;
    v_orden := v_orden + 1;
    insert into gasto_items (empresa_id, gasto_id, orden, categoria_id, categoria_nombre, descripcion, monto, iva_tipo, monto_iva)
    values (v_emp, p_id, v_orden, v_cat_id, v_cat_nombre, left(coalesce(nullif(v_desc, ''), v_cat_nombre, ''), 300), v_monto, v_iva,
            iva_contenido(v_monto, v_iva));
  end loop;

  update gastos g set
    proveedor_id = v_prov_id,
    proveedor_nombre = v_prov_nombre,
    proveedor_ruc = v_prov_ruc,
    descripcion = left(nullif(btrim(p->>'descripcion'), ''), 500),
    tipo_comprobante = left(nullif(btrim(p->>'tipo_comprobante'), ''), 60),
    numero_comprobante = left(nullif(btrim(p->>'numero_comprobante'), ''), 40),
    timbrado = left(nullif(regexp_replace(coalesce(p->>'timbrado', ''), '\s+', '', 'g'), ''), 20),
    fecha_comprobante = nullif(p->>'fecha_comprobante', '')::date,
    tipo_pago = v_tipo_pago,
    plazo_dias = case when v_tipo_pago = 'credito' then nullif(p->>'plazo_dias', '')::integer end,
    fecha_vencimiento = case when v_tipo_pago = 'credito' then nullif(p->>'fecha_vencimiento', '')::date end,
    medio_pago = case when v_tipo_pago = 'contado' then v_medio end,
    referencia_pago = case when v_tipo_pago = 'contado' then left(nullif(btrim(p->>'referencia_pago'), ''), 120) end,
    observacion = left(nullif(btrim(p->>'observacion'), ''), 1000),
    total_10 = t.t10, iva_10 = t.i10, total_5 = t.t5, iva_5 = t.i5, exenta = t.ex,
    monto_iva = t.i10 + t.i5, total = t.t10 + t.t5 + t.ex, subtotal = t.t10 + t.t5 + t.ex - t.i10 - t.i5,
    updated_at = now()
  from (select coalesce(sum(monto) filter (where iva_tipo = '10%'), 0) as t10,
               coalesce(sum(monto_iva) filter (where iva_tipo = '10%'), 0) as i10,
               coalesce(sum(monto) filter (where iva_tipo = '5%'), 0) as t5,
               coalesce(sum(monto_iva) filter (where iva_tipo = '5%'), 0) as i5,
               coalesce(sum(monto) filter (where iva_tipo = 'exenta'), 0) as ex
          from gasto_items where gasto_id = p_id) t
  where g.id = p_id;

  update gastos g set busqueda = concat_ws(' ', norm(g.numero), norm(g.proveedor_nombre), compacto(g.proveedor_ruc),
           norm(g.numero_comprobante), compacto(g.numero_comprobante), norm(g.tipo_comprobante), norm(g.descripcion),
           (select string_agg(norm(i.descripcion) || ' ' || norm(i.categoria_nombre), ' ') from gasto_items i where i.gasto_id = g.id))
   where g.id = p_id;
end;
$fn$;

-- Alta o edición de un BORRADOR. p = { id?, idempotency_key?, ...gasto_escribir } → { id, estado }
create or replace function :"schema".guardar_gasto(p jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_estado text;
  v_usr record;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if v_id is not null then
    select estado into v_estado from gastos where id = v_id and empresa_id = v_emp for update;
    if not found then raise exception 'Gasto no encontrado'; end if;
    if v_estado <> 'borrador' then raise exception 'Solo se editan los borradores'; end if;
  else
    if v_idem is not null then
      select id into v_id from gastos where empresa_id = v_emp and idempotency_key = v_idem;
      if found then return jsonb_build_object('id', v_id, 'estado', (select estado from gastos where id = v_id), 'repetido', true); end if;
    end if;
    select u.id, u.nombre into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;
    insert into gastos (empresa_id, estado, idempotency_key, created_by, usuario_nombre)
    values (v_emp, 'borrador', v_idem, auth.uid(), v_usr.nombre)
    returning id into v_id;
  end if;
  perform gasto_escribir(v_id, p);
  return jsonb_build_object('id', v_id, 'estado', 'borrador');
end;
$fn$;

-- Guarda y CONFIRMA (nuevo o borrador) en un paso atómico. → { id, numero, total, cxp_id, caja_id }
create or replace function :"schema".confirmar_gasto(p jsonb)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_usr record;
  g gastos;
  v_falta text[] := '{}';
  v_lineas integer;
  v_mal integer;
  v_numero text;
  v_venc date;
  v_caja uuid;
  v_cxp uuid;
  v_cons text;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  select u.id, u.nombre into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = v_emp limit 1;

  if v_id is not null then
    select * into g from gastos where id = v_id and empresa_id = v_emp for update;
    if not found then raise exception 'Gasto no encontrado'; end if;
    if g.estado <> 'borrador' then raise exception 'Este gasto ya está %', case g.estado when 'confirmado' then 'confirmado' else 'anulado' end; end if;
  else
    -- Idempotencia: un doble clic o un reintento devuelve el ya confirmado.
    if v_idem is not null then
      select * into g from gastos where empresa_id = v_emp and idempotency_key = v_idem;
      if found then
        if g.estado = 'confirmado' then
          return jsonb_build_object('id', g.id, 'numero', g.numero, 'total', g.total, 'repetido', true);
        end if;
        v_id := g.id;
      end if;
    end if;
    if v_id is null then
      insert into gastos (empresa_id, estado, idempotency_key, created_by, usuario_nombre)
      values (v_emp, 'borrador', v_idem, auth.uid(), v_usr.nombre)
      returning id into v_id;
    end if;
  end if;

  perform gasto_escribir(v_id, p);
  select * into g from gastos where id = v_id;

  -- Requisitos fiscales para confirmar (los mismos que el actual).
  if g.proveedor_id is null then v_falta := v_falta || 'proveedor'::text; end if;
  if g.tipo_comprobante is null then v_falta := v_falta || 'tipo de comprobante'::text; end if;
  if g.numero_comprobante is null then v_falta := v_falta || 'número de comprobante'::text; end if;
  if g.fecha_comprobante is null then v_falta := v_falta || 'fecha del comprobante'::text; end if;
  if gasto_requiere_timbrado(g.tipo_comprobante) and g.timbrado is null then v_falta := v_falta || 'timbrado'::text; end if;
  if g.tipo_pago is null then v_falta := v_falta || 'condición (contado o crédito)'::text; end if;
  if g.tipo_pago = 'contado' and g.medio_pago is null then v_falta := v_falta || 'medio de pago'::text; end if;
  if cardinality(v_falta) > 0 then raise exception 'Faltan datos para confirmar: %', array_to_string(v_falta, ', '); end if;
  if g.fecha_comprobante > v_hoy then raise exception 'La fecha del comprobante no puede ser futura'; end if;

  select count(*), count(*) filter (where categoria_id is null or btrim(descripcion) = '' or monto <= 0)
    into v_lineas, v_mal from gasto_items where gasto_id = v_id;
  if v_lineas = 0 then raise exception 'Cargá al menos una línea'; end if;
  if v_mal > 0 then raise exception 'Cada línea necesita categoría, descripción y un monto mayor a cero'; end if;
  if g.total <= 0 then raise exception 'El total tiene que ser mayor a cero'; end if;

  if g.tipo_pago = 'credito' then
    v_venc := coalesce(g.fecha_vencimiento, g.fecha_comprobante + coalesce(g.plazo_dias, 30));
    if v_venc < g.fecha_comprobante then raise exception 'El vencimiento no puede ser anterior a la fecha del comprobante'; end if;
  end if;

  if g.tipo_pago = 'contado' and g.medio_pago = 'efectivo' then
    select id into v_caja from cajas where empresa_id = v_emp and estado = 'abierta' order by fecha_apertura desc limit 1;
    if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
  end if;

  v_numero := 'GS-' || lpad(reservar_secuencia('gasto', coalesce((
                select max(substring(numero from '[0-9]+$')::bigint) from gastos where empresa_id = v_emp and numero is not null), 0))::text, 6, '0');

  begin
    update gastos set estado = 'confirmado', numero = v_numero, fecha_vencimiento = v_venc, caja_id = v_caja,
           confirmado_at = now(), confirmado_por = v_usr.nombre, updated_at = now(),
           busqueda = concat_ws(' ', norm(v_numero), busqueda)
     where id = v_id;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_gastos_comprobante' then
      raise exception using errcode = '23505', message = format('Ya hay un gasto confirmado con el comprobante %s %s de este proveedor', g.tipo_comprobante, g.numero_comprobante);
    end if;
    raise;
  end;

  if g.tipo_pago = 'credito' then
    insert into cuentas_por_pagar (empresa_id, compra_id, gasto_id, proveedor_id, numero, fecha_emision, vencimiento, moneda, monto)
    values (v_emp, null, v_id, g.proveedor_id, g.numero_comprobante, g.fecha_comprobante, v_venc, 'GS', g.total)
    returning id into v_cxp;
  elsif v_caja is not null then
    insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, gasto_id, observacion)
    values (v_emp, v_caja, 'egreso', left('Gasto ' || v_numero || ' · ' || g.proveedor_nombre, 200), round(g.total), 'efectivo', 'gasto',
            v_usr.id, v_hoy, v_id, left(g.tipo_comprobante || ' ' || g.numero_comprobante, 200));
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'total', g.total, 'cxp_id', v_cxp, 'caja_id', v_caja);
end;
$fn$;

-- Anular un confirmado (motivo obligatorio): la deuda con el proveedor y el egreso de caja se anulan.
create or replace function :"schema".anular_gasto(p_id uuid, p_motivo text)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  g gastos;
  cx cuentas_por_pagar;
  v_caja_estado text;
  v_usr record;
  v_ops text;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo de la anulación (mínimo 3 caracteres)'; end if;
  select * into g from gastos where id = p_id and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Gasto no encontrado'; end if;
  if g.estado = 'anulado' then raise exception 'El gasto ya está anulado'; end if;
  if g.estado <> 'confirmado' then raise exception 'Un borrador no se anula: se elimina'; end if;
  select u.id, u.nombre into v_usr from usuarios u where u.auth_user_id = auth.uid() and u.empresa_id = empresa_actual() limit 1;

  select * into cx from cuentas_por_pagar where gasto_id = g.id for update;
  if found then
    if cx.pagado > 0 then
      select string_agg(distinct k.numero, ', ') into v_ops
        from pagos_proveedores_aplicaciones a join pagos_proveedores k on k.id = a.pago_id
       where a.cxp_id = cx.id and k.anulado_at is null;
      raise exception 'Este gasto ya tiene pagos al proveedor (%): anulá primero esos pagos', coalesce(v_ops, 'órdenes de pago');
    end if;
    update cuentas_por_pagar set estado = 'anulada', updated_at = now() where id = cx.id;
  end if;

  if exists (select 1 from caja_movimientos where gasto_id = g.id and anulado_at is null) then
    select c.estado into v_caja_estado from caja_movimientos m join cajas c on c.id = m.caja_id
     where m.gasto_id = g.id and m.anulado_at is null limit 1;
    if v_caja_estado <> 'abierta' then raise exception 'El efectivo salió de una caja que ya se cerró: no se puede anular'; end if;
    update caja_movimientos set anulado_at = now(), anulado_por = v_usr.id, anulado_motivo = left('Gasto anulado: ' || btrim(p_motivo), 200)
     where gasto_id = g.id and anulado_at is null;
  end if;

  update gastos set estado = 'anulado', anulado_at = now(), anulado_por = v_usr.nombre, anulado_motivo = left(btrim(p_motivo), 500), updated_at = now()
   where id = g.id;
  return jsonb_build_object('id', g.id, 'numero', g.numero);
end;
$fn$;

-- Eliminar un borrador. → { id, comprobante_path } (la API borra el archivo).
create or replace function :"schema".eliminar_gasto(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = :"schema", public as $fn$
declare g gastos;
begin
  select * into g from gastos where id = p_id and empresa_id = empresa_actual() for update;
  if not found then raise exception 'Gasto no encontrado'; end if;
  if g.estado <> 'borrador' then raise exception 'Solo se eliminan los borradores (un confirmado se anula)'; end if;
  delete from gastos where id = g.id;
  return jsonb_build_object('id', g.id, 'comprobante_path', g.comprobante_path);
end;
$fn$;

-- Lista paginada con contadores y total de la vista en la misma consulta.
create or replace function :"schema".listar_gastos(
  p_q text default null, p_estado text default null, p_desde date default null, p_hasta date default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
begin
  return (
  with par as (select tokens_busqueda(p_q) as tk),
  base as (
    select g.*, coalesce(g.fecha_comprobante, (g.created_at at time zone 'America/Asuncion')::date) as fecha
      from gastos g where g.empresa_id = empresa_actual()
  ),
  filtradas as (
    select b.* from base b, par
     where (p_estado is null or b.estado = p_estado)
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (cardinality(par.tk) = 0 or coincide_busqueda(coalesce(b.busqueda, ''), par.tk))
  ),
  pagina as (
    select * from filtradas order by fecha desc, created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_monto', (select coalesce(sum(total), 0) from filtradas where estado = 'confirmado'),
    'resumen', (select jsonb_build_object('total', count(*), 'borrador', count(*) filter (where estado = 'borrador'),
                  'confirmado', count(*) filter (where estado = 'confirmado'), 'anulado', count(*) filter (where estado = 'anulado'))
                  from base),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'numero', x.numero, 'estado', x.estado, 'fecha', x.fecha,
        'proveedor_id', x.proveedor_id, 'proveedor_nombre', x.proveedor_nombre, 'proveedor_ruc', x.proveedor_ruc,
        'tipo_comprobante', x.tipo_comprobante, 'numero_comprobante', x.numero_comprobante, 'timbrado', x.timbrado,
        'descripcion', x.descripcion, 'tipo_pago', x.tipo_pago, 'medio_pago', x.medio_pago, 'fecha_vencimiento', x.fecha_vencimiento,
        'total', x.total, 'monto_iva', x.monto_iva, 'tiene_comprobante', x.comprobante_path is not null,
        'categorias', (select string_agg(distinct i.categoria_nombre, ', ') from gasto_items i where i.gasto_id = x.id),
        'cxp', (select jsonb_build_object('id', c.id, 'saldo', c.saldo, 'pagado', c.pagado, 'estado', c.estado)
                  from cuentas_por_pagar c where c.gasto_id = x.id),
        'anulado_motivo', x.anulado_motivo, 'usuario_nombre', x.usuario_nombre, 'created_at', x.created_at
      ) order by x.fecha desc, x.created_at desc) from pagina x), '[]'::jsonb)
  ));
end;
$$;

-- Detalle de un gasto: cabecera, líneas, su cuenta a pagar (con pagos) y su egreso de caja.
create or replace function :"schema".gasto_detalle(p_id uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'gasto', to_jsonb(g) - 'busqueda' - 'idempotency_key' - 'comprobante_path' || jsonb_build_object('tiene_comprobante', g.comprobante_path is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'categoria_id', i.categoria_id, 'categoria_nombre', i.categoria_nombre,
                 'descripcion', i.descripcion, 'monto', i.monto, 'iva_tipo', i.iva_tipo, 'monto_iva', i.monto_iva) order by i.orden)
               from gasto_items i where i.gasto_id = g.id), '[]'::jsonb),
    'cxp', (select jsonb_build_object('id', c.id, 'monto', c.monto, 'pagado', c.pagado, 'saldo', c.saldo, 'estado', c.estado,
                  'vencimiento', c.vencimiento,
                  'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'numero', k.numero, 'fecha', k.fecha, 'monto', a.monto,
                                        'anulado', k.anulado_at is not null) order by k.fecha)
                                       from pagos_proveedores_aplicaciones a join pagos_proveedores k on k.id = a.pago_id where a.cxp_id = c.id), '[]'::jsonb))
              from cuentas_por_pagar c where c.gasto_id = g.id),
    'caja', (select jsonb_build_object('caja_id', m.caja_id, 'numero_caja', cj.numero_caja, 'monto', m.monto, 'anulado', m.anulado_at is not null)
               from caja_movimientos m join cajas cj on cj.id = m.caja_id where m.gasto_id = g.id order by m.created_at limit 1)
  )
  from gastos g where g.id = p_id and g.empresa_id = empresa_actual()
$$;

-- =============================================================================
-- CUENTAS A PAGAR — ahora incluyen los gastos a crédito (redefine las de 42).
-- `compra_numero` trae el número de la compra o del gasto (GS-…); `gasto_id` dice cuál es.
-- =============================================================================
create or replace function :"schema".listar_cuentas_pagar(
  p_q text default null, p_filtro text default null, p_moneda text default 'GS', p_proveedor uuid default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
begin
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  par as (select tokens_busqueda(p_q) as tk),
  vivas as (
    select x.*, pr.nombre as proveedor_nombre, pr.ruc as proveedor_ruc, pr.telefono as proveedor_telefono,
           coalesce(c.numero_control, g.numero) as compra_numero,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           x.vencimiento - (select d from hoy) as dias_para_vencer,
           concat_ws(' ', norm(pr.nombre), norm(pr.nombre_comercial), regexp_replace(lower(coalesce(pr.ruc, '')), '[^a-z0-9]', '', 'g'),
                     lower(x.numero), regexp_replace(lower(x.numero), '[^a-z0-9]', '', 'g'), lower(c.numero_control), lower(g.numero), norm(g.descripcion)) as _t
      from cuentas_por_pagar x
      join proveedores pr on pr.id = x.proveedor_id
      left join compras c on c.id = x.compra_id
      left join gastos g on g.id = x.gasto_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and x.moneda = coalesce(p_moneda, 'GS')
       and (p_proveedor is null or x.proveedor_id = p_proveedor)
  ),
  filtradas as (
    select v.* from vivas v, par, hoy
     where (cardinality(par.tk) = 0 or coincide_busqueda(v._t, par.tk))
       and (p_filtro is null
            or (p_filtro = 'vencidas' and v.vencimiento < hoy.d)
            or (p_filtro = 'por_vencer' and v.vencimiento >= hoy.d)
            or (p_filtro = 'semana' and v.vencimiento between hoy.d and hoy.d + 7))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_saldo', (select coalesce(sum(saldo), 0) from filtradas),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' order by f.vencimiento, f.numero)
                        from (select * from filtradas order by vencimiento, numero
                               limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb),
    'antiguedad', (select jsonb_build_object(
        'por_vencer', coalesce(sum(saldo) filter (where dias_atraso = 0), 0),
        'vence_semana', coalesce(sum(saldo) filter (where dias_atraso = 0 and dias_para_vencer <= 7), 0),
        'd1_30', coalesce(sum(saldo) filter (where dias_atraso between 1 and 30), 0),
        'd31_60', coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        'd61_90', coalesce(sum(saldo) filter (where dias_atraso between 61 and 90), 0),
        'd90', coalesce(sum(saldo) filter (where dias_atraso > 90), 0),
        'proveedores', count(distinct proveedor_id),
        'total', coalesce(sum(saldo), 0),
        'pagado_mes', (select coalesce(sum(total), 0) from pagos_proveedores, hoy
                        where empresa_id = empresa_actual() and anulado_at is null and moneda = coalesce(p_moneda, 'GS')
                          and fecha >= (date_trunc('month', hoy.d)::timestamp at time zone 'America/Asuncion')))
      from vivas)
  ));
end;
$$;

create or replace function :"schema".estado_cuenta_proveedor(p_proveedor uuid)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d)
  select jsonb_build_object(
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'compra_id', x.compra_id, 'gasto_id', x.gasto_id, 'compra_numero', coalesce(c.numero_control, g.numero), 'numero', x.numero,
        'fecha_emision', x.fecha_emision, 'vencimiento', x.vencimiento, 'moneda', x.moneda,
        'monto', x.monto, 'pagado', x.pagado, 'saldo', x.saldo, 'estado', x.estado,
        'dias_atraso', case when x.estado in ('pendiente', 'parcial') then greatest((select d from hoy) - x.vencimiento, 0) else 0 end
      ) order by x.vencimiento desc, x.numero desc)
      from cuentas_por_pagar x left join compras c on c.id = x.compra_id left join gastos g on g.id = x.gasto_id
     where x.proveedor_id = p_proveedor and x.empresa_id = empresa_actual()), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'numero', k.numero, 'fecha', k.fecha, 'moneda', k.moneda, 'total', k.total, 'observacion', k.observacion,
        'usuario', k.usuario_nombre, 'anulado_at', k.anulado_at, 'anulado_motivo', k.anulado_motivo,
        'medios', (select jsonb_agg(jsonb_build_object('metodo', m.metodo, 'monto', m.monto, 'referencia', m.referencia)) from pagos_proveedores_medios m where m.pago_id = k.id),
        'aplicado_a', (select jsonb_agg(jsonb_build_object('numero', x.numero, 'monto', a.monto))
                         from pagos_proveedores_aplicaciones a join cuentas_por_pagar x on x.id = a.cxp_id where a.pago_id = k.id)
      ) order by k.fecha desc)
      from pagos_proveedores k where k.proveedor_id = p_proveedor and k.empresa_id = empresa_actual()), '[]'::jsonb),
    'deuda_gs', (select coalesce(sum(saldo), 0) from cuentas_por_pagar where proveedor_id = p_proveedor and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and moneda = 'GS'),
    'deuda_usd', (select coalesce(sum(saldo), 0) from cuentas_por_pagar where proveedor_id = p_proveedor and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and moneda = 'USD'),
    'vencido_gs', (select coalesce(sum(saldo), 0) from cuentas_por_pagar, hoy where proveedor_id = p_proveedor and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial') and moneda = 'GS' and vencimiento < hoy.d)
  )
$$;

-- =============================================================================
-- PAGOS (cobro de facturas)
-- =============================================================================

-- Facturas con saldo. p_categoria / p_plan: uuid o '__sin__' (sin categoría / sin plan).
-- Desde/Hasta filtran por VENCIMIENTO (igual que el actual).
create or replace function :"schema".pagos_facturas_pendientes(
  p_q text default null, p_desde date default null, p_hasta date default null,
  p_categoria text default null, p_plan text default null, p_limit integer default 100, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
begin
  return (
  with hoy as (select (now() at time zone 'America/Asuncion')::date as d),
  par as (select tokens_busqueda(p_q) as tk),
  base as (
    select x.id, x.venta_id, x.numero, x.cliente_id, x.fecha_emision, x.vencimiento, x.monto, x.cobrado, x.saldo, x.estado,
           coalesce(nullif(btrim(c.razon_social), ''), c.nombre) as cliente_nombre,
           c.categoria_id, cc.nombre as categoria_nombre,
           coalesce(u.nombre, nullif(btrim(c.vendedor_texto), '')) as vendedor,
           s.plan_id, s.plan_nombre,
           greatest((select d from hoy) - x.vencimiento, 0) as dias_atraso,
           concat_ws(' ', norm(c.nombre), norm(c.razon_social), lower(x.numero), compacto(x.numero)) as _t
      from cuentas_por_cobrar x
      join clientes c on c.id = x.cliente_id
      left join cliente_categorias cc on cc.id = c.categoria_id
      left join usuarios u on u.id = c.vendedor_usuario_id
      left join ventas v on v.id = x.venta_id
      left join suscripciones s on s.id = v.suscripcion_id
     where x.empresa_id = empresa_actual() and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and c.deleted_at is null and c.activo
  ),
  filtradas as (
    select b.* from base b, par
     where (cardinality(par.tk) = 0 or coincide_busqueda(b._t, par.tk))
       and (p_desde is null or b.vencimiento >= p_desde)
       and (p_hasta is null or b.vencimiento <= p_hasta)
       and (p_categoria is null or (p_categoria = '__sin__' and b.categoria_id is null) or b.categoria_id::text = p_categoria)
       and (p_plan is null or (p_plan = '__sin__' and b.plan_id is null and b.plan_nombre is null) or b.plan_id::text = p_plan)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_monto', (select coalesce(sum(monto), 0) from filtradas),
    'total_saldo', (select coalesce(sum(saldo), 0) from filtradas),
    'total_general', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' || jsonb_build_object(
                 'en_aprobacion', (select coalesce(sum(cp.monto), 0) from cobros_pendientes cp where cp.cxc_id = f.id and cp.estado = 'pendiente'))
               order by f.vencimiento, f.fecha_emision, f.numero)
               from (select * from filtradas order by vencimiento, fecha_emision, numero
                      limit least(greatest(coalesce(p_limit, 100), 0), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)
  ));
end;
$$;

-- Lo cobrado, una fila por factura cobrada (aplicación de un recibo no anulado).
-- Desde/Hasta filtran por la FECHA DEL PAGO. Lo cobrado de más (a favor) no es pago de factura.
create or replace function :"schema".pagos_cobrados(
  p_q text default null, p_desde date default null, p_hasta date default null,
  p_categoria text default null, p_plan text default null, p_limit integer default 100, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
begin
  return (
  with par as (select tokens_busqueda(p_q) as tk),
  base as (
    select a.id, k.id as cobro_id, k.numero_recibo, k.fecha, k.created_at, k.cliente_id, k.cliente_nombre, k.usuario_nombre,
           x.numero as factura_numero, x.venta_id, a.monto, c.categoria_id, cc.nombre as categoria_nombre,
           coalesce(u.nombre, nullif(btrim(c.vendedor_texto), '')) as vendedor, s.plan_id, s.plan_nombre,
           (k.fecha at time zone 'America/Asuncion')::date as fecha_pago,
           concat_ws(' ', norm(k.cliente_nombre), norm(c.razon_social), lower(x.numero), lower(k.numero_recibo)) as _t
      from cobros_aplicaciones a
      join cobros_clientes k on k.id = a.cobro_id
      join cuentas_por_cobrar x on x.id = a.cxc_id
      join clientes c on c.id = k.cliente_id
      left join cliente_categorias cc on cc.id = c.categoria_id
      left join usuarios u on u.id = c.vendedor_usuario_id
      left join ventas v on v.id = x.venta_id
      left join suscripciones s on s.id = v.suscripcion_id
     where k.empresa_id = empresa_actual() and k.anulado_at is null
  ),
  filtradas as (
    select b.* from base b, par
     where (cardinality(par.tk) = 0 or coincide_busqueda(b._t, par.tk))
       and (p_desde is null or b.fecha_pago >= p_desde)
       and (p_hasta is null or b.fecha_pago <= p_hasta)
       and (p_categoria is null or (p_categoria = '__sin__' and b.categoria_id is null) or b.categoria_id::text = p_categoria)
       and (p_plan is null or (p_plan = '__sin__' and b.plan_id is null and b.plan_nombre is null) or b.plan_id::text = p_plan)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_monto', (select coalesce(sum(monto), 0) from filtradas),
    'total_general', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) - '_t' || jsonb_build_object(
                 'metodos', (select string_agg(distinct m.metodo, ',') from cobros_pagos m where m.cobro_id = f.cobro_id),
                 'referencia', coalesce(
                    (select cp.banco_origen || ' · ' || cp.numero_operacion from cobros_pendientes cp where cp.cobro_id = f.cobro_id limit 1),
                    (select string_agg(m.referencia, ' · ') from cobros_pagos m where m.cobro_id = f.cobro_id and m.referencia is not null)))
               order by f.fecha desc, f.numero_recibo desc)
               from (select * from filtradas order by fecha desc, numero_recibo desc
                      limit least(greatest(coalesce(p_limit, 100), 0), 500) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)
  ));
end;
$$;

grant execute on function
  :"schema".gasto_requiere_timbrado(text), :"schema".gasto_escribir(uuid, jsonb), :"schema".guardar_gasto(jsonb),
  :"schema".confirmar_gasto(jsonb), :"schema".anular_gasto(uuid, text), :"schema".eliminar_gasto(uuid),
  :"schema".listar_gastos(text, text, date, date, integer, integer), :"schema".gasto_detalle(uuid),
  :"schema".listar_cuentas_pagar(text, text, text, uuid, integer, integer), :"schema".estado_cuenta_proveedor(uuid),
  :"schema".pagos_facturas_pendientes(text, date, date, text, text, integer, integer),
  :"schema".pagos_cobrados(text, date, date, text, text, integer, integer)
  to authenticated, service_role;
