-- =============================================================================
-- REGISTRO DE COMPROBANTES — RG 90, etapa 2: VENTAS (tipo de registro 1, 19 campos).
--
-- Facturas (109) y notas de crédito (110, con la factura asociada) del autoimpresor, con el número
-- fiscal de la receta 101. Las electrónicas nunca van: Marangatu ya las tiene. Los tickets tampoco.
--
-- rg90_ventas(p_desde, p_hasta) → jsonb { filas[], excluidos[] } (mismas claves que rg90_compras)
--   · Montos por tasa con IVA incluido, de los ítems, en guaraníes enteros. La SET exige que el
--     total sea igual a la suma de los tres: si los ítems no dan el total, va como problema.
--   · Cliente: 11 (RUC sin dígito verificador) o 15 "sin nombre" para el cliente ocasional.
--   · Anuladas: no se registran (la especificación de la SET no prevé cómo informarlas).
--   · Sin número fiscal (antes del autoimpresor): van a `excluidos` con manual = true, porque en
--     modo autoimpresor hay que cargarlas a mano en Marangatu.
-- rg90_registro(p_desde, p_hasta) → compras + ventas juntas: el archivo admite los dos tipos.
-- Permiso: "Ver reportes financieros" (rep_sesion).
--
-- IDEMPOTENTE. Va después de 101.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".rg90_ventas(p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  v_modo text;
  v_sifen boolean;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], null);
  select * into g from rep_rango(p_desde, p_hasta);
  select coalesce(c.modo, 'sin_factura_fiscal') into v_modo from facturacion_config c where c.empresa_id = s.s_empresa;
  select coalesce(x.activo, false) into v_sifen from sifen_config x where x.empresa_id = s.s_empresa;

  with base as (
    select 'venta'::text as origen, v.id, v.numero_control as documento,
           (v.fecha at time zone 'America/Asuncion')::date as fecha,
           v.estado = 'anulada' as anulado, 109 as codigo, 'Factura'::text as tipo_comprobante,
           v.fiscal_numero, v.fiscal_timbrado, null::text as asociado, null::text as timbrado_asociado,
           v.receptor_nombre, v.receptor_ruc, v.receptor_ocasional, v.tipo_venta, v.plazo_dias, v.cuotas,
           v.moneda, coalesce(v.tipo_cambio, 1) as tc, coalesce(v.total, 0) as total,
           m.t10, m.t5, m.tex
      from ventas v
      cross join lateral (
        select coalesce(sum(i.total_linea) filter (where upper(i.tipo_iva) = '10%'), 0) as t10,
               coalesce(sum(i.total_linea) filter (where upper(i.tipo_iva) = '5%'), 0) as t5,
               coalesce(sum(i.total_linea) filter (where upper(i.tipo_iva) not in ('10%', '5%')), 0) as tex
          from ventas_items i where i.venta_id = v.id) m
     where v.empresa_id = s.s_empresa and v.tipo_documento = 'factura'
       and (v.fecha at time zone 'America/Asuncion')::date between g.r_desde and g.r_hasta
    union all
    select 'nota_credito', n.id, n.numero, (n.fecha at time zone 'America/Asuncion')::date,
           n.estado = 'anulada', 110, 'Nota de crédito',
           n.fiscal_numero, n.fiscal_timbrado, v.fiscal_numero, v.fiscal_timbrado,
           v.receptor_nombre, v.receptor_ruc, v.receptor_ocasional, v.tipo_venta, v.plazo_dias, v.cuotas,
           v.moneda, coalesce(v.tipo_cambio, 1), coalesce(n.total, 0),
           m.t10, m.t5, m.tex
      from notas_credito n
      join ventas v on v.id = n.venta_id
      cross join lateral (
        select coalesce(sum(i.total_linea) filter (where upper(i.tipo_iva) = '10%'), 0) as t10,
               coalesce(sum(i.total_linea) filter (where upper(i.tipo_iva) = '5%'), 0) as t5,
               coalesce(sum(i.total_linea) filter (where upper(i.tipo_iva) not in ('10%', '5%')), 0) as tex
          from notas_credito_items i where i.nota_id = n.id) m
     where n.empresa_id = s.s_empresa and v.tipo_documento = 'factura'
       and (n.fecha at time zone 'America/Asuncion')::date between g.r_desde and g.r_hasta
  ), calc as (
    select b.*,
           nullif(upper(btrim(coalesce(b.receptor_ruc, ''))), 'X') as ruc_l,
           regexp_replace(coalesce(b.fiscal_timbrado, ''), '\D', '', 'g') as timbrado_l,
           rg90_numero(b.fiscal_numero) as numero_l,
           rg90_numero(b.asociado) as asociado_l,
           regexp_replace(coalesce(b.timbrado_asociado, ''), '\D', '', 'g') as timbrado_asoc_l,
           round(b.t10 * x.fx) as m10, round(b.t5 * x.fx) as m5, round(b.tex * x.fx) as mex,
           round(b.total * x.fx) as gtotal
      from base b
      cross join lateral (select case when b.moneda = 'USD' then b.tc else 1 end as fx) x
  ), filas as (
    select c.*,
           c.m10 + c.m5 + c.mex as mtotal,
           case when c.receptor_ocasional or c.ruc_l is null then 15 else 11 end as tipo_ident,
           case when c.receptor_ocasional or c.ruc_l is null then 'X' else split_part(c.ruc_l, '-', 1) end as ident,
           array_remove(array[
             case when c.ruc_l is null and not c.receptor_ocasional then 'Falta el RUC del cliente' end,
             case when length(c.timbrado_l) <> 8 then 'El timbrado tiene que tener 8 dígitos' end,
             case when c.numero_l is null then 'El número tiene que ser 001-001-0000123' end,
             case when c.m10 + c.m5 + c.mex <= 0 then 'El total es cero' end,
             case when abs(c.m10 + c.m5 + c.mex - c.gtotal) > 1 then 'Los productos no suman el total del comprobante' end,
             case when c.codigo = 110 and (c.asociado_l is null or length(c.timbrado_asoc_l) <> 8) then 'Falta la factura asociada' end
           ], null) as problemas
      from calc c
     where c.fiscal_numero is not null and not c.anulado
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'origen', f.origen, 'id', f.id, 'documento', f.documento, 'fecha', f.fecha,
        'proveedor', case when f.receptor_ocasional then 'Cliente ocasional' else f.receptor_nombre end, 'ruc', f.receptor_ruc,
        'tipo_comprobante', f.tipo_comprobante, 'codigo', f.codigo,
        'tipo_ident', f.tipo_ident, 'ident', f.ident, 'timbrado', f.timbrado_l, 'numero', coalesce(f.numero_l, f.fiscal_numero),
        'gravado_10', f.m10, 'gravado_5', f.m5, 'exento', f.mex, 'total', f.mtotal,
        -- La "factura al contado" se guarda como CREDITO con plazo 0 y una cuota.
        'condicion', case when f.tipo_venta = 'CREDITO' and not (f.plazo_dias = 0 and coalesce(f.cuotas, 1) <= 1) then 2 else 1 end,
        'moneda_extranjera', f.moneda = 'USD', 'iva_credito', 0,
        'asociado', f.asociado_l, 'timbrado_asociado', nullif(f.timbrado_asoc_l, ''),
        'problemas', to_jsonb(f.problemas)) order by f.fecha, f.codigo, f.fiscal_numero)
      from filas f), '[]'::jsonb),
    'excluidos', coalesce((select jsonb_agg(jsonb_build_object(
        'origen', c.origen, 'id', c.id, 'documento', c.documento, 'fecha', c.fecha,
        'proveedor', case when c.receptor_ocasional then 'Cliente ocasional' else c.receptor_nombre end, 'tipo_comprobante', c.tipo_comprobante, 'total', c.gtotal,
        'manual', not c.anulado and v_modo = 'autoimpresor',
        'motivo', case when c.anulado then 'Anulada'
                       when v_modo = 'autoimpresor' then 'Sin número fiscal: cargala a mano en Marangatu'
                       when v_modo = 'sifen' and coalesce(v_sifen, false) then 'Factura electrónica: Marangatu ya la tiene'
                       else 'Sin número fiscal: la empresa todavía no factura por autoimpresor' end) order by c.fecha, c.documento)
      from calc c where c.anulado and c.fiscal_numero is not null or (not c.anulado and c.fiscal_numero is null)), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

create or replace function :"schema".rg90_registro(p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  c jsonb := rg90_compras(p_desde, p_hasta);
  v jsonb := rg90_ventas(p_desde, p_hasta);
begin
  return c || jsonb_build_object('filas', (v->'filas') || (c->'filas'), 'excluidos', (v->'excluidos') || (c->'excluidos'));
end;
$fn$;

revoke all on function :"schema".rg90_ventas(date, date) from public, anon;
revoke all on function :"schema".rg90_registro(date, date) from public, anon;
grant execute on function :"schema".rg90_ventas(date, date), :"schema".rg90_registro(date, date) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
