-- =============================================================================
-- REGISTRO DE COMPROBANTES — RG 90/2021 (SET / DNIT, pedido del dueño 29-oct-2026).
--
-- Arma lo que va en el archivo de importación de Marangatu ("Especificación Técnica para
-- Importación — Registro de Comprobantes", SET jun-2021). Primera etapa: COMPRAS (tipo de
-- registro 2) — las compras de la lista unificada (receta 59) y los gastos operativos cargados
-- antes (tabla gastos). Las VENTAS (tipo 1) se suman cuando las facturas por autoimpresor
-- tengan su número fiscal; las electrónicas (SIFEN) NUNCA van: Marangatu ya las tiene.
--
-- rg90_compras(p_desde, p_hasta) → jsonb { ruc, desde, hasta, filas[], excluidos[] }
--   · filas: una por comprobante, con los campos YA en el formato de la SET: tipo de
--     identificación (11 RUC / 12 cédula) y número SIN dígito verificador, código de comprobante
--     (109 factura, 101 autofactura, 103 boleta, 111 nota de débito), fecha dd/mm/aaaa, timbrado,
--     número ###-###-#######, gravado 10 % / 5 % (IVA incluido), exento y total en guaraníes
--     (USD × tipo de cambio), condición 1 contado / 2 crédito, moneda extranjera S/N, si tiene
--     IVA crédito. `problemas` = lo que falta para que Marangatu lo acepte (sin RUC, sin
--     timbrado, número mal escrito…): esas filas NO van al archivo hasta corregirlas.
--   · excluidos: lo que no se registra y por qué (electrónica / virtual, recibo, sin
--     comprobante fiscal).
-- Permiso: "Ver reportes financieros" (rep_sesion).
--
-- IDEMPOTENTE. Va después de 99.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- Tipo de comprobante del ERP → código de la Tabla 4 de la SET (null = no se registra).
create or replace function :"schema".rg90_codigo_compra(p_tipo text)
returns integer language sql immutable as $$
  select case lower(btrim(coalesce(p_tipo, '')))
    when 'factura' then 109
    when 'autofactura' then 101
    when 'boleta' then 103
    when 'nota de débito' then 111
    when 'nota de debito' then 111
    else null end
$$;

-- "001-1-123" / "0010010000123" → "001-001-0000123" (o null si no se puede).
create or replace function :"schema".rg90_numero(p text)
returns text language plpgsql immutable as $$
declare
  v text := regexp_replace(coalesce(p, ''), '\s', '', 'g');
  m text[];
begin
  m := regexp_match(v, '^(\d{1,3})-(\d{1,3})-(\d{1,7})$');
  if m is not null then return lpad(m[1], 3, '0') || '-' || lpad(m[2], 3, '0') || '-' || lpad(m[3], 7, '0'); end if;
  m := regexp_match(v, '^(\d{3})(\d{3})(\d{7})$');
  if m is not null then return m[1] || '-' || m[2] || '-' || m[3]; end if;
  return null;
end;
$$;

create or replace function :"schema".rg90_compras(p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], null);
  select * into g from rep_rango(p_desde, p_hasta);

  with base as (
    -- Compras (mercadería, gastos y mixtas: receta 59)
    select 'compra'::text as origen, c.id, c.numero_control as documento,
           coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           coalesce(nullif(btrim(p.nombre), ''), c.proveedor_nombre) as proveedor, p.ruc as ruc,
           c.tipo_comprobante, c.con_comprobante, c.nro_timbrado as timbrado, c.numero_factura as numero,
           c.tipo_pago, c.moneda, coalesce(c.tipo_cambio, 1) as tc,
           coalesce(c.total_10, 0) as t10, coalesce(c.total_5, 0) as t5, coalesce(c.exenta, 0) as tex,
           coalesce(c.total, 0) as total, coalesce(c.iva_credito, 0) as iva_credito
      from compras c left join proveedores p on p.id = c.proveedor_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada'
       and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between g.r_desde and g.r_hasta
    union all
    -- Gastos operativos cargados antes de la lista unificada
    select 'gasto', x.id, x.numero, coalesce(x.fecha_comprobante, x.fecha, (x.created_at at time zone 'America/Asuncion')::date),
           coalesce(nullif(btrim(p.nombre), ''), x.proveedor_nombre), coalesce(nullif(btrim(x.proveedor_ruc), ''), p.ruc),
           x.tipo_comprobante, coalesce(x.con_comprobante, true), x.timbrado, x.numero_comprobante,
           x.tipo_pago, x.moneda, coalesce(x.tipo_cambio, 1),
           coalesce(x.total_10, 0), coalesce(x.total_5, 0), coalesce(x.exenta, 0), coalesce(x.total, 0),
           case when coalesce(x.deducible, true) then coalesce(x.iva_10, 0) + coalesce(x.iva_5, 0) else 0 end
      from gastos x left join proveedores p on p.id = x.proveedor_id
     where x.empresa_id = s.s_empresa and x.estado = 'confirmado'
       and coalesce(x.fecha_comprobante, x.fecha, (x.created_at at time zone 'America/Asuncion')::date) between g.r_desde and g.r_hasta
  ), armada as (
    select b.*,
           rg90_codigo_compra(b.tipo_comprobante) as codigo,
           lower(btrim(coalesce(b.tipo_comprobante, ''))) as tipo_l,
           nullif(regexp_replace(coalesce(b.ruc, ''), '[^0-9A-Za-z-]', '', 'g'), '') as ruc_l,
           regexp_replace(coalesce(b.timbrado, ''), '\D', '', 'g') as timbrado_l,
           rg90_numero(b.numero) as numero_l,
           case when b.moneda = 'USD' then b.tc else 1 end as fx
      from base b
  ), calc as (
    select a.*,
           case when a.ruc_l is null then null
                when position('-' in a.ruc_l) > 0 then 11
                when a.codigo = 101 then 12 else 11 end as tipo_ident,
           split_part(coalesce(a.ruc_l, ''), '-', 1) as ident,
           round(a.t10 * a.fx) as g10, round(a.t5 * a.fx) as g5, round(a.tex * a.fx) as gex,
           round(a.total * a.fx) as gtotal
      from armada a
  ), filas as (
    select c.*,
           -- Autofactura / boleta resimple…: solo el total (la SET pide 0 en los gravados).
           case when c.codigo = 101 then 0 else c.g10 end as m10,
           case when c.codigo = 101 then 0 else c.g5 end as m5,
           case when c.codigo = 101 then 0 else c.gex end as mex,
           case when c.codigo = 101 then c.gtotal else c.g10 + c.g5 + c.gex end as mtotal,
           array_remove(array[
             case when c.ruc_l is null then 'Falta el RUC del proveedor' end,
             case when c.timbrado_l = '' then 'Falta el timbrado'
                  when length(c.timbrado_l) <> 8 then 'El timbrado tiene que tener 8 dígitos' end,
             case when c.numero_l is null then 'El número tiene que ser 001-001-0000123' end,
             case when (case when c.codigo = 101 then c.gtotal else c.g10 + c.g5 + c.gex end) <= 0 then 'El total es cero' end,
             case when c.codigo = 111 then 'Nota de débito: falta la factura que corrige (cargala a mano en Marangatu)' end
           ], null) as problemas
      from calc c
     where c.con_comprobante and c.codigo is not null
  )
  select jsonb_build_object(
    'ruc', (select e->>'ruc' from (select datos_empresa() e) d),
    'desde', g.r_desde, 'hasta', g.r_hasta,
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'origen', f.origen, 'id', f.id, 'documento', f.documento, 'fecha', f.fecha,
        'proveedor', f.proveedor, 'ruc', f.ruc, 'tipo_comprobante', f.tipo_comprobante, 'codigo', f.codigo,
        'tipo_ident', f.tipo_ident, 'ident', f.ident, 'timbrado', f.timbrado_l, 'numero', coalesce(f.numero_l, f.numero),
        'gravado_10', f.m10, 'gravado_5', f.m5, 'exento', f.mex, 'total', f.mtotal,
        'condicion', case when f.tipo_pago = 'credito' then 2 else 1 end,
        'moneda_extranjera', f.moneda = 'USD', 'iva_credito', round(f.iva_credito * f.fx),
        'problemas', to_jsonb(f.problemas)) order by f.fecha, f.documento)
      from filas f), '[]'::jsonb),
    'excluidos', coalesce((select jsonb_agg(jsonb_build_object(
        'origen', c.origen, 'id', c.id, 'documento', c.documento, 'fecha', c.fecha, 'proveedor', c.proveedor,
        'tipo_comprobante', c.tipo_comprobante, 'total', c.gtotal,
        'motivo', case when not c.con_comprobante or c.tipo_l = '' then 'Sin comprobante fiscal'
                       when c.tipo_l like '%electr%' then 'Factura electrónica: Marangatu ya la tiene'
                       when c.tipo_l like '%virtual%' then 'Comprobante virtual: Marangatu ya lo tiene'
                       else c.tipo_comprobante || ': no se registra' end) order by c.fecha, c.documento)
      from calc c where not (c.con_comprobante and c.codigo is not null)), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

revoke all on function :"schema".rg90_compras(date, date) from public, anon;
grant execute on function :"schema".rg90_compras(date, date) to authenticated, service_role;
grant execute on function :"schema".rg90_codigo_compra(text), :"schema".rg90_numero(text) to authenticated, service_role;

commit;
