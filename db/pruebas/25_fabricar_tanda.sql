-- =============================================================================
-- MENÚ FABRICABLE POR TANDA (receta 168). Un producto vendible (Menú) que se fabrica a stock
-- desde su receta y se vende de ese stock, sin volver a explotar los ingredientes al vender.
-- Ejemplo del dueño: maní (materia prima) → bolsas de maní (Menú por tanda) para vender.
-- =============================================================================
do $$
declare
  v_mani uuid;
  v_bolsa uuid;
begin
  -- Ingrediente: maní (materia prima con stock propio).
  v_mani := pg_temp.producto('Maní', 0);
  update productos set tipo_producto = 'materia_prima', unidad_medida = 'kg' where id = v_mani;
  perform pg_temp.comprar(v_mani, 100, 5000);   -- 100 kg a Gs. 5.000/kg

  -- Producto vendible: bolsa de maní de 1 kg (Menú), receta = 1 kg de maní, marcada "por tanda".
  v_bolsa := pg_temp.producto('Bolsa de maní 1kg', 20000);
  update productos set tipo_producto = 'menu' where id = v_bolsa;
  perform receta_guardar(jsonb_build_object(
    'producto_id', v_bolsa, 'rendimiento', 1, 'por_tanda', true,
    'items', jsonb_build_array(jsonb_build_object('insumo_id', v_mani, 'cantidad', 1, 'unidad', 'kg'))));

  insert into prueba_fx values ('mani', v_mani), ('bolsa', v_bolsa);
end $$;

-- El Menú por tanda lleva stock propio y arranca en 0.
select pg_temp.ok('menu por tanda lleva stock propio', (select controla_stock from productos where id = pg_temp.fx('bolsa')));
select pg_temp.igual('la bolsa arranca sin stock', pg_temp.stock(pg_temp.fx('bolsa')), 0);

-- Aparece en la lista de fabricables (el viejo "Fabricado" seguía apareciendo; el Menú por tanda también).
select pg_temp.ok('la bolsa es fabricable',
  exists (select 1 from jsonb_array_elements(fabricables(pg_temp.fx('dep_a'))->'items') i where (i->>'id')::uuid = pg_temp.fx('bolsa')));

-- Fabricar 10 bolsas: consume 10 kg de maní (quedan 90) y suma 10 bolsas.
do $$ begin
  perform fabricar(jsonb_build_object('producto_id', pg_temp.fx('bolsa'), 'cantidad', 10, 'deposito_id', pg_temp.fx('dep_a')));
end $$;
select pg_temp.igual('fabricar suma el stock de la bolsa', pg_temp.stock(pg_temp.fx('bolsa')), 10);
select pg_temp.igual('fabricar consume el maní', pg_temp.stock(pg_temp.fx('mani')), 90);

-- Vender 3 bolsas: baja el stock propio de la bolsa (quedan 7) y NO vuelve a tocar el maní.
do $$ begin perform pg_temp.vender(pg_temp.fx('bolsa'), 3); end $$;
select pg_temp.igual('vender baja el stock de la bolsa', pg_temp.stock(pg_temp.fx('bolsa')), 7);
select pg_temp.igual('vender NO explota el maní', pg_temp.stock(pg_temp.fx('mani')), 90);

-- No se puede vender más de lo fabricado.
select pg_temp.rechaza('no se vende más que el stock fabricado',
  $q$ select pg_temp.vender(pg_temp.fx('bolsa'), 100) $q$, 'Stock insuficiente');

-- Un Menú SIN "por tanda" sigue como siempre: no lleva stock y al vender explota sus ingredientes.
do $$
declare v_plato uuid;
begin
  v_plato := pg_temp.producto('Plato con maní', 15000);
  update productos set tipo_producto = 'menu' where id = v_plato;
  perform receta_guardar(jsonb_build_object(
    'producto_id', v_plato, 'rendimiento', 1, 'por_tanda', false,
    'items', jsonb_build_array(jsonb_build_object('insumo_id', pg_temp.fx('mani'), 'cantidad', 2, 'unidad', 'kg'))));
  insert into prueba_fx values ('plato', v_plato);
end $$;
select pg_temp.ok('menu normal NO lleva stock', not (select controla_stock from productos where id = pg_temp.fx('plato')));
do $$ begin perform pg_temp.vender(pg_temp.fx('plato'), 1); end $$;
select pg_temp.igual('menu normal explota el maní al vender', pg_temp.stock(pg_temp.fx('mani')), 88);

-- MERMA al fabricar: el consumo es el BRUTO = neto / (1 − merma). Ej. 1 kg neto con 20% de merma.
do $$
declare v_harina uuid; v_pan uuid;
begin
  v_harina := pg_temp.producto('Harina', 0);
  update productos set tipo_producto = 'materia_prima', unidad_medida = 'kg' where id = v_harina;
  perform pg_temp.comprar(v_harina, 100, 3000);        -- 100 kg a Gs. 3.000/kg
  v_pan := pg_temp.producto('Pan por tanda', 5000);
  update productos set tipo_producto = 'menu' where id = v_pan;
  perform receta_guardar(jsonb_build_object(
    'producto_id', v_pan, 'rendimiento', 1, 'por_tanda', true,
    'items', jsonb_build_array(jsonb_build_object('insumo_id', v_harina, 'cantidad', 1, 'unidad', 'kg', 'merma_pct', 20))));
  insert into prueba_fx values ('harina', v_harina), ('pan', v_pan);
end $$;
-- Fabricar 8 panes: neto 8 kg, con 20% de merma consume 8 / 0,8 = 10 kg → de 100 quedan 90.
do $$ begin perform fabricar(jsonb_build_object('producto_id', pg_temp.fx('pan'), 'cantidad', 8, 'deposito_id', pg_temp.fx('dep_a'))); end $$;
select pg_temp.igual('la merma del 20% se aplica al fabricar (bruto = neto / 0,8)', pg_temp.stock(pg_temp.fx('harina')), 90);
select pg_temp.igual('entran los 8 panes fabricados', pg_temp.stock(pg_temp.fx('pan')), 8);
-- La merma va al costo: 10 kg × 3.000 = 30.000 repartido en 8 panes = 3.750 (sin merma sería 3.000).
select pg_temp.igual('la merma sube el costo del pan', (select costo_promedio from productos where id = pg_temp.fx('pan')), 3750);

-- FABRICAR SOLO MENÚ (receta 169): una materia prima por tanda NO se puede fabricar.
do $$
declare v_prep uuid;
begin
  v_prep := pg_temp.producto('Salsa por tanda', 0);
  update productos set tipo_producto = 'materia_prima', unidad_medida = 'kg' where id = v_prep;
  perform receta_guardar(jsonb_build_object(
    'producto_id', v_prep, 'rendimiento', 1, 'por_tanda', true,
    'items', jsonb_build_array(jsonb_build_object('insumo_id', pg_temp.fx('harina'), 'cantidad', 1, 'unidad', 'kg'))));
  insert into prueba_fx values ('prep', v_prep);
end $$;
select pg_temp.rechaza('una materia prima no se fabrica (solo Menú)',
  $q$ select fabricar(jsonb_build_object('producto_id', pg_temp.fx('prep'), 'cantidad', 1, 'deposito_id', pg_temp.fx('dep_a'))) $q$,
  'solo los productos Menú');
select pg_temp.ok('la materia prima no aparece en la lista de fabricables',
  not exists (select 1 from jsonb_array_elements(fabricables(pg_temp.fx('dep_a'))->'items') i where (i->>'id')::uuid = pg_temp.fx('prep')));
