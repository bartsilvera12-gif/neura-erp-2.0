-- Ficha del cliente en Inmobiliaria (receta 134): búsquedas con coincidencias, interesados y lo suyo.
do $$
declare
  v jsonb;
  b jsonb;
  p1 jsonb; p2 jsonb;
  v_cli uuid;
  v_duena uuid;
  v_casa uuid;
begin
  v := guardar_funciones_empresa('{"inmobiliaria": true}');
  select (x->>'id')::uuid into v_casa from jsonb_array_elements(propiedad_tipos_lista()) x where x->>'nombre' = 'Casa';
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Busca casa') returning id into v_cli;
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Dueña ficha') returning id into v_duena;

  p1 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Casa barata Luque', 'tipo_id', v_casa, 'gestion', 'venta', 'precio_venta', 300000000,
    'ciudad', 'Luque', 'superficie_terreno', 400, 'propia', false, 'propietario_id', v_duena, 'comision_venta_pct', 3));
  p2 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Casa cara Luque', 'tipo_id', v_casa, 'gestion', 'venta', 'precio_venta', 900000000, 'ciudad', 'Luque'));

  b := cliente_busqueda_guardar(jsonb_build_object('cliente_id', v_cli, 'gestion', 'venta', 'tipo_id', v_casa, 'ciudad', 'Luque',
    'precio_max', 500000000, 'superficie_min', 300, 'notas', 'PRUEBA con patio'));
  perform pg_temp.ok('Búsqueda: encuentra solo la que cumple precio y m²',
    jsonb_array_length(b->'coincidencias') = 1 and b->'coincidencias'->0->>'id' = p1->>'id', b::text);

  v := propiedad_interesados((p1->>'id')::uuid);
  perform pg_temp.ok('Interesados: la propiedad sabe quién la busca', exists (select 1 from jsonb_array_elements(v) x where (x->>'cliente_id')::uuid = v_cli), v::text);
  v := propiedad_interesados((p2->>'id')::uuid);
  perform pg_temp.ok('Interesados: la cara no le sirve', not exists (select 1 from jsonb_array_elements(v) x where (x->>'cliente_id')::uuid = v_cli), v::text);

  -- Vendida, deja de coincidir.
  perform propiedad_estado((p1->>'id')::uuid, 'vendida');
  v := cliente_inmobiliaria(v_cli);
  perform pg_temp.igual('Búsqueda: una vendida ya no coincide', jsonb_array_length(v->'busquedas'->0->'coincidencias')::numeric, 0);

  v := cliente_inmobiliaria(v_duena);
  perform pg_temp.ok('Ficha: la dueña ve su propiedad con la comisión',
    jsonb_array_length(v->'como_dueno') = 1 and (v->'como_dueno'->0->>'comision_venta_pct')::numeric = 3, v::text);

  perform cliente_busqueda_borrar((b->>'id')::uuid);
  perform pg_temp.igual('Búsqueda: se borra', jsonb_array_length(cliente_inmobiliaria(v_cli)->'busquedas')::numeric, 0);
  perform pg_temp.rechaza('Búsqueda: nadie la lee directo', $q$select * from cliente_busquedas$q$, 'permission denied');
  perform guardar_funciones_empresa('{"inmobiliaria": false}');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Ficha inmobiliaria: el escenario se cortó', false, sqlerrm);
end $$;
