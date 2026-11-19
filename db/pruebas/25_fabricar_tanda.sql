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
