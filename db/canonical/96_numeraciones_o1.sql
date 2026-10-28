-- =============================================================================
-- 96 · Numeraciones O(1): el patrón de la 95 (ventas) para todas las demás.
--
-- Hasta acá, cada alta calculaba "el mayor número usado" recorriendo su tabla:
--   · con contador (secuencias_producto vía reservar_secuencia / inv_numero) el recorrido
--     es el "piso" (por si alguien cargó números a mano): greatest(contador, mayor) + 1 →
--     compras (COMP-), órdenes de compra (OC-), recibos (REC-), órdenes de pago (OP-),
--     presupuestos (PRE-, también al duplicar), gastos (GS-), traslados (TR-) y remisiones
--     (EEE-PPP-NNNNNNN por establecimiento-punto), ajustes / pérdidas (AJ- / PE-, también la
--     importación de productos), movimientos de caja (MC-), turnos de caja y pedidos QR;
--   · sin contador (lock + max + 1): pedidos de mostrador, tickets de soporte, CRM- y PRY-.
-- Ahora el "mayor número usado" se lee de numeracion_maximos (una tabla genérica:
-- empresa + familia + serie), mantenida por UN trigger genérico en cada tabla, en la
-- misma transacción (alta, cambio de número / empresa / serie, borrado —si se borra el
-- mayor se recalcula— y truncate). numeracion_max() lo devuelve; si falta la fila, la
-- arma contando como antes (mismo resultado). En cada función solo se reemplaza el
-- recorrido por numeracion_max(...): misma firma, mismo formato, mismo lock, mismo
-- resultado (reintentos, rollback sin hueco y números de inicio siguen igual).
--
-- No entra: mesa_cuenta_partes (numero por división, ya va por el índice único
-- (division_id, numero)) y ventas (la 95).
-- IDEMPOTENTE. Va después de la 95.
-- =============================================================================

set search_path to :"schema", public;

-- ── Familias: de dónde sale cada "mayor número" (misma expresión que la función vieja) ──
--   modo 'entero' : max(columna)
--   modo 'sufijo' : max(substring(columna from '[0-9]+$')::bigint)
--   modo 'mc'     : ídem, solo las filas con columna ~ '^MC-[0-9]+$'
--   serie 'col'   : una fila por valor de serie_col (… and serie_col = serie)
--   serie 'like'  : una fila por serie (… and columna like serie || '-%')
create table if not exists :"schema".numeracion_familias (
  familia text primary key,
  tabla text not null,
  columna text not null,
  modo text not null check (modo in ('entero', 'sufijo', 'mc')),
  serie_modo text not null default '' check (serie_modo in ('', 'col', 'like')),
  serie_col text
);
alter table :"schema".numeracion_familias enable row level security;
revoke all on :"schema".numeracion_familias from public, anon, authenticated;
grant all on :"schema".numeracion_familias to service_role;

insert into :"schema".numeracion_familias (familia, tabla, columna, modo, serie_modo, serie_col) values
  ('compras.numero_control',        'compras',            'numero_control', 'sufijo', '', null),
  ('ordenes_compra.numero_oc',      'ordenes_compra',     'numero_oc',      'sufijo', '', null),
  ('cobros_clientes.numero_recibo', 'cobros_clientes',    'numero_recibo',  'sufijo', '', null),
  ('pagos_proveedores.numero',      'pagos_proveedores',  'numero',         'sufijo', '', null),
  ('presupuestos.numero',           'presupuestos',       'numero',         'sufijo', '', null),
  ('gastos.numero',                 'gastos',             'numero',         'sufijo', '', null),
  ('traslados.numero',              'traslados',          'numero',         'sufijo', '', null),
  ('traslados.remision_numero',     'traslados',          'remision_numero','sufijo', 'like', null),
  ('ajustes_inventario.numero',     'ajustes_inventario', 'numero',         'sufijo', 'col', 'tipo'),
  ('caja_movimientos.numero',       'caja_movimientos',   'numero',         'mc',     '', null),
  ('cajas.numero_caja',             'cajas',              'numero_caja',    'entero', '', null),
  ('mesa_pedidos.numero',           'mesa_pedidos',       'numero',         'entero', '', null),
  ('pedidos_mostrador.numero',      'pedidos_mostrador',  'numero',         'entero', '', null),
  ('soporte_tickets.numero',        'soporte_tickets',    'numero',         'entero', '', null),
  ('crm_prospectos.numero_control', 'crm_prospectos',     'numero_control', 'sufijo', '', null),
  ('proyectos.numero',              'proyectos',          'numero',         'sufijo', '', null)
on conflict (familia) do update
  set tabla = excluded.tabla, columna = excluded.columna, modo = excluded.modo,
      serie_modo = excluded.serie_modo, serie_col = excluded.serie_col;

-- ── Mayor número usado por empresa / familia / serie ('' = sin serie); null = ninguno ──
create table if not exists :"schema".numeracion_maximos (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  familia text not null references :"schema".numeracion_familias(familia) on delete cascade,
  serie text not null default '',
  ultimo bigint,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, familia, serie)
);
alter table :"schema".numeracion_maximos enable row level security;
revoke all on :"schema".numeracion_maximos from public, anon, authenticated;
grant all on :"schema".numeracion_maximos to service_role;

-- Valor de una fila según el modo (null = no cuenta). ok = false si el número no entra en
-- bigint (la función vieja fallaba al contar: se deja que la cuenta falle igual).
create or replace function :"schema".numeracion_valor(p_modo text, p_txt text, out v bigint, out ok boolean)
language plpgsql immutable parallel safe as $$
declare d text;
begin
  ok := true;
  if p_txt is null then return; end if;
  if p_modo = 'entero' then v := p_txt::bigint; return; end if;
  if p_modo = 'mc' and p_txt !~ '^MC-[0-9]+$' then return; end if;
  d := substring(p_txt from '[0-9]+$');
  if d is null then return; end if;
  if length(d) <= 18 then v := d::bigint; return; end if;
  begin
    v := d::bigint;
  exception when numeric_value_out_of_range then
    v := null; ok := false;
  end;
end;
$$;

-- Cuenta como la función vieja (solo para inicializar / recalcular).
create or replace function :"schema".numeracion_contar(p_empresa uuid, p_familia text, p_serie text default '')
returns bigint language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  f numeracion_familias;
  v_sql text;
  v bigint;
begin
  select * into f from numeracion_familias where familia = p_familia;
  if not found then raise exception 'Numeración desconocida: %', p_familia; end if;
  v_sql := format('select max(%s) from %I.%I x where x.empresa_id = $1',
                  case f.modo when 'entero' then format('x.%I::bigint', f.columna)
                              else format('substring(x.%I from ''[0-9]+$'')::bigint', f.columna) end,
                  current_schema(), f.tabla)
        || case when f.modo = 'mc' then format(' and x.%I ~ ''^MC-[0-9]+$''', f.columna) else '' end
        || case f.serie_modo when 'col' then format(' and x.%I = $2', f.serie_col)
                             when 'like' then format(' and x.%I like $2 || ''-%%''', f.columna) else '' end;
  execute v_sql into v using p_empresa, p_serie;
  return v;
end;
$fn$;
revoke execute on function :"schema".numeracion_contar(uuid, text, text) from public, anon, authenticated;

create or replace function :"schema".numeracion_asegurar(p_empresa uuid, p_familia text, p_serie text default '')
returns void language plpgsql volatile security definer set search_path = :"schema", public as $fn$
begin
  if p_empresa is null or p_serie is null then return; end if;
  if not exists (select 1 from numeracion_maximos n
                  where n.empresa_id = p_empresa and n.familia = p_familia and n.serie = p_serie) then
    insert into numeracion_maximos (empresa_id, familia, serie, ultimo)
    values (p_empresa, p_familia, p_serie, numeracion_contar(p_empresa, p_familia, p_serie))
    on conflict (empresa_id, familia, serie) do nothing;
  end if;
end;
$fn$;
revoke execute on function :"schema".numeracion_asegurar(uuid, text, text) from public, anon, authenticated;

-- Lo que devolvía el recorrido de la función vieja ("el mayor número usado"), en O(1).
-- Desde la app solo para la empresa de la sesión (los SECURITY DEFINER y el servicio, todas).
create or replace function :"schema".numeracion_max(p_empresa uuid, p_familia text, p_serie text default '')
returns bigint language plpgsql volatile security definer set search_path = :"schema", public as $fn$
declare
  v bigint;
  v_emp uuid;
begin
  v_emp := empresa_actual();
  if v_emp is not null and p_empresa is distinct from v_emp then
    raise exception 'Numeración de otra empresa' using errcode = '42501';
  end if;
  select n.ultimo into v from numeracion_maximos n
   where n.empresa_id = p_empresa and n.familia = p_familia and n.serie = coalesce(p_serie, '');
  if found then return v; end if;
  perform numeracion_asegurar(p_empresa, p_familia, coalesce(p_serie, ''));
  -- Otra sesión pudo crearla a la vez: se lee lo confirmado (sentencia nueva).
  select n.ultimo into v from numeracion_maximos n
   where n.empresa_id = p_empresa and n.familia = p_familia and n.serie = coalesce(p_serie, '');
  return v;
end;
$fn$;
revoke execute on function :"schema".numeracion_max(uuid, text, text) from public, anon;
grant execute on function :"schema".numeracion_max(uuid, text, text) to authenticated, service_role;

-- Trigger genérico (AFTER, por fila). TG_ARGV[0] = familia.
create or replace function :"schema".tg_numeracion_maximos()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  f numeracion_familias;
  o jsonb;
  n jsonb;
  e_old uuid; e_new uuid;
  v_old bigint; v_new bigint;
  ok_old boolean := true; ok_new boolean := true;
  s_old text; s_new text;
  t_old text; t_new text;
  r record;
begin
  select * into f from numeracion_familias where familia = tg_argv[0];
  if tg_op = 'TRUNCATE' then
    delete from numeracion_maximos where familia = f.familia;
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    o := to_jsonb(old);
    e_old := (o->>'empresa_id')::uuid;
    t_old := o->>f.columna;
    select x.v, x.ok into v_old, ok_old from numeracion_valor(f.modo, t_old) x;
    s_old := case f.serie_modo when 'col' then o->>f.serie_col when '' then '' end;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    n := to_jsonb(new);
    e_new := (n->>'empresa_id')::uuid;
    t_new := n->>f.columna;
    select x.v, x.ok into v_new, ok_new from numeracion_valor(f.modo, t_new) x;
    s_new := case f.serie_modo when 'col' then n->>f.serie_col when '' then '' end;
  end if;
  if tg_op = 'UPDATE' and e_old is not distinct from e_new and t_old is not distinct from t_new
     and s_old is not distinct from s_new then
    return null;
  end if;

  -- Sale un número: si era el mayor de su fila, se bloquea y se recalcula (foto nueva).
  if tg_op in ('UPDATE', 'DELETE') and v_old is not null then
    for r in
      select m.serie from numeracion_maximos m
       where m.empresa_id = e_old and m.familia = f.familia and v_old >= m.ultimo
         and case f.serie_modo when 'like' then t_old like m.serie || '-%' else m.serie = s_old end
       for update
    loop
      update numeracion_maximos m set ultimo = numeracion_contar(e_old, f.familia, r.serie), updated_at = now()
       where m.empresa_id = e_old and m.familia = f.familia and m.serie = r.serie;
    end loop;
  end if;

  -- Entra un número.
  if tg_op in ('INSERT', 'UPDATE') and t_new is not null then
    if not ok_new then
      -- No entra en bigint: que la próxima cuenta se haga como antes (y falle igual).
      delete from numeracion_maximos m
       where m.empresa_id = e_new and m.familia = f.familia
         and case f.serie_modo when 'like' then t_new like m.serie || '-%' else m.serie = s_new end;
      return null;
    end if;
    if v_new is not null then
      if f.serie_modo = 'like' then
        if t_new like '%-%' then
          perform numeracion_asegurar(e_new, f.familia, regexp_replace(t_new, '-[^-]*$', ''));
        end if;
      elsif s_new is not null then
        perform numeracion_asegurar(e_new, f.familia, s_new);
      end if;
      update numeracion_maximos m set ultimo = v_new, updated_at = now()
       where m.empresa_id = e_new and m.familia = f.familia
         and case f.serie_modo when 'like' then t_new like m.serie || '-%' else m.serie = s_new end
         and (m.ultimo is null or v_new > m.ultimo);
    end if;
  end if;
  return null;
end;
$fn$;
revoke execute on function :"schema".tg_numeracion_maximos() from public, anon, authenticated;

-- Triggers en cada tabla (columnas: número, empresa y serie).
do $do$
declare
  f record;
begin
  for f in select * from numeracion_familias loop
    execute format('drop trigger if exists %I on %I.%I', 'trg_num_' || replace(f.familia, '.', '_'), current_schema(), f.tabla);
    execute format('create trigger %I after insert or delete or update of %s on %I.%I for each row execute function %I.tg_numeracion_maximos(%L)',
                   'trg_num_' || replace(f.familia, '.', '_'),
                   array_to_string(array(select distinct quote_ident(c) from unnest(array[f.columna, 'empresa_id', f.serie_col]) c where c is not null), ', '),
                   current_schema(), f.tabla, current_schema(), f.familia);
    execute format('drop trigger if exists %I on %I.%I', 'trg_num_' || replace(f.familia, '.', '_') || '_tr', current_schema(), f.tabla);
    execute format('create trigger %I after truncate on %I.%I for each statement execute function %I.tg_numeracion_maximos(%L)',
                   'trg_num_' || replace(f.familia, '.', '_') || '_tr', current_schema(), f.tabla, current_schema(), f.familia);
  end loop;
end;
$do$;

-- Inicializar / corregir: una fila por empresa y familia (y por serie existente), siempre
-- contando (re-aplicar la receta corrige cualquier diferencia).
do $do$
declare
  f record;
  e record;
  s text;
begin
  for f in select * from numeracion_familias loop
    for e in select id from empresas loop
      for s in
        select '' where f.serie_modo = ''
        union
        select x.serie from numeracion_maximos x where x.empresa_id = e.id and x.familia = f.familia and f.serie_modo <> ''
      loop
        insert into numeracion_maximos (empresa_id, familia, serie, ultimo)
        values (e.id, f.familia, s, numeracion_contar(e.id, f.familia, s))
        on conflict (empresa_id, familia, serie) do update set ultimo = excluded.ultimo, updated_at = now()
          where numeracion_maximos.ultimo is distinct from excluded.ultimo;
      end loop;
    end loop;
  end loop;
end;
$do$;
-- Series existentes: tipos de ajuste y establecimiento-punto de las remisiones.
do $do$
declare r record;
begin
  for r in select distinct empresa_id, tipo as serie from ajustes_inventario where tipo is not null loop
    perform numeracion_asegurar(r.empresa_id, 'ajustes_inventario.numero', r.serie);
  end loop;
  for r in select distinct empresa_id, regexp_replace(remision_numero, '-[^-]*$', '') as serie
             from traslados where remision_numero like '%-%' loop
    perform numeracion_asegurar(r.empresa_id, 'traslados.remision_numero', r.serie);
  end loop;
end;
$do$;

-- ── Las funciones: el recorrido se reemplaza por numeracion_max (nada más cambia) ──────
-- Se reescribe la definición vigente; cada patrón tiene que aparecer las veces esperadas.
do $do$
declare
  c record;
  v_oid regprocedure;
  v_def text;
  v_nueva text;
  v_n integer;
begin
  for c in
    select * from (values
      -- (función, patrón (regex), reemplazo, apariciones)
      ('abrir_caja(uuid,numeric,text)',
       '\(select max\(numero_caja\) from cajas where empresa_id = s\.s_empresa\)',
       'numeracion_max(s.s_empresa, ''cajas.numero_caja'')', 1),
      ('registrar_movimiento_caja(jsonb)',
       '\(\s*select max\(substring\(numero from ''\[0-9\]\+\$''\)::bigint\) from caja_movimientos where empresa_id = s\.s_empresa and numero ~ ''\^MC-\[0-9\]\+\$''\)',
       '(numeracion_max(s.s_empresa, ''caja_movimientos.numero''))', 1),
      ('confirmar_gasto(jsonb)',
       '\(\s*select max\(substring\(numero from ''\[0-9\]\+\$''\)::bigint\) from gastos where empresa_id = v_emp and numero is not null\)',
       '(numeracion_max(v_emp, ''gastos.numero''))', 1),
      ('crear_traslado(jsonb)',
       '\(select max\(substring\(t\.numero from ''\[0-9\]\+\$''\)::bigint\) from traslados t where t\.empresa_id = v_empresa\)',
       'numeracion_max(v_empresa, ''traslados.numero'')', 1),
      ('crear_traslado(jsonb)',
       '\(select max\(substring\(t\.remision_numero from ''\[0-9\]\+\$''\)::bigint\) from traslados t\s+where t\.empresa_id = v_empresa and t\.remision_numero like v_est \|\| ''-'' \|\| v_pto \|\| ''-%''\)',
       'numeracion_max(v_empresa, ''traslados.remision_numero'', v_est || ''-'' || v_pto)', 1),
      ('guardar_orden_compra(jsonb)',
       '\(\s*select max\(substring\(numero_oc from ''\[0-9\]\+\$''\)::bigint\) from ordenes_compra where empresa_id = v_empresa\)',
       '(numeracion_max(v_empresa, ''ordenes_compra.numero_oc''))', 1),
      ('guardar_presupuesto(jsonb)',
       '\(\s*select max\(substring\(numero from ''\[0-9\]\+\$''\)::bigint\) from presupuestos where empresa_id = v_emp\)',
       '(numeracion_max(v_emp, ''presupuestos.numero''))', 1),
      ('presupuesto_duplicar(uuid)',
       '\(\s*select max\(substring\(numero from ''\[0-9\]\+\$''\)::bigint\) from presupuestos where empresa_id = v_u\.empresa_id\)',
       '(numeracion_max(v_u.empresa_id, ''presupuestos.numero''))', 1),
      ('registrar_ajuste(jsonb)',
       '\(select max\(substring\(x\.numero from ''\[0-9\]\+\$''\)::bigint\) from ajustes_inventario x\s+where x\.empresa_id = v_empresa and x\.tipo = v_tipo\)',
       'numeracion_max(v_empresa, ''ajustes_inventario.numero'', v_tipo)', 1),
      ('aplicar_importacion_productos(jsonb,text,boolean,text,text,uuid,uuid)',
       '\(select max\(substring\(x\.numero from ''\[0-9\]\+\$''\)::bigint\)\s+from ajustes_inventario x where x\.empresa_id = v_empresa and x\.tipo = ''ajuste''\)',
       'numeracion_max(v_empresa, ''ajustes_inventario.numero'', ''ajuste'')', 1),
      ('registrar_cobro(jsonb)',
       '\(\s*select max\(substring\(numero_recibo from ''\[0-9\]\+\$''\)::bigint\) from cobros_clientes where empresa_id = v_empresa\)',
       '(numeracion_max(v_empresa, ''cobros_clientes.numero_recibo''))', 1),
      ('registrar_compra(jsonb)',
       '\(\s*select max\(substring\(numero_control from ''\[0-9\]\+\$''\)::bigint\) from compras where empresa_id = v_empresa\)',
       '(numeracion_max(v_empresa, ''compras.numero_control''))', 1),
      ('registrar_pago_proveedor(jsonb)',
       '\(\s*select max\(substring\(numero from ''\[0-9\]\+\$''\)::bigint\) from pagos_proveedores where empresa_id = v_empresa\)',
       '(numeracion_max(v_empresa, ''pagos_proveedores.numero''))', 1),
      ('mesa_pedido_publico_crear(text,jsonb,text,text)',
       '\(select coalesce\(max\(numero\), 0\) from mesa_pedidos where empresa_id = m\.empresa_id\)',
       'coalesce(numeracion_max(m.empresa_id, ''mesa_pedidos.numero''), 0)', 1),
      ('pedido_mostrador_guardar(jsonb)',
       'select coalesce\(max\(numero\), 0\) \+ 1 into v_numero from pedidos_mostrador where empresa_id = s\.s_empresa;',
       'v_numero := coalesce(numeracion_max(s.s_empresa, ''pedidos_mostrador.numero''), 0) + 1;', 1),
      ('tg_soporte_tickets_numero()',
       'select coalesce\(max\(numero\), 0\) \+ 1 into new\.numero from soporte_tickets where empresa_id = new\.empresa_id;',
       'new.numero := coalesce(numeracion_max(new.empresa_id, ''soporte_tickets.numero''), 0) + 1;', 1),
      ('tg_crm_prospectos()',
       'select ''CRM-'' \|\| lpad\(\(coalesce\(max\(substring\(numero_control from ''\[0-9\]\+\$''\)::bigint\), 0\) \+ 1\)::text, 6, ''0''\)\s+into new\.numero_control from crm_prospectos where empresa_id = new\.empresa_id;',
       'new.numero_control := ''CRM-'' || lpad((coalesce(numeracion_max(new.empresa_id, ''crm_prospectos.numero_control''), 0) + 1)::text, 6, ''0'');', 1),
      ('tg_proyectos()',
       'select ''PRY-'' \|\| lpad\(\(coalesce\(max\(substring\(numero from ''\[0-9\]\+\$''\)::bigint\), 0\) \+ 1\)::text, 5, ''0''\)\s+into new\.numero from proyectos where empresa_id = new\.empresa_id;',
       'new.numero := ''PRY-'' || lpad((coalesce(numeracion_max(new.empresa_id, ''proyectos.numero''), 0) + 1)::text, 5, ''0'');', 1)
    ) x(fn, patron, reemplazo, veces)
  loop
    v_oid := (current_schema() || '.' || c.fn)::regprocedure;
    v_def := pg_get_functiondef(v_oid);
    v_n := regexp_count(v_def, c.patron);
    if v_n = 0 and position(split_part(split_part(c.reemplazo, '''', 2), '''', 1) in v_def) > 0 then
      continue;  -- ya adaptada
    end if;
    if v_n <> c.veces then
      raise exception '96: % — el recorrido aparece % veces (se esperaba %)', c.fn, v_n, c.veces;
    end if;
    v_nueva := regexp_replace(v_def, c.patron, c.reemplazo, 'g');
    execute v_nueva;
    raise notice '96: % → numeracion_max', v_oid;
  end loop;
end;
$do$;

-- Que no quede ninguna con el recorrido viejo.
do $do$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = current_schema() and p.prokind = 'f'
     and p.proname not in ('numeracion_contar', 'venta_numeracion_contar', 'mesa_cuenta_parte_cobrar_caja')
     and pg_get_functiondef(p.oid) ~ 'max\((substring\()?(numero|numero_control|numero_oc|numero_recibo|numero_caja|remision_numero)\M';
  if v is not null then raise exception '96: siguen recorriendo la tabla: %', v; end if;
end;
$do$;

reset search_path;
