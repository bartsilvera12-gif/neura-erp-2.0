-- Ajustes, pérdidas y traslados entre depósitos.
do $$
declare
  p uuid := pg_temp.producto('Ajuste', 5000);
  a jsonb;
begin
  perform pg_temp.comprar(p, 10, 1000);

  a := registrar_ajuste(jsonb_build_object('tipo', 'ajuste', 'motivo', 'conteo_fisico', 'deposito_id', pg_temp.fx('dep_a'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p, 'modo', 'conteo', 'cantidad', 7))));
  perform pg_temp.igual('conteo: el stock queda en lo contado', pg_temp.stock(p), 7);
  perform anular_ajuste((a->>'id')::uuid, 'prueba');
  perform pg_temp.igual('anular conteo: vuelve el stock', pg_temp.stock(p), 10);

  a := registrar_ajuste(jsonb_build_object('tipo', 'ajuste', 'motivo', 'correccion', 'deposito_id', pg_temp.fx('dep_a'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p, 'modo', 'diferencia', 'cantidad', 5, 'costo_unitario', 1000))));
  perform pg_temp.igual('ajuste positivo: suma', pg_temp.stock(p), 15);

  a := registrar_ajuste(jsonb_build_object('tipo', 'perdida', 'motivo', 'rotura', 'deposito_id', pg_temp.fx('dep_a'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 2))));
  perform pg_temp.igual('pérdida: resta', pg_temp.stock(p), 13);
  perform pg_temp.ok('ajustes: capas cuadradas', (verificar_capas(p)->>'ok')::boolean, (verificar_capas(p))::text);

  perform pg_temp.rechaza('ajuste sin motivo válido',
    format($q$select registrar_ajuste('{"tipo": "ajuste", "motivo": "cualquiera", "items": [{"producto_id": "%s", "cantidad": 1}]}')$q$, p), 'motivo');
  perform pg_temp.rechaza('conteo negativo',
    format($q$select registrar_ajuste('{"tipo": "ajuste", "motivo": "correccion", "deposito_id": "%s", "items": [{"producto_id": "%s", "modo": "conteo", "cantidad": -1}]}')$q$, pg_temp.fx('dep_a'), p), 'no puede ser negativo');
  perform pg_temp.rechaza('pérdida mayor al stock',
    format($q$select registrar_ajuste('{"tipo": "perdida", "motivo": "rotura", "deposito_id": "%s", "items": [{"producto_id": "%s", "cantidad": 999}]}')$q$, pg_temp.fx('dep_a'), p), 'stock');
  perform pg_temp.igual('rechazos: el stock queda igual', pg_temp.stock(p), 13);
exception when others then
  perform pg_temp.ok('ajustes: el escenario se cortó', false, sqlerrm);
end $$;

do $$
declare
  p uuid := pg_temp.producto('Traslado', 5000);
  t jsonb;
  v_item uuid;
begin
  perform pg_temp.comprar(p, 10, 1000);

  t := crear_traslado(jsonb_build_object('deposito_origen_id', pg_temp.fx('dep_a'), 'deposito_destino_id', pg_temp.fx('dep_b'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 4))));
  perform pg_temp.igual('traslado enviado: sale del origen', pg_temp.stock(p, 'dep_a'), 6);
  perform pg_temp.igual('traslado enviado: todavía no llega', pg_temp.stock(p, 'dep_b'), 0);

  perform recibir_traslado((t->>'id')::uuid);
  perform pg_temp.igual('traslado recibido: llega al destino', pg_temp.stock(p, 'dep_b'), 4);
  perform pg_temp.igual('traslado recibido: el total se conserva', (select stock_actual from productos where id = p), 10);
  perform pg_temp.ok('traslado recibido: capas cuadradas', (verificar_capas(p)->>'ok')::boolean, (verificar_capas(p))::text);
  perform pg_temp.rechaza('recibir dos veces', format($q$select recibir_traslado(%L)$q$, t->>'id'), 'ya está');

  -- Llega menos.
  t := crear_traslado(jsonb_build_object('deposito_origen_id', pg_temp.fx('dep_a'), 'deposito_destino_id', pg_temp.fx('dep_b'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 3))));
  select id into v_item from traslados_items where traslado_id = (t->>'id')::uuid;
  perform pg_temp.rechaza('llegó menos sin motivo',
    format($q$select recibir_traslado(%L, '{"items": [{"item_id": "%s", "cantidad_recibida": 2}]}')$q$, t->>'id', v_item), 'motivo');
  perform recibir_traslado((t->>'id')::uuid, jsonb_build_object('diferencia_motivo', 'prueba',
    'items', jsonb_build_array(jsonb_build_object('item_id', v_item, 'cantidad_recibida', 2))));
  perform pg_temp.igual('llegó menos: el destino recibe lo que llegó', pg_temp.stock(p, 'dep_b'), 6);
  perform pg_temp.igual('llegó menos: el origen ya lo había enviado', pg_temp.stock(p, 'dep_a'), 3);

  -- Anulado antes de recibir.
  t := crear_traslado(jsonb_build_object('deposito_origen_id', pg_temp.fx('dep_a'), 'deposito_destino_id', pg_temp.fx('dep_b'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 1))));
  perform anular_traslado((t->>'id')::uuid, 'prueba');
  perform pg_temp.igual('traslado anulado: vuelve al origen', pg_temp.stock(p, 'dep_a'), 3);

  perform pg_temp.rechaza('trasladar más de lo que hay',
    format($q$select crear_traslado('{"deposito_origen_id": "%s", "deposito_destino_id": "%s", "items": [{"producto_id": "%s", "cantidad": 999}]}')$q$, pg_temp.fx('dep_a'), pg_temp.fx('dep_b'), p), 'stock');
  perform pg_temp.rechaza('trasladar al mismo depósito',
    format($q$select crear_traslado('{"deposito_origen_id": "%s", "deposito_destino_id": "%s", "items": [{"producto_id": "%s", "cantidad": 1}]}')$q$, pg_temp.fx('dep_a'), pg_temp.fx('dep_a'), p), 'distintos');
exception when others then
  perform pg_temp.ok('traslados: el escenario se cortó', false, sqlerrm);
end $$;
