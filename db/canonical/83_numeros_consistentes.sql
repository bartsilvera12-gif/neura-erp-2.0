-- =============================================================================
-- 83 · Mismos números en todas las pantallas.
--   · Valor del stock: Inicio, Pérdidas y Depósitos redondean cada producto + depósito antes de
--     sumar, igual que el reporte Existencias por depósito (antes Inicio daba Gs. 27.156.712 y
--     Existencias Gs. 27.156.708 por redondear en distinto lugar).
--   · Medios de pago del reporte de ventas: "billetera" va junto con QR ("QR / billetera", como
--     en la caja y los tickets).
-- IDEMPOTENTE (el parche no se aplica dos veces).
-- =============================================================================

-- El parche busca las funciones en el schema del cliente (current_schema()).
set search_path to :"schema", public;

do $patch$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.proname in ('dashboard_inicio', 'reporte_perdidas', 'sucursales_depositos')
  loop
    v_def := pg_get_functiondef(r.oid);
    -- Ya parcheada (segunda corrida): no se toca.
    continue when strpos(v_def, 'round(capas_valor(sd.producto_id') > 0;
    v_new := replace(v_def, 'capas_valor(sd.producto_id, sd.deposito_id, sd.cantidad, p.costo_promedio)',
                     'round(capas_valor(sd.producto_id, sd.deposito_id, sd.cantidad, p.costo_promedio))');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end
$patch$;

create or replace function :"schema".categoria_pago(p_metodo text)
returns text language sql immutable as $$
  select case
    when p_metodo is null then 'otro'
    when lower(p_metodo) like 'tarjeta%' or lower(p_metodo) like 'pos%' then 'tarjeta'
    when lower(p_metodo) in ('qr', 'billetera') then 'qr'
    when lower(p_metodo) in ('efectivo', 'transferencia', 'cheque') then lower(p_metodo)
    else 'otro'
  end
$$;
