-- =============================================================================
-- QA: CAPAS DE COSTO DESCUADRADAS POR VENTAS VIEJAS "SIN LOTE" (datos, no reglas).
--
-- Causa: productos con lotes (receta 44/50) que se vendieron cuando no había un lote vigente
--   que cubriera la venta ("Sin lote vigente que lo cubra"): el stock bajó, pero ningún lote
--   se descontó. Al migrar a capas (receta 79) esas unidades quedaron como FALTANTE sin lote
--   (capas_consumos.capa_id NULL, origen 'stock_inicial') y los lotes mostraban MÁS unidades
--   que el stock real del depósito (ej. Leche entera 1 L en Depósito principal: stock 42,
--   lotes 56, faltante 14). verificar_capas() daba ok (stock = capas + lotes − faltante), pero
--   la ficha "Costo por compra" mostraba 56 unidades en lotes y ninguna capa en ese depósito,
--   y como una entrada CON lote no salda faltantes sin lote, el descuadre no se iba nunca.
--
-- Corrección (sin tocar el stock ni el kardex): por producto con lotes + depósito con faltante
--   sin lote pendiente y lotes por encima de lo que el stock permite, se descuenta ese exceso
--   de los lotes en orden FEFO (como habría salido la venta) con un lotes_movimientos SALIDA
--   'ajuste' (motivo "Corrección de datos (85)…") y se salda el faltante por lo mismo.
--   Queda: stock = Σ capas + Σ lotes, faltante 0.
-- Al final exige verificar_capas() sin diferencias en las empresas del schema.
--
-- IDEMPOTENTE (sin faltantes ni exceso no hace nada). Va después de 84.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $fix$
declare
  r record;
  l record;
  f record;
  v_exceso numeric;
  v_resta numeric;
  v_toma numeric;
  v_hecho numeric;
begin
  for r in
    select sd.empresa_id, sd.producto_id, sd.deposito_id, sd.cantidad as stock,
           coalesce((select sum(x.cantidad) from lotes x
                      where x.producto_id = sd.producto_id and x.deposito_id = sd.deposito_id and x.cantidad > 0), 0) as en_lotes,
           coalesce((select sum(c.quedan) from capas_costo c
                      where c.producto_id = sd.producto_id and c.deposito_id = sd.deposito_id), 0) as en_capas,
           coalesce((select sum(c.cantidad - c.revertido - c.saldado - c.trasladado) from capas_consumos c
                      where c.producto_id = sd.producto_id and c.deposito_id = sd.deposito_id and c.capa_id is null), 0) as faltante
      from stock_depositos sd
      join productos p on p.id = sd.producto_id and p.controla_stock and p.controla_lotes
  loop
    -- Lo que los lotes tienen de más respecto del stock (sin pasar el faltante pendiente).
    v_exceso := least(r.faltante, r.en_lotes - (r.stock - r.en_capas));
    continue when v_exceso is null or v_exceso <= 0;

    v_resta := v_exceso;
    for l in
      select x.id, x.cantidad from lotes x
       where x.producto_id = r.producto_id and x.deposito_id = r.deposito_id and x.cantidad > 0
       order by x.vencimiento, x.created_at, x.id
       for update
    loop
      exit when v_resta <= 0;
      v_toma := least(l.cantidad, v_resta);
      update lotes set cantidad = cantidad - v_toma where id = l.id;
      -- lote_id no nulo y origen 'ajuste': el gancho de capas (79) no lo toca.
      insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, motivo, created_by)
        values (r.empresa_id, r.producto_id, l.id, r.deposito_id, 'SALIDA', v_toma, 'ajuste',
                'Corrección de datos (85): ventas viejas sin lote que no descontaron del lote', null);
      v_resta := v_resta - v_toma;
    end loop;

    -- Saldar el faltante sin lote por lo que se descontó de los lotes.
    v_hecho := v_exceso - v_resta;
    for f in
      select c.id, c.cantidad - c.revertido - c.saldado - c.trasladado as pend from capas_consumos c
       where c.producto_id = r.producto_id and c.deposito_id = r.deposito_id and c.capa_id is null
         and c.cantidad - c.revertido - c.saldado - c.trasladado > 0
       order by c.created_at, c.id
       for update
    loop
      exit when v_hecho <= 0;
      v_toma := least(f.pend, v_hecho);
      update capas_consumos set saldado = saldado + v_toma where id = f.id;
      v_hecho := v_hecho - v_toma;
    end loop;
  end loop;
end
$fix$;

-- Invariante (79): sin diferencias en ninguna empresa del schema.
do $chk$
declare
  v jsonb := verificar_capas();
begin
  if not coalesce((v->>'ok')::boolean, false) then
    raise exception 'verificar_capas() sigue con diferencias: %', v;
  end if;
end
$chk$;

commit;

notify pgrst, 'reload schema';
