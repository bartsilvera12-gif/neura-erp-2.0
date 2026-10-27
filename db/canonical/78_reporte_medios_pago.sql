-- =============================================================================
-- 78 · Reporte de ventas: medios de pago bien agrupados.
--   · Los cobros con posnet (pos, pos_debito, pos_credito) son tarjeta: van a "Tarjeta" y
--     ya no aparecen sueltos como "POS".
--   · QR tiene su propio renglón (antes caía en "Otros").
-- Solo cambia categoria_pago (receta 15), que usan los reportes de ventas para agrupar y
-- filtrar. IDEMPOTENTE.
-- =============================================================================

create or replace function :"schema".categoria_pago(p_metodo text)
returns text language sql immutable as $$
  select case
    when p_metodo is null then 'otro'
    when lower(p_metodo) like 'tarjeta%' or lower(p_metodo) like 'pos%' then 'tarjeta'
    when lower(p_metodo) = 'qr' then 'qr'
    when lower(p_metodo) in ('efectivo', 'transferencia', 'cheque') then lower(p_metodo)
    else 'otro'
  end
$$;
