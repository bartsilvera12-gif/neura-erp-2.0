-- =============================================================================
-- 172 — Bot vendedor por WhatsApp (Omnicanal › Bot vendedor).
--
-- El cliente escribe al WhatsApp de la tienda, elige una categoría y el bot pasa a ser el vendedor
-- de esa categoría (con las instrucciones que la tienda cargó para ella). Arma el carrito con los
-- productos, precios y stock del ERP y toma el pedido: envío o retiro, y pago al recibir o por
-- transferencia (con foto del comprobante). La conversación la lleva Claude (src/lib/bot-vendedor);
-- acá está lo que tiene que ser verdad: precios, stock y el pedido.
--
--   1. bot_vendedor_config: una fila por empresa (prendido, canal, tienda, instrucciones, entrega,
--      formas de pago y cuentas). Solo la escribe el servidor (pantalla de ADMIN).
--   2. categorias_productos.bot_visible / bot_instrucciones: qué categorías ofrece y cómo vende
--      el "vendedor" de cada una.
--   3. bot_vendedor_sesiones: estado de cada chat (categoría elegida, carrito, pedido). Solo servidor.
--   4. El pedido es un PEDIDO DE MOSTRADOR (receta 77) con origen 'whatsapp' y un estado nuevo,
--      'whatsapp' (= "por preparar"): no vence al cierre del día. Cuando la tienda lo tiene listo lo
--      "envía a caja" (pasa a 'en_caja' con la fecha de ese día) y desde ahí sigue el circuito de
--      siempre: la caja lo cobra en Nueva venta, se hace la venta y se descuenta el stock.
--      No reserva stock (igual que los de mostrador); el bot no vende más de lo que hay.
--   5. pedido_whatsapp_crear (solo service_role): precios de la base, nunca del bot.
--
-- Redefine pedido_mostrador_json (77) para sumar los datos del pedido de WhatsApp.
-- Aditivo e IDEMPOTENTE. Va después de 171.
-- =============================================================================
begin;
set local search_path to :"schema", public;

-- ── 1. Configuración ─────────────────────────────────────────────────────────
create table if not exists :"schema".bot_vendedor_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  activo boolean not null default false,
  -- null = cualquier canal de WhatsApp de la empresa
  canal_id uuid references :"schema".chat_canales(id) on delete set null,
  tienda text,
  instrucciones text,
  envio_activo boolean not null default true,
  envio_texto text,
  retiro_activo boolean not null default true,
  retiro_texto text,
  pago_al_recibir boolean not null default true,
  pago_transferencia boolean not null default true,
  -- [{ banco, titular, cuenta, documento, alias }]
  cuentas jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);

alter table :"schema".categorias_productos add column if not exists bot_visible boolean not null default true;
alter table :"schema".categorias_productos add column if not exists bot_instrucciones text;

-- ── 3. Sesiones del bot ──────────────────────────────────────────────────────
create table if not exists :"schema".bot_vendedor_sesiones (
  conversacion_id uuid primary key references :"schema".chat_conversaciones(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  categoria_id uuid references :"schema".categorias_productos(id) on delete set null,
  -- [{ producto_id, cantidad }]
  carrito jsonb not null default '[]'::jsonb,
  datos jsonb not null default '{}'::jsonb,
  -- 'charla' | 'pago' (espera el comprobante) | 'humano' (lo atiende una persona)
  paso text not null default 'charla',
  pedido_id uuid references :"schema".pedidos_mostrador(id) on delete set null,
  -- Un solo turno del bot a la vez por chat (mensajes que llegan juntos).
  ocupado_hasta timestamptz,
  turnos_dia integer not null default 0,
  turnos_fecha date,
  updated_at timestamptz not null default now()
);
create index if not exists bot_vendedor_sesiones_empresa_idx on :"schema".bot_vendedor_sesiones (empresa_id, updated_at desc);

alter table :"schema".bot_vendedor_config enable row level security;
alter table :"schema".bot_vendedor_config force row level security;
alter table :"schema".bot_vendedor_sesiones enable row level security;
alter table :"schema".bot_vendedor_sesiones force row level security;
revoke all on :"schema".bot_vendedor_config, :"schema".bot_vendedor_sesiones from anon, authenticated;
grant all on :"schema".bot_vendedor_config, :"schema".bot_vendedor_sesiones to service_role;

-- ── 4. Pedido de WhatsApp = pedido de mostrador con origen 'whatsapp' ───────
alter table :"schema".pedidos_mostrador add column if not exists origen text not null default 'mostrador';
alter table :"schema".pedidos_mostrador add column if not exists conversacion_id uuid references :"schema".chat_conversaciones(id) on delete set null;
alter table :"schema".pedidos_mostrador add column if not exists contacto_telefono text;
alter table :"schema".pedidos_mostrador add column if not exists entrega text;
alter table :"schema".pedidos_mostrador add column if not exists direccion text;
alter table :"schema".pedidos_mostrador add column if not exists ubicacion text;
alter table :"schema".pedidos_mostrador add column if not exists forma_pago text;
alter table :"schema".pedidos_mostrador add column if not exists pago_estado text;
alter table :"schema".pedidos_mostrador add column if not exists comprobante_path text;
alter table :"schema".pedidos_mostrador add column if not exists comprobante_mime text;
alter table :"schema".pedidos_mostrador add column if not exists comprobante_lectura jsonb;
alter table :"schema".pedidos_mostrador add column if not exists comprobante_at timestamptz;

do $do$
begin
  alter table pedidos_mostrador drop constraint if exists chk_pedidos_mostrador_estado;
  alter table pedidos_mostrador add constraint chk_pedidos_mostrador_estado check (estado in ('en_caja', 'cobrado', 'anulado', 'whatsapp'));
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  where c.conname = 'chk_pedidos_mostrador_whatsapp' and t.relnamespace = current_schema()::regnamespace) then
    alter table pedidos_mostrador add constraint chk_pedidos_mostrador_whatsapp check (
      origen in ('mostrador', 'whatsapp')
      and (entrega is null or entrega in ('envio', 'retiro'))
      and (forma_pago is null or forma_pago in ('al_recibir', 'transferencia'))
      and (pago_estado is null or pago_estado in ('pendiente', 'comprobante')));
  end if;
end;
$do$;
create index if not exists pedidos_mostrador_whatsapp_idx on :"schema".pedidos_mostrador (empresa_id, creado_at desc) where origen = 'whatsapp';

-- Un pedido como lo ven el vendedor y la caja (77) + los datos del pedido de WhatsApp.
create or replace function :"schema".pedido_mostrador_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'etiqueta', pm_etiqueta(p.numero),
    'estado', pm_estado(p.estado, p.fecha), 'fecha', p.fecha, 'version', p.version::text,
    'sucursal', jsonb_build_object('id', su.id, 'nombre', su.nombre),
    'cliente', case when p.cliente_id is not null or p.cliente_nombre is not null
                    then jsonb_build_object('id', p.cliente_id, 'nombre', coalesce(c.nombre, p.cliente_nombre)) end,
    'nota', p.nota, 'total', p.total,
    'creado_at', p.creado_at, 'creado_por', p.creado_por, 'vendedor', p.creado_por_nombre, 'editado_at', p.editado_at,
    'venta', case when p.venta_id is not null then jsonb_build_object('id', v.id, 'numero', v.numero_control, 'total', v.total, 'estado', v.estado) end,
    'cobrado_at', p.cobrado_at, 'cobrado_por_nombre', p.cobrado_por_nombre, 'total_cobrado', p.total_cobrado,
    'modificado_en_caja', p.modificado_en_caja,
    'anulado_at', p.anulado_at, 'anulado_por_nombre', p.anulado_por_nombre, 'motivo_anulacion', p.motivo_anulacion,
    'origen', p.origen,
    'whatsapp', case when p.origen = 'whatsapp' then jsonb_build_object(
        'conversacion_id', p.conversacion_id, 'telefono', p.contacto_telefono, 'entrega', p.entrega,
        'direccion', p.direccion, 'ubicacion', p.ubicacion, 'forma_pago', p.forma_pago, 'pago_estado', p.pago_estado,
        'comprobante_path', p.comprobante_path, 'comprobante_mime', p.comprobante_mime,
        'comprobante_lectura', p.comprobante_lectura, 'comprobante_at', p.comprobante_at) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'producto_id', i.producto_id, 'nombre', i.producto_nombre, 'sku', i.sku, 'cantidad', i.cantidad,
        'precio_unitario', i.precio_unitario, 'precio_base', i.precio_base, 'precio_mods', i.precio_mods, 'total', i.total,
        'modificadores', i.modificadores, 'modificadores_texto', i.modificadores_texto,
        -- true = el precio base del pedido es el de hoy (lista con el descuento del producto)
        'precio_de_hoy', pr.id is not null and mesa_precio(pr.precio_venta, pr.descuento_pct) = i.precio_base)
        order by i.orden, i.producto_nombre)
      from pedido_mostrador_items i left join productos pr on pr.id = i.producto_id
      where i.pedido_id = p.id), '[]'::jsonb))
    from pedidos_mostrador p
    join sucursales su on su.id = p.sucursal_id
    left join clientes c on c.id = p.cliente_id
    left join ventas v on v.id = p.venta_id
   where p.id = p_id
$$;

-- ── 5. El bot crea el pedido (solo service_role) ─────────────────────────────
-- p = { conversacion_id, telefono, nombre, entrega: envio|retiro, direccion?, ubicacion?,
--       forma_pago: al_recibir|transferencia, nota?, items: [{ producto_id, cantidad }] }
create or replace function :"schema".pedido_whatsapp_crear(p_empresa uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  ped pedidos_mostrador;
  it jsonb;
  prod record;
  v_cant numeric;
  v_base numeric;
  v_total numeric := 0;
  v_orden integer := 0;
  v_numero integer;
  v_suc uuid;
  v_nombre text := nullif(left(btrim(coalesce(p->>'nombre', '')), 120), '');
  v_entrega text := p->>'entrega';
  v_pago text := p->>'forma_pago';
  v_dir text := nullif(left(btrim(coalesce(p->>'direccion', '')), 500), '');
  v_ubi text := nullif(left(btrim(coalesce(p->>'ubicacion', '')), 200), '');
  v_conv uuid := nullif(p->>'conversacion_id', '')::uuid;
begin
  if not funcion_activa(p_empresa, 'pedidos') then
    raise exception 'Pedidos de mostrador está apagada en Configuración › Rubro y funciones';
  end if;
  if v_conv is not null and not exists (select 1 from chat_conversaciones where id = v_conv and empresa_id = p_empresa) then
    raise exception 'Conversación de otra empresa';
  end if;
  if v_entrega is null or v_entrega not in ('envio', 'retiro') then raise exception 'Falta elegir envío o retiro'; end if;
  if v_pago is null or v_pago not in ('al_recibir', 'transferencia') then raise exception 'Falta elegir la forma de pago'; end if;
  if v_entrega = 'envio' and v_dir is null and v_ubi is null then raise exception 'Para el envío falta la dirección'; end if;
  if v_nombre is null then raise exception 'Falta el nombre de quien recibe el pedido'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p->'items') > 50 then raise exception 'Demasiados productos en un pedido'; end if;

  v_suc := sucursal_principal(p_empresa);
  if v_suc is null then raise exception 'La empresa no tiene sucursal principal'; end if;

  -- Numeración correlativa por empresa (la misma que los pedidos de mostrador).
  perform pg_advisory_xact_lock(hashtext('pedidos_mostrador_numero_' || p_empresa::text));
  v_numero := coalesce(numeracion_max(p_empresa, 'pedidos_mostrador.numero'), 0) + 1;
  insert into pedidos_mostrador (empresa_id, sucursal_id, numero, estado, fecha, cliente_nombre, nota, creado_por_nombre,
                                 origen, conversacion_id, contacto_telefono, entrega, direccion, ubicacion, forma_pago, pago_estado)
    values (p_empresa, v_suc, v_numero, 'whatsapp', pm_hoy(), v_nombre,
            nullif(left(btrim(coalesce(p->>'nota', '')), 500), ''), 'Bot de WhatsApp',
            'whatsapp', v_conv, nullif(regexp_replace(coalesce(p->>'telefono', ''), '[^0-9]', '', 'g'), ''),
            v_entrega, v_dir, v_ubi, v_pago, case when v_pago = 'transferencia' then 'pendiente' end)
    returning * into ped;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_cant := nullif(it->>'cantidad', '')::numeric;
    if v_cant is null or v_cant <= 0 or v_cant > 9999 then raise exception 'Cantidad inválida en un producto'; end if;
    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Un producto del carrito ya no existe'; end if;
    if not prod.activo or not prod.es_vendible or prod.tipo_producto = 'materia_prima' then
      raise exception '"%" ya no está a la venta', prod.nombre;
    end if;
    if prod.controla_stock and prod.tipo_producto <> 'menu' and v_cant > greatest(prod.stock_actual, 0) then
      raise exception 'De "%" quedan % y pediste %', prod.nombre, greatest(prod.stock_actual, 0)::numeric(14, 0), v_cant;
    end if;
    v_base := mesa_precio(prod.precio_venta, prod.descuento_pct);
    v_orden := v_orden + 1;
    insert into pedido_mostrador_items (pedido_id, empresa_id, producto_id, producto_nombre, sku, cantidad,
                                        precio_base, precio_mods, precio_unitario, total, orden)
      values (ped.id, p_empresa, prod.id, prod.nombre, prod.sku, v_cant, v_base, 0, v_base, round(v_cant * v_base), v_orden);
    v_total := v_total + round(v_cant * v_base);
  end loop;

  update pedidos_mostrador set total = v_total where id = ped.id;
  return pedido_mostrador_json(ped.id);
end;
$fn$;

-- El comprobante de transferencia que mandó el cliente (solo service_role).
create or replace function :"schema".pedido_whatsapp_comprobante(p_empresa uuid, p_id uuid, p_path text, p_mime text, p_lectura jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  update pedidos_mostrador
     set comprobante_path = p_path, comprobante_mime = p_mime, comprobante_lectura = p_lectura, comprobante_at = now(),
         pago_estado = 'comprobante', version = version + 1, updated_at = now()
   where id = p_id and empresa_id = p_empresa and origen = 'whatsapp' and estado <> 'anulado';
  if not found then raise exception 'Pedido no encontrado'; end if;
  return pedido_mostrador_json(p_id);
end;
$fn$;

-- ── 6. Pantalla Caja › Pedidos de WhatsApp ───────────────────────────────────
-- Los que esperan ("whatsapp") y los de WhatsApp de los últimos 7 días (para seguirlos).
create or replace function :"schema".pedidos_whatsapp_listar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from pm_sesion();
  perform exigir_permiso('pedidos_mostrador');
  if not s.s_ve_todos then raise exception 'Los pedidos de WhatsApp los maneja la caja o un supervisor' using errcode = '42501'; end if;
  return jsonb_build_object(
    'ahora', now(),
    'pedidos', coalesce((select jsonb_agg(pedido_mostrador_json(p.id) order by (p.estado = 'whatsapp') desc, p.creado_at desc)
      from pedidos_mostrador p
     where p.empresa_id = s.s_empresa and p.origen = 'whatsapp'
       and (p.estado = 'whatsapp' or p.creado_at > now() - interval '7 days')
       and (s.s_todas or p.sucursal_id = s.s_sucursal)), '[]'::jsonb));
end;
$fn$;

-- "Enviar a caja": el pedido pasa a 'en_caja' HOY (vence al cierre, como todos) en la sucursal de quien lo envía.
create or replace function :"schema".pedido_whatsapp_a_caja(p_id uuid)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  ped pedidos_mostrador;
begin
  select * into s from pm_sesion();
  perform exigir_permiso('pedidos_mostrador');
  if not s.s_ve_todos then raise exception 'Los pedidos de WhatsApp los maneja la caja o un supervisor' using errcode = '42501'; end if;
  select * into ped from pedidos_mostrador where id = p_id and empresa_id = s.s_empresa and origen = 'whatsapp' for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if ped.estado <> 'whatsapp' then
    raise exception 'El pedido % ya no está esperando (está %)', pm_etiqueta(ped.numero), pm_estado(ped.estado, ped.fecha);
  end if;
  update pedidos_mostrador
     set estado = 'en_caja', fecha = pm_hoy(), sucursal_id = s.s_sucursal, version = version + 1, updated_at = now()
   where id = ped.id;
  return pedido_mostrador_json(ped.id);
end;
$fn$;

revoke all on function :"schema".pedido_whatsapp_crear(uuid, jsonb) from public, anon, authenticated;
revoke all on function :"schema".pedido_whatsapp_comprobante(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function :"schema".pedidos_whatsapp_listar() from public, anon;
revoke all on function :"schema".pedido_whatsapp_a_caja(uuid) from public, anon;
revoke all on function :"schema".pedido_mostrador_json(uuid) from public, anon, authenticated;
grant execute on function :"schema".pedido_whatsapp_crear(uuid, jsonb) to service_role;
grant execute on function :"schema".pedido_whatsapp_comprobante(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function :"schema".pedidos_whatsapp_listar() to authenticated, service_role;
grant execute on function :"schema".pedido_whatsapp_a_caja(uuid) to authenticated, service_role;
grant execute on function :"schema".pedido_mostrador_json(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
