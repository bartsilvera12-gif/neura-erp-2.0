-- =============================================================================
-- CONTRAPARTIDA DE LA CORRECCIÓN DE LOTES DE LA RECETA 85.
--
-- La 85 bajó del lote lo que ventas viejas sin lote no habían descontado. El lote quedó bien, pero esas
-- ventas siguen contando como "sin lote" y verificar_lotes marca una diferencia que no existe.
-- Por cada corrección se asienta la entrada "sin lote" que la compensa.
-- No cambia el stock, ni la cantidad de ningún lote, ni el kardex.
--
-- IDEMPOTENTE. Va después de 116.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- El trigger crearía una capa de costo por esta entrada, y acá no entra mercadería.
alter table lotes_movimientos disable trigger trg_lotes_mov_capas;

insert into lotes_movimientos (empresa_id, producto_id, deposito_id, lote_id, tipo, cantidad, origen, motivo)
select c.empresa_id, c.producto_id, c.deposito_id, null, 'ENTRADA', c.cantidad, 'ajuste',
       'Contrapartida de la corrección de datos (85)'
  from lotes_movimientos c
 where c.motivo like 'Corrección de datos (85)%'
   and c.lote_id is not null
   and not exists (select 1 from lotes_movimientos x
                    where x.motivo = 'Contrapartida de la corrección de datos (85)'
                      and x.producto_id = c.producto_id and x.deposito_id = c.deposito_id);

alter table lotes_movimientos enable trigger trg_lotes_mov_capas;

commit;
