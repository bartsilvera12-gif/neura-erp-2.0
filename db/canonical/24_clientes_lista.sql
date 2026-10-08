-- =============================================================================
-- Clientes Fase 1: lista paginada con deuda + ficha.
--   · clientes.plazo_dias        plazo habitual de los clientes a crédito
--   · documento único sin importar puntos/guion ("80012345-6" = "800123456")
--   · listar_clientes(...)       página de clientes con búsqueda inteligente, filtros,
--                                total comprado, última compra, deuda y vencido, y las
--                                cifras de arriba (clientes, con deuda, a cobrar, vencido)
--   · resumen_cliente(id)        cifras de la ficha
-- Deuda = ventas a CRÉDITO no anuladas (hasta que la Fase 2 sume los cobros).
-- Vencida = la venta pasó su plazo (el de la venta, si no el del cliente, si no 30 días).
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
alter table :"schema".clientes add column if not exists plazo_dias integer;
alter table :"schema".clientes drop constraint if exists clientes_plazo_check;
alter table :"schema".clientes add constraint clientes_plazo_check check (plazo_dias is null or plazo_dias between 0 and 3650);

drop index if exists :"schema".clientes_documento_unico;
create unique index if not exists clientes_documento_unico
  on :"schema".clientes (empresa_id, regexp_replace(lower(documento), '[^a-z0-9]+', '', 'g'))
  where documento is not null and btrim(documento) <> '' and deleted_at is null;

-- Cifras de cada cliente (una fila por cliente con ventas).
create or replace function :"schema".cifras_clientes(p_cliente uuid default null)
returns table (cliente_id uuid, total_comprado numeric, compras bigint, ultima_compra timestamptz, deuda numeric, vencido numeric)
language sql stable security invoker set search_path = :"schema", public as $$
  select v.cliente_id,
         sum(v.total) filter (where v.estado <> 'anulada'),
         count(*) filter (where v.estado <> 'anulada'),
         max(v.fecha) filter (where v.estado <> 'anulada'),
         coalesce(sum(v.total) filter (where v.estado <> 'anulada' and v.tipo_venta = 'CREDITO'), 0),
         coalesce(sum(v.total) filter (where v.estado <> 'anulada' and v.tipo_venta = 'CREDITO'
                    and (v.fecha at time zone 'America/Asuncion')::date + coalesce(v.plazo_dias, c.plazo_dias, 30)
                        < (now() at time zone 'America/Asuncion')::date), 0)
    from ventas v
    join clientes c on c.id = v.cliente_id
   where v.empresa_id = empresa_actual() and v.cliente_id is not null
     and (p_cliente is null or v.cliente_id = p_cliente)
   group by v.cliente_id
$$;

create or replace function :"schema".listar_clientes(
  p_q text default null, p_tipo text default null, p_condicion text default null,
  p_deuda text default null, p_inactivos boolean default false,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  with par as (select tokens_busqueda(p_q) as tk, trim(norm(p_q)) as q, compacto(p_q) as qc),
  cif as (select * from cifras_clientes()),
  base as (
    select c.id, c.nombre, c.razon_social, c.tipo_cliente, c.documento, c.ruc, c.telefono, c.email, c.direccion,
           c.ciudad, c.condicion_pago, c.plazo_dias, c.limite_credito, c.activo, c.origen, c.creado_at,
           coalesce(f.total_comprado, 0) as total_comprado, coalesce(f.compras, 0) as compras, f.ultima_compra,
           coalesce(f.deuda, 0) as deuda, coalesce(f.vencido, 0) as vencido,
           norm(coalesce(c.razon_social, c.nombre)) || ' ' || norm(c.nombre) as _n,
           norm(c.nombre) || ' ' || norm(coalesce(c.razon_social, '')) || ' ' || compacto(c.documento) || ' '
             || compacto(c.ruc) || ' ' || compacto(c.telefono) || ' ' || norm(coalesce(c.email, '')) || ' '
             || norm(coalesce(c.ciudad, '')) as _t
      from clientes c left join cif f on f.cliente_id = c.id
     where c.empresa_id = empresa_actual() and c.deleted_at is null
       and (coalesce(p_inactivos, false) or c.activo)
       and (p_tipo is null or c.tipo_cliente = p_tipo)
       and (p_condicion is null or c.condicion_pago = p_condicion)
       and (p_deuda is null or (p_deuda = 'con_deuda' and coalesce(f.deuda, 0) > 0) or (p_deuda = 'vencidos' and coalesce(f.vencido, 0) > 0))
  ),
  hits as (
    select b.*, case when nullif(par.q, '') is null then 0
                     when length(par.qc) >= 5 and (compacto(b.documento) = par.qc or compacto(b.ruc) = par.qc or compacto(b.telefono) = par.qc) then 1000
                     else puntaje_busqueda(b._n, b._t, par.q, par.tk) end as _score
      from base b, par
     where nullif(par.q, '') is null or coincide_busqueda(b._t, par.tk)
  ),
  pag as (
    select * from hits
     order by _score desc, case when nullif((select q from par), '') is null then deuda end desc nulls last, nombre, id
     limit least(greatest(coalesce(p_limit, 25), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_n' - '_t' - '_score'
                                       order by _score desc, case when nullif((select q from par), '') is null then deuda end desc nulls last, nombre, id) from pag), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
               'clientes', count(*) filter (where c.activo),
               'con_deuda', count(*) filter (where coalesce(f.deuda, 0) > 0),
               'a_cobrar', coalesce(sum(f.deuda), 0),
               'vencido', coalesce(sum(f.vencido), 0))
               from clientes c left join cif f on f.cliente_id = c.id
              where c.empresa_id = empresa_actual() and c.deleted_at is null)
  )
$$;

-- Cifras de la ficha de un cliente.
create or replace function :"schema".resumen_cliente(p_cliente uuid)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'total_comprado', coalesce(f.total_comprado, 0), 'compras', coalesce(f.compras, 0),
    'ultima_compra', f.ultima_compra, 'deuda', coalesce(f.deuda, 0), 'vencido', coalesce(f.vencido, 0),
    'ticket_promedio', case when coalesce(f.compras, 0) > 0 then round(f.total_comprado / f.compras) else 0 end)
    from (select 1) x left join cifras_clientes(p_cliente) f on true
$$;

grant execute on function :"schema".cifras_clientes(uuid) to authenticated, service_role;
grant execute on function :"schema".listar_clientes(text, text, text, text, boolean, integer, integer) to authenticated, service_role;
grant execute on function :"schema".resumen_cliente(uuid) to authenticated, service_role;

-- Cliente vivo con este documento (sin importar puntos ni guion), para avisar antes de
-- que salte el índice único. p_excepto = el propio cliente al editar.
create or replace function :"schema".cliente_por_documento(p_documento text, p_excepto uuid default null)
returns text
language sql stable security invoker set search_path = :"schema", public as $$
  select nombre from clientes
   where empresa_id = empresa_actual() and deleted_at is null
     and compacto(documento) = compacto(p_documento) and compacto(p_documento) <> ''
     and (p_excepto is null or id <> p_excepto)
   limit 1
$$;
grant execute on function :"schema".cliente_por_documento(text, uuid) to authenticated, service_role;
