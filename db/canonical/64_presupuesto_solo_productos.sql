-- =============================================================================
-- PRESUPUESTOS: SOLO PRODUCTOS DEL INVENTARIO (regla del dueño, 2026-10-22).
--
-- Antes un presupuesto podía llevar "líneas libres" (servicio / flete sin producto).
-- Desde ahora cada línea es un producto del inventario: si falta, se crea en el
-- inventario (alta rápida desde el mismo formulario) y se cotiza.
--
--   · guardar_presupuesto(p jsonb) se redefine (la de 53, única versión): una línea sin
--     producto_id se RECHAZA con un mensaje claro; el producto tiene que existir, ser de la
--     empresa y estar activo (como antes). La rama de línea libre desaparece.
--   · presupuesto_duplicar(uuid) se redefine (la de 53): al duplicar un presupuesto viejo
--     que tenía líneas libres, esas líneas NO se copian (se avisa en el historial con
--     `lineas_omitidas`); si no queda ninguna línea, error claro.
--   · Trigger BEFORE INSERT en presupuestos_items: ninguna línea nueva sin producto (o con
--     un producto de otra empresa), venga de donde venga. Solo INSERT: las líneas
--     históricas sin producto quedan como están (se siguen viendo en la ficha y el PDF) y
--     el ON DELETE SET NULL de productos sigue funcionando. Por eso NO es un CHECK.
--   · presupuesto_vincular_producto (53) queda igual: sirve para ligar una línea histórica
--     sin producto a un producto antes de cobrarla en la caja.
--
-- IDEMPOTENTE. Va después de 53 (si se vuelve a correr 53, correr 64 después).
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- ── guardar_presupuesto: solo productos ─────────────────────────────────────
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
  v_descr text;
  v_prod_id uuid;
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

  -- Solo productos del inventario: se valida TODO antes de tocar nada.
  for it in select * from jsonb_array_elements(p->'items') loop
    v_orden := v_orden + 1;
    if nullif(it->>'producto_id', '') is null then
      raise exception 'Línea % (%): en un presupuesto solo van productos del inventario. Buscalo o crealo en el inventario.',
        v_orden, coalesce(nullif(btrim(it->>'descripcion'), ''), 'sin descripción');
    end if;
  end loop;
  v_orden := 0;

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

    begin
      v_prod_id := (it->>'producto_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Línea %: el producto no es válido', v_orden;
    end;
    select id, nombre, sku, unidad_medida, tipo_iva, precio_venta, activo into prod
      from productos where id = v_prod_id and empresa_id = v_emp;
    if not found then raise exception 'Línea %: el producto no existe en el inventario', v_orden; end if;
    if not prod.activo then raise exception 'Línea %: el producto "%" está inactivo', v_orden, prod.nombre; end if;
    insert into presupuestos_items (empresa_id, presupuesto_id, orden, producto_id, sku, descripcion, detalle, unidad,
                                    cantidad, precio_unitario, precio_lista, descuento_pct, tipo_iva)
      values (v_emp, v_id, v_orden, prod.id, prod.sku, coalesce(v_descr, prod.nombre),
              left(nullif(btrim(it->>'detalle'), ''), 1000), prod.unidad_medida, v_cant, v_precio,
              round(prod.precio_venta / v_cambio, v_dec), v_dl, prod.tipo_iva);
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

-- ── presupuesto_duplicar: no copia líneas sin producto ──────────────────────
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
  v_omitidas integer;
begin
  v_u := presupuesto_actor(array['ADMIN', 'SUPERVISOR', 'VENDEDOR', 'CAJERO']);
  select * into r from presupuestos where id = p_id and empresa_id = v_u.empresa_id;
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  if not exists (select 1 from presupuestos_items where presupuesto_id = r.id and producto_id is not null) then
    raise exception 'El presupuesto % no tiene productos del inventario para copiar: armá uno nuevo con productos.', r.numero;
  end if;
  select count(*) into v_omitidas from presupuestos_items where presupuesto_id = r.id and producto_id is null;
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
    select empresa_id, v_id, row_number() over (order by orden), producto_id, sku, descripcion, detalle, unidad, cantidad,
           precio_unitario, precio_lista, descuento_pct, tipo_iva
      from presupuestos_items where presupuesto_id = r.id and producto_id is not null order by orden;
  perform presupuesto_recalcular(v_id);
  perform presupuesto_evento(v_id, 'creado', null,
    jsonb_strip_nulls(jsonb_build_object('duplicado_de', r.numero, 'lineas_omitidas', nullif(v_omitidas, 0))), v_u);
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'lineas_omitidas', v_omitidas);
end;
$fn$;

revoke all on function :"schema".guardar_presupuesto(jsonb) from public;
revoke all on function :"schema".presupuesto_duplicar(uuid) from public;
grant execute on function :"schema".guardar_presupuesto(jsonb), :"schema".presupuesto_duplicar(uuid)
  to authenticated, service_role;

-- ── Ninguna línea nueva sin producto (de la misma empresa) ───────────────────
create or replace function :"schema".tg_presupuestos_items_solo_productos()
returns trigger
language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if new.producto_id is null then
    raise exception 'En un presupuesto solo van productos del inventario (línea "%")', coalesce(new.descripcion, 'sin descripción')
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from productos where id = new.producto_id and empresa_id = new.empresa_id) then
    raise exception 'El producto de la línea "%" no es de esta empresa', coalesce(new.descripcion, 'sin descripción')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
revoke all on function :"schema".tg_presupuestos_items_solo_productos() from public, anon, authenticated;

drop trigger if exists presupuestos_items_solo_productos on :"schema".presupuestos_items;
create trigger presupuestos_items_solo_productos
  before insert on :"schema".presupuestos_items
  for each row execute function :"schema".tg_presupuestos_items_solo_productos();

comment on column :"schema".presupuestos_items.producto_id is
  'Producto del inventario (obligatorio en líneas nuevas desde la receta 64). Null solo en líneas históricas o si el producto se borró.';

commit;
