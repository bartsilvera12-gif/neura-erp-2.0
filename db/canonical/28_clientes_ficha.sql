-- =============================================================================
-- Clientes al estilo del sistema actual (sistemas-propio), con datos genéricos:
--   · campos nuevos: contacto, teléfono/email secundarios, país, presencia digital,
--     categoría (el "tipo de servicio" del actual, configurable), valor anual, moneda,
--     vendedor en texto libre, receptor SIFEN, baja operativa y motivo de eliminación
--   · codigo CL-XXXXXXXX (igual que el actual: primeros 8 del id)
--   · cliente_categorias: catálogo configurable por empresa
--   · cliente_historial: la pestaña "Actividad" — se llena SOLA con un trigger
--     (alta, cambios campo por campo, desactivar/reactivar, baja, eliminación)
--   · cliente_notas: notas internas con autor y fecha
--   · listar_clientes v3: filtros estado / tipo / origen / categoría, columnas nuevas,
--     KPIs total / activos / empresas
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;
do $$ begin perform extensions.similarity('a', 'b'); end $$;

-- ── Campos nuevos ────────────────────────────────────────────────────────────
alter table :"schema".clientes add column if not exists nombre_contacto text;
alter table :"schema".clientes add column if not exists telefono_secundario text;
alter table :"schema".clientes add column if not exists email_secundario text;
alter table :"schema".clientes add column if not exists pais text default 'Paraguay';
alter table :"schema".clientes add column if not exists sitio_web text;
alter table :"schema".clientes add column if not exists instagram text;
alter table :"schema".clientes add column if not exists linkedin text;
alter table :"schema".clientes add column if not exists categoria_id uuid;
alter table :"schema".clientes add column if not exists valor_anual numeric(18,2);
alter table :"schema".clientes add column if not exists moneda_preferida text default 'GS';
alter table :"schema".clientes add column if not exists vendedor_texto text;
-- Receptor SIFEN (avanzado). Vacío = se arma solo con RUC / documento.
alter table :"schema".clientes add column if not exists sifen_naturaleza text;      -- contribuyente | no_contribuyente
alter table :"schema".clientes add column if not exists sifen_ti_ope text;          -- B2B | B2C | B2G | B2F
alter table :"schema".clientes add column if not exists sifen_extranjero boolean default false;
alter table :"schema".clientes add column if not exists sifen_pais_iso3 text default 'PRY';
alter table :"schema".clientes add column if not exists sifen_tipo_documento text;  -- cedula | pasaporte | carnet_extranjero | otro
alter table :"schema".clientes add column if not exists sifen_num_id text;
alter table :"schema".clientes add column if not exists sifen_direccion text;
alter table :"schema".clientes add column if not exists sifen_numero_casa text;
-- Baja operativa (deja de ser cliente, queda en la base) y eliminación lógica.
alter table :"schema".clientes add column if not exists baja_at timestamptz;
alter table :"schema".clientes add column if not exists baja_por uuid;
alter table :"schema".clientes add column if not exists baja_motivo text;
alter table :"schema".clientes add column if not exists deleted_by uuid;
alter table :"schema".clientes add column if not exists deleted_motivo text;
alter table :"schema".clientes add column if not exists codigo text
  generated always as ('CL-' || upper(left(replace(id::text, '-', ''), 8))) stored;

do $$ begin
  alter table clientes add constraint chk_clientes_moneda check (moneda_preferida in ('GS', 'USD'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clientes add constraint chk_clientes_sifen_naturaleza check (sifen_naturaleza is null or sifen_naturaleza in ('contribuyente', 'no_contribuyente'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clientes add constraint chk_clientes_sifen_tiope check (sifen_ti_ope is null or sifen_ti_ope in ('B2B', 'B2C', 'B2G', 'B2F'));
exception when duplicate_object then null; end $$;

-- ── Categorías de cliente (el "tipo de servicio" del actual, genérico) ──────
create table if not exists :"schema".cliente_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  color text,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_cliente_categorias_nombre on :"schema".cliente_categorias (empresa_id, lower(nombre));
alter table :"schema".cliente_categorias enable row level security;
alter table :"schema".cliente_categorias force row level security;
drop policy if exists clicat_propias on :"schema".cliente_categorias;
create policy clicat_propias on :"schema".cliente_categorias to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".cliente_categorias to authenticated, service_role;

do $$ begin
  alter table clientes add constraint clientes_categoria_fk foreign key (categoria_id) references cliente_categorias(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists clientes_categoria_idx on :"schema".clientes (categoria_id) where categoria_id is not null;

-- Categorías de ejemplo para cada empresa que todavía no tiene ninguna.
insert into :"schema".cliente_categorias (empresa_id, nombre, color, orden)
select e.id, c.nombre, c.color, c.orden
  from :"schema".empresas e
 cross join (values ('Minorista', '#0d9488', 1), ('Mayorista', '#2563eb', 2), ('Corporativo', '#7c3aed', 3)) c(nombre, color, orden)
 where not exists (select 1 from :"schema".cliente_categorias x where x.empresa_id = e.id);

-- ── Notas internas ───────────────────────────────────────────────────────────
create table if not exists :"schema".cliente_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  texto text not null check (length(trim(texto)) > 0),
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cliente_notas_cliente_idx on :"schema".cliente_notas (cliente_id, created_at desc);
alter table :"schema".cliente_notas enable row level security;
alter table :"schema".cliente_notas force row level security;
drop policy if exists clinotas_propias on :"schema".cliente_notas;
create policy clinotas_propias on :"schema".cliente_notas to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".cliente_notas to authenticated, service_role;

-- ── Historial (pestaña Actividad) ────────────────────────────────────────────
create table if not exists :"schema".cliente_historial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  accion text not null,           -- creado | actualizado | desactivado | reactivado | baja | eliminado | suscripcion | ...
  detalle jsonb not null default '{}'::jsonb,
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cliente_historial_cliente_idx on :"schema".cliente_historial (cliente_id, created_at desc);
alter table :"schema".cliente_historial enable row level security;
alter table :"schema".cliente_historial force row level security;
drop policy if exists clihist_propio on :"schema".cliente_historial;
create policy clihist_propio on :"schema".cliente_historial to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert on :"schema".cliente_historial to authenticated, service_role;

-- Nombre legible de cada campo que se registra en el historial.
create or replace function :"schema".cliente_campo_etiqueta(p_campo text)
returns text language sql immutable as $$
  select case p_campo
    when 'nombre' then 'Nombre' when 'razon_social' then 'Nombre para factura' when 'tipo_cliente' then 'Tipo de cliente'
    when 'documento' then 'CI / Documento' when 'ruc' then 'RUC' when 'nombre_contacto' then 'Contacto'
    when 'telefono' then 'Teléfono' when 'telefono_secundario' then 'Teléfono secundario'
    when 'email' then 'Email' when 'email_secundario' then 'Email secundario'
    when 'direccion' then 'Dirección' when 'ciudad' then 'Ciudad' when 'pais' then 'País'
    when 'sitio_web' then 'Sitio web' when 'instagram' then 'Instagram' when 'linkedin' then 'LinkedIn'
    when 'categoria_id' then 'Categoría' when 'valor_anual' then 'Valor anual estimado'
    when 'moneda_preferida' then 'Moneda' when 'condicion_pago' then 'Condición de pago'
    when 'plazo_dias' then 'Plazo (días)' when 'limite_credito' then 'Límite de crédito'
    when 'vendedor_usuario_id' then 'Vendedor' when 'vendedor_texto' then 'Vendedor (texto)'
    when 'origen' then 'Origen' when 'activo' then 'Estado'
    when 'sifen_naturaleza' then 'SIFEN: naturaleza' when 'sifen_ti_ope' then 'SIFEN: tipo de operación'
    when 'sifen_extranjero' then 'SIFEN: extranjero' when 'sifen_pais_iso3' then 'SIFEN: país'
    when 'sifen_tipo_documento' then 'SIFEN: tipo de documento' when 'sifen_num_id' then 'SIFEN: número de documento'
    when 'sifen_direccion' then 'SIFEN: dirección' when 'sifen_numero_casa' then 'SIFEN: número de casa'
    else p_campo end
$$;

create or replace function :"schema".tg_clientes_historial()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_usuario uuid;
  v_nombre text;
  v_cambios jsonb := '[]'::jsonb;
  v_campo text;
  v_antes text;
  v_despues text;
  v_campos text[] := array['nombre','razon_social','tipo_cliente','documento','ruc','nombre_contacto','telefono',
    'telefono_secundario','email','email_secundario','direccion','ciudad','pais','sitio_web','instagram','linkedin',
    'categoria_id','valor_anual','moneda_preferida','condicion_pago','plazo_dias','limite_credito','vendedor_usuario_id',
    'vendedor_texto','origen','sifen_naturaleza','sifen_ti_ope','sifen_extranjero','sifen_pais_iso3',
    'sifen_tipo_documento','sifen_num_id','sifen_direccion','sifen_numero_casa'];
begin
  select u.id, u.nombre into v_usuario, v_nombre from usuarios u where u.auth_user_id = auth.uid() limit 1;
  if v_usuario is null and new.created_by is not null and tg_op = 'INSERT' then
    select u.id, u.nombre into v_usuario, v_nombre from usuarios u where u.id = new.created_by;
  end if;

  if tg_op = 'INSERT' then
    insert into cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre)
    values (new.empresa_id, new.id, 'creado', jsonb_build_object('origen', new.origen), v_usuario, coalesce(v_nombre, 'Sistema'));
    return null;
  end if;

  -- Eliminación / baja / estado: un evento propio cada uno.
  if new.deleted_at is not null and old.deleted_at is null then
    insert into cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre)
    values (new.empresa_id, new.id, 'eliminado', jsonb_build_object('motivo', new.deleted_motivo), v_usuario, coalesce(v_nombre, 'Sistema'));
    return null;
  end if;
  if new.baja_at is not null and old.baja_at is null then
    insert into cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre)
    values (new.empresa_id, new.id, 'baja', jsonb_build_object('motivo', new.baja_motivo), v_usuario, coalesce(v_nombre, 'Sistema'));
  elsif new.activo is distinct from old.activo then
    insert into cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre)
    values (new.empresa_id, new.id, case when new.activo then 'reactivado' else 'desactivado' end, '{}'::jsonb, v_usuario, coalesce(v_nombre, 'Sistema'));
  end if;

  foreach v_campo in array v_campos loop
    execute format('select ($1).%I::text, ($2).%I::text', v_campo, v_campo) into v_antes, v_despues using old, new;
    if v_antes is distinct from v_despues then
      if v_campo = 'categoria_id' then
        select nombre into v_antes from cliente_categorias where id = old.categoria_id;
        select nombre into v_despues from cliente_categorias where id = new.categoria_id;
      elsif v_campo = 'vendedor_usuario_id' then
        select nombre into v_antes from usuarios where id = old.vendedor_usuario_id;
        select nombre into v_despues from usuarios where id = new.vendedor_usuario_id;
      end if;
      v_cambios := v_cambios || jsonb_build_object('campo', cliente_campo_etiqueta(v_campo), 'antes', v_antes, 'despues', v_despues);
    end if;
  end loop;
  if jsonb_array_length(v_cambios) > 0 then
    insert into cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre)
    values (new.empresa_id, new.id, 'actualizado', jsonb_build_object('cambios', v_cambios), v_usuario, coalesce(v_nombre, 'Sistema'));
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_clientes_historial on :"schema".clientes;
create trigger trg_clientes_historial after insert or update on :"schema".clientes
  for each row execute function :"schema".tg_clientes_historial();

-- Clientes que ya existían: un "creado" con su fecha real, para que la Actividad no arranque vacía.
insert into :"schema".cliente_historial (empresa_id, cliente_id, accion, detalle, usuario_id, usuario_nombre, created_at)
select c.empresa_id, c.id, 'creado', jsonb_build_object('origen', c.origen), c.created_by, coalesce(u.nombre, 'Sistema'), c.creado_at
  from :"schema".clientes c left join :"schema".usuarios u on u.id = c.created_by
 where not exists (select 1 from :"schema".cliente_historial h where h.cliente_id = c.id and h.accion = 'creado');

-- ── Búsqueda: el código CL-XXXX y el contacto también se encuentran ─────────
create or replace function :"schema".tg_clientes_busqueda()
returns trigger language plpgsql security invoker set search_path = :"schema", public as $fn$
begin
  new.busqueda := concat_ws(' ', norm(new.nombre), norm(new.razon_social), norm(new.nombre_contacto),
                            compacto(new.documento), compacto(new.ruc), compacto(new.telefono), compacto(new.telefono_secundario),
                            norm(new.email), norm(new.email_secundario), norm(new.ciudad),
                            'cl' || left(replace(new.id::text, '-', ''), 8));
  new.busqueda_nombre := concat_ws(' ', norm(coalesce(new.razon_social, new.nombre)), norm(new.nombre));
  return new;
end;
$fn$;
drop trigger if exists trg_clientes_busqueda on :"schema".clientes;
create trigger trg_clientes_busqueda before insert or update of nombre, razon_social, nombre_contacto, documento, ruc,
  telefono, telefono_secundario, email, email_secundario, ciudad
  on :"schema".clientes for each row execute function :"schema".tg_clientes_busqueda();
-- Recalcular el texto de los que ya existen (sin disparar el historial: no cambia ningún campo registrado).
update :"schema".clientes set nombre = nombre;

-- ── Lista v3 ─────────────────────────────────────────────────────────────────
drop function if exists :"schema".listar_clientes(text, text, text, text, boolean, integer, integer);
create or replace function :"schema".listar_clientes(
  p_q text default null, p_tipo text default null, p_condicion text default null,
  p_deuda text default null, p_estado text default 'activos', p_origen text default null,
  p_categoria uuid default null, p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.39
as $$
begin
  return (
  with par as (
    select x.tk, trim(norm(p_q)) as q, compacto(p_q) as qc
      from (select tokens_busqueda(p_q) as tk) x
  ),
  cif as (select * from cifras_clientes()),
  base as (
    select c.id, c.codigo, c.nombre, c.razon_social, c.tipo_cliente, c.documento, c.ruc, c.nombre_contacto, c.telefono,
           c.email, c.direccion, c.ciudad, c.condicion_pago, c.plazo_dias, c.limite_credito, c.activo, c.origen,
           c.creado_at, c.baja_at, c.moneda_preferida,
           c.categoria_id, cat.nombre as categoria_nombre, cat.color as categoria_color,
           coalesce(uv.nombre, c.vendedor_texto) as vendedor_nombre, uc.nombre as creado_por_nombre,
           (select string_agg(s.plan_nombre, ', ' order by s.created_at) from suscripciones s where s.cliente_id = c.id and s.estado = 'activa') as suscripcion_activa,
           coalesce(f.total_comprado, 0) as total_comprado, coalesce(f.compras, 0) as compras, f.ultima_compra,
           coalesce(f.deuda, 0) as deuda, coalesce(f.vencido, 0) as vencido,
           c.busqueda_nombre as _n, c.busqueda as _t
      from clientes c
      left join cif f on f.cliente_id = c.id
      left join cliente_categorias cat on cat.id = c.categoria_id
      left join usuarios uv on uv.id = c.vendedor_usuario_id
      left join usuarios uc on uc.id = c.created_by
     where c.empresa_id = empresa_actual() and c.deleted_at is null
       and (coalesce(p_estado, 'todos') = 'todos'
            or (p_estado = 'activos' and c.activo)
            or (p_estado = 'inactivos' and not c.activo and c.baja_at is null)
            or (p_estado = 'baja' and c.baja_at is not null))
       and (p_tipo is null or c.tipo_cliente = p_tipo)
       and (p_condicion is null or c.condicion_pago = p_condicion)
       and (p_origen is null or c.origen = p_origen)
       and (p_categoria is null or c.categoria_id = p_categoria)
       and (p_deuda is null or (p_deuda = 'con_deuda' and coalesce(f.deuda, 0) > 0) or (p_deuda = 'vencidos' and coalesce(f.vencido, 0) > 0))
       and (cardinality((select tk from par)) = 0
            or c.id in (select candidatos_busqueda('clientes', (select tk from par))))
  ),
  hits as (
    select b.*, case when nullif(par.q, '') is null then 0
                     when length(par.qc) >= 5 and strpos(b._t, par.qc) > 0 and (compacto(b.documento) = par.qc or compacto(b.ruc) = par.qc or compacto(b.telefono) = par.qc) then 1000
                     else puntaje_busqueda(b._n, b._t, par.q, par.tk) end as _score
      from base b, par
     where nullif(par.q, '') is null or coincide_busqueda(b._t, par.tk)
  ),
  pag as (
    select * from hits
     order by _score desc, creado_at desc, id
     limit least(greatest(coalesce(p_limit, 25), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(pag) - '_n' - '_t' - '_score' order by _score desc, creado_at desc, id) from pag), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
               'clientes', count(*),
               'activos', count(*) filter (where c.activo),
               'empresas', count(*) filter (where c.tipo_cliente = 'empresa'),
               'con_deuda', count(*) filter (where coalesce(f.deuda, 0) > 0),
               'a_cobrar', coalesce(sum(f.deuda), 0),
               'vencido', coalesce(sum(f.vencido), 0))
               from clientes c left join cif f on f.cliente_id = c.id
              where c.empresa_id = empresa_actual() and c.deleted_at is null)
  )
  );
end;
$$;
grant execute on function :"schema".listar_clientes(text, text, text, text, text, text, uuid, integer, integer) to authenticated, service_role;

-- ── Vista previa de eliminación (lo que arrastra borrar al cliente) ─────────
create or replace function :"schema".cliente_eliminar_preview(p_cliente uuid)
returns jsonb
language sql stable security invoker set search_path = :"schema", public as $$
  select jsonb_build_object(
    'ventas', (select count(*) from ventas where cliente_id = p_cliente and empresa_id = empresa_actual() and estado <> 'anulada'),
    'deuda', (select coalesce(sum(saldo), 0) from cuentas_por_cobrar where cliente_id = p_cliente and empresa_id = empresa_actual() and estado in ('pendiente', 'parcial')),
    'cobros', (select count(*) from cobros_clientes where cliente_id = p_cliente and empresa_id = empresa_actual() and anulado_at is null),
    'saldo_favor', saldo_favor_cliente(p_cliente),
    'contactos', (select count(*) from cliente_contactos where cliente_id = p_cliente and empresa_id = empresa_actual()),
    'notas', (select count(*) from cliente_notas where cliente_id = p_cliente and empresa_id = empresa_actual())
  )
$$;
grant execute on function :"schema".cliente_eliminar_preview(uuid) to authenticated, service_role;
