-- =============================================================================
-- MESAS: LA CUENTA DESDE EL QR (pedido del dueño, 28-oct-2026).
--
-- En el celular (/m/<token>) el cliente ahora también puede:
--   1. "Pedir la cuenta" (y cancelar la solicitud mientras la caja no la tomó). La caja la ve en
--      Pedidos de mesas ("Pidió la cuenta · hace 3 min") y la atiende con "Enviar a caja".
--   2. "Ver consumo": lo aceptado de la cuenta abierta, ítem por ítem, con su estado.
--   3. "Separar cuenta": por productos (cada uno con su nombre; un ítem de varias unidades se
--      reparte por unidades y uno compartido se divide entre varios) o en partes iguales.
--      Lo que no se asignó (o lo que se pidió después) queda como RESTO, que se cobra aparte.
--   4. "Datos de facturación": RUC (con dígito verificador) + razón social (+ email opcional),
--      para la cuenta entera o para cada persona. Son una PROPUESTA: la caja los ve al cobrar
--      (si el RUC ya es de un cliente, lo usa; si no, confirma crearlo). Sin RUC → ticket.
--      "Buscar" trae SOLO la razón social de un cliente de la empresa por RUC / CI.
--
-- Tablas
--   · mesa_cuentas + cuenta_solicitada_at, fact_ruc / fact_razon_social / fact_email / fact_at.
--   · mesa_cuenta_divisiones  una por cuenta (modo productos | iguales, personas).
--   · mesa_cuenta_partes      persona / parte: número, nombre, datos de facturación propuestos y,
--                             cuando se cobra, venta_id (cada parte es su propia venta).
--                             es_resto = la parte que se crea al cobrar el resto.
--   · mesa_cuenta_parte_items qué paga cada parte: ítem de la cuenta + cantidad (hasta 3
--                             decimales: media pizza = 0,5; un tercio = 0,333 / 0,334).
--   · mesa_qr_eventos         contador por mesa para los límites del celular (búsquedas, cambios).
--
-- Cobro en caja (Nueva venta › Mesas por cobrar): con la cuenta separada, cada parte (o el
-- resto) se carga sola en el carrito y se cobra con mesa_cuenta_parte_cobrar_caja: venta propia
-- (ticket o factura, su forma de pago) en la misma transacción que marca la parte cobrada. La
-- cuenta se cierra cuando no queda nada por cobrar. La cuenta entera (mesa_cuenta_cobrar_caja)
-- se puede seguir cobrando de una vez mientras no se haya cobrado ninguna parte.
-- La versión de la cuenta (mesa_cuenta_version) ahora incluye la división: si el celular cambia
-- la división mientras la caja la tiene cargada, la base pide recargarla.
--
-- Seguridad (público): todo por el token de la mesa, solo la cuenta ABIERTA de esa mesa; los
-- celulares no ven ids de partes ni datos de clientes (Buscar devuelve solo la razón social, con
-- tope de búsquedas por mesa y exige una cuenta abierta); emails enmascarados; límites de cambios.
--
-- IDEMPOTENTE. Va después de 87 (redefine mesas_tablero y mesas_por_cobrar de 73,
-- mesa_cuenta_cobrar_caja de 74 y mesa_cuenta_enviar_caja de 69).
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
alter table :"schema".mesa_cuentas add column if not exists cuenta_solicitada_at timestamptz;
alter table :"schema".mesa_cuentas add column if not exists fact_ruc text;
alter table :"schema".mesa_cuentas add column if not exists fact_razon_social text;
alter table :"schema".mesa_cuentas add column if not exists fact_email text;
alter table :"schema".mesa_cuentas add column if not exists fact_at timestamptz;

create table if not exists :"schema".mesa_cuenta_divisiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cuenta_id uuid not null references :"schema".mesa_cuentas(id) on delete cascade,
  modo text not null,
  personas integer not null,
  creada_at timestamptz not null default now(),
  actualizada_at timestamptz not null default now(),
  constraint chk_mesa_div_modo check (modo in ('productos', 'iguales')),
  constraint chk_mesa_div_personas check (personas between 1 and 20)
);
create unique index if not exists uq_mesa_div_cuenta on :"schema".mesa_cuenta_divisiones (cuenta_id);

create table if not exists :"schema".mesa_cuenta_partes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  division_id uuid not null references :"schema".mesa_cuenta_divisiones(id) on delete cascade,
  cuenta_id uuid not null references :"schema".mesa_cuentas(id) on delete cascade,
  numero integer not null,
  nombre text not null,
  es_resto boolean not null default false,
  fact_ruc text,
  fact_razon_social text,
  fact_email text,
  venta_id uuid references :"schema".ventas(id) on delete set null,
  cobrada_at timestamptz,
  cobrada_por uuid references :"schema".usuarios(id) on delete set null,
  total_cobrado numeric,
  constraint chk_mesa_parte_nombre check (length(btrim(nombre)) between 1 and 40),
  constraint chk_mesa_parte_numero check (numero between 1 and 40)
);
create unique index if not exists uq_mesa_parte_num on :"schema".mesa_cuenta_partes (division_id, numero);
create index if not exists mesa_partes_cuenta_idx on :"schema".mesa_cuenta_partes (cuenta_id);

create table if not exists :"schema".mesa_cuenta_parte_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  parte_id uuid not null references :"schema".mesa_cuenta_partes(id) on delete cascade,
  item_id uuid not null references :"schema".mesa_pedido_items(id) on delete cascade,
  cantidad numeric(12, 3) not null,
  constraint chk_mesa_parte_item_cant check (cantidad > 0 and cantidad <= 50)
);
create unique index if not exists uq_mesa_parte_item on :"schema".mesa_cuenta_parte_items (parte_id, item_id);
create index if not exists mesa_parte_items_item_idx on :"schema".mesa_cuenta_parte_items (item_id);

create table if not exists :"schema".mesa_qr_eventos (
  id bigserial primary key,
  mesa_id uuid not null references :"schema".mesas(id) on delete cascade,
  tipo text not null,
  at timestamptz not null default now()
);
create index if not exists mesa_qr_eventos_idx on :"schema".mesa_qr_eventos (mesa_id, tipo, at);

alter table :"schema".mesa_cuenta_divisiones enable row level security;
alter table :"schema".mesa_cuenta_divisiones force row level security;
alter table :"schema".mesa_cuenta_partes enable row level security;
alter table :"schema".mesa_cuenta_partes force row level security;
alter table :"schema".mesa_cuenta_parte_items enable row level security;
alter table :"schema".mesa_cuenta_parte_items force row level security;
alter table :"schema".mesa_qr_eventos enable row level security;
alter table :"schema".mesa_qr_eventos force row level security;

drop policy if exists mesa_div_propias on :"schema".mesa_cuenta_divisiones;
create policy mesa_div_propias on :"schema".mesa_cuenta_divisiones for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists mesa_partes_propias on :"schema".mesa_cuenta_partes;
create policy mesa_partes_propias on :"schema".mesa_cuenta_partes for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
drop policy if exists mesa_parte_items_propios on :"schema".mesa_cuenta_parte_items;
create policy mesa_parte_items_propios on :"schema".mesa_cuenta_parte_items for select to authenticated
  using (empresa_id = :"schema".empresa_actual());

revoke all on :"schema".mesa_cuenta_divisiones, :"schema".mesa_cuenta_partes, :"schema".mesa_cuenta_parte_items, :"schema".mesa_qr_eventos from anon, authenticated;
grant select on :"schema".mesa_cuenta_divisiones, :"schema".mesa_cuenta_partes, :"schema".mesa_cuenta_parte_items to authenticated;
grant all on :"schema".mesa_cuenta_divisiones, :"schema".mesa_cuenta_partes, :"schema".mesa_cuenta_parte_items, :"schema".mesa_qr_eventos to service_role;
grant usage, select on sequence :"schema".mesa_qr_eventos_id_seq to service_role;

-- =============================================================================
-- 2. Helpers (internos)
-- =============================================================================

-- Qué se cobra: (ítem, cantidad) de la cuenta entera (p_parte null, p_resto false), de una
-- parte, o del resto (lo aceptado que ninguna parte tiene asignado). Solo pedidos aceptados.
create or replace function :"schema".mesa_seleccion(p_cuenta uuid, p_parte uuid, p_resto boolean)
returns table (item_id uuid, cantidad numeric)
language sql stable security definer set search_path = :"schema", public as $$
  with it as (
    select i.id, i.cantidad from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
     where p.cuenta_id = p_cuenta and p.estado not in ('nuevo', 'rechazado')
  ), asig as (
    select pi.item_id, sum(pi.cantidad) as cant
      from mesa_cuenta_parte_items pi join mesa_cuenta_partes pa on pa.id = pi.parte_id
     where pa.cuenta_id = p_cuenta group by pi.item_id
  ), propia as (
    select pi.item_id, sum(pi.cantidad) as cant from mesa_cuenta_parte_items pi where pi.parte_id = p_parte group by pi.item_id
  )
  select it.id,
         case when p_resto then it.cantidad - coalesce(a.cant, 0) when p_parte is null then it.cantidad else least(pp.cant, it.cantidad) end
    from it left join asig a on a.item_id = it.id left join propia pp on pp.item_id = it.id
   where case when p_resto then it.cantidad - coalesce(a.cant, 0) > 0
              when p_parte is null then true
              else pp.cant is not null end
$$;

-- Líneas para el carrito de la caja (mismo formato que mesas_por_cobrar de 73).
create or replace function :"schema".mesa_lineas_caja(p_cuenta uuid, p_parte uuid, p_resto boolean)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(x order by x->>'nombre', x->>'modificadores_texto' nulls first), '[]'::jsonb) from (
    select jsonb_build_object('producto_id', i.producto_id, 'nombre', i.producto_nombre, 'cantidad', sum(s.cantidad),
                              'precio_unitario', i.precio_unitario, 'total', sum(round(s.cantidad * i.precio_unitario)),
                              'modificadores', i.modificadores, 'modificadores_texto', i.modificadores_texto,
                              'precio_mods', coalesce(i.precio_mods, 0), 'precio_base', i.precio_unitario - coalesce(i.precio_mods, 0),
                              'precio_de_hoy', bool_and(pr.id is not null and mesa_precio(pr.precio_venta, pr.descuento_pct) = i.precio_unitario - coalesce(i.precio_mods, 0))) as x
      from mesa_seleccion(p_cuenta, p_parte, p_resto) s
      join mesa_pedido_items i on i.id = s.item_id
      left join productos pr on pr.id = i.producto_id
     group by i.producto_id, i.producto_nombre, i.precio_unitario, i.modificadores, i.modificadores_texto, i.precio_mods) t
$$;

create or replace function :"schema".mesa_seleccion_total(p_cuenta uuid, p_parte uuid, p_resto boolean)
returns numeric language sql stable security definer set search_path = :"schema", public as $$
  select coalesce(sum(round(s.cantidad * i.precio_unitario)), 0)
    from mesa_seleccion(p_cuenta, p_parte, p_resto) s join mesa_pedido_items i on i.id = s.item_id
$$;

-- "ju***@gmail.com"
create or replace function :"schema".mesa_email_oculto(p text)
returns text language sql immutable as $$
  select case when p is null or position('@' in p) = 0 then p
              else left(split_part(p, '@', 1), 2) || '***@' || split_part(p, '@', 2) end
$$;

-- Datos de facturación propuestos. Para la caja, además, el cliente que ya tiene ese RUC.
create or replace function :"schema".mesa_fact_json(p_emp uuid, p_ruc text, p_razon text, p_email text, p_publico boolean)
returns jsonb language sql stable security definer set search_path = :"schema", public as $$
  select case when p_ruc is null then null else jsonb_build_object(
    'ruc', p_ruc, 'razon_social', p_razon,
    'email', case when p_publico then mesa_email_oculto(p_email) else p_email end,
    'cliente', case when p_publico then null else (
      select jsonb_build_object('id', c.id, 'nombre', coalesce(nullif(btrim(c.razon_social), ''), c.nombre))
        from clientes c
       where c.empresa_id = p_emp and c.deleted_at is null and coalesce(c.activo, true)
         and (ruc_normalizado(c.ruc) = p_ruc or ruc_normalizado(c.documento) = p_ruc)
       order by (ruc_normalizado(c.ruc) = p_ruc) desc nulls last, c.updated_at desc nulls last
       limit 1) end) end
$$;

-- División de una cuenta (null = sin separar). p_publico: sin ids de partes ni de clientes.
create or replace function :"schema".mesa_division_json(p_cuenta uuid, p_publico boolean default false)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  d mesa_cuenta_divisiones;
  v_resto jsonb;
  v_resto_total numeric;
begin
  select * into d from mesa_cuenta_divisiones where cuenta_id = p_cuenta;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'cantidad', s.cantidad)), '[]'::jsonb)
    into v_resto from mesa_seleccion(p_cuenta, null, true) s;
  v_resto_total := mesa_seleccion_total(p_cuenta, null, true);
  return jsonb_build_object(
    'modo', d.modo, 'personas', d.personas, 'actualizada_at', d.actualizada_at,
    'partes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', case when p_publico then null else pa.id end,
        'numero', pa.numero, 'nombre', pa.nombre, 'es_resto', pa.es_resto,
        'total', case when pa.venta_id is not null then pa.total_cobrado else mesa_seleccion_total(p_cuenta, pa.id, false) end,
        'cobrada', pa.venta_id is not null, 'cobrada_at', pa.cobrada_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'cantidad', s.cantidad))
                             from mesa_seleccion(p_cuenta, pa.id, false) s), '[]'::jsonb),
        'facturacion', mesa_fact_json(pa.empresa_id, pa.fact_ruc, pa.fact_razon_social, pa.fact_email, p_publico))
        order by pa.numero)
      from mesa_cuenta_partes pa where pa.division_id = d.id), '[]'::jsonb),
    'resto', case when jsonb_array_length(v_resto) > 0 then jsonb_build_object('total', v_resto_total, 'items', v_resto) end);
end;
$fn$;

-- Versión de una cuenta (69 + la división): la caja cobra la versión que cargó.
create or replace function :"schema".mesa_cuenta_version(p_cuenta uuid)
returns text language sql stable security definer set search_path = :"schema", public as $$
  select md5(
    coalesce((select string_agg(p.id::text || ':' || p.total::text, ',' order by p.id)
                from mesa_pedidos p where p.cuenta_id = p_cuenta and p.estado not in ('nuevo', 'rechazado')), '')
    || '|' || coalesce((select d.actualizada_at::text from mesa_cuenta_divisiones d where d.cuenta_id = p_cuenta), '')
    || '|' || (select count(*)::text from mesa_cuenta_partes pa where pa.cuenta_id = p_cuenta and pa.venta_id is not null))
$$;

-- Límite por mesa para lo que hace el celular (se cuenta solo lo que pasa).
create or replace function :"schema".mesa_qr_limite(p_mesa uuid, p_tipo text, p_max integer, p_ventana interval)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  delete from mesa_qr_eventos where mesa_id = p_mesa and at < now() - interval '1 day';
  if (select count(*) from mesa_qr_eventos where mesa_id = p_mesa and tipo = p_tipo and at > now() - p_ventana) >= p_max then
    if p_tipo = 'buscar' then
      raise exception 'Hiciste muchas búsquedas seguidas: esperá unos minutos o escribí la razón social';
    end if;
    raise exception 'Hiciste muchos cambios seguidos: esperá un minuto y probá de nuevo';
  end if;
  insert into mesa_qr_eventos (mesa_id, tipo) values (p_mesa, p_tipo);
end;
$fn$;

-- Mesa del token (bloqueada): válida, activa y con Mesas y QR prendida.
create or replace function :"schema".mesa_publico_mesa(p_token text)
returns :"schema".mesas language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Mesa no encontrada'; end if;
  select * into m from mesas where token = p_token for update;
  if not found then raise exception 'Mesa no encontrada'; end if;
  if not m.activa or mesa_qr_activo(p_token) is false then
    raise exception 'Esta mesa no está tomando pedidos por QR. Pedile a quien te atiende.';
  end if;
  return m;
end;
$fn$;

-- RUC para la factura propuesta desde el celular: mismo criterio y mensajes que el resto.
create or replace function :"schema".mesa_ruc_publico(p text)
returns text language plpgsql stable set search_path = :"schema", public as $fn$
declare
  v text := ruc_normalizado(p);
  v_base text;
  v_dv integer;
begin
  if v is null then return null; end if;
  if v ~ '^\d{3,8}$' then
    raise exception 'Falta el dígito verificador: sería %-%', v, ruc_dv(v);
  end if;
  if v !~ '^\d{3,8}-\d$' then
    raise exception 'Formato del RUC: de 3 a 8 números, guion y el dígito verificador (ej. 80012345-0)';
  end if;
  if not ruc_valido(v) then
    v_base := split_part(v, '-', 1);
    v_dv := ruc_dv(v_base);
    raise exception 'El dígito verificador de % es %: el RUC es %-%', v_base, v_dv, v_base, v_dv;
  end if;
  return v;
end;
$fn$;

-- =============================================================================
-- 3. Público (anon): la cuenta de la mesa desde el celular
-- =============================================================================
create or replace function :"schema".mesa_publico_cuenta_json(p_mesa uuid)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  c mesa_cuentas;
begin
  select * into c from mesa_cuentas where mesa_id = p_mesa and estado = 'abierta';
  if not found then return jsonb_build_object('abierta', false, 'ahora', now()); end if;
  return jsonb_build_object(
    'abierta', true,
    'ahora', now(),
    'abierta_at', c.abierta_at,
    'total', mesa_seleccion_total(c.id, null, false),
    'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
    'solicitada_at', c.cuenta_solicitada_at,
    'en_caja', c.en_caja_at is not null,
    'cobrado', coalesce((select sum(pa.total_cobrado) from mesa_cuenta_partes pa where pa.cuenta_id = c.id and pa.venta_id is not null), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'pedido', p.numero, 'nombre', i.producto_nombre, 'cantidad', i.cantidad,
        'precio_unitario', i.precio_unitario, 'total', i.total, 'modificadores_texto', i.modificadores_texto,
        'estado', coalesce((select k.estado from mesa_comandas k
                             where k.pedido_id = p.id and k.estacion_id is not distinct from i.estacion_id
                             order by k.creado_at limit 1), p.estado))
        order by p.creado_at, p.numero, i.producto_nombre, i.id)
      from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
      where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), '[]'::jsonb),
    'division', mesa_division_json(c.id, true),
    'facturacion', mesa_fact_json(c.empresa_id, c.fact_ruc, c.fact_razon_social, c.fact_email, true));
end;
$fn$;

create or replace function :"schema".mesa_publico_cuenta(p_token text)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_mesa uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select id into v_mesa from mesas where token = p_token and activa;
  if v_mesa is null then return null; end if;
  return mesa_publico_cuenta_json(v_mesa);
end;
$fn$;

-- Pedir la cuenta / cancelar la solicitud.
create or replace function :"schema".mesa_publico_pedir_cuenta(p_token text, p_pedir boolean)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
  c mesa_cuentas;
begin
  m := mesa_publico_mesa(p_token);
  select * into c from mesa_cuentas where mesa_id = m.id and estado = 'abierta' for update;
  if not found then raise exception 'La mesa todavía no tiene una cuenta abierta: hacé tu pedido primero'; end if;
  perform mesa_qr_limite(m.id, 'escribir', 40, interval '10 minutes');
  if coalesce(p_pedir, true) then
    if not exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado not in ('nuevo', 'rechazado')) then
      raise exception 'Todavía no hay productos confirmados en la cuenta';
    end if;
    if c.cuenta_solicitada_at is null then
      update mesa_cuentas set cuenta_solicitada_at = now() where id = c.id;
    end if;
  else
    if c.en_caja_at is not null then
      raise exception 'La caja ya está preparando tu cuenta: si querés seguir pidiendo, avisale al mozo';
    end if;
    update mesa_cuentas set cuenta_solicitada_at = null where id = c.id;
  end if;
  return mesa_publico_cuenta_json(m.id);
end;
$fn$;

-- Separar la cuenta. p_division:
--   { modo: 'iguales', personas: N, partes?: [{ nombre }] }
--   { modo: 'productos', partes: [{ nombre }], asignaciones: [{ item_id, reparto: [{ parte: 1..N, cantidad }] }] }
--   null / {} → deja de estar separada.
create or replace function :"schema".mesa_publico_dividir(p_token text, p_division jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
  c mesa_cuentas;
  d mesa_cuenta_divisiones;
  v_modo text;
  v_n integer;
  v_nombre text;
  v_ids uuid[] := '{}';
  v_id uuid;
  a jsonb;
  r jsonb;
  v_item uuid;
  v_parte integer;
  v_cant numeric;
  it record;
  v_idx integer := 0;
  v_milli integer;
  v_base integer;
  v_rem integer;
  k integer;
  v_mal record;
begin
  m := mesa_publico_mesa(p_token);
  select * into c from mesa_cuentas where mesa_id = m.id and estado = 'abierta' for update;
  if not found then raise exception 'La mesa todavía no tiene una cuenta abierta: hacé tu pedido primero'; end if;
  perform mesa_qr_limite(m.id, 'escribir', 40, interval '10 minutes');
  if exists (select 1 from mesa_cuenta_partes where cuenta_id = c.id and venta_id is not null) then
    raise exception 'La caja ya cobró una parte de la cuenta: si hay que cambiar algo, pedile al mozo';
  end if;

  if p_division is null or jsonb_typeof(p_division) <> 'object' or p_division = '{}'::jsonb then
    delete from mesa_cuenta_divisiones where cuenta_id = c.id;
    return mesa_publico_cuenta_json(m.id);
  end if;

  if not exists (select 1 from mesa_seleccion(c.id, null, false)) then
    raise exception 'Todavía no hay productos confirmados en la cuenta para separar';
  end if;
  v_modo := p_division->>'modo';
  if v_modo is null or v_modo not in ('productos', 'iguales') then raise exception 'Elegí cómo separar la cuenta'; end if;
  if jsonb_typeof(coalesce(p_division->'partes', '[]'::jsonb)) <> 'array' then raise exception 'Datos inválidos'; end if;
  if v_modo = 'iguales' then
    begin
      v_n := (p_division->>'personas')::integer;
    exception when others then
      raise exception 'Cantidad de personas inválida';
    end;
  else
    v_n := jsonb_array_length(coalesce(p_division->'partes', '[]'::jsonb));
  end if;
  if v_n is null or v_n < 2 or v_n > 20 then raise exception 'La cuenta se separa entre 2 y 20 personas'; end if;

  insert into mesa_cuenta_divisiones (empresa_id, cuenta_id, modo, personas)
    values (c.empresa_id, c.id, v_modo, v_n)
    on conflict (cuenta_id) do update set modo = excluded.modo, personas = excluded.personas, actualizada_at = now()
    returning * into d;
  -- Las partes se conservan por número (así no se pierden sus datos de facturación).
  delete from mesa_cuenta_partes where division_id = d.id and (numero > v_n or es_resto);
  for k in 1..v_n loop
    v_nombre := left(nullif(btrim(coalesce(p_division->'partes'->(k - 1)->>'nombre', '')), ''), 40);
    insert into mesa_cuenta_partes (empresa_id, division_id, cuenta_id, numero, nombre)
      values (c.empresa_id, d.id, c.id, k, coalesce(v_nombre, 'Persona ' || k))
      on conflict (division_id, numero) do update set nombre = excluded.nombre
      returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  delete from mesa_cuenta_parte_items pi using mesa_cuenta_partes pa where pa.id = pi.parte_id and pa.division_id = d.id;

  if v_modo = 'iguales' then
    -- Cada ítem se reparte en N partes con 3 decimales; los milésimos que sobran rotan entre las
    -- personas (así los montos quedan parejos y la suma da exacto lo pedido).
    for it in select s.item_id, s.cantidad from mesa_seleccion(c.id, null, false) s order by s.item_id loop
      v_milli := round(it.cantidad * 1000)::integer;
      v_base := v_milli / v_n;
      v_rem := v_milli - v_base * v_n;
      for k in 0..v_n - 1 loop
        v_cant := (v_base + case when ((k - v_idx) % v_n + v_n) % v_n < v_rem then 1 else 0 end) / 1000.0;
        if v_cant > 0 then
          insert into mesa_cuenta_parte_items (empresa_id, parte_id, item_id, cantidad) values (c.empresa_id, v_ids[k + 1], it.item_id, v_cant);
        end if;
      end loop;
      v_idx := v_idx + v_rem;
    end loop;
  else
    if jsonb_typeof(coalesce(p_division->'asignaciones', '[]'::jsonb)) <> 'array' then raise exception 'Datos inválidos'; end if;
    if jsonb_array_length(coalesce(p_division->'asignaciones', '[]'::jsonb)) > 400 then raise exception 'Son demasiados productos'; end if;
    for a in select * from jsonb_array_elements(coalesce(p_division->'asignaciones', '[]'::jsonb)) loop
      begin
        v_item := (a->>'item_id')::uuid;
      exception when others then
        raise exception 'Hay un producto inválido';
      end;
      if not exists (select 1 from mesa_seleccion(c.id, null, false) s where s.item_id = v_item) then
        raise exception 'Un producto ya no está en la cuenta: actualizá y probá de nuevo';
      end if;
      if jsonb_typeof(coalesce(a->'reparto', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(a->'reparto', '[]'::jsonb)) > 20 then
        raise exception 'Datos inválidos';
      end if;
      for r in select * from jsonb_array_elements(coalesce(a->'reparto', '[]'::jsonb)) loop
        begin
          v_parte := (r->>'parte')::integer;
          v_cant := (r->>'cantidad')::numeric;
        exception when others then
          raise exception 'Cantidad inválida';
        end;
        if v_parte is null or v_parte < 1 or v_parte > v_n then raise exception 'Persona inválida'; end if;
        if v_cant is null or v_cant <= 0 or v_cant <> round(v_cant, 3) then raise exception 'Cantidad inválida'; end if;
        insert into mesa_cuenta_parte_items (empresa_id, parte_id, item_id, cantidad)
          values (c.empresa_id, v_ids[v_parte], v_item, v_cant)
          on conflict (parte_id, item_id) do update set cantidad = mesa_cuenta_parte_items.cantidad + excluded.cantidad;
      end loop;
    end loop;
    -- Nadie paga más de lo que se pidió.
    select i.producto_nombre as nombre, i.cantidad, sum(pi.cantidad) as asignado into v_mal
      from mesa_cuenta_parte_items pi join mesa_cuenta_partes pa on pa.id = pi.parte_id join mesa_pedido_items i on i.id = pi.item_id
     where pa.division_id = d.id group by i.id, i.producto_nombre, i.cantidad having sum(pi.cantidad) > i.cantidad limit 1;
    if found then
      raise exception 'En "%" se repartió % y se pidieron %', v_mal.nombre, trim_scale(v_mal.asignado), trim_scale(v_mal.cantidad);
    end if;
    select pa.nombre into v_nombre from mesa_cuenta_partes pa
     where pa.division_id = d.id and not exists (select 1 from mesa_cuenta_parte_items pi where pi.parte_id = pa.id)
     order by pa.numero limit 1;
    if found then raise exception '"%" no tiene nada asignado: asignale algo o sacala de la lista', v_nombre; end if;
  end if;
  return mesa_publico_cuenta_json(m.id);
end;
$fn$;

-- Datos de facturación propuestos: de la cuenta (p_parte null) o de una persona (su número).
-- p_ruc vacío → se borran.
create or replace function :"schema".mesa_publico_facturacion(p_token text, p_parte integer, p_ruc text, p_razon text, p_email text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
  c mesa_cuentas;
  v_ruc text;
  v_razon text := left(nullif(btrim(regexp_replace(coalesce(p_razon, ''), '\s+', ' ', 'g')), ''), 150);
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  pa mesa_cuenta_partes;
begin
  m := mesa_publico_mesa(p_token);
  select * into c from mesa_cuentas where mesa_id = m.id and estado = 'abierta' for update;
  if not found then raise exception 'La mesa todavía no tiene una cuenta abierta: hacé tu pedido primero'; end if;
  perform mesa_qr_limite(m.id, 'escribir', 40, interval '10 minutes');
  v_ruc := mesa_ruc_publico(p_ruc);
  if v_ruc is not null then
    if v_razon is null or length(v_razon) < 2 then raise exception 'Escribí la razón social o el nombre para la factura'; end if;
    if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'El email no es válido';
    end if;
  end if;

  if p_parte is null then
    update mesa_cuentas set fact_ruc = v_ruc, fact_razon_social = case when v_ruc is null then null else v_razon end,
           fact_email = case when v_ruc is null then null else v_email end, fact_at = now()
     where id = c.id;
  else
    select pa2.* into pa from mesa_cuenta_partes pa2 join mesa_cuenta_divisiones d on d.id = pa2.division_id
     where d.cuenta_id = c.id and pa2.numero = p_parte and not pa2.es_resto for update of pa2;
    if not found then raise exception 'Esa persona ya no está en la división de la cuenta: actualizá y probá de nuevo'; end if;
    if pa.venta_id is not null then raise exception 'La parte de "%" ya se cobró', pa.nombre; end if;
    update mesa_cuenta_partes set fact_ruc = v_ruc, fact_razon_social = case when v_ruc is null then null else v_razon end,
           fact_email = case when v_ruc is null then null else v_email end
     where id = pa.id;
  end if;
  return mesa_publico_cuenta_json(m.id);
end;
$fn$;

-- "Buscar" por RUC o CI entre los clientes de la empresa: devuelve SOLO la razón social / nombre
-- (y el RUC con su dígito verificador). Exige una cuenta abierta y tiene tope por mesa.
create or replace function :"schema".mesa_publico_buscar_ruc(p_token text, p_doc text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  m mesas;
  v text := ruc_normalizado(p_doc);
  v_base text;
  r record;
begin
  m := mesa_publico_mesa(p_token);
  if not exists (select 1 from mesa_cuentas where mesa_id = m.id and estado = 'abierta') then
    raise exception 'La mesa todavía no tiene una cuenta abierta: hacé tu pedido primero';
  end if;
  if v is null or v !~ '^\d{3,10}(-\d)?$' then
    raise exception 'Escribí el RUC (con o sin dígito verificador) o el número de cédula';
  end if;
  perform mesa_qr_limite(m.id, 'buscar', 15, interval '10 minutes');
  v_base := split_part(v, '-', 1);
  select coalesce(nullif(btrim(cl.razon_social), ''), cl.nombre) as nombre, ruc_receptor(cl.ruc, cl.documento) as ruc into r
    from clientes cl
   where cl.empresa_id = m.empresa_id and cl.deleted_at is null and coalesce(cl.activo, true)
     and (split_part(ruc_normalizado(cl.ruc), '-', 1) = v_base or split_part(ruc_normalizado(cl.documento), '-', 1) = v_base)
   order by (ruc_receptor(cl.ruc, cl.documento) is not null) desc, cl.updated_at desc nulls last
   limit 1;
  if not found then return jsonb_build_object('encontrado', false); end if;
  return jsonb_build_object(
    'encontrado', true,
    'razon_social', r.nombre,
    'ruc', coalesce(r.ruc, case when v ~ '^\d{3,8}-\d$' and ruc_valido(v) then v
                                when v_base ~ '^\d{3,8}$' then v_base || '-' || ruc_dv(v_base) end));
end;
$fn$;

-- =============================================================================
-- 4. Caja: enviar a caja (69 + al volver a abrir se borra la solicitud)
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

  if exists (select 1 from mesa_cuenta_partes where cuenta_id = c.id and venta_id is not null) then
    raise exception 'Ya se cobró una parte de la cuenta de "%": cobrá lo que falta en la caja', m.nombre;
  end if;
  update mesa_cuentas set en_caja_at = null, en_caja_por = null, en_caja_por_nombre = null, cuenta_solicitada_at = null where id = c.id;
  return jsonb_build_object('id', c.id, 'estado', 'abierta', 'en_caja_at', null);
end;
$fn$;

-- =============================================================================
-- 5. Tablero (73 + solicitud de cuenta, división y facturación propuesta)
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
        'solicitada_at', c.cuenta_solicitada_at,  -- 88
        'mesa', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'zona', m.zona),
        'sucursal', jsonb_build_object('id', su.id, 'nombre', su.nombre),
        'total', coalesce((select sum(p.total) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')), 0),
        'pedidos', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')),
        'pendientes', (select count(*) from mesa_pedidos p where p.cuenta_id = c.id and p.estado = 'nuevo'),
        'items', coalesce((select jsonb_agg(x order by x->>'nombre', x->>'modificadores_texto' nulls first) from (
            select jsonb_build_object('nombre', i.producto_nombre, 'cantidad', sum(i.cantidad), 'precio_unitario', i.precio_unitario,
                                      'total', sum(i.total), 'modificadores_texto', i.modificadores_texto) as x
              from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
             where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
             group by i.producto_nombre, i.precio_unitario, i.modificadores_texto) t), '[]'::jsonb),
        'division', mesa_division_json(c.id, false),  -- 88
        'facturacion', mesa_fact_json(c.empresa_id, c.fact_ruc, c.fact_razon_social, c.fact_email, false))  -- 88
        order by m.orden, m.nombre)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id join sucursales su on su.id = m.sucursal_id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta'
        and (s.s_sucursal is null or m.sucursal_id = s.s_sucursal)), '[]'::jsonb),
    'estaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nombre', e.nombre, 'color', e.color, 'icono', e.icono, 'orden', e.orden, 'activa', e.activa)
        order by e.orden, e.nombre)
      from estaciones_cocina e where e.empresa_id = s.s_empresa), '[]'::jsonb),
    'mi_estacion_id', (select u.estacion_cocina_id from usuarios u where u.id = s.s_usuario),
    'puede_atender', tiene_permiso('pedidos_mesas'),
    'puede_cocina', tiene_permiso('cocina'));
end;
$fn$;

-- =============================================================================
-- 6. Caja › Nueva venta: mesas por cobrar (73 + partes, resto y facturación propuesta)
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
        'items', mesa_lineas_caja(c.id, null, false),
        -- 88: facturación propuesta desde el celular y, si la cuenta está separada, sus partes.
        'facturacion', mesa_fact_json(c.empresa_id, c.fact_ruc, c.fact_razon_social, c.fact_email, false),
        'cobrado', coalesce((select sum(pa.total_cobrado) from mesa_cuenta_partes pa where pa.cuenta_id = c.id and pa.venta_id is not null), 0),
        'division', case when d.id is null then null else jsonb_build_object(
          'modo', d.modo,
          'partes', coalesce((select jsonb_agg(jsonb_build_object(
              'id', pa.id, 'numero', pa.numero, 'nombre', pa.nombre, 'es_resto', pa.es_resto,
              'cobrada', pa.venta_id is not null,
              'total', case when pa.venta_id is not null then pa.total_cobrado else mesa_seleccion_total(c.id, pa.id, false) end,
              'items', case when pa.venta_id is not null then '[]'::jsonb else mesa_lineas_caja(c.id, pa.id, false) end,
              'facturacion', mesa_fact_json(pa.empresa_id, pa.fact_ruc, pa.fact_razon_social, pa.fact_email, false))
              order by pa.numero)
            from mesa_cuenta_partes pa where pa.division_id = d.id), '[]'::jsonb),
          'resto', case when exists (select 1 from mesa_seleccion(c.id, null, true)) then jsonb_build_object(
              'total', mesa_seleccion_total(c.id, null, true), 'items', mesa_lineas_caja(c.id, null, true)) end) end)
        order by c.en_caja_at)
      from mesa_cuentas c join mesas m on m.id = c.mesa_id
      left join mesa_cuenta_divisiones d on d.cuenta_id = c.id
      where c.empresa_id = s.s_empresa and c.estado = 'abierta' and c.en_caja_at is not null
        and m.sucursal_id = v_suc), '[]'::jsonb));
end;
$fn$;

-- =============================================================================
-- 7. Cobro de la cuenta entera (74 + no si ya se cobró una parte)
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
  v_viejas text;
  v_claves text;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta de mesa no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;

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
  -- 88: separada y con una parte cobrada → se cobran las partes que faltan.
  if exists (select 1 from mesa_cuenta_partes where cuenta_id = c.id and venta_id is not null) then
    raise exception 'La cuenta de "%" está separada y ya se cobró una parte: cobrá las partes que faltan', m.nombre;
  end if;
  if exists (select 1 from mesa_pedidos where cuenta_id = c.id and estado = 'nuevo') then
    raise exception 'La mesa "%" tiene un pedido nuevo sin atender: aceptalo o rechazalo en Pedidos de mesas antes de cobrar', m.nombre;
  end if;
  if p_version is null or p_version <> mesa_cuenta_version(c.id) then
    raise exception 'La cuenta de "%" cambió desde que la cargaste: recargala antes de cobrar', m.nombre;
  end if;

  v_caja := caja_abierta_para(null, null, p_caja_id);
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> m.sucursal_id then raise exception 'La mesa "%" es de otra sucursal: cobrala en una caja de su sucursal', m.nombre; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'La venta debe tener al menos un ítem'; end if;
  for g in
    select i.producto_id, max(i.producto_nombre) as nombre, mods_clave(i.modificadores) as clave,
           max(i.modificadores_texto) as texto, sum(i.cantidad) as cantidad
      from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
     where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado')
     group by i.producto_id, mods_clave(i.modificadores)
  loop
    if g.producto_id is null then
      raise exception 'El producto "%" de la cuenta ya no existe en el catálogo: no se puede cobrar en caja', g.nombre;
    end if;
    select coalesce(sum((x->>'cantidad')::numeric), 0) into v_en_carrito
      from jsonb_array_elements(p_items) x
     where x->>'producto_id' = g.producto_id::text and mods_clave(x->'mods') = g.clave;
    if v_en_carrito < g.cantidad then
      raise exception 'No se pueden quitar productos de la cuenta de la mesa: "%"% pidió %, en el carrito hay %',
        g.nombre, coalesce(' (' || g.texto || ')', ''), trim_scale(g.cantidad), trim_scale(v_en_carrito);
    end if;
  end loop;

  select string_agg(distinct i.producto_id::text, ',') into v_viejas
    from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
   where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado') and i.modificadores is null and i.producto_id is not null;
  select string_agg(distinct i.producto_id::text || '#' || mods_clave(i.modificadores), ';') into v_claves
    from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
   where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado') and i.producto_id is not null;
  perform set_config('erp.mods_sin_exigir', coalesce(v_viejas, ''), true);
  perform set_config('erp.mods_sin_exigir_claves', coalesce(v_claves, ''), true);

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Cuenta de mesa: ' || m.nombre || coalesce(' · ' || m.zona, ''), 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);
  perform set_config('erp.mods_sin_exigir', '', true);
  perform set_config('erp.mods_sin_exigir_claves', '', true);

  update mesa_cuentas set estado = 'cerrada', cerrada_at = now(), cerrada_por = s.s_usuario,
         venta_id = (v_venta->>'venta_id')::uuid, total = coalesce((v_venta->>'total')::numeric, 0)
   where id = c.id;
  update mesa_comandas k set estado = 'entregado', preparando_at = coalesce(k.preparando_at, now()),
         listo_at = coalesce(k.listo_at, now()), entregado_at = now(), updated_at = now()
    from mesa_pedidos p
   where p.id = k.pedido_id and p.cuenta_id = c.id and k.estado <> 'entregado';
  update mesa_pedidos set estado = 'entregado', entregado_at = now(), listo_at = coalesce(listo_at, now()), updated_at = now()
   where cuenta_id = c.id and estado in ('aceptado', 'en_preparacion', 'listo');
  return v_venta || jsonb_build_object('mesa', m.nombre);
end;
$fn$;

-- =============================================================================
-- 8. Cobro de UNA parte (o del resto): su propia venta; la cuenta se cierra con la última
-- =============================================================================
create or replace function :"schema".mesa_cuenta_parte_cobrar_caja(
  p_cuenta_id uuid, p_parte_id uuid, p_resto boolean, p_version text,
  p_cliente_id uuid, p_tipo_venta text, p_metodo_pago text, p_moneda text, p_observaciones text,
  p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_descuento_pct numeric default 0,
  p_plazo_dias integer default null, p_caja_id uuid default null,
  p_tipo_documento text default 'ticket', p_cliente_ocasional boolean default false)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c mesa_cuentas;
  m mesas;
  d mesa_cuenta_divisiones;
  pa mesa_cuenta_partes;
  v_caja uuid;
  v_suc_caja uuid;
  v_previa uuid;
  v_venta jsonb;
  g record;
  v_en_carrito numeric;
  v_quien text;
  v_viejas text;
  v_claves text;
  v_resto boolean := coalesce(p_resto, false);
  v_nombre text;
  v_total numeric;
  v_faltan integer;
  v_cerrada boolean := false;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  select * into c from mesa_cuentas where id = p_cuenta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Cuenta de mesa no encontrada'; end if;
  select * into m from mesas where id = c.mesa_id;
  if (p_parte_id is null) = (not v_resto) then raise exception 'Elegí la parte de la cuenta que se cobra'; end if;

  -- Reintento del mismo POS: esa venta ya es de una parte de esta cuenta.
  if nullif(p_idempotency_key, '') is not null then
    select id into v_previa from ventas where empresa_id = s.s_empresa and idempotency_key = p_idempotency_key limit 1;
    if v_previa is not null and exists (select 1 from mesa_cuenta_partes x where x.cuenta_id = c.id and x.venta_id = v_previa) then
      return jsonb_build_object('venta_id', v_previa, 'numero_control', (select numero_control from ventas where id = v_previa),
                                'reusada', true, 'mesa', m.nombre, 'cuenta_cerrada', c.estado = 'cerrada');
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
    raise exception 'La cuenta de "%" cambió desde que la cargaste (la separaron de nuevo o entró un pedido): recargala antes de cobrar', m.nombre;
  end if;
  select * into d from mesa_cuenta_divisiones where cuenta_id = c.id;
  if not found then raise exception 'La cuenta de "%" ya no está separada: recargala', m.nombre; end if;

  if v_resto then
    if not exists (select 1 from mesa_seleccion(c.id, null, true)) then raise exception 'No queda nada sin asignar en la cuenta de "%"', m.nombre; end if;
    v_nombre := 'Resto';
  else
    select * into pa from mesa_cuenta_partes where id = p_parte_id and division_id = d.id for update;
    if not found then raise exception 'Esa parte ya no está en la cuenta: recargala'; end if;
    if pa.venta_id is not null then raise exception 'La parte de "%" ya se cobró', pa.nombre; end if;
    if not exists (select 1 from mesa_seleccion(c.id, pa.id, false)) then raise exception 'La parte de "%" no tiene nada para cobrar', pa.nombre; end if;
    v_nombre := pa.nombre;
  end if;

  v_caja := caja_abierta_para(null, null, p_caja_id);
  if v_caja is null then raise exception 'Abrí la caja para cobrar'; end if;
  select sucursal_id into v_suc_caja from cajas where id = v_caja;
  if v_suc_caja <> m.sucursal_id then raise exception 'La mesa "%" es de otra sucursal: cobrala en una caja de su sucursal', m.nombre; end if;

  -- El carrito trae, por producto y combinación, al menos lo de esta parte.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'La venta debe tener al menos un ítem'; end if;
  for g in
    select i.producto_id, max(i.producto_nombre) as nombre, mods_clave(i.modificadores) as clave,
           max(i.modificadores_texto) as texto, sum(sel.cantidad) as cantidad
      from mesa_seleccion(c.id, p_parte_id, v_resto) sel join mesa_pedido_items i on i.id = sel.item_id
     group by i.producto_id, mods_clave(i.modificadores)
  loop
    if g.producto_id is null then
      raise exception 'El producto "%" de la cuenta ya no existe en el catálogo: no se puede cobrar en caja', g.nombre;
    end if;
    select coalesce(sum((x->>'cantidad')::numeric), 0) into v_en_carrito
      from jsonb_array_elements(p_items) x
     where x->>'producto_id' = g.producto_id::text and mods_clave(x->'mods') = g.clave;
    if v_en_carrito < g.cantidad then
      raise exception 'No se pueden quitar productos de la parte de "%": "%"% es %, en el carrito hay %',
        v_nombre, g.nombre, coalesce(' (' || g.texto || ')', ''), trim_scale(g.cantidad), trim_scale(v_en_carrito);
    end if;
  end loop;

  select string_agg(distinct i.producto_id::text, ',') into v_viejas
    from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
   where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado') and i.modificadores is null and i.producto_id is not null;
  select string_agg(distinct i.producto_id::text || '#' || mods_clave(i.modificadores), ';') into v_claves
    from mesa_pedido_items i join mesa_pedidos p on p.id = i.pedido_id
   where p.cuenta_id = c.id and p.estado not in ('nuevo', 'rechazado') and i.producto_id is not null;
  perform set_config('erp.mods_sin_exigir', coalesce(v_viejas, ''), true);
  perform set_config('erp.mods_sin_exigir_claves', coalesce(v_claves, ''), true);

  v_venta := crear_venta(
    p_cliente_id, p_tipo_venta, p_metodo_pago, p_moneda,
    coalesce(nullif(btrim(p_observaciones), ''), left('Cuenta de mesa: ' || m.nombre || coalesce(' · ' || m.zona, '') || ' · ' || v_nombre, 500)),
    p_items, p_pagos, p_idempotency_key, p_descuento_pct, p_plazo_dias, null, v_caja,
    p_tipo_documento, p_cliente_ocasional);
  perform set_config('erp.mods_sin_exigir', '', true);
  perform set_config('erp.mods_sin_exigir_claves', '', true);
  v_total := coalesce((v_venta->>'total')::numeric, 0);

  if v_resto then
    -- El resto pasa a ser una parte más (cobrada) con lo que quedaba sin asignar.
    insert into mesa_cuenta_partes (empresa_id, division_id, cuenta_id, numero, nombre, es_resto, venta_id, cobrada_at, cobrada_por, total_cobrado)
      values (c.empresa_id, d.id, c.id, (select coalesce(max(numero), 0) + 1 from mesa_cuenta_partes where division_id = d.id),
              'Resto', true, (v_venta->>'venta_id')::uuid, now(), s.s_usuario, v_total)
      returning * into pa;
    insert into mesa_cuenta_parte_items (empresa_id, parte_id, item_id, cantidad)
      select c.empresa_id, pa.id, sel.item_id, sel.cantidad from mesa_seleccion(c.id, null, true) sel;
  else
    update mesa_cuenta_partes set venta_id = (v_venta->>'venta_id')::uuid, cobrada_at = now(), cobrada_por = s.s_usuario, total_cobrado = v_total
     where id = pa.id;
  end if;

  -- ¿Queda algo? Partes sin cobrar con algo asignado + el resto.
  select count(*) into v_faltan from mesa_cuenta_partes x
   where x.division_id = d.id and x.venta_id is null and exists (select 1 from mesa_seleccion(c.id, x.id, false));
  if v_faltan = 0 and not exists (select 1 from mesa_seleccion(c.id, null, true)) then
    v_cerrada := true;
    update mesa_cuentas set estado = 'cerrada', cerrada_at = now(), cerrada_por = s.s_usuario,
           venta_id = (v_venta->>'venta_id')::uuid,
           total = coalesce((select sum(x.total_cobrado) from mesa_cuenta_partes x where x.cuenta_id = c.id and x.venta_id is not null), 0)
     where id = c.id;
    update mesa_comandas k set estado = 'entregado', preparando_at = coalesce(k.preparando_at, now()),
           listo_at = coalesce(k.listo_at, now()), entregado_at = now(), updated_at = now()
      from mesa_pedidos p
     where p.id = k.pedido_id and p.cuenta_id = c.id and k.estado <> 'entregado';
    update mesa_pedidos set estado = 'entregado', entregado_at = now(), listo_at = coalesce(listo_at, now()), updated_at = now()
     where cuenta_id = c.id and estado in ('aceptado', 'en_preparacion', 'listo');
  elsif exists (select 1 from mesa_seleccion(c.id, null, true)) then
    v_faltan := v_faltan + 1;
  end if;
  return v_venta || jsonb_build_object('mesa', m.nombre, 'parte', v_nombre, 'cuenta_cerrada', v_cerrada, 'faltan', v_faltan);
end;
$fn$;

-- =============================================================================
-- 9. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".mesa_seleccion(uuid, uuid, boolean) from public, anon;
revoke all on function :"schema".mesa_lineas_caja(uuid, uuid, boolean) from public, anon;
revoke all on function :"schema".mesa_seleccion_total(uuid, uuid, boolean) from public, anon;
revoke all on function :"schema".mesa_email_oculto(text) from public, anon;
revoke all on function :"schema".mesa_fact_json(uuid, text, text, text, boolean) from public, anon;
revoke all on function :"schema".mesa_division_json(uuid, boolean) from public, anon;
revoke all on function :"schema".mesa_cuenta_version(uuid) from public, anon;
revoke all on function :"schema".mesa_qr_limite(uuid, text, integer, interval) from public, anon;
revoke all on function :"schema".mesa_publico_mesa(text) from public, anon;
revoke all on function :"schema".mesa_ruc_publico(text) from public, anon;
revoke all on function :"schema".mesa_publico_cuenta_json(uuid) from public, anon;
revoke all on function :"schema".mesa_publico_cuenta(text) from public;
revoke all on function :"schema".mesa_publico_pedir_cuenta(text, boolean) from public;
revoke all on function :"schema".mesa_publico_dividir(text, jsonb) from public;
revoke all on function :"schema".mesa_publico_facturacion(text, integer, text, text, text) from public;
revoke all on function :"schema".mesa_publico_buscar_ruc(text, text) from public;
revoke all on function :"schema".mesa_cuenta_enviar_caja(uuid, boolean) from public;
revoke all on function :"schema".mesas_tablero() from public;
revoke all on function :"schema".mesas_por_cobrar(uuid) from public;
revoke all on function :"schema".mesa_cuenta_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean) from public;
revoke all on function :"schema".mesa_cuenta_parte_cobrar_caja(uuid, uuid, boolean, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean) from public;

grant execute on function
  :"schema".mesa_cuenta_enviar_caja(uuid, boolean),
  :"schema".mesas_tablero(),
  :"schema".mesas_por_cobrar(uuid),
  :"schema".mesa_cuenta_cobrar_caja(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean),
  :"schema".mesa_cuenta_parte_cobrar_caja(uuid, uuid, boolean, text, uuid, text, text, text, text, jsonb, jsonb, text, numeric, integer, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function
  :"schema".mesa_publico_cuenta(text),
  :"schema".mesa_publico_pedir_cuenta(text, boolean),
  :"schema".mesa_publico_dividir(text, jsonb),
  :"schema".mesa_publico_facturacion(text, integer, text, text, text),
  :"schema".mesa_publico_buscar_ruc(text, text)
  to anon, authenticated, service_role;

commit;
