-- =============================================================================
-- NÚMERO FISCAL DEL AUTOIMPRESOR (pedido del dueño 29-oct-2026, requisito del RG 90 de ventas).
--
-- Cada factura de una empresa en modo "autoimpresor" guarda, al emitirse, su número
-- ###-###-####### y el timbrado con su vigencia. Lo mismo la nota de crédito de una factura con
-- número. Se asigna por trigger para cubrir todos los caminos (crear_venta, emitir_factura_contado,
-- emitir_cuota_suscripcion, pedidos de mesa). La numeración es sin huecos: si la venta falla, el
-- contador vuelve atrás con la transacción. La factura anulada conserva su número.
--
--   · Punto de expedición: casa central → el de Configuración › Facturación; otra sucursal → el
--     suyo (sucursales.establecimiento / punto_expedicion). Todas usan el mismo timbrado y rango.
--   · Contadores: el punto de la configuración usa numero_actual / nc_numero_actual (= el PRÓXIMO
--     número); los demás, facturas_numeracion (factura desde numero_inicial, NC desde 1).
--   · Bloquea: autoimpresor inactivo, timbrado fuera de vigencia, rango terminado, sucursal sin
--     códigos. La NC de una venta sin número (ticket, factura anterior) queda sin número fiscal.
--
-- IDEMPOTENTE. Va después de 100.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table :"schema".facturacion_autoimpresor add column if not exists nc_numero_actual bigint not null default 1;

alter table :"schema".ventas
  add column if not exists fiscal_numero text,
  add column if not exists fiscal_timbrado text,
  add column if not exists fiscal_vigencia_desde date,
  add column if not exists fiscal_vigencia_hasta date;

alter table :"schema".notas_credito
  add column if not exists fiscal_numero text,
  add column if not exists fiscal_timbrado text,
  add column if not exists fiscal_vigencia_desde date,
  add column if not exists fiscal_vigencia_hasta date;

create unique index if not exists ventas_fiscal_unico
  on :"schema".ventas (empresa_id, fiscal_timbrado, fiscal_numero) where fiscal_numero is not null;
create unique index if not exists notas_credito_fiscal_unico
  on :"schema".notas_credito (empresa_id, fiscal_timbrado, fiscal_numero) where fiscal_numero is not null;

-- Contadores de los puntos de expedición que no son el de la configuración.
create table if not exists :"schema".facturas_numeracion (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  timbrado text not null,
  establecimiento text not null,
  punto text not null,
  documento text not null check (documento in ('factura', 'nc')),
  siguiente bigint not null,
  primary key (empresa_id, timbrado, establecimiento, punto, documento)
);
alter table :"schema".facturas_numeracion enable row level security;
alter table :"schema".facturas_numeracion force row level security;
revoke all on :"schema".facturas_numeracion from anon, authenticated;
grant all on :"schema".facturas_numeracion to service_role;

-- Último número usado de un timbrado y punto (null si no hay): protege de bajar un contador.
create or replace function :"schema".fiscal_ultimo(p_empresa uuid, p_timbrado text, p_prefijo text, p_doc text)
returns bigint language plpgsql stable security definer set search_path = :"schema", public as $$
declare
  v text;
begin
  if p_doc = 'factura' then
    select max(x.fiscal_numero) into v from ventas x
     where x.empresa_id = p_empresa and x.fiscal_timbrado = p_timbrado and x.fiscal_numero like p_prefijo || '-%';
  else
    select max(x.fiscal_numero) into v from notas_credito x
     where x.empresa_id = p_empresa and x.fiscal_timbrado = p_timbrado and x.fiscal_numero like p_prefijo || '-%';
  end if;
  return right(v, 7)::bigint;
end;
$$;

-- Toma el próximo número. Bloquea la fila del autoimpresor: dos cajas no reciben el mismo.
create or replace function :"schema".fiscal_asignar(p_empresa uuid, p_sucursal uuid, p_fecha date, p_doc text)
returns table (f_numero text, f_timbrado text, f_desde date, f_hasta date)
language plpgsql security definer set search_path = :"schema", public as $$
declare
  a facturacion_autoimpresor;
  v_suc record;
  v_est text;
  v_pto text;
  v_n bigint;
begin
  select * into a from facturacion_autoimpresor x where x.empresa_id = p_empresa for update;
  if not found or not a.activo then
    raise exception 'El autoimpresor no está activo: completá el timbrado en Configuración › Facturación o emití ticket.';
  end if;
  if a.timbrado_numero is null or a.timbrado_fin_vigencia is null then
    raise exception 'Falta el timbrado o su vigencia: completalo en Configuración › Facturación o emití ticket.';
  end if;
  if p_fecha > a.timbrado_fin_vigencia then
    raise exception 'El timbrado % venció el %: cargá el nuevo en Configuración › Facturación o emití ticket.',
      a.timbrado_numero, to_char(a.timbrado_fin_vigencia, 'DD/MM/YYYY');
  end if;
  if a.timbrado_inicio_vigencia is not null and p_fecha < a.timbrado_inicio_vigencia then
    raise exception 'El timbrado % recién rige desde el %: emití ticket hasta esa fecha.',
      a.timbrado_numero, to_char(a.timbrado_inicio_vigencia, 'DD/MM/YYYY');
  end if;

  select s.nombre, s.es_principal, s.establecimiento, s.punto_expedicion into v_suc
    from sucursales s where s.id = coalesce(p_sucursal, sucursal_principal(p_empresa));
  if coalesce(v_suc.es_principal, true) then
    v_est := a.establecimiento_codigo;
    v_pto := a.punto_expedicion_codigo;
  else
    v_est := v_suc.establecimiento;
    v_pto := v_suc.punto_expedicion;
  end if;
  if nullif(btrim(v_est), '') is null or nullif(btrim(v_pto), '') is null then
    raise exception 'La sucursal % no tiene establecimiento y punto de expedición: cargalos antes de facturar.', coalesce(v_suc.nombre, '');
  end if;
  v_est := lpad(btrim(v_est), 3, '0');
  v_pto := lpad(btrim(v_pto), 3, '0');

  if v_est = lpad(btrim(a.establecimiento_codigo), 3, '0') and v_pto = lpad(btrim(a.punto_expedicion_codigo), 3, '0') then
    v_n := case when p_doc = 'factura' then a.numero_actual else a.nc_numero_actual end;
  else
    insert into facturas_numeracion as x (empresa_id, timbrado, establecimiento, punto, documento, siguiente)
    values (p_empresa, a.timbrado_numero, v_est, v_pto, p_doc, case when p_doc = 'factura' then a.numero_inicial else 1 end + 1)
    on conflict (empresa_id, timbrado, establecimiento, punto, documento) do update set siguiente = x.siguiente + 1
    returning x.siguiente - 1 into v_n;
  end if;

  if p_doc = 'factura' and v_n > a.numero_final then
    raise exception 'Se terminó el rango del timbrado %: la última factura habilitada es la N° %. Cargá el rango nuevo en Configuración › Facturación o emití ticket.',
      a.timbrado_numero, a.numero_final;
  end if;
  if v_n > 9999999 then
    raise exception 'El número fiscal no puede pasar de 7 dígitos: revisá el rango en Configuración › Facturación.';
  end if;

  if v_est = lpad(btrim(a.establecimiento_codigo), 3, '0') and v_pto = lpad(btrim(a.punto_expedicion_codigo), 3, '0') then
    if p_doc = 'factura' then
      update facturacion_autoimpresor x set numero_actual = v_n + 1 where x.empresa_id = p_empresa;
    else
      update facturacion_autoimpresor x set nc_numero_actual = v_n + 1 where x.empresa_id = p_empresa;
    end if;
  end if;

  return query select v_est || '-' || v_pto || '-' || lpad(v_n::text, 7, '0'), a.timbrado_numero,
                      a.timbrado_inicio_vigencia, a.timbrado_fin_vigencia;
end;
$$;

create or replace function :"schema".tg_ventas_fiscal()
returns trigger language plpgsql security definer set search_path = :"schema", public as $$
declare
  f record;
begin
  if new.tipo_documento is distinct from 'factura' then return new; end if;
  if (select c.modo from facturacion_config c where c.empresa_id = new.empresa_id) is distinct from 'autoimpresor' then return new; end if;
  select * into f from fiscal_asignar(new.empresa_id, new.sucursal_id, (coalesce(new.fecha, now()) at time zone 'America/Asuncion')::date, 'factura');
  new.fiscal_numero := f.f_numero;
  new.fiscal_timbrado := f.f_timbrado;
  new.fiscal_vigencia_desde := f.f_desde;
  new.fiscal_vigencia_hasta := f.f_hasta;
  return new;
end;
$$;

-- "z": corre después de trg_ventas_receptor (sin RUC no hay factura) y no gasta un número si rechaza.
drop trigger if exists trg_ventas_z_fiscal on :"schema".ventas;
create trigger trg_ventas_z_fiscal before insert on :"schema".ventas
  for each row execute function :"schema".tg_ventas_fiscal();

create or replace function :"schema".tg_notas_credito_fiscal()
returns trigger language plpgsql security definer set search_path = :"schema", public as $$
declare
  f record;
begin
  if (select v.fiscal_numero from ventas v where v.id = new.venta_id) is null then return new; end if;
  if (select c.modo from facturacion_config c where c.empresa_id = new.empresa_id) is distinct from 'autoimpresor' then return new; end if;
  if not coalesce((select a.activo from facturacion_autoimpresor a where a.empresa_id = new.empresa_id), false) then return new; end if;
  select * into f from fiscal_asignar(new.empresa_id, new.sucursal_id, (coalesce(new.fecha, now()) at time zone 'America/Asuncion')::date, 'nc');
  new.fiscal_numero := f.f_numero;
  new.fiscal_timbrado := f.f_timbrado;
  new.fiscal_vigencia_desde := f.f_desde;
  new.fiscal_vigencia_hasta := f.f_hasta;
  return new;
end;
$$;

drop trigger if exists trg_notas_credito_fiscal on :"schema".notas_credito;
create trigger trg_notas_credito_fiscal before insert on :"schema".notas_credito
  for each row execute function :"schema".tg_notas_credito_fiscal();

revoke all on function :"schema".fiscal_ultimo(uuid, text, text, text) from public, anon, authenticated;
revoke all on function :"schema".fiscal_asignar(uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function :"schema".tg_ventas_fiscal() from public, anon, authenticated;
revoke all on function :"schema".tg_notas_credito_fiscal() from public, anon, authenticated;

-- Parches a funciones vivas: guardar y leer el contador de NC, buscar por número fiscal.
do $do$
declare
  v_def text;
  v_nuevo text;
  v_par text[];
begin
  -- guardar_autoimpresor
  v_def := pg_get_functiondef('guardar_autoimpresor(jsonb)'::regprocedure);
  if v_def not like '%nc_numero_actual%' then
    v_nuevo := v_def;
    foreach v_par slice 1 in array array[
      ['v_fin_txt text;', E'v_fin_txt text;\n  v_ult bigint;\n  v_prefijo text;'],
      ['a.numero_final := nullif(p->>''numero_final'', '''')::bigint;',
       E'a.numero_final := nullif(p->>''numero_final'', '''')::bigint;\n  a.nc_numero_actual := coalesce(nullif(p->>''nc_numero_actual'', '''')::bigint, 1);'],
      ['raise exception ''Los números del rango deben ser desde 1''; end if;',
       E'raise exception ''Los números del rango deben ser desde 1''; end if;\n  if a.nc_numero_actual < 1 then raise exception ''El próximo número de nota de crédito debe ser desde 1''; end if;\n  if a.numero_final > 9999999 or a.numero_actual > 9999999 or a.nc_numero_actual > 9999999 then raise exception ''El número fiscal tiene hasta 7 dígitos''; end if;'],
      ['insert into facturacion_autoimpresor (',
       E'-- 101: no volver a usar un número ya emitido (ej. pantalla abierta desde antes de una venta).\n  if a.timbrado_numero is not null and a.establecimiento_codigo is not null and a.punto_expedicion_codigo is not null then\n    v_prefijo := lpad(btrim(a.establecimiento_codigo), 3, ''0'') || ''-'' || lpad(btrim(a.punto_expedicion_codigo), 3, ''0'');\n    v_ult := fiscal_ultimo(s.p_empresa, a.timbrado_numero, v_prefijo, ''factura'');\n    if a.numero_actual <= v_ult then\n      raise exception ''Ya se emitió la factura % de este timbrado: el próximo número tiene que ser mayor.'', v_prefijo || ''-'' || lpad(v_ult::text, 7, ''0'');\n    end if;\n    v_ult := fiscal_ultimo(s.p_empresa, a.timbrado_numero, v_prefijo, ''nc'');\n    if a.nc_numero_actual <= v_ult then\n      raise exception ''Ya se emitió la nota de crédito % de este timbrado: el próximo número tiene que ser mayor.'', v_prefijo || ''-'' || lpad(v_ult::text, 7, ''0'');\n    end if;\n  end if;\n\n  insert into facturacion_autoimpresor ('],
      ['numero_actual, numero_inicial, numero_final, tipo_documento_default,', 'numero_actual, nc_numero_actual, numero_inicial, numero_final, tipo_documento_default,'],
      ['a.numero_actual, a.numero_inicial, a.numero_final, a.tipo_documento_default,', 'a.numero_actual, a.nc_numero_actual, a.numero_inicial, a.numero_final, a.tipo_documento_default,'],
      ['numero_final = excluded.numero_final,', 'numero_final = excluded.numero_final, nc_numero_actual = excluded.nc_numero_actual,']
    ] loop
      if position(v_par[1] in v_nuevo) = 0 then raise exception 'guardar_autoimpresor: no se encontró %', v_par[1]; end if;
      v_nuevo := replace(v_nuevo, v_par[1], v_par[2]);
    end loop;
    execute v_nuevo;
  end if;

  -- config_facturacion
  v_def := pg_get_functiondef('config_facturacion()'::regprocedure);
  if v_def not like '%nc_numero_actual%' then
    if position('''numero_final'', a.numero_final,' in v_def) = 0 then raise exception 'config_facturacion: no se encontró numero_final'; end if;
    execute replace(v_def, '''numero_final'', a.numero_final,',
                    '''numero_final'', a.numero_final, ''nc_numero_actual'', coalesce(a.nc_numero_actual, 1),');
  end if;

  -- Buscar la venta por su número fiscal. Lo toma al insertarse los ítems (la fila ya existe).
  v_def := pg_get_functiondef('texto_busqueda_venta(uuid, text, text, text, text, uuid)'::regprocedure);
  if v_def not like '%fiscal_numero%' then
    if position('norm(p_numero), compacto(p_numero),' in v_def) = 0 then raise exception 'texto_busqueda_venta: no se encontró el número'; end if;
    execute replace(v_def, 'norm(p_numero), compacto(p_numero),',
                    'norm(p_numero), compacto(p_numero), (select compacto(fv.fiscal_numero) from ventas fv where fv.id = p_venta),');
  end if;

  -- Detalle de la NC: el número fiscal de la factura que corrige.
  v_def := pg_get_functiondef('nota_credito_detalle(uuid)'::regprocedure);
  if v_def not like '%fiscal_numero%' then
    if position('''numero_control'', v.numero_control,' in v_def) = 0 then raise exception 'nota_credito_detalle: no se encontró el número'; end if;
    execute replace(v_def, '''numero_control'', v.numero_control,',
                    '''numero_control'', v.numero_control, ''fiscal_numero'', v.fiscal_numero, ''fiscal_timbrado'', v.fiscal_timbrado,');
  end if;

  -- Lista de NC: mostrar y buscar por número fiscal.
  v_def := pg_get_functiondef('listar_notas_credito(date, date, text, text, integer, integer)'::regprocedure);
  if v_def not like '%fiscal_numero%' then
    v_nuevo := v_def;
    foreach v_par slice 1 in array array[
      ['''id'', f.id, ''numero'', f.numero,', '''id'', f.id, ''numero'', f.numero, ''fiscal_numero'', f.fiscal_numero,'],
      ['where v_q is null or lower(b.numero) like ''%'' || v_q || ''%''', 'where v_q is null or lower(b.numero) like ''%'' || v_q || ''%'' or b.fiscal_numero like ''%'' || v_q || ''%''']
    ] loop
      if position(v_par[1] in v_nuevo) = 0 then raise exception 'listar_notas_credito: no se encontró %', v_par[1]; end if;
      v_nuevo := replace(v_nuevo, v_par[1], v_par[2]);
    end loop;
    execute v_nuevo;
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
