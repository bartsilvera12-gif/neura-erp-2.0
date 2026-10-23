-- =============================================================================
-- MESAS: "ENVIAR A CAJA" (pedido del dueño, 23-oct-2026).
--
-- Antes la cuenta de la mesa se cobraba en Caja › Pedidos de mesas. Ahora hay un solo camino:
--   1. En "Cuentas abiertas" se toca "Enviar a caja" (la mesa pidió la cuenta): la cuenta queda
--      EN CAJA · POR COBRAR (marca de cuándo y quién la envió). "Volver a abrir" la saca de la caja.
--   2. En Caja › Nueva venta aparece "Mesas por cobrar (N)" (las de la sucursal de la caja). El
--      cajero la carga en el carrito, puede sumar otros productos y cobra como cualquier venta
--      (forma de pago, ticket/factura, cliente o cliente ocasional).
--   3. Al confirmar, mesa_cuenta_cobrar_caja crea la venta (crear_venta) y cierra la cuenta con su
--      venta_id EN LA MISMA TRANSACCIÓN: o queda todo o no queda nada.
--
-- Estado "en caja": la cuenta sigue con estado = 'abierta' (así un pedido nuevo que se acepta se
-- suma a la misma cuenta, y siguen valiendo el índice "una abierta por mesa", la cocina y el menú
-- público) y se marca con en_caja_at / en_caja_por / en_caja_por_nombre. Los JSON la muestran
-- como estado "en_caja".
--
-- Seguridad
--   · Doble cobro: mesa_cuenta_cobrar_caja bloquea la fila de la cuenta (FOR UPDATE); el segundo
--     cajero espera y ve "ya se cobró". Reintento del mismo POS (idempotency_key) → misma venta.
--   · "La cuenta cambió": el cajero cobra la VERSIÓN que cargó (hash de los pedidos aceptados); si
--     entró o se rechazó un pedido desde entonces, la base no cobra y pide recargar.
--   · No se pueden quitar ítems de la cuenta: el carrito tiene que traer, por producto, al menos lo
--     que pidió la mesa (agregar otros productos sí).
--   · Sucursal: solo se cobra en una caja abierta de la sucursal de la mesa.
--
-- Se borra mesa_cuenta_cobrar (el cobro directo de 68). IDEMPOTENTE. Va después de 68.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Marca "en caja"
-- =============================================================================
alter table :"schema".mesa_cuentas add column if not exists en_caja_at timestamptz;
alter table :"schema".mesa_cuentas add column if not exists en_caja_por uuid references :"schema".usuarios(id) on delete set null;
alter table :"schema".mesa_cuentas add column if not exists en_caja_por_nombre text;
create index if not exists mesa_cuentas_en_caja_idx on :"schema".mesa_cuentas (empresa_id, en_caja_at)
  where estado = 'abierta' and en_caja_at is not null;

-- Versión de una cuenta: cambia si se acepta, rechaza o entra un pedido aceptado nuevo.
create or replace function :"schema".mesa_cuenta_version(p_cuenta uuid)
returns text language sql stable security definer set search_path = :"schema", public as $$
  select md5(coalesce(string_agg(p.id::text || ':' || p.total::text, ',' order by p.id), ''))
    from mesa_pedidos p where p.cuenta_id = p_cuenta and p.estado not in ('nuevo', 'rechazado')
$$;

-- =============================================================================
-- 2. Tablero (68 + estado en caja)
-- =============================================================================
create or replace function :"schema".mesas_tablero()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from mesa_sesion();
  if not (tiene_permiso('pedidos_mesas') or tiene_permiso('cocina')) then
    raise exception 'Tu perfil no tiene permiso para: atender pedidos de mesas' using errcode = '42501', hint = 'permiso:pedidos_mesas';
  end if;
  return jsonb_build_object(
    'ahora', now(),
    'pedidos', coalesce((select jsonb_agg(mesa_pedido_json(p.id) order by p.creado_at, p.numero)
      from mesa_pedidos p join mesas m on m.id = p.mesa_id
      where p.empresa_id = s.s_empresa
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)
        and (p.estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')
             or coalesce(p.entregado_at, p.rechazado_at, p.updated_at) > now() - interval '1 hour')), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'abierta_at', c.abierta_at,
        'estado', case when c.en_caja_at is not null then 'en_caja' else 'abierta' end,
        'en_caja_at', c.en_caja_at, 'en_caja_por_nombre', c.en_caja_por_nombre,
        'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
        'sucursal', jsonb_build_object('id', su.id, 'nombre', su.nombre),
        'total', coalesce((select sum(p.total) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), 0),
        'pedidos', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')),
        'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
        'items', coalesce((select jsonb_agg(x order by x->>'nombre') from (
            select jsonb_build_object('nombre', i.producto_nombre, 'cantidad', sum(i.cantidad), 'precio_unitario', i.precio_unitario,
                                      'total', sum(i.total)) as x
              from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
             where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
             group by i.producto_nombre, i.precio_unitario) t), '[]'::jsonb))
        order by m.orden, m.nombre)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id join sucursales su on su.id = m.sucursal_id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta'
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)), '[]'::jsonb),
    'puede_atender', tiene_permiso('pedidos_mesas'),
    'puede_cocina', tiene_permiso('cocina'));
end;
$fn$;

-- =============================================================================
-- 3. Enviar a caja / volver a abrir (Pedidos de mesas, "Atender pedidos de mesas")
-- =============================================================================
create or replace function :"schema".mesa_cuenta_enviar_caja(p_cuenta_id uuid, p_enviar boolean default true)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  m mesas;
begin
  select * into s from mesa_sesion();
  perform exigir_permiso('pedidos_mesas');
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;
  if s.s_sucursal is not null and m.sucursal_id <> s.s_sucursal then raise exception 'Esa mesa es de otra sucursal'; end if;
  if c.estado <> 'abierta' then raise exception 'Esa cuenta ya se cerró'; end if;

  if coalesce(p_enviar, true) then
    if c.en_caja_at is not null then
      return jsonb_build_object('id', c.id, 'estado', 'en_caja', 'en_caja_at', c.en_caja_at);
    end if;
    if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado = 'nuevo') then
      raise exception 'La mesa "%" tiene pedidos sin atender: aceptalos o rechazalos antes de enviar la cuenta a caja', m.nombre;
    end if;
    if not exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado not in ('nuevo', 'rechazado')) then
      raise exception 'La cuenta no tiene pedidos aceptados: usá "Liberar mesa"';
    end if;
    update mesa_cuentas set en_caja_at = now(), en_caja_por = s.s_usuario, en_caja_por_nombre = s.s_nombre
     where id = c.id returning * into c;
    return jsonb_build_object('id', c.id, 'estado', 'en_caja', 'en_caja_at', c.en_caja_at);
  end if;

  update mesa_cuentas set en_caja_at = null, en_caja_por = null, en_caja_por_nombre = null where id = c.id;
  return jsonb_build_object('id', c.id, 'estado', 'abierta', 'en_caja_at', null);
end;
$fn$;

-- =============================================================================
-- 4. Caja › Nueva venta: mesas por cobrar de la sucursal de la caja
-- =============================================================================
create or replace function :"schema".mesas_por_cobrar(p_caja_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_caja uuid;
  v_suc uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  begin
    v_caja := caja_abierta_para(null, null, p_caja_id);
  exception when others then
    v_caja := null;
  end;
  if v_caja is null then return jsonb_build_object('ahora', now(), 'cuentas', '[]'::jsonb); end if;
  select sucursal_id into v_suc from cajas where id = v_caja;
  return jsonb_build_object(
    'ahora', now(),
    'caja_id', v_caja,
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'abierta_at', c.abierta_at, 'en_caja_at', c.en_caja_at, 'en_caja_por_nombre', c.en_caja_por_nombre,
        'version', mesa_cuenta_version(c.id),
        'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
        'total', coalesce((select sum(p.total) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), 0),
        'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
        'items', coalesce((select jsonb_agg(x order by x->>'nombre') from (
            select jsonb_build_object('producto_id', i.producto_id, 'nombre', i.producto_nombre, 'cantidad', sum(i.cantidad),
                                      'precio_unitario', i.precio_unitario, 'total', sum(i.total),
                                      -- true = el precio del pedido es el de hoy (lista con el descuento del producto)
                                      'precio_de_hoy', bool_and(pr.id is not null and mesa_precio(pr.precio_venta, pr.descuento_pct) = i.precio_unitario)) as x
              from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
              left join productos pr on pr.id = i.producto_id
             where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
             group by i.producto_id, i.producto_nombre, i.precio_unitario) t), '[]'::jsonb))
        order by c.en_caja_at)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta' and c.en_caja_at is not null
        and m.sucursal_id = v_suc), '[]'::jsonb));
end;
$fn$;

-- =============================================================================
-- 5. Cobrar en caja: venta + cierre de la cuenta en una transacción
-- =============================================================================
create or replace function :"schema".mesa_cuenta_cobrar_caja(
  p_cuenta_id uuid, p_version text,
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket', p_cliente_ocasional boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  m mesas;
  v_caja uuid;
  v_suc_caja uuid;
  v_previa uuid;
  v_venta jsonb;
  g record;
  v_en_carrito numeric;
  v_quien text;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  -- La fila de la cuenta serializa a los cajeros: el segundo espera y ve que ya se cobró.
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta de mesa no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;

  -- Reintento del mismo POS: la venta ya está hecha y la cuenta cerrada con ella.
  if nullif(p_idempotency_key, '') is not null then
    select id into v_previa from ventas where empresa_id = s.s_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_previa is not null and c.venta_id = v_previa then
      return jsonb_build_object('venta_id', v_previa, 'numero_control', (select numero_control from ventas where id = v_previa),
                                'reusada', true, 'mesa', m.nombre);
    end if;
  end if;

  if c.estado = 'cerrada' then
    select coalesce(u.nombre, 'otro usuario') into v_quien from usuarios u where u.id = c.cerrada_por;
    raise exception 'La cuenta de "%" ya se cobró (%): soltala del carrito', m.nombre, coalesce(v_quien, 'otro usuario');
  end if;
  if c.estado <> 'abierta' then raise exception 'La cuenta de "%" ya no está abierta: soltala del carrito', m.nombre; end if;
  if c.en_caja_at is null then raise exception 'La cuenta de "%" ya no está en caja (la volvieron a abrir): soltala del carrito', m.nombre; end if;
  if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado = 'nuevo') then
    raise exception 'La mesa "%" tiene un pedido nuevo sin atender: aceptalo o rechazalo en Pedidos de mesas antes de cobrar', m.nombre;
  end if;
  if p_version is null or p_version <> mesa_cuenta_version(c.id) then
    raise exception 'La cuenta de "%" cambió desde que la cargaste: recargala antes de cobrar', m.nombre;
  end if;

  -- Caja: abierta y de la sucursal de la mesa.
  v_caja := caja_abierta_para(null, null, p_caja_id);
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> m.sucursal_id then raise exception 'La mesa "%" es de otra sucursal: cobrala en una caja de su sucursal', m.nombre; end if;

  -- El carrito trae, por producto, al menos lo que pidió la mesa (no se quitan ítems de la cuenta).
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'La venta debe tener al menos un ítem'; end if;
  for g in
    select i.producto_id, max(i.producto_nombre) as nombre, sum(i.cantidad) as cantidad
      from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
     where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
     group by i.producto_id
  loop
    if g.producto_id is null then
      raise exception 'El producto "%" de la cuenta ya no existe en el catálogo: no se puede cobrar en caja', g.nombre;
    end if;
    select coalesce(sum((x->>'cantidad')::numeric), 0) into v_en_carrito
      from jsonb_array_elements(p_items) x where x->>'producto_id' = g.producto_id::text;
    if v_en_carrito < g.cantidad then
      raise exception 'No se pueden quitar productos de la cuenta de la mesa: "%" pidió %, en el carrito hay %',
        g.nombre, trim_scale(g.cantidad), trim_scale(v_en_carrito);
    end if;
  end loop;

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Cuenta de mesa: ' || m.nombre || coalesce(' · ' || m.zona, ''), 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);

  update mesa_cuentas set estado = 'cerrada', cerrada_at = now(), cerrada_por = s.s_usuario,
         venta_id = (v_venta->>'venta_id')::uuid, total = coalesce((v_venta->>'total')::numeric, 0)
   where id = c.id;
  -- Lo que quedó sin entregar se da por entregado al cobrar.
  update mesa_pedidos set estado = 'entregado', entregado_at = now(), listo_at = coalesce(listo_at, now()), updated_at = now()
   where cuenta_id = c.id and estado in ('aceptado', 'en_preparacion', 'listo');
  return v_venta || jsonb_build_object('mesa', m.nombre);
end;
$fn$;

-- El cobro directo desde Pedidos de mesas (68) ya no existe: un solo camino, por la caja.
drop function if exists :"schema".mesa_cuenta_cobrar(uuid, uuid, boolean, text, jsonb, uuid);

-- =============================================================================
-- 6. Público: el celular ve que se pidió la cuenta
-- =============================================================================
create or replace function :"schema".mesa_pedidos_publico_estado(p_token text, p_seguimientos text[])
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_mesa uuid;
  v_segs text[];
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return '[]'::jsonb; end if;
  select id into v_mesa from mesas where token = p_token;
  if v_mesa is null then return '[]'::jsonb; end if;
  select coalesce(array_agg(x), '{}') into v_segs
    from (select distinct x from unnest(coalesce(p_seguimientos, '{}')) x where x ~ '^[0-9a-f]{32}$' limit 20) t;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'seguimiento', p.seguimiento, 'numero', p.numero, 'estado', p.estado, 'motivo_rechazo', p.motivo_rechazo,
      'total', p.total, 'creado_at', p.creado_at, 'cuenta_cerrada', c.estado <> 'abierta',
      'cuenta_en_caja', c.estado = 'abierta' and c.en_caja_at is not null,
      'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', i.producto_nombre, 'cantidad', i.cantidad, 'total', i.total)
                          order by i.producto_nombre) from mesa_pedido_items i where i.pedido_id = p.id), '[]'::jsonb))
      order by p.creado_at desc)
    from mesa_pedidos p join mesa_cuentas c on c.id = p.cuenta_id
    where p.mesa_id = v_mesa and p.seguimiento = any (v_segs) and p.creado_at > now() - interval '12 hours'), '[]'::jsonb);
end;
$fn$;

-- =============================================================================
-- 7. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".mesa_cuenta_version(uuid) from public;
revoke all on function :"schema".mesa_cuenta_enviar_caja(uuid, boolean) from public;
revoke all on function :"schema".mesas_por_cobrar(uuid) from public;
revoke all on function :"schema".mesa_cuenta_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean) from public;
grant execute on function
  :"schema".mesa_cuenta_enviar_caja(uuid, boolean),
  :"schema".mesas_por_cobrar(uuid),
  :"schema".mesa_cuenta_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function :"schema".mesa_pedidos_publico_estado(text, text[]) to anon, authenticated, service_role;

commit;
